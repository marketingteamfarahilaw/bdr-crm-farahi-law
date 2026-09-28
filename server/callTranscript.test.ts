import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// When RingCentral has no transcript of a call, OpenAI transcribes the recording
// (Youssef, 2026-09-28) — and running out of OpenAI credit is the account's
// problem, not the call's.
vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "https://api.openai.com", forgeApiKey: "test-key" } }));
vi.mock("./_core/voiceTranscription", () => ({ transcribeAudio: vi.fn() }));
const { transcribeAudio } = await import("./_core/voiceTranscription");
const { rcCallTranscript } = await import("./_core/callTranscript");
const whisper = vi.mocked(transcribeAudio);

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// What RingCentral answers today: AI Notes refused for the app, RingSense has nothing.
const ringCentralHasNothing = () => vi.fn()
  .mockResolvedValueOnce(reply(403, { message: "In order to call this API endpoint, application needs to have [ReadCopilotCallNotes] permission" }))
  .mockResolvedValueOnce(reply(404, { errors: [{ errorCode: "RAH-3001" }] }));
const call = { telephonySessionId: "s-1", recordingUri: "https://media.ringcentral.com/restapi/v1.0/account/1/recording/42/content" };

beforeEach(() => whisper.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("rcCallTranscript with OpenAI", () => {
  it("transcribes the recording with the rep's own connection when RingCentral has nothing", async () => {
    vi.stubGlobal("fetch", ringCentralHasNothing());
    whisper.mockResolvedValueOnce({ task: "transcribe", language: "es", duration: 60, text: " Hola, habla Grace. ", segments: [] });
    const r = await rcCallTranscript(call, "grace-token", ["grace-token"]);
    expect(r).toEqual({ ok: true, text: "Hola, habla Grace.", summary: null });
    expect(whisper.mock.calls[0][0].audioUrl).toBe(`${call.recordingUri}?access_token=grace-token`);
  });

  it("calls running out of OpenAI credit no_credit", async () => {
    vi.stubGlobal("fetch", ringCentralHasNothing());
    whisper.mockResolvedValueOnce({
      error: "Transcription service request failed", code: "TRANSCRIPTION_FAILED",
      details: '429 Too Many Requests: {"error":{"code":"credit_balance_exhausted","type":"insufficient_quota"}}',
    });
    const r = await rcCallTranscript(call, "grace-token", ["grace-token"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_credit");
  });

  it("leaves OpenAI alone when RingCentral's AI Notes have the call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, {
      callTranscripts: { transcripts: [{ participantId: "a", text: "Hi" }], context: { participants: [{ participantId: "a", name: "Grace" }] } },
    })));
    const r = await rcCallTranscript(call, "grace-token", ["grace-token"]);
    expect(r).toEqual({ ok: true, text: "Grace: Hi", summary: null });
    expect(whisper).not.toHaveBeenCalled();
  });
});
