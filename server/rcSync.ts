/**
 * Account-wide RingCentral call sync.
 *
 * The team places calls from the RingCentral desktop app / desk phone / mobile.
 * RingCentral records them; this pulls recent calls, matches each to a facility
 * by phone number, and — for new, recorded calls — transcribes them, generates
 * an AI summary, and auto-creates follow-up tasks. Dedupe is by the RingCentral
 * call-log id (contact_logs.rcCallId) so a call is never processed twice.
 *
 * The access token is passed in by the caller (crmRouter / the poller) so this
 * module never imports the token logic — keeps it free of circular deps.
 */
import axios from "axios";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import { createContactLog, createFacilityUpdate, createTask, getExistingRcCallIds, getExistingRcSessionIds } from "./crmDb";
import { sendCallRecapToWebhook } from "./filevineHook";
import { getDb } from "./db";
import { facilities } from "../drizzle/schema";

const RC_BASE = "https://platform.ringcentral.com";

export type CallAnalysis = {
  summary: string;
  actionItems: string[];
  followUpTasks: Array<{ title: string; priority: "high" | "medium" | "low"; dueInDays?: number }>;
  extractedData: Record<string, unknown>;
};

/**
 * Analyze a call transcript: 2-3 sentence summary, action items, follow-up
 * tasks, and structured signals. Returns empties on any LLM/parse failure.
 * Shared by logFacilityCall (live widget calls) and the account-wide sync.
 */
export async function analyzeCallTranscript(transcriptText: string): Promise<CallAnalysis> {
  const empty: CallAnalysis = { summary: "", actionItems: [], followUpTasks: [], extractedData: {} };
  if (!transcriptText) return empty;
  try {
    const llmResp = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a business development assistant for a personal injury law firm. Analyze this phone call transcript between a BD rep and a facility partner (chiropractor, body shop, physical therapist, etc.).

Return a JSON object with EXACTLY these fields:
{
  "summary": "2-3 sentence summary of what was discussed, tone of the conversation, and outcome",
  "keyPoints": ["3-5 short bullet points recapping the key things discussed and the outcome — this is the 'Recap'", ...],
  "actionItems": ["string", ...],
  "followUpTasks": [
    { "title": "string", "priority": "high|medium|low", "dueInDays": number }
  ],
  "contactPerson": "name of person spoken to if mentioned, else null",
  "relationshipTone": "warm|neutral|cold|hostile",
  "sentiment": "positive|neutral|negative",
  "interestLevel": "interested|not_interested|neutral",
  "leadsDiscussed": true or false,
  "commitmentMade": "brief description of any commitment made, else null"
}

For sentiment: the overall emotional tone of the partner toward our firm on this call.
For interestLevel: is the partner interested in partnering / sending or receiving referrals? "interested" = engaged, positive, made a commitment, or wants to continue; "not_interested" = declined, brushed off, hostile, or asked us to stop; "neutral" = noncommittal or purely informational.

For actionItems: list concrete things the BD rep needs to do (e.g. "Send referral package to Dr. Smith", "Follow up on 3 pending cases").
For followUpTasks: list tasks that should be scheduled (e.g. check-in calls, sending materials, visiting the facility). Set dueInDays based on urgency (1-3 for urgent, 7 for this week, 14 for next 2 weeks, 30 for next month).
Be specific and actionable. If nothing was discussed, return empty arrays.`,
        },
        { role: "user", content: transcriptText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "call_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              keyPoints: { type: "array", items: { type: "string" } },
              actionItems: { type: "array", items: { type: "string" } },
              followUpTasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    priority: { type: "string", enum: ["high", "medium", "low"] },
                    dueInDays: { type: "number" },
                  },
                  required: ["title", "priority", "dueInDays"],
                  additionalProperties: false,
                },
              },
              contactPerson: { type: ["string", "null"] },
              relationshipTone: { type: "string", enum: ["warm", "neutral", "cold", "hostile"] },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              interestLevel: { type: "string", enum: ["interested", "not_interested", "neutral"] },
              leadsDiscussed: { type: "boolean" },
              commitmentMade: { type: ["string", "null"] },
            },
            required: ["summary", "keyPoints", "actionItems", "followUpTasks", "contactPerson", "relationshipTone", "sentiment", "interestLevel", "leadsDiscussed", "commitmentMade"],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = llmResp.choices[0]?.message?.content as string;
    const parsed = JSON.parse(raw);
    return {
      summary: parsed.summary ?? "",
      actionItems: parsed.actionItems ?? [],
      followUpTasks: parsed.followUpTasks ?? [],
      extractedData: {
        keyPoints: parsed.keyPoints ?? [],
        contactPerson: parsed.contactPerson,
        relationshipTone: parsed.relationshipTone,
        sentiment: parsed.sentiment,
        interestLevel: parsed.interestLevel,
        leadsDiscussed: parsed.leadsDiscussed,
        commitmentMade: parsed.commitmentMade,
        actionItems: parsed.actionItems ?? [],
        followUpTasks: parsed.followUpTasks ?? [],
      },
    };
  } catch (e) {
    console.warn("[rcSync] analyzeCallTranscript failed:", (e as any)?.message ?? e);
    return empty;
  }
}

const onlyDigits = (s?: string | null) => (s || "").replace(/\D/g, "");

type FacIndexEntry = { id: number; name: string; assignedRepId: number | null; assignedRepName: string | null; digits: string[] };

async function buildFacilityIndex(): Promise<FacIndexEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: facilities.id,
      name: facilities.name,
      assignedRepId: facilities.assignedRepId,
      assignedRepName: facilities.assignedRepName,
      phone: facilities.phone,
      phone2: facilities.phone2,
      phone3: facilities.phone3,
      contactPhone: facilities.contactPhone,
    })
    .from(facilities);
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    assignedRepId: (f.assignedRepId as number | null) ?? null,
    assignedRepName: (f.assignedRepName as string | null) ?? null,
    digits: [f.phone, f.phone2, f.phone3, f.contactPhone].map(onlyDigits).filter((d) => d.length >= 7),
  }));
}

function matchFacility(index: FacIndexEntry[], fromDigits: string, toDigits: string): FacIndexEntry | null {
  for (const f of index) {
    for (const d of f.digits) {
      const hitFrom = fromDigits.length >= 7 && (fromDigits.endsWith(d) || d.endsWith(fromDigits));
      const hitTo = toDigits.length >= 7 && (toDigits.endsWith(d) || d.endsWith(toDigits));
      if (hitFrom || hitTo) return f;
    }
  }
  return null;
}

export type SyncResult = { scanned: number; matched: number; logged: number; transcribed: number; skippedRecent: number };

/**
 * Pull recent calls and process the new ones. `accessToken` must be a valid RC
 * token (caller obtains it via getValidRCToken).
 */
export async function syncRecentCalls(
  accessToken: string,
  opts: {
    lookbackMinutes?: number;
    settleMinutes?: number;
    transcribe?: boolean;
    perPage?: number;
    dryRun?: boolean;
    /** When set (per-agent sync), every logged call / recap / task is attributed
     *  to this CRM user instead of the call's RingCentral display name. */
    attribution?: { repId?: number; repName?: string };
  } = {}
): Promise<SyncResult> {
  const attribution = opts.attribution;
  const lookbackMinutes = opts.lookbackMinutes ?? 90;
  const settleMs = (opts.settleMinutes ?? 2) * 60 * 1000;
  const transcribe = opts.transcribe ?? true;
  const perPage = opts.perPage ?? 250;
  const dryRun = opts.dryRun ?? false;

  const dateFrom = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
  const resp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { dateFrom, perPage, view: "Detailed" },
  });
  const records: any[] = resp.data?.records ?? [];
  const result: SyncResult = { scanned: records.length, matched: 0, logged: 0, transcribed: 0, skippedRecent: 0 };
  if (records.length === 0) return result;

  // Dedupe: skip a record if EITHER its per-extension call id OR its stable
  // cross-extension telephonySessionId is already logged. The latter prevents
  // double-logging one physical call that appears in two agents' extension logs
  // (ring group / shared line / transferred inbound) with different record ids.
  const ids = records.map((r) => String(r.id)).filter(Boolean);
  const sessionIds = records.map((r) => String(r.telephonySessionId ?? r.sessionId ?? "")).filter(Boolean);
  const existing = await getExistingRcCallIds(ids);
  const existingSessions = await getExistingRcSessionIds(sessionIds);

  const index = await buildFacilityIndex();
  const now = Date.now();

  for (const r of records) {
    const id = String(r.id);
    const sessionId = String(r.telephonySessionId ?? r.sessionId ?? "");
    if (!id || existing.has(id)) continue;
    if (sessionId && existingSessions.has(sessionId)) continue;

    // Give RingCentral time to attach the recording before we process — very
    // recent calls are skipped this round and picked up on the next sync.
    const startMs = r.startTime ? new Date(r.startTime).getTime() : 0;
    if (startMs && now - startMs < settleMs) {
      result.skippedRecent++;
      continue;
    }

    const fromDigits = onlyDigits(r.from?.phoneNumber);
    const toDigits = onlyDigits(r.to?.phoneNumber);
    const facility = matchFacility(index, fromDigits, toDigits);
    if (!facility) continue; // unmatched call — not a tracked partner
    result.matched++;
    if (dryRun) { result.logged++; continue; } // count what WOULD be synced, write nothing

    const durationSecs = r.duration ?? 0;
    const durationStr = `${Math.floor(durationSecs / 60)}:${(durationSecs % 60).toString().padStart(2, "0")}`;
    const callResult =
      r.result === "Call connected" || r.result === "Accepted" ? "connected"
      : r.result === "Voicemail" ? "voicemail"
      : r.result === "No Answer" || r.result === "Missed" ? "no_answer"
      : r.result === "Busy" ? "busy" : "other";
    const callDate = r.startTime ? new Date(r.startTime) : new Date();

    await createContactLog({
      facilityId: facility.id,
      contactType: "call",
      contactDate: callDate,
      callResult,
      callDuration: durationStr,
      callType: "partner_checkin",
      summary: `[Synced] ${r.direction ?? "Outbound"} call — ${r.result ?? ""} (${durationStr}). ${r.from?.phoneNumber ?? "?"} → ${r.to?.phoneNumber ?? "?"}`,
      repId: attribution?.repId ?? facility.assignedRepId ?? undefined,
      repName: attribution?.repName ?? r.from?.name ?? facility.assignedRepName ?? undefined,
      fromRingCentral: 1,
      rcCallId: id,
      rcSessionId: sessionId || undefined,
    });
    existing.add(id); // mark seen so a duplicate id later in THIS batch is skipped
    if (sessionId) existingSessions.add(sessionId); // and a duplicate session (other extension) later in THIS batch
    result.logged++;

    // Transcribe + summarize recorded, connected calls.
    const recordingUrl: string | null = r.recording?.contentUri ?? null;
    if (transcribe && recordingUrl && durationSecs > 0) {
      try {
        const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
        const tr = await transcribeAudio({ audioUrl: authedUrl });
        if (!("error" in tr) && tr.text) {
          const transcriptText = tr.text;
          const analysis = await analyzeCallTranscript(transcriptText);
          await createFacilityUpdate({
            facilityId: facility.id,
            updateDate: callDate,
            rawText: transcriptText,
            summary: analysis.summary || transcriptText.slice(0, 300),
            updateType: "transcript",
            repId: attribution?.repId ?? facility.assignedRepId ?? undefined,
            repName: attribution?.repName ?? facility.assignedRepName ?? undefined,
            extractedData: Object.keys(analysis.extractedData).length > 0 ? analysis.extractedData : null,
          });
          for (const task of analysis.followUpTasks) {
            const dueDate = new Date(callDate);
            dueDate.setDate(dueDate.getDate() + (task.dueInDays ?? 7));
            await createTask({
              facilityId: facility.id,
              title: task.title,
              description: `Auto-created from a synced call on ${callDate.toLocaleDateString()}`,
              dueDate,
              priority: task.priority,
              assignedToId: attribution?.repId ?? facility.assignedRepId ?? undefined,
              assignedToName: attribution?.repName ?? facility.assignedRepName ?? undefined,
              status: "open",
            });
          }
          // Push the finished recap out to Filevine (via the Zapier/n8n webhook).
          await sendCallRecapToWebhook({
            event: "call_recap",
            facilityId: facility.id,
            facilityName: facility.name,
            agent: attribution?.repName ?? facility.assignedRepName ?? r.from?.name ?? null,
            callTime: callDate.toISOString(),
            callTimeLocal: callDate.toLocaleString(),
            durationStr,
            durationSeconds: durationSecs,
            callResult,
            direction: r.direction ?? null,
            summary: analysis.summary || transcriptText.slice(0, 300),
            keyPoints: (analysis.extractedData.keyPoints as string[]) ?? [],
            sentiment: (analysis.extractedData.sentiment as string) ?? null,
            interestLevel: (analysis.extractedData.interestLevel as string) ?? null,
            tasks: analysis.followUpTasks,
            transcript: transcriptText,
            source: "bdcrm",
          });
          result.transcribed++;
        }
      } catch (e: any) {
        console.warn(`[rcSync] transcription failed for call ${id}:`, e?.response?.status ?? e?.message ?? e);
      }
    }
  }

  return result;
}
