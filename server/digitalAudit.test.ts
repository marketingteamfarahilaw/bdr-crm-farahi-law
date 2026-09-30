import { describe, expect, it } from "vitest";
import { TOLL_FREE, MERCH } from "@shared/marketing";
import { contraryOf, evidenceOf, misregistered, sourceHygiene, type AuditLead } from "./digitalAudit";

let id = 1;
const lead = (marketingSource: string | null, over: Partial<AuditLead> = {}): AuditLead => ({
  leadId: id++, leadDate: new Date("2026-09-10T19:00:00Z"), clientName: `Client ${id}`, outcome: "Chase",
  marketingSource, teamRole: null, contactSource: null, campaign: null, utm: null, referringUrl: null, keywords: null, ...over,
});

describe("evidenceOf", () => {
  it("reads the Contact Source the way the Marketing Report's routes do", () => {
    expect(evidenceOf(lead(null, { contactSource: "Web Search" }))).toEqual({ group: "SEO", evidence: "Contact Source: Google search" });
    expect(evidenceOf(lead(null, { contactSource: "GMB 525 W Main St Visalia" }))).toMatchObject({ group: "GBP" });
    expect(evidenceOf(lead(null, { contactSource: "Intaker - JFJ" }))).toMatchObject({ group: "SEO" });
    expect(evidenceOf(lead(null, { contactSource: "Facebook" }))).toMatchObject({ group: "Ads" });
    expect(evidenceOf(lead(null, { contactSource: "Yelp" }))).toMatchObject({ group: "SEO" });
  });
  it("counts only the firm's own websites, not a partner's", () => {
    expect(evidenceOf(lead(null, { contactSource: "JustinforJustice Website" }))).toMatchObject({ group: "SEO" });
    expect(evidenceOf(lead(null, { contactSource: "somebodyshop.com" }))).toBeNull();
  });
  it("never takes a Walker call line as evidence, whatever else the lead says", () => {
    expect(evidenceOf(lead(null, { contactSource: "Walker Advertising Contract 26", utm: "utm_source=google&gclid=abc" }))).toBeNull();
  });
  it("reads the campaign and the links when the Contact Source says nothing", () => {
    expect(evidenceOf(lead(null, { campaign: "GMB Visalia" }))).toMatchObject({ group: "GBP" });
    expect(evidenceOf(lead(null, { utm: "https://x.test/?gclid=123" }))).toEqual({ group: "Ads", evidence: "Link: Google Ads click" });
    expect(evidenceOf(lead(null, { referringUrl: "https://www.justinforjustice.com/contact" }))).toEqual({ group: "SEO", evidence: "Link: firm website" });
    expect(evidenceOf(lead(null, { referringUrl: "https://m.facebook.com/" }))).toMatchObject({ group: "Ads" });
    expect(evidenceOf(lead(null, { contactSource: "Phone Call" }))).toBeNull();
  });
});

describe("contraryOf", () => {
  it("flags a digital lead whose Contact Source says it came another way", () => {
    expect(contraryOf({ contactSource: "Walker Advertising Contract 26" })).toBe("Contact Source: Walker call line");
    expect(contraryOf({ contactSource: "Existing Client" })).toBe("Contact Source: Existing client");
    expect(contraryOf({ contactSource: "Afterhours Call Service" })).toBeNull();
    expect(contraryOf({ contactSource: "Web Search" })).toBeNull();
  });
});

describe("misregistered", () => {
  const leads = [
    lead("Walker Advertising Contract 26", { contactSource: "Web Search", outcome: "Signed" }),
    lead("Walker Advertising Contract 26", { contactSource: "Web Search" }),
    lead("Walker Advertising Contract 26", { contactSource: "Walker Advertising Contract 26" }),   // Walker's own line: fine
    lead(null, { contactSource: "Google My Business" }),
    lead("Existing Client", { contactSource: "Existing Client" }),
    lead("BDR Someone", { teamRole: "BDR", contactSource: "Web Search" }),                         // the team's: never checked
    lead("GMB 525 W Main St Visalia", { contactSource: "Walker Advertising" }),
    lead("Justin For Justice Toll Free for Website", { contactSource: "Justin For Justice Toll Free for Website" }),
    lead("Walker Advertising", { contactSource: "800-738-0000" }),
  ];
  const r = misregistered(leads);

  it("groups non-digital sources with digital evidence, by source and evidence", () => {
    const walker = r.possiblyDigital.find((g) => g.source === "Walker Advertising Contract 26")!;
    expect(walker).toMatchObject({ evidence: "Contact Source: Google search", group: "SEO", leads: 2, signed: 1 });
    expect(walker.clients).toHaveLength(2);
    expect(r.possiblyDigital.find((g) => g.source === "No source recorded")).toMatchObject({ group: "GBP", leads: 1 });
    expect(r.possiblyDigital.some((g) => g.source.startsWith("BDR"))).toBe(false);
    expect(r.wouldAdd.find((w) => w.group === "SEO")).toMatchObject({ leads: 2, signed: 1 });
  });

  it("lists digital sources whose Contact Source says otherwise", () => {
    expect(r.possiblyNotDigital).toHaveLength(1);
    expect(r.possiblyNotDigital[0]).toMatchObject({ source: "GMB 525 W Main St Visalia", label: "GBP Visalia", evidence: "Contact Source: Walker call line" });
  });

  it("finds every lead on the shared toll-free line", () => {
    expect(r.tollFree.map((g) => [g.source, g.label, g.leads])).toEqual([
      ["Justin For Justice Toll Free for Website", TOLL_FREE, 1],
      ["Walker Advertising", null, 1],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  });
});

describe("sourceHygiene", () => {
  const n = (source: string, leads = 1) => ({ source, leads, first: null, last: null });
  const h = sourceHygiene([
    n("Justin For Justice Toll Free for Website", 40), n("JustinforJustice Website", 30), n("Justin For Justice website", 3),
    n("GMB 525 W Main St Visalia", 20), n("GMB 525 W. Main St Visalia", 2),
    n("Walker Advertising Contract 26", 50), n("Walker Advertising Contract 27", 40), n("Walker Advertising", 5),
    n("Online Ads Agency", 4), n("Justin - Note Pad and Post it", 2), n("Existing Client", 9),
  ]);

  it("lists which Lead Docket names make up each row", () => {
    const visalia = h.perRow.find((r) => r.label === "GBP Visalia")!;
    expect(visalia.names.map((x) => x.source)).toEqual(["GMB 525 W Main St Visalia", "GMB 525 W. Main St Visalia"]);
    expect(visalia.leads).toBe(22);
  });
  it("flags names that look digital but aren't counted, and knows merch", () => {
    expect(h.lookDigital.map((x) => x.source)).toEqual(["Online Ads Agency"]);
    expect(h.merch.map((x) => x.source)).toEqual(["Justin - Note Pad and Post it"]);
    expect(h.merch.length && MERCH).toBe(MERCH);
  });
  it("pairs near-duplicate spellings, but not Walker's numbered contracts", () => {
    const sets = h.duplicates.map((d) => d.names.map((x) => x.source).sort());
    expect(sets).toContainEqual(["GMB 525 W Main St Visalia", "GMB 525 W. Main St Visalia"]);
    expect(sets).toContainEqual(["Justin For Justice Toll Free for Website", "Justin For Justice website", "JustinforJustice Website"]);
    expect(sets.some((s) => s.some((x) => x.includes("Contract")))).toBe(false);
    // The JFJ cluster spans two report rows — the website and the shared toll-free line.
    expect(h.duplicates.find((d) => d.names.length === 3)!.rows).toHaveLength(2);
  });
});
