import { describe, expect, it } from "vitest";
import { scorecardBucket } from "../signupsReport";
import { NO_SOURCE, derive, emptyCounts, type Counts, type Grouping, type LeadRow, type ReasonKey } from "./common";
import { NO_REASON, REASON_LABEL, checkReasons, reasonOf, whyNotSigned, type WhyLead } from "./reasons";

/** The outcome the Lead Docket sync writes for a status, as the dashboard reads it. */
const outcomeOf = (status: string, sub: string) =>
  status === "Signed Up" ? "Signed"
    : status === "Referred" ? (sub === "Signed Up" ? "Signed Referred Out" : "Referred Out")
    : status;   // Rejected, Lost, "Rejected - PD Leads Only" and the open statuses keep their own
const familyOf = (status: string, sub: string) => reasonOf(scorecardBucket(outcomeOf(status, sub)), status, sub);

// Every (status | sub-status) pair in Lead Docket today, pinned to its family.
const PAIRS: Record<ReasonKey, [string, string][]> = {
  signed: [
    ...[
      "Signed Agreement/Welcome Letter Sent - Via Email", "Signed Agreement/Welcome Letter Sent - Via Text",
      "Contingency agreement signed/GDrive LD and FV done", "New Client Sign-up Notification Sent",
      "Passenger Contingency agreement signed up", "Signed - Not Verified", "N/A",
    ].map((s): [string, string] => ["Signed Up", s]),
    ["Referred", "Signed Up"],
  ],
  open: [
    ["Chase", "Continued Attempt"], ["Chase", "Pending PD/TCR/DEF info/Pics/Video/Medical records"],
    ["Chase", "Pending decision to speak to a family/friend/etc"], ["Chase", "Welcome Message/Request for Documents"],
    ["Chase", "Pending Agreement"], ["Chase", "Inconvenient time/Client asked for a call back"], ["Under Review", "N/A"],
    ["Pending Referral", "Disputed liability/no TCR/Witness or video footage"], ["Pending Agreement", "Electronic Signature"],
    ["Assigned", "N/A"],
  ],
  referred: [
    "Declined", "Rejected Lead Referral", "Reviewing", "Pending Review - Intakes Dept", "Settled / Closed",
    "Rejected Client Referral", "Work Comp", "Med Mal", "No Follow-Up", "Pending Review - Referrals Dept",
  ].map((s): [string, string] => ["Referred", s]),
  junk: [
    ...[
      "Spam", "Invalid/No Contact Info", "Wrong Contact Information", "Disconnected Number", "Fraud",
      "Caller disconnect/hung up while connecting to FLF", "Robo Call", "Duplicate Lead",
    ].map((s): [string, string] => ["Rejected", s]),
    ["Lost", "Wrong Number / Email"],
  ],
  tooLate: ["SOL Lapsed", "City Claim - SOL Lapsed 6mos", "Incident date is too close to SOL"].map((s): [string, string] => ["Rejected", s]),
  lostThem: [
    ...[
      "No Longer Interested", "Hired Another Attorney", "No response within 45days", "Client requested Cease and Desist Communication",
      "Currently has an Atty but had a General Inquiry", "Lost Contact", "Did Not Sign After Meeting", "No Show",
    ].map((s): [string, string] => ["Lost", s]),
    ["Rejected - PD Leads Only", "No Answer/Open"], ["Rejected - PD Leads Only", "Closed - No Response"],
  ],
  noClaim: [
    ...[
      "At fault", "No Injuries", "Gap in treatment", "Owner of a parked vehicle", "Client settled with PL/DEF insurance",
      "Disputed liability/no TCR/Witness or video footage", "DEF is uninsured and PL only Liability", "No treatment at all",
      "PD only", "Minimal PD", "Hit and run NO UM/UIM", "Self Negligence", "No Insurance",
      "Slip/Trip and fall -No same day ER/Incident report", "Dog bites - No DEF to go after",
    ].map((s): [string, string] => ["Rejected", s]),
    ...[
      "For Review of BDRs", "Already Resolved - Repaired/On-Ongoing Repair", "Successful Transfer", "Total Loss",
      "Declined for Financial Reasons/No INS Coverage",
    ].map((s): [string, string] => ["Rejected - PD Leads Only", s]),
  ],
  wrongArea: [
    "Not a PI case", "Med Mal", "Employment Law", "General Inquiry", "Criminal Law", "Work Comp", "Civil Law", "City Claim",
    "Product Liability", "Tenant Landlord", "Family Law", "Complex Lead", "Native Indian Territory", "Premises liability",
    "Incident happened outside of USA / No-fault states", "Defamation", "Immigration",
  ].map((s): [string, string] => ["Rejected", s]),
  other: [["Rejected", "Personal Injury"], ["Rejected", "Rejected Referral"]],
};

describe("reasonOf", () => {
  for (const family of Object.keys(PAIRS) as ReasonKey[]) {
    it(`puts every current pair in '${REASON_LABEL[family]}'`, () => {
      const wrong = PAIRS[family].map(([status, sub]) => ({ pair: `${status} | ${sub}`, got: familyOf(status, sub) })).filter((x) => x.got !== family);
      expect(wrong).toEqual([]);
    });
  }

  it("lets the scorecard column decide before any sub-status rule", () => {
    // Referred-out Med Mal is referred, not "not a case we take"; an open lead with a no-claim sub-status is still open.
    expect(familyOf("Referred", "Med Mal")).toBe("referred");
    expect(familyOf("Pending Referral", "Disputed liability/no TCR/Witness or video footage")).toBe("open");
    expect(reasonOf("notInterested", "Rejected", "At fault")).toBe("lostThem");
  });

  it("falls back on the status when no rule matches", () => {
    expect(reasonOf("rejected", "Lost", null)).toBe("lostThem");
    expect(reasonOf("rejected", "  LOST ", "Something new")).toBe("lostThem");
    expect(reasonOf("rejected", "Rejected", null)).toBe("other");
    expect(reasonOf("rejected", null, null)).toBe("other");
    expect(reasonOf("rejected", "Closed", "")).toBe("other");
  });

  it("matches case-insensitively and gives the same answer from the cache", () => {
    expect(reasonOf("rejected", "Rejected", "AT FAULT")).toBe("noClaim");
    for (let k = 0; k < 3; k++) expect(reasonOf("rejected", "Rejected", "Hired Another Attorney")).toBe("lostThem");
  });

  it("reads 'test' only at the start", () => {
    expect(reasonOf("rejected", "Rejected", "Test lead")).toBe("junk");
    expect(reasonOf("rejected", "Test", null)).toBe("junk");
    expect(reasonOf("rejected", "Rejected", "Contest of liability")).toBe("other");
  });
});

// ── whyNotSigned ──

type Spec = { source: string | null; status: string; sub: string | null; n?: number; at?: string };
let seq = 0;
const rowsOf = (specs: Spec[]): LeadRow[] => specs.flatMap((s) => Array.from({ length: s.n ?? 1 }, () => ({
  leadDate: new Date(s.at ?? `2026-09-${String(1 + (seq++ % 20)).padStart(2, "0")}T18:00:00Z`),
  createdDate: null, signedUpDate: null,
  outcome: outcomeOf(s.status, s.sub ?? ""), status: s.status, subStatus: s.sub,
  caseType: "Auto Accident", marketingSource: s.source, contactSource: null, campaign: null,
})));

/** The scorecard totals, counted the way getMarketingDashboard counts them. */
const totalsOf = (leads: WhyLead[]): Counts => {
  const t = emptyCounts();
  for (const l of leads) { t.leads++; t[l.bucket]++; if (l.signed) t.signed++; }
  return t;
};
const leadsOf = (specs: Spec[], group: Grouping = "channel", months = ["2026-08", "2026-09"]) => derive(rowsOf(specs), months, group);

const WALKER_26 = "Walker Advertising Contract 26";
const WALKER_31 = "Walker Advertising Contract 31";
const sample: Spec[] = [
  { source: WALKER_26, status: "Signed Up", sub: "N/A", n: 6 },
  { source: WALKER_31, status: "Referred", sub: "Signed Up", n: 2 },
  { source: WALKER_26, status: "Rejected", sub: "At fault", n: 20 },
  { source: WALKER_31, status: "Rejected", sub: "No Injuries", n: 14 },
  { source: WALKER_26, status: "Rejected", sub: "Owner of a parked vehicle", n: 6 },
  { source: WALKER_26, status: "Chase", sub: "Continued Attempt", n: 4 },
  { source: WALKER_26, status: "Lost", sub: "No Longer Interested", n: 5 },
  { source: WALKER_31, status: "Referred", sub: "Med Mal", n: 3 },
  { source: WALKER_26, status: "Rejected", sub: "Spam", n: 2 },
  { source: "Web Search", status: "Signed Up", sub: "N/A", n: 12 },
  { source: "Web Search", status: "Rejected", sub: "At fault", n: 5 },
  { source: "Web Search", status: "Lost", sub: "Hired Another Attorney", n: 9 },
  { source: "Web Search", status: "Lost", sub: "No Longer Interested", n: 8 },
  { source: "Web Search", status: "Rejected", sub: "Med Mal", n: 4 },
  { source: "Web Search", status: "Rejected", sub: "SOL Lapsed", n: 2 },
  { source: "GMB 525 W Main St Visalia", status: "Rejected", sub: "No Injuries", n: 3 },
  { source: "GMB 525 W Main St Visalia", status: "Signed Up", sub: "N/A", n: 4 },
  { source: null, status: "Rejected", sub: null, n: 3 },
  { source: null, status: "Rejected", sub: "Personal Injury", n: 1 },
  { source: "Existing Client", status: "Not Interested", sub: null, n: 2 },
];

describe("whyNotSigned", () => {
  const leads = leadsOf(sample);
  const totals = totalsOf(leads);
  const w = whyNotSigned(leads);

  it("adds back to every scorecard total", () => {
    expect(checkReasons(w, totals)).toEqual([]);
    const f = Object.fromEntries(w.families.map((x) => [x.key, x.leads])) as Record<ReasonKey, number>;
    expect(w.families.map((x) => x.key)).toEqual(["signed", "open", "referred", "lostThem", "noClaim", "wrongArea", "tooLate", "junk", "other"]);
    expect(f.signed).toBe(totals.signed);
    expect(f.open).toBe(totals.open);
    expect(f.referred).toBe(totals.referredOut);
    expect(f.lostThem + f.noClaim + f.wrongArea + f.tooLate + f.junk + f.other).toBe(totals.rejected + totals.notInterested);
    expect(w.funnel.viable + w.funnel.notViable).toBe(totals.leads);
    expect(w.funnel.signed).toBe(totals.signed);
  });

  it("counts each family", () => {
    const f = Object.fromEntries(w.families.map((x) => [x.key, x.leads])) as Record<ReasonKey, number>;
    expect(f).toEqual({ signed: 24, open: 4, referred: 3, lostThem: 24, noClaim: 48, wrongArea: 4, tooLate: 2, junk: 2, other: 4 });
    expect(w.families.find((x) => x.key === "noClaim")!.share).toBe(41.7);   // 48 of 115
  });

  it("builds the funnel", () => {
    expect(w.funnel).toEqual({ leads: 115, notViable: 56, viable: 59, signed: 24, viableRate: 51.3, winRate: 40.7, costPerViable: null });
  });

  it("gives each row a bar that adds up to its leads, named like the scorecard", () => {
    for (const r of w.rows) {
      expect(Object.values(r.by).reduce((a, b) => a + b, 0)).toBe(r.leads);
      expect(r.by.signed).toBe(r.signed);
    }
    const walker = w.rows.find((r) => r.name === "Walker Advertising")!;
    expect(walker).toMatchObject({ leads: 62, signed: 8, members: [WALKER_26, WALKER_31] });
    expect(walker.by).toMatchObject({ noClaim: 40, lostThem: 5, referred: 3, junk: 2, open: 4 });
    expect(w.rows.map((r) => r.name)).toEqual(["Walker Advertising", "Web Search", "Google Business Profile (GMB)", NO_SOURCE, "Existing Client"]);
    expect(w.rows.find((r) => r.name === NO_SOURCE)!.members).toEqual([]);
  });

  it("keeps each source its own row in the Sources view", () => {
    const bySource = whyNotSigned(leadsOf(sample, "source"));
    expect(bySource.rows.map((r) => r.name)).toContain(WALKER_26);
    expect(bySource.rows.find((r) => r.name === WALKER_26)!.members).toEqual([WALKER_26]);
    expect(checkReasons(bySource, totals)).toEqual([]);
  });

  it("lists the biggest reasons outside signed and open, one per reason and family", () => {
    expect(w.top.some((t) => t.family === "signed" || t.family === "open")).toBe(false);
    expect(w.top[0]).toEqual({ reason: "At fault", family: "noClaim", leads: 25, topRow: "Walker Advertising", topRowShare: 80 });
    // Med Mal referred out and Med Mal rejected are different reasons.
    expect(w.top.filter((t) => t.reason === "Med Mal").map((t) => [t.family, t.leads])).toEqual(expect.arrayContaining([["wrongArea", 4], ["referred", 3]]));
    expect(w.top.find((t) => t.reason === NO_REASON)).toMatchObject({ family: "other", leads: 3, topRow: NO_SOURCE, topRowShare: 100 });
    expect(w.top.length).toBeLessThanOrEqual(12);
  });

  it("lists every sub-status seen, per family", () => {
    expect(w.members.noClaim).toEqual([
      { reason: "At fault", leads: 25 }, { reason: "No Injuries", leads: 17 }, { reason: "Owner of a parked vehicle", leads: 6 },
    ]);
    expect(w.members.lostThem.map((m) => m.reason)).toEqual(["No Longer Interested", "Hired Another Attorney", NO_REASON]);
    expect(w.members.other.map((m) => m.reason)).toEqual([NO_REASON, "Personal Injury"]);
    const sum = Object.values(w.members).flat().reduce((a, m) => a + m.leads, 0);
    expect(sum).toBe(totals.leads);
  });

  it("merges sub-statuses that differ only in case or spacing", () => {
    const x = whyNotSigned(leadsOf([
      { source: "A", status: "Rejected", sub: "At fault", n: 2 },
      { source: "A", status: "Rejected", sub: "AT  FAULT", n: 1 },
    ]));
    expect(x.members.noClaim).toEqual([{ reason: "At fault", leads: 3 }]);
  });

  it("writes the two insights as a share of leads", () => {
    expect(w.insights).toEqual([
      "65% of Walker Advertising's leads had no viable claim (mostly At fault, No Injuries, Owner of a parked vehicle), against 15% for everything else.",
      "24 viable leads (21% of all leads) chose another firm or went quiet — mostly No Longer Interested and Hired Another Attorney.",
    ]);
    expect(w.insights.join(" ")).not.toMatch(/bad lead/i);
  });

  it("stays quiet when the biggest row is small or no worse than the rest", () => {
    const small = whyNotSigned(leadsOf([
      { source: "Walker Advertising Contract 26", status: "Rejected", sub: "At fault", n: 40 },
      { source: "Web Search", status: "Signed Up", sub: "N/A", n: 10 },
    ]));
    expect(small.insights).toEqual([]);   // 40 leads is under 50, and nobody chose another firm
    const even = whyNotSigned(leadsOf([
      { source: "Walker Advertising Contract 26", status: "Rejected", sub: "At fault", n: 30 },
      { source: "Walker Advertising Contract 26", status: "Signed Up", sub: "N/A", n: 30 },
      { source: "Web Search", status: "Rejected", sub: "At fault", n: 30 },
      { source: "Web Search", status: "Signed Up", sub: "N/A", n: 30 },
    ]));
    expect(even.insights).toEqual([]);
  });

  it("names No source only as the rest, never as the vendor", () => {
    const x = whyNotSigned(leadsOf([
      { source: null, status: "Rejected", sub: "At fault", n: 90 },
      { source: "Web Search", status: "Rejected", sub: "At fault", n: 45 },
      { source: "Web Search", status: "Signed Up", sub: "N/A", n: 30 },
      { source: "Intaker", status: "Signed Up", sub: "N/A", n: 20 },
    ]));
    expect(x.insights).toEqual([]);   // Web Search is the biggest vendor, and its 60% is under 1.25 × the rest's 90/110
  });
});

describe("whyNotSigned rows", () => {
  it("shows the 12 biggest rows and folds the rest into 'All other'", () => {
    const specs: Spec[] = Array.from({ length: 15 }, (_, k) => ({ source: `Source ${String(k).padStart(2, "0")}`, status: k % 2 ? "Signed Up" : "Rejected", sub: k % 2 ? "N/A" : "At fault", n: 30 - k }));
    const leads = leadsOf(specs);
    const w = whyNotSigned(leads);
    expect(w.rows).toHaveLength(13);
    expect(w.rows.slice(0, 12).map((r) => r.name)).toEqual(specs.slice(0, 12).map((s) => s.source));
    const other = w.rows[12];
    expect(other).toMatchObject({ name: "All other", other: true, members: [], leads: 18 + 17 + 16, signed: 17 });
    expect(checkReasons(w, totalsOf(leads))).toEqual([]);
  });

  it("names a single leftover row instead of folding it", () => {
    const specs: Spec[] = Array.from({ length: 13 }, (_, k) => ({ source: `Source ${k}`, status: "Rejected", sub: "At fault", n: 20 - k }));
    const w = whyNotSigned(leadsOf(specs));
    expect(w.rows).toHaveLength(13);
    expect(w.rows.some((r) => r.other)).toBe(false);
  });
});

describe("cost per viable lead", () => {
  const leads = leadsOf(sample);

  it("divides all the spend by the viable leads of the rows that have spend", () => {
    // Walker: 62 leads, 40 no claim + 2 junk → 20 viable.
    const w = whyNotSigned(leads, { spendByRow: new Map([["Walker Advertising", 4000]]), spendTotal: 4000 });
    expect(w.funnel.costPerViable).toBe(200);
    // Spend that matched no row still counts in the total, as it does for cost per lead.
    expect(whyNotSigned(leads, { spendByRow: new Map([["Walker Advertising", 4000]]), spendTotal: 4600 }).funnel.costPerViable).toBe(230);
    // Web Search: 40 leads, 5 no claim + 4 wrong area + 2 too late → 29 viable; 49 viable with Walker.
    expect(whyNotSigned(leads, { spendByRow: new Map([["Walker Advertising", 4000], ["Web Search", 1000]]), spendTotal: 5000 }).funnel.costPerViable).toBe(102.04);
  });

  it("sums the rows when no total is passed", () => {
    expect(whyNotSigned(leads, { spendByRow: new Map([["Walker Advertising", 3000]]) }).funnel.costPerViable).toBe(150);
  });

  it("is null without spend, or when no row with leads has spend", () => {
    expect(whyNotSigned(leads, {}).funnel.costPerViable).toBeNull();
    expect(whyNotSigned(leads, { spendByRow: new Map(), spendTotal: 0 }).funnel.costPerViable).toBeNull();
    expect(whyNotSigned(leads, { spendByRow: new Map(), spendTotal: 900 }).funnel.costPerViable).toBeNull();
  });
});

describe("edge cases", () => {
  it("returns zeros, not NaN, for an empty period", () => {
    const w = whyNotSigned([]);
    expect(w.families.map((f) => [f.leads, f.share])).toEqual(Array(9).fill([0, 0]));
    expect(w.funnel).toEqual({ leads: 0, notViable: 0, viable: 0, signed: 0, viableRate: 0, winRate: 0, costPerViable: null });
    expect(w.rows).toEqual([]);
    expect(w.top).toEqual([]);
    expect(Object.values(w.members).every((m) => m.length === 0)).toBe(true);
    expect(w.insights).toEqual([]);
    expect(checkReasons(w, emptyCounts())).toEqual([]);
  });

  it("counts leads outside the loaded months, as the scorecard does", () => {
    // A range still loading from Lead Docket can hand over rows whose month isn't in the list.
    const leads = leadsOf([
      { source: "Web Search", status: "Rejected", sub: "At fault", at: "2026-07-20T18:00:00Z" },
      { source: "Web Search", status: "Signed Up", sub: "N/A", at: "2026-09-02T18:00:00Z" },
    ], "channel", ["2026-09"]);
    expect(leads.map((l) => l.i)).toEqual([-1, 0]);
    const w = whyNotSigned(leads);
    expect(w.funnel).toMatchObject({ leads: 2, notViable: 1, viable: 1, signed: 1, viableRate: 50, winRate: 100 });
    expect(checkReasons(w, totalsOf(leads))).toEqual([]);
  });

  it("classifies leads with no status or sub-status", () => {
    const leads = leadsOf([{ source: "Web Search", status: "", sub: null, n: 2 }]);
    const w = whyNotSigned(leads);
    expect(w.families.find((f) => f.key === "open")!.leads).toBe(2);   // an empty outcome is an open lead
    expect(w.members.open).toEqual([{ reason: NO_REASON, leads: 2 }]);
    expect(checkReasons(w, totalsOf(leads))).toEqual([]);
  });
});

describe("checkReasons", () => {
  const leads = leadsOf(sample);
  const totals = totalsOf(leads);

  it("reports a family that no longer adds up", () => {
    const w = whyNotSigned(leads);
    w.families = w.families.map((f) => (f.key === "junk" ? { ...f, leads: f.leads + 1 } : f));
    const problems = checkReasons(w, totals);
    expect(problems.some((p) => p.includes("families' total"))).toBe(true);
    expect(problems.some((p) => p.includes("rejected families"))).toBe(true);
  });

  it("reports a row whose bar doesn't match its leads", () => {
    const w = whyNotSigned(leads);
    w.rows[0] = { ...w.rows[0], by: { ...w.rows[0].by, other: w.rows[0].by.other + 1 } };
    expect(checkReasons(w, totals)).toEqual([expect.stringContaining("Walker Advertising's bar")]);
  });

  it("reports totals the scorecard disagrees with", () => {
    const w = whyNotSigned(leads);
    const problems = checkReasons(w, { ...totals, signed: totals.signed + 1 });
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("Signed"), expect.stringContaining("funnel signed"), expect.stringContaining("rows' signed")]));
  });
});
