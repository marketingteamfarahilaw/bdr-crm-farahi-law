/**
 * Call transcripts from the RingCentral app's AI Notes (RingCentral's AI
 * Assistant): the transcript and notes the team already sees in RingCentral
 * after a call — part of RingEX, no extra license. RingCentral's own App
 * Connect copies them into CRMs from this same endpoint; its source is public
 * (ringcentral/rc-unified-crm-extension, src/backfillCallLogAiNotes.ts).
 *
 * The endpoint isn't in RingCentral's public API list, and the CRM's
 * RingCentral app needs RingCentral's "ReadCopilotCallNotes" permission for it
 * — every request was refused for that on 2026-09-28, while the team could read
 * the same notes in the RingCentral app.
 */
import type { TranscriptResult } from "./ringsense";

const RC_BASE = "https://platform.ringcentral.com";

type AiNotes = {
  telephonySessionId?: string;
  callNote?: { content?: string | null } | null;
  callTranscripts?: {
    transcripts?: { participantId?: string; text?: string }[];
    context?: { participants?: { participantId?: string; name?: string | null }[] };
  } | null;
};

/** The notes' HTML as plain lines, list items kept as "- …". */
export function noteText(html: string) {
  return html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** The call as "Name: what they said" lines, and the notes as its summary. */
function toText(d: AiNotes): { text: string; summary: string | null } {
  const names = new Map((d.callTranscripts?.context?.participants ?? []).map((p) => [String(p.participantId), p.name?.trim() || null]));
  const order = new Map<string, number>();
  const text = (d.callTranscripts?.transcripts ?? [])
    .map((t) => {
      const id = String(t.participantId ?? "");
      if (!order.has(id)) order.set(id, order.size + 1);
      const who = names.get(id) ?? `Speaker ${order.get(id)}`;
      return t.text?.trim() ? `${who}: ${t.text.trim()}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return { text, summary: d.callNote?.content ? noteText(d.callNote.content) || null : null };
}

/** AI Notes' transcript of a call, read with the connection of the rep who made it. */
export async function aiNotesTranscript(telephonySessionId: string, token: string): Promise<TranscriptResult> {
  let r: Response;
  try {
    r = await fetch(`${RC_BASE}/ai/copilot/v1/accounts/~/extensions/~/ai-notes/${encodeURIComponent(telephonySessionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return { ok: false, reason: "error", error: `couldn't reach RingCentral: ${e instanceof Error ? e.message : e}` };
  }
  if (r.ok) {
    const j = (await r.json()) as AiNotes & { records?: AiNotes[] };
    const d = Array.isArray(j.records) ? (j.records.find((x) => x.telephonySessionId === telephonySessionId) ?? j.records[0]) : j;
    const { text, summary } = toText(d ?? {});
    if (text) return { ok: true, text, summary };
    // Notes without a transcript still say what the call was.
    return summary ? { ok: true, text: summary, summary } : { ok: false, reason: "not_ready", error: "RingCentral's AI Notes for this call are empty." };
  }
  const body = (await r.text()).slice(0, 300);
  if (r.status === 404) return { ok: false, reason: "not_ready", error: "RingCentral has no AI Notes for this call." };
  if (r.status === 403 && /application needs to have/i.test(body)) {
    const permission = body.match(/\[(\w+)\]/)?.[1] ?? "ReadCopilotCallNotes";
    return { ok: false, reason: "app_permission", error: `The CRM's RingCentral app isn't allowed to read AI Notes yet (RingCentral's "${permission}" permission).` };
  }
  return { ok: false, reason: "error", error: `AI Notes ${r.status}: ${body}` };
}
