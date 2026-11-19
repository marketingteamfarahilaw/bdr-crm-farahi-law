import { describe, expect, it } from "vitest";
import { explainNames, whyNotListed, type FoundLead } from "./sheetNames";

const range = { fromDay: "2026-11-01", toDay: "2026-11-12" };
let id = 1;
const lead = (over: Partial<FoundLead> = {}): FoundLead => ({
  leadId: id++, clientName: "Ana Placeholder", leadDate: new Date("2026-11-05T19:00:00Z"),
  outcome: "Signed", status: "Signed Up", subStatus: null, caseType: "Auto",
  marketingSource: "GMB - Visalia", teamRole: null, teamRep: null, ...over,
});

describe("whyNotListed", () => {
  it("names a rep's lead as BD/FR", () => {
    expect(whyNotListed(lead({ teamRole: "BDR", teamRep: "Pat Rep" }), range)).toMatchObject({ fix: "leaddocket", reason: expect.stringContaining("BDR Pat Rep") });
  });
  it("names a non-digital source", () => {
    expect(whyNotListed(lead({ marketingSource: "Billboard" }), range).reason).toContain('"Billboard"');
    expect(whyNotListed(lead({ marketingSource: null }), range).reason).toContain('"blank"');
  });
  it("names a lead that isn't signed", () => {
    expect(whyNotListed(lead({ outcome: "Chase", status: "Open" }), range)).toMatchObject({ fix: "leaddocket", reason: expect.stringContaining("Not signed") });
  });
  it("names a lead from outside the period", () => {
    expect(whyNotListed(lead({ leadDate: new Date("2026-10-20T19:00:00Z") }), range).reason).toContain("2026-10-20");
  });
});

describe("explainNames", () => {
  it("says when nobody by that name is in Lead Docket", () => {
    const [r] = explainNames(["Gus Ghost"], [lead()], range);
    expect(r).toMatchObject({ found: null, fix: "leaddocket" });
  });
  it("prefers the lead in the period that signed", () => {
    const old = lead({ leadDate: new Date("2025-02-01T19:00:00Z"), outcome: "Chase", status: "Open" });
    const cur = lead({ marketingSource: "Billboard" });
    const [r] = explainNames(["Ana Placeholder Jr"], [old, cur], range);
    expect(r.found?.leadId).toBe(cur.leadId);
    expect(r.reason).toContain("Billboard");
  });
});
