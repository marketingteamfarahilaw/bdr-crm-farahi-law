/**
 * Outbound call-recap webhook → Zapier / n8n → Filevine.
 *
 * Rather than calling the Filevine API directly (which needs an admin-issued API
 * key), the CRM POSTs each finished call recap to a webhook URL. A Zapier/n8n
 * automation — using the org's already-authorized Filevine connector — turns it
 * into a Filevine Task. The CRM already produces the AI summary/recap/tasks, so
 * the automation just maps fields (no AI step required), though we include the
 * raw transcript too in case you want one.
 *
 * The webhook URL is stored in app_settings ("filevine_webhook_url") or the
 * FILEVINE_WEBHOOK_URL env var. If neither is set, this is a no-op.
 */
import axios from "axios";
import { getSetting } from "./db";

export type CallRecapPayload = {
  event: "call_recap";
  facilityId: number | null;
  facilityName: string | null;
  facilityCategory?: string | null;
  facilityCity?: string | null;
  facilityPhone?: string | null;
  agent: string | null;
  callTime: string;            // ISO 8601 — "when"
  callTimeLocal?: string;      // human-friendly local string
  durationStr: string | null;  // "M:SS"
  durationSeconds?: number | null;
  callResult?: string | null;  // connected | voicemail | no_answer | ...
  direction?: string | null;
  summary: string;             // AI recap summary
  keyPoints: string[];         // recap bullets
  sentiment?: string | null;
  interestLevel?: string | null;
  tasks: Array<{ title: string; priority: string; dueInDays?: number }>;
  transcript?: string | null;
  source: "bdcrm";
};

let warnedNoUrl = false;

export async function getFilevineWebhookUrl(): Promise<string> {
  const fromDb = await getSetting("filevine_webhook_url");
  return (fromDb && fromDb.trim()) || (process.env.FILEVINE_WEBHOOK_URL ?? "").trim();
}

/**
 * Best-effort: POST a call recap to the configured webhook. Never throws — a
 * webhook failure must never block call logging / transcription.
 */
export async function sendCallRecapToWebhook(payload: CallRecapPayload): Promise<void> {
  try {
    const url = await getFilevineWebhookUrl();
    if (!url) {
      if (!warnedNoUrl) {
        console.log("[filevineHook] no webhook URL configured — skipping Filevine push.");
        warnedNoUrl = true;
      }
      return;
    }
    await axios.post(url, payload, {
      timeout: 10000,
      headers: { "Content-Type": "application/json" },
    });
    console.log(`[filevineHook] pushed recap → Filevine webhook for "${payload.facilityName ?? payload.facilityId}" (${payload.durationStr ?? "?"}).`);
  } catch (e: any) {
    console.warn("[filevineHook] webhook post failed:", e?.response?.status ?? e?.message ?? e);
  }
}
