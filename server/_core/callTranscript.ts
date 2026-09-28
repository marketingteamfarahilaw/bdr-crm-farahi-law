/**
 * A recorded call's transcript from RingCentral, for every place the CRM
 * summarizes a call. The RingCentral app's AI Notes first — what the team
 * already sees in RingCentral after a call — else RingSense's, for reps with an
 * AI Conversation Expert license. Youssef stopped using OpenAI's Whisper on
 * 2026-09-27; before that the CRM transcribed the recordings itself.
 */
import { aiNotesTranscript } from "./aiNotes";
import { recordingIdOf, ringSenseTranscript, type TranscriptResult } from "./ringsense";

const RC_BASE = "https://platform.ringcentral.com";

/** The id AI Notes files a call under, from the rep's own call log. */
async function telephonySessionOf(callId: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(`${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    return r.ok ? ((await r.json()) as { telephonySessionId?: string }).telephonySessionId ?? null : null;
  } catch {
    return null;
  }
}

export async function rcCallTranscript(
  call: { telephonySessionId?: string | null; callId?: string | null; recordingUri?: string | null },
  /** The connection of the rep who made the call: AI Notes are filed under them. */
  own: string | null,
  /** Connections to ask RingSense with — anyone with its permission can read any rep's call. */
  all: string[] = own ? [own] : [],
): Promise<TranscriptResult> {
  let notes: TranscriptResult | null = null;
  if (own) {
    const telephonySessionId = call.telephonySessionId || (call.callId ? await telephonySessionOf(call.callId, own) : null);
    if (telephonySessionId) {
      notes = await aiNotesTranscript(telephonySessionId, own);
      if (notes.ok) return notes;
    }
  }
  const recordingId = recordingIdOf(call.recordingUri);
  const rs = recordingId && all.length ? await ringSenseTranscript(recordingId, all) : null;
  if (rs?.ok) return rs;
  // The team has AI Notes; RingSense needs a license nobody holds. So when both
  // fail, AI Notes' reason is the one to act on.
  return notes ?? rs ?? { ok: false, reason: "error", error: "couldn't find this call in RingCentral" };
}
