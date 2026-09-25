import { describe, expect, it } from "vitest";
import { NOT_VIABLE, derive, emptyCounts, type Lead, type LeadRow } from "./common";
import { reasonOf } from "./reasons";
import { NOT_RECORDED, OTHER_ROUTE, ROUTE_RULES, checkRoutes, contactRoutes, routeOf, type Routes } from "./routes";

const months = ["2026-08", "2026-09"];

const row = (p: Partial<LeadRow>): LeadRow => ({
  leadDate: new Date("2026-09-10T18:00:00Z"), createdDate: null, signedUpDate: null,
  outcome: "Open", status: null, subStatus: null, caseType: null,
  marketingSource: null, contactSource: null, campaign: null,
  ...p,
});

/** The scorecard's totals, counted the way the dashboard counts them. */
const totalsOf = (leads: Lead[]) => {
  const t = emptyCounts();
  for (const l of leads) { t.leads++; t[l.bucket]++; if (l.signed) t.signed++; }
  return t;
};

/** What leadFilter's contactSources scope matches: the raw value, '' meaning NULL or empty. */
const drill = (leads: Lead[], members: string[]) => leads.filter((l) => members.includes(l.contactSource ?? ""));

describe("routeOf", () => {
  it("pins today's Contact Source values to their routes", () => {
    const today: [string, string][] = [
      ["Google My Business", "Google Business Profile"],
      ["Web Search", "Google search"],
      ["FLF Employee", "Staff and team referral"],
      ["JustinforJustice Website", "Firm and partner websites"],
      ["Web Chat", "Website chat (Intaker)"],
      ["Existing Client", "Existing client"],
      ["Afterhours Call Service", "After-hours answering service"],
      ["Intaker - JFJ", "Website chat (Intaker)"],
      ["Web Form", "Website form"],
      ["GroClub FB Ads Campaign", "Social media"],
      ["Walk In", "Walk-in"],
      ["Google Local Services Ads", "Google Local Services Ads"],
      ["Walker Employment Contract", "Walker call line"],
      ["Phone Call", "Phone call"],
      ["Avvo", "Directories (Yelp, Avvo)"],
      ["Yelp", "Directories (Yelp, Avvo)"],
      ["Unknown", NOT_RECORDED],
      ["motorcyclistattorney.com", "Firm and partner websites"],
      ["A & A Auto Collision Center", "Partner business"],
      ["Kantor Orthopedics", "Partner business"],
      ["Television", "TV, radio, outdoor"],
      ["Referral - Attorney", "Attorney referral"],
      ["Field Representative Zulema Salas", "Staff and team referral"],
    ];
    for (const [value, route] of today) expect([value, routeOf(value)]).toEqual([value, route]);
  });

  it("treats NULL, empty, blank and Unknown as not recorded", () => {
    for (const v of [null, "", "   ", "Unknown", " unknown "]) expect(routeOf(v)).toBe(NOT_RECORDED);
  });

  it("sends values no rule covers to Other", () => {
    for (const v of ["Malvin Rosales", "George Iniguez", "Labor Law Advocates"]) expect(routeOf(v)).toBe(OTHER_ROUTE);
  });

  it("uses the first matching rule, on the cleaned value", () => {
    expect(routeOf("Walker Web Chat")).toBe("Walker call line");
    expect(routeOf("  Web   Search ")).toBe("Google search");
    expect(routeOf("Web Search Ads")).toBe(OTHER_ROUTE);   // only the exact pick-list value is Google search
    expect(routeOf("Walk-in")).toBe("Walk-in");
    expect(routeOf("walk in")).toBe("Walk-in");
    expect(routeOf("Justin Farahi")).toBe("Staff and team referral");
    expect(routeOf("BDR Jane Doe")).toBe("Staff and team referral");
    expect(routeOf("Attorney Referral Website")).toBe("Firm and partner websites");
  });

  it("names only routes from the rules, plus Not recorded and Other", () => {
    const names = new Set([...ROUTE_RULES.map(([, n]) => n), NOT_RECORDED, OTHER_ROUTE]);
    for (const v of ["x", "Web Chat", "", null, "Yelp", "Kantor Orthopedics"]) expect(names.has(routeOf(v))).toBe(true);
  });

  it("gives the same answer from the cache", () => {
    expect(routeOf("Web Chat")).toBe(routeOf("Web Chat"));
    expect(routeOf("Web Chat ")).toBe("Website chat (Intaker)");
  });
});

describe("contactRoutes", () => {
  const rows: LeadRow[] = [
    // Walker's own lines: the contract is both the credit and the door.
    ...Array.from({ length: 6 }, (_, n) => row({ marketingSource: "Walker Advertising Contract 26", contactSource: "Walker Advertising Contract 26", outcome: n < 2 ? "Signed" : "Rejected", subStatus: n === 2 ? "At fault" : n === 3 ? "Spam" : null, status: "Rejected" })),
    row({ marketingSource: "Intaker", contactSource: "Web Chat", outcome: "Signed" }),
    row({ marketingSource: "Intaker", contactSource: "Web Chat", outcome: "Not Interested" }),
    row({ marketingSource: "Intaker", contactSource: "web chat ", outcome: "Rejected", status: "Lost", subStatus: "Hired Another Attorney" }),
    row({ marketingSource: "Intaker", contactSource: "Intaker - JFJ", outcome: "Open" }),
    row({ marketingSource: "GMB 525 W Main St Visalia", contactSource: "Google My Business", outcome: "Signed Referred Out" }),
    row({ marketingSource: "GMB 525 W Main St Visalia", contactSource: "Google My Business", outcome: "Referred Out" }),
    row({ marketingSource: "Justin For Justice", contactSource: "Web Search", outcome: "Signed" }),
    row({ marketingSource: null, contactSource: null, outcome: "Open" }),
    row({ marketingSource: "", contactSource: "", outcome: "Signed" }),
    row({ marketingSource: "Existing Client", contactSource: "Unknown", outcome: "Rejected", subStatus: "Not a PI case" }),
    row({ marketingSource: "Malvin Rosales", contactSource: "Malvin Rosales", outcome: "Signed" }),
    row({ marketingSource: "Malvin Rosales", contactSource: "malvin rosales", outcome: "Open" }),
    row({ marketingSource: "Labor Law Advocates", contactSource: "Labor Law Advocates", outcome: "Rejected" }),
    // Outside the dashboard's months: still a lead in the total, as the scorecard counts it.
    row({ leadDate: new Date("2026-07-15T18:00:00Z"), marketingSource: "Yelp", contactSource: "Yelp", outcome: "Signed" }),
    // No leadDate: derive() drops it, and so must the routes.
    row({ leadDate: null, marketingSource: "Yelp", contactSource: "Yelp", outcome: "Signed" }),
  ];
  const leads = derive(rows, months, "channel");
  const totals = totalsOf(leads);
  const r = contactRoutes(leads);
  const byName = (name: string) => r.rows.find((x) => x.name === name)!;

  it("adds back to the scorecard's leads and sign-ups", () => {
    expect(r.rows.reduce((a, x) => a + x.leads, 0)).toBe(totals.leads);
    expect(r.rows.reduce((a, x) => a + x.signed, 0)).toBe(totals.signed);
    expect(totals.leads).toBe(rows.length - 1);
    expect(checkRoutes(r, totals)).toEqual([]);
  });

  it("counts each route's leads, sign-ups and conversion", () => {
    expect(byName("Walker call line")).toMatchObject({ leads: 6, signed: 2, conversion: 33.3, members: ["Walker Advertising Contract 26"] });
    expect(byName("Website chat (Intaker)")).toMatchObject({ leads: 4, signed: 1, conversion: 25 });
    expect(byName("Google Business Profile")).toMatchObject({ leads: 2, signed: 1 });
    expect(byName("Directories (Yelp, Avvo)")).toMatchObject({ leads: 1, signed: 1 });
  });

  it("sorts every route by leads, only routes with leads", () => {
    expect(r.rows[0].name).toBe("Walker call line");
    for (let n = 1; n < r.rows.length; n++) expect(r.rows[n - 1].leads).toBeGreaterThanOrEqual(r.rows[n].leads);
    expect(r.rows.every((x) => x.leads > 0)).toBe(true);
    expect(r.rows.find((x) => x.name === "TV, radio, outdoor")).toBeUndefined();
  });

  it("keeps raw members, with '' for NULL or empty, so a drill equals the bar", () => {
    expect(byName("Website chat (Intaker)").members.sort()).toEqual(["Intaker - JFJ", "Web Chat", "web chat "].sort());
    expect(byName(NOT_RECORDED).members.sort()).toEqual(["", "Unknown"]);
    for (const x of r.rows) {
      const hit = drill(leads, x.members);
      expect([x.name, hit.length]).toEqual([x.name, x.leads]);
      expect([x.name, hit.filter((l) => l.signed).length]).toEqual([x.name, x.signed]);
    }
  });

  it("puts every Contact Source value in exactly one route", () => {
    const all = r.rows.flatMap((x) => x.members);
    expect(new Set(all).size).toBe(all.length);
  });

  it("lists Other's values, merged by spelling, adding to its row", () => {
    expect(r.otherMembers).toEqual([
      { value: "Malvin Rosales", leads: 2 },
      { value: "Labor Law Advocates", leads: 1 },
    ]);
    expect(byName(OTHER_ROUTE).leads).toBe(3);
  });

  it("takes not viable and lost from reasonOf, never counting a lead twice", () => {
    for (const x of r.rows) {
      const mine = leads.filter((l) => routeOf(l.contactSource) === x.name);
      const reasons = mine.map((l) => reasonOf(l.bucket, l.status, l.subStatus));
      expect([x.name, x.notViable]).toEqual([x.name, reasons.filter((k) => NOT_VIABLE.has(k)).length]);
      expect([x.name, x.lostThem]).toEqual([x.name, reasons.filter((k) => k === "lostThem").length]);
      expect(x.signed + x.notViable + x.lostThem).toBeLessThanOrEqual(x.leads);
    }
    // Not Interested is always the intake side's loss, whatever the sub-status says.
    expect(byName("Website chat (Intaker)").lostThem).toBeGreaterThanOrEqual(1);
  });

  it("measures how often the door and the credit are the same", () => {
    // Walker ×6, Malvin ×2 (any case), Labor Law ×1, Yelp (July) ×1 — of 20; blanks never count as the same.
    expect(r.sameAsSource).toBe(50);
  });
});

describe("contactRoutes edge cases", () => {
  it("is empty with no leads, and still reconciles", () => {
    const r = contactRoutes([]);
    expect(r).toEqual({ rows: [], otherMembers: [], sameAsSource: 0 });
    expect(checkRoutes(r, { leads: 0, signed: 0 })).toEqual([]);
  });

  it("still reconciles when only part of the range is loaded", () => {
    // A backfill in progress leaves the older month thin; the routes cover whatever is there.
    const leads = derive([
      row({ leadDate: new Date("2026-09-02T18:00:00Z"), contactSource: "Web Search", outcome: "Signed" }),
      row({ leadDate: new Date("2026-09-03T18:00:00Z"), contactSource: "Web Form", outcome: "Rejected", subStatus: "Spam" }),
    ], months, "source");
    const r = contactRoutes(leads);
    expect(checkRoutes(r, totalsOf(leads))).toEqual([]);
    expect(r.rows.map((x) => x.name).sort()).toEqual(["Google search", "Website form"]);
  });

  it("classifies tens of thousands of leads quickly", () => {
    const values = ["Web Chat", "Web Search", "Google My Business", "Walker Advertising Contract 26", null, "Someone New"];
    const many = derive(Array.from({ length: 45_000 }, (_, n) => row({ contactSource: values[n % values.length], outcome: n % 7 ? "Rejected" : "Signed" })), months, "channel");
    const t0 = Date.now();
    const r = contactRoutes(many);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(checkRoutes(r, totalsOf(many))).toEqual([]);
  });
});

describe("checkRoutes", () => {
  const leads = derive([
    row({ contactSource: "Web Chat", outcome: "Signed" }),
    row({ contactSource: "Web Search", outcome: "Open" }),
    row({ contactSource: "Mystery", outcome: "Open" }),
  ], months, "channel");
  const good = contactRoutes(leads);
  const copy = (): Routes => JSON.parse(JSON.stringify(good));

  it("flags totals that don't match the scorecard", () => {
    expect(checkRoutes(good, { leads: 4, signed: 1 })).toHaveLength(1);
    expect(checkRoutes(good, { leads: 3, signed: 2 })).toHaveLength(1);
  });

  it("flags a value listed under two routes, or under the wrong one", () => {
    const twice = copy();
    twice.rows[1].members.push(twice.rows[0].members[0]);
    expect(checkRoutes(twice, { leads: 3, signed: 1 }).some((p) => p.includes("in both"))).toBe(true);

    const wrong = copy();
    wrong.rows.find((x) => x.name === "Google search")!.members = ["Web Chat"];
    expect(checkRoutes(wrong, { leads: 3, signed: 1 }).some((p) => p.includes("routes to"))).toBe(true);
  });

  it("flags Other's list drifting from its row", () => {
    const off = copy();
    off.otherMembers = [];
    expect(checkRoutes(off, { leads: 3, signed: 1 }).some((p) => p.includes("Other"))).toBe(true);
  });
});
