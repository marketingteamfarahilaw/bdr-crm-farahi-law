/**
 * A recorded call's transcript, for every place the CRM summarizes a call.
 * RingCentral's own first, as they cost nothing: the RingCentral app's AI Notes
 * — what the team already sees in RingCentral after a call — then RingSense's,
 * for reps with an AI Conversation Expert license. Else OpenAI's Whisper
 * transcribes the recording, paid by the minute: Youssef stopped using OpenAI
 * on 2026-09-27, then put credit back on it the next day, since RingCentral
 * won't let the CRM read AI Notes yet (aiNotes.ts).
 */
import { aiNotesTranscript } from "./aiNotes";
import { ENV } from "./env";
import { recordingIdOf, ringSenseTranscript, type TranscriptResult } from "./ringsense";
import { transcribeAudio } from "./voiceTranscription";

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

/** OpenAI's Whisper, from the recording itself — only when the server has an OpenAI key. */
async function whisperTranscript(recordingUri: string, token: string): Promise<TranscriptResult> {
  const tr = await transcribeAudio({ audioUrl: `${recordingUri}?access_token=${token}` });
  if (!("error" in tr)) {
    return tr.text.trim() ? { ok: true, text: tr.text.trim(), summary: null } : { ok: false, reason: "error", error: "OpenAI heard no speech on the recording." };
  }
  const error = `${tr.error}${tr.details ? `: ${tr.details}` : ""}`.slice(0, 500);
  // The whole account, not this call: every call would fail the same way until someone pays.
  if (/insufficient_quota|credit_balance_exhausted/.test(error)) {
    return { ok: false, reason: "no_credit", error: "OpenAI has no credit left for transcribing calls." };
  }
  return { ok: false, reason: "error", error };
}

export async function rcCallTranscript(
  call: { telephonySessionId?: string | null; callId?: string | null; recordingUri?: string | null },
  /** The connection of the rep who made the call: AI Notes are filed under them, and it fetches the recording. */
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
  // Nothing from RingCentral: OpenAI transcribes the recording, and its answer is the one to act on.
  const token = own ?? all[0];
  if (call.recordingUri && token && ENV.forgeApiUrl && ENV.forgeApiKey) return whisperTranscript(call.recordingUri, token);
  // The team has AI Notes; RingSense needs a license nobody holds. So when both
  // fail, AI Notes' reason is the one to act on.
  return notes ?? rs ?? { ok: false, reason: "error", error: "couldn't find this call in RingCentral" };
}
