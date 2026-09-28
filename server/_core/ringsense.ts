/**
 * Call transcripts from RingCentral itself — RingSense, which RingCentral also
 * calls "AI Conversation Expert". Youssef chose it over OpenAI's Whisper on
 * 2026-09-27, when he stopped using OpenAI: the recordings already live in
 * RingCentral, and RingSense transcribes the recorded calls of reps who hold its
 * license, some minutes after the call ends (half an hour in RingCentral's own
 * example).
 *
 * The API is account-wide: any user with RingCentral's "AI Conversation Expert —
 * Access Insights" permission can read every licensed rep's transcripts. So a
 * request tries each connected rep's token until one is allowed. The CRM's
 * RingCentral app already has the RingSense permission.
 *
 * What RingCentral answers (seen 2026-09-27, before anyone had the license or
 * the permission): 403 RAH-3005 to users without the permission, but 404
 * RAH-3001 "Insights not found" for the same call to a user on a custom "Call
 * Log Access Only" role. So a 404 doesn't end the search, and it outranks the
 * 403s: someone RingCentral let look found nothing.
 */
const RC_BASE = "https://platform.ringcentral.com";

export type TranscriptResult =
  | { ok: true; text: string; summary: string | null }
  /** not_ready: RingCentral has nothing for the call (yet — or never, for a rep without the license).
   *  no_permission: nobody connected may read transcripts.
   *  app_permission: the CRM's RingCentral app itself lacks a permission (aiNotes.ts). */
  | { ok: false; reason: "not_ready" | "no_permission" | "app_permission" | "error"; error: string };

/** The recording id in a RingCentral recording link (…/recording/3822154740023/content). */
export const recordingIdOf = (uri: string | null | undefined) => String(uri ?? "").match(/\/recording\/(\d+)/)?.[1] ?? null;

type Insights = {
  speakerInfo?: { speakerId?: string; name?: string | null }[];
  insights?: {
    Transcript?: { start?: number; text?: string; speakerId?: string }[];
    Summary?: { value?: string }[];
  };
};

/** The call as "Name: what they said" lines, in order; RingCentral's own summary alongside. */
function toText(j: Insights): { text: string; summary: string | null } {
  const names = new Map((j.speakerInfo ?? []).map((s) => [String(s.speakerId), s.name?.trim() || null]));
  const order = new Map<string, number>();
  const text = (j.insights?.Transcript ?? [])
    .slice()
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .map((t) => {
      const id = String(t.speakerId ?? "");
      if (!order.has(id)) order.set(id, order.size + 1);
      const who = names.get(id) ?? `Speaker ${order.get(id)}`;
      return t.text?.trim() ? `${who}: ${t.text.trim()}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const summary = (j.insights?.Summary ?? []).map((s) => s.value?.trim()).filter(Boolean).join(" ") || null;
  return { text, summary };
}

/** RingSense's transcript of a recorded call, trying each token until one may read it. */
export async function ringSenseTranscript(recordingId: string, tokens: string[]): Promise<TranscriptResult> {
  let refused = false;
  let missing = false;
  let lastError = "no RingCentral connection to ask with";
  for (const token of tokens) {
    let r: Response;
    try {
      r = await fetch(`${RC_BASE}/ai/ringsense/v1/public/accounts/~/domains/pbx/records/${encodeURIComponent(recordingId)}/insights`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      lastError = `couldn't reach RingCentral: ${e instanceof Error ? e.message : e}`;
      continue;
    }
    if (r.ok) {
      const { text, summary } = toText((await r.json()) as Insights);
      return text ? { ok: true, text, summary } : { ok: false, reason: "not_ready", error: "RingCentral's analysis of this call has no transcript yet." };
    }
    const body = (await r.text()).slice(0, 300);
    // This user may not read transcripts: another connected user might.
    if (r.status === 403) { refused = true; lastError = `RingSense 403: ${body}`; continue; }
    // Nothing for this recording as this user sees it — not processed yet, or the
    // rep has no license. The others are still asked.
    if (r.status === 404) { missing = true; continue; }
    lastError = `RingSense ${r.status}: ${body}`;
  }
  if (missing) return { ok: false, reason: "not_ready", error: "RingCentral has no transcript for this call (yet)." };
  return refused
    ? { ok: false, reason: "no_permission", error: "No one connected to the CRM may read RingCentral's call transcripts (its \"AI Conversation Expert — Access Insights\" permission)." }
    : { ok: false, reason: "error", error: lastError };
}
