import { afterEach, describe, expect, it, vi } from "vitest";
import { aiNotesTranscript, noteText } from "./_core/aiNotes";
import { rcCallTranscript } from "./_core/callTranscript";

// RingCentral's sources alone: no OpenAI key, so OpenAI never transcribes here (callTranscript.test.ts does that).
vi.mock("./_core/env", () => ({ ENV: { forgeApiUrl: "", forgeApiKey: "" } }));

// RingCentral's AI Notes — the transcript the team sees in the RingCentral app —
// and the order the CRM asks RingCentral's two transcript sources in.
const notes = {
  records: [{
    telephonySessionId: "s-1",
    callNote: { content: "<p><strong>Recap</strong></p><ul><li>Dr. Lee will send two patients</li><li>Lunch on Friday</li></ul>" },
    callTranscripts: {
      transcripts: [
        { participantId: "a", text: "Hi, it's Grace from Farahi Law." },
        { participantId: "b", text: "Hi Grace &mdash; ask for Maria." },
        { participantId: "b", text: "  " },
      ],
      context: { participants: [{ participantId: "a", name: "Grace Lanayon" }, { participantId: "b", name: null }] },
    },
  }],
};
const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// What RingCentral answered for every rep's call on 2026-09-28.
const refused = () => reply(403, { errorCode: "InsufficientPermissions", message: "In order to call this API endpoint, application needs to have [ReadCopilotCallNotes] permission" });

afterEach(() => vi.unstubAllGlobals());

describe("aiNotesTranscript", () => {
  it("writes the call as speaker lines and the notes as its summary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(200, notes));
    vi.stubGlobal("fetch", fetchMock);
    const r = await aiNotesTranscript("s-1", "grace-token");
    expect(r).toEqual({
      ok: true,
      text: "Grace Lanayon: Hi, it's Grace from Farahi Law.\nSpeaker 2: Hi Grace &mdash; ask for Maria.",
      summary: "Recap\n- Dr. Lee will send two patients\n- Lunch on Friday",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/copilot/v1/accounts/~/extensions/~/ai-notes/s-1");
  });

  it("names the missing app permission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => refused()));
    const r = await aiNotesTranscript("s-1", "t");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("app_permission");
      expect(r.error).toContain("ReadCopilotCallNotes");
    }
  });

  it("says not ready when the call has no AI Notes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(404, { errorCode: "NotFound" })));
    const r = await aiNotesTranscript("s-1", "t");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_ready");
  });

  it("turns the notes' HTML into lines", () => {
    expect(noteText("<p>Tom &amp; Jerry</p><ol><li>One</li><li>Two</li></ol>")).toBe("Tom & Jerry\n- One\n- Two");
  });
});

describe("rcCallTranscript", () => {
  it("looks the call up in the rep's call log, then reads its AI Notes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { id: "c-1", telephonySessionId: "s-1" }))
      .mockResolvedValueOnce(reply(200, notes));
    vi.stubGlobal("fetch", fetchMock);
    const r = await rcCallTranscript({ callId: "c-1", recordingUri: ".../recording/42/content" }, "grace-token", ["grace-token"]);
    expect(r.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/extension/~/call-log/c-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to RingSense, and acts on AI Notes' refusal when both fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(reply(404, { errors: [{ errorCode: "RAH-3001" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await rcCallTranscript({ telephonySessionId: "s-1", recordingUri: ".../recording/42/content" }, "own", ["own"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ai/ringsense/v1/public/accounts/~/domains/pbx/records/42/insights");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("app_permission");
  });

  it("asks RingSense alone when the rep isn't connected", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(404, { errors: [{ errorCode: "RAH-3001" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await rcCallTranscript({ callId: "c-1", recordingUri: ".../recording/42/content" }, null, ["someone-else"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_ready");
  });
});
