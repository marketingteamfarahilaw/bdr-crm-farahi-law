import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingIdOf, ringSenseTranscript } from "./_core/ringsense";

// RingCentral's RingSense transcripts: which token may read them, and what the
// CRM does when RingCentral hasn't got one (yet).
const insights = {
  speakerInfo: [
    { speakerId: "p-1", name: "Miguel Flores" },
    { speakerId: "p-2", name: null },
  ],
  insights: {
    Transcript: [
      { start: 9.1, text: "Sure, ask for Maria.", speakerId: "p-2" },
      { start: 2.2, text: "Hi, it's Miguel from Farahi Law.", speakerId: "p-1" },
      { start: 5.0, text: "  ", speakerId: "p-1" },
    ],
    Summary: [{ value: "A quick check-in." }],
  },
};
const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("ringSenseTranscript", () => {
  it("reads the recording id out of a RingCentral recording link", () => {
    expect(recordingIdOf("https://media.ringcentral.com/restapi/v1.0/account/453633020/recording/3822154740023/content")).toBe("3822154740023");
    expect(recordingIdOf("https://example.com/nothing")).toBeNull();
  });

  it("writes the call as speaker lines in order, trying the next token when one may not read it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(403, { errors: [{ errorCode: "RAH-3005" }] }))
      .mockResolvedValueOnce(reply(200, insights));
    vi.stubGlobal("fetch", fetchMock);
    const r = await ringSenseTranscript("3822154740023", ["rep-token", "admin-token"]);
    expect(r).toEqual({ ok: true, text: "Miguel Flores: Hi, it's Miguel from Farahi Law.\nSpeaker 2: Sure, ask for Maria.", summary: "A quick check-in." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/ai/ringsense/v1/public/accounts/~/domains/pbx/records/3822154740023/insights");
  });

  it("says not ready when RingCentral has nothing for the call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(404, { errors: [{ errorCode: "RAH-3001" }] })));
    const r = await ringSenseTranscript("1", ["t"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_ready");
  });

  it("says no permission when no connected user may read transcripts", async () => {
    // A fresh response per request, as the network gives.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply(403, { errors: [{ errorCode: "RAH-3005" }] })));
    const r = await ringSenseTranscript("1", ["a", "b"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_permission");
  });
});
