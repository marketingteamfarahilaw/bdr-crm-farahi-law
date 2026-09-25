import { describe, expect, it, vi } from "vitest";

// The reason rules belong to the why-not-signed feature and have their own
// tests; here a fixed stand-in says which leads are not viable, so these tests
// check the grid's arithmetic, not the rules.
vi.mock("./reasons", () => ({
  reasonOf: (bucket: string, _status: string | null, subStatus: string | null) => {
    if (bucket === "signedInHouse" || bucket === "signedReferred") return "signed";
    if (bucket === "open") return "open";
    if (/at fault|no injur/i.test(subStatus ?? "")) return "noClaim";
    if (/spam|wrong number/i.test(subStatus ?? "")) return "junk";
    if (/\bsol\b/i.test(subStatus ?? "")) return "tooLate";
    return "other";
  },
}));

import { NO_SOURCE, derive, emptyCounts, monthsBetween, type Grouping, type Lead, type LeadRow, type RowRef } from "./common";
import { checkGrid, monthGrid } from "./monthGrid";
import type { SpendAssignment } from "./spend";

const row = (p: Partial<LeadRow>): LeadRow => ({
  leadDate: null, createdDate: null, signedUpDate: null, outcome: null, status: null, subStatus: null,
  caseType: null, marketingSource: null, contactSource: null, campaign: null, ...p,
});
// Noon Pacific on a day, so no test depends on where midnight falls.
const on = (day: string) => new Date(`${day}T19:00:00Z`);

const noSpend = (months: string[]): SpendAssignment => ({
  byRow: new Map(), byRowMonth: new Map(), byMonth: months.map(() => null), unmatched: [], total: 0,
});

/** The dashboard's own counting, written out independently: the scorecard the grid must add back to. */
function scorecard(leads: Lead[], months: string[], spend: SpendAssignment) {
  const totals = emptyCounts();
  const rows = new Map<string, { name: string; members: string[]; leads: number; signed: number; cells: number[]; spend: number | null }>();
  for (const l of leads) {
    totals.leads++; totals[l.bucket]++; if (l.signed) totals.signed++;
    const r = rows.get(l.name) ?? { name: l.name, members: [], leads: 0, signed: 0, cells: months.map(() => 0), spend: null };
    r.leads++;
    if (l.source !== NO_SOURCE && !r.members.includes(l.source)) r.members.push(l.source);
    if (l.signed) { r.signed++; if (l.i >= 0) r.cells[l.i]++; }
    rows.set(l.name, r);
  }
  const sources = Array.from(rows.values())
    .map((r) => ({ ...r, spend: spend.byRow.get(r.name) ?? null }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads || a.name.localeCompare(b.name));
  const paid = sources.filter((s) => s.spend != null);
  const paidSigned = paid.reduce((a, s) => a + s.signed, 0);
  return {
    totals: { ...totals, spend: spend.total || null, costPerSignup: paidSigned ? Math.round((spend.total / paidSigned) * 100) / 100 : null },
    sources,
    refs: sources.map((s): RowRef => ({ name: s.name, members: s.members })),
  };
}

const MONTHS = ["2026-08", "2026-09"];
const FIXTURE = [
  row({ leadDate: on("2026-08-03"), outcome: "Signed", marketingSource: "Walker Advertising Contract 26" }),
  row({ leadDate: on("2026-08-10"), outcome: "Rejected", subStatus: "At fault", marketingSource: "Walker Advertising Contract 26" }),
  row({ leadDate: on("2026-09-02"), outcome: "Rejected", subStatus: "No injuries", marketingSource: "Walker Advertising Contract 27" }),
  row({ leadDate: on("2026-09-05"), outcome: "Signed Referred Out", marketingSource: "Walker Advertising Contract 27" }),
  row({ leadDate: on("2026-09-06"), outcome: "Open", marketingSource: "Walker Advertising Contract 27" }),
  row({ leadDate: on("2026-09-07"), outcome: "Signed", marketingSource: "GMB 525 W Main St Visalia" }),
  row({ leadDate: on("2026-08-20"), outcome: "Rejected", subStatus: "Spam", marketingSource: "" }),
  row({ leadDate: on("2026-09-21"), outcome: "Lost", subStatus: "Hired another attorney", marketingSource: null }),
  row({ leadDate: null, outcome: "Signed", marketingSource: "GMB 525 W Main St Visalia" }),   // no date: never counted
];

describe("monthGrid", () => {
  it("fills each row's cells by month, in the scorecard's row order", () => {
    const leads = derive(FIXTURE, MONTHS, "channel");
    const spend = noSpend(MONTHS);
    const sc = scorecard(leads, MONTHS, spend);
    const g = monthGrid(leads, MONTHS, sc.refs, spend, sc.totals);

    expect(g.rows.map((r) => r.name)).toEqual(sc.sources.map((s) => s.name));
    const walker = g.rows.find((r) => r.name === "Walker Advertising")!;
    expect(walker).toMatchObject({
      leads: 5, signed: 2,
      leadCells: [2, 3], signedCells: [1, 1], notViableCells: [1, 1], spendCells: [null, null],
    });
    expect(walker.members).toEqual(["Walker Advertising Contract 26", "Walker Advertising Contract 27"]);
    const none = g.rows.find((r) => r.name === NO_SOURCE)!;
    expect(none).toMatchObject({ leads: 2, signed: 0, leadCells: [1, 1], notViableCells: [1, 0] });

    expect(g.monthly).toEqual([
      { month: "2026-08", leads: 3, signed: 1, notViable: 2, spend: null, costPerSignup: null, costPerLead: null },
      { month: "2026-09", leads: 5, signed: 2, notViable: 1, spend: null, costPerSignup: null, costPerLead: null },
    ]);
    expect(g.firstIdx).toBe(0);
    expect(g.costAvg).toBeNull();
    expect(checkGrid(g, sc.totals, sc.sources, { funnel: { notViable: 3 } })).toEqual([]);
  });

  it("uses Pacific months: a lead at 11:30 pm on Aug 31 is August's", () => {
    const leads = derive([row({ leadDate: new Date("2026-09-01T06:30:00Z"), outcome: "Signed", marketingSource: "Web Search" })], MONTHS, "source");
    const spend = noSpend(MONTHS);
    const sc = scorecard(leads, MONTHS, spend);
    const g = monthGrid(leads, MONTHS, sc.refs, spend, sc.totals);
    expect(g.rows[0].signedCells).toEqual([1, 0]);
    expect(checkGrid(g, sc.totals, sc.sources)).toEqual([]);
  });

  it("costs a month by its spend over the sign-ups of the rows that paid that month", () => {
    const leads = derive(FIXTURE, MONTHS, "channel");
    const spend: SpendAssignment = {
      byRow: new Map([["Walker Advertising", 9000]]),
      byRowMonth: new Map([["Walker Advertising", [4500, 4500]]]),
      // September also has $1,200 that matched no row: it still counts in the month's cost.
      byMonth: [4500, 5700],
      unmatched: [{ source: "Billboard 99", amount: 1200, why: "noLeads" }],
      total: 10200,
    };
    const sc = scorecard(leads, MONTHS, spend);
    const g = monthGrid(leads, MONTHS, sc.refs, spend, sc.totals);

    expect(g.rows.find((r) => r.name === "Walker Advertising")!.spendCells).toEqual([4500, 4500]);
    expect(g.rows.find((r) => r.name !== "Walker Advertising")!.spendCells).toEqual([null, null]);
    // Aug: Walker signed 1 of 2 leads. Sep: Walker signed 1 of 3; GMB's sign-up has no spend, so it doesn't divide.
    expect(g.monthly[0]).toMatchObject({ spend: 4500, costPerSignup: 4500, costPerLead: 2250 });
    expect(g.monthly[1]).toMatchObject({ spend: 5700, costPerSignup: 5700, costPerLead: 1900 });
    expect(g.costAvg).toBe(sc.totals.costPerSignup);
    expect(g.monthly.reduce((a, m) => a + (m.spend ?? 0), 0)).toBe(sc.totals.spend);
    expect(checkGrid(g, sc.totals, sc.sources)).toEqual([]);
  });

  it("leaves a month's cost empty when nobody who paid signed, and rounds to cents", () => {
    const months = ["2026-07", "2026-08", "2026-09"];
    const leads = derive([
      row({ leadDate: on("2026-07-02"), outcome: "Rejected", marketingSource: "Walker Advertising Contract 26" }),
      row({ leadDate: on("2026-08-02"), outcome: "Signed", marketingSource: "Walker Advertising Contract 26" }),
      row({ leadDate: on("2026-08-03"), outcome: "Signed", marketingSource: "Walker Advertising Contract 26" }),
      row({ leadDate: on("2026-08-04"), outcome: "Signed", marketingSource: "Walker Advertising Contract 26" }),
    ], months, "channel");
    const spend: SpendAssignment = {
      byRow: new Map([["Walker Advertising", 3000]]),
      byRowMonth: new Map([["Walker Advertising", [1000, 1000, 1000]]]),
      byMonth: [1000, 1000, 1000],
      unmatched: [], total: 3000,
    };
    const sc = scorecard(leads, months, spend);
    const g = monthGrid(leads, months, sc.refs, spend, sc.totals);
    expect(g.monthly[0]).toMatchObject({ spend: 1000, costPerSignup: null, costPerLead: 1000 });
    expect(g.monthly[1]).toMatchObject({ costPerSignup: 333.33, costPerLead: 333.33 });
    // Spend with no leads at all that month: both costs are empty, never a divide by zero.
    expect(g.monthly[2]).toMatchObject({ spend: 1000, costPerSignup: null, costPerLead: null });
    expect(checkGrid(g, sc.totals, sc.sources)).toEqual([]);
  });

  it("counts a partly covered month's spend in full, as the scorecard does", () => {
    // 'This month' on Sep 24: 24 days of leads against all of September's spend.
    const months = monthsBetween(on("2026-09-01"), on("2026-09-24"));
    const leads = derive([
      row({ leadDate: on("2026-09-03"), outcome: "Signed", marketingSource: "Intaker" }),
      row({ leadDate: on("2026-09-24"), outcome: "Signed", marketingSource: "Intaker" }),
    ], months, "channel");
    const spend: SpendAssignment = {
      byRow: new Map([["Intaker", 3000]]), byRowMonth: new Map([["Intaker", [3000]]]), byMonth: [3000], unmatched: [], total: 3000,
    };
    const sc = scorecard(leads, months, spend);
    const g = monthGrid(leads, months, sc.refs, spend, sc.totals);
    expect(months).toEqual(["2026-09"]);
    expect(g.monthly[0]).toMatchObject({ leads: 2, signed: 2, spend: 3000, costPerSignup: 1500 });
    expect(g.monthly[0].costPerSignup).toBe(sc.totals.costPerSignup);
    expect(checkGrid(g, sc.totals, sc.sources)).toEqual([]);
  });

  it("starts the columns at the first month with a lead (or spend)", () => {
    const months = monthsBetween(on("2024-06-15"), on("2026-09-15"));
    const leads = derive([
      row({ leadDate: on("2026-01-20"), outcome: "Open", marketingSource: "Web Search" }),
      row({ leadDate: on("2026-09-01"), outcome: "Signed", marketingSource: "Web Search" }),
    ], months, "source");
    const sc = scorecard(leads, months, noSpend(months));
    const g = monthGrid(leads, months, sc.refs, noSpend(months), sc.totals);
    expect(months[g.firstIdx]).toBe("2026-01");
    expect(checkGrid(g, sc.totals, sc.sources)).toEqual([]);

    const byMonth: (number | null)[] = months.map(() => null);
    byMonth[months.indexOf("2025-12")] = 800;
    const early: SpendAssignment = { byRow: new Map(), byRowMonth: new Map(), byMonth, unmatched: [{ source: "Radio", amount: 800, why: "noLeads" }], total: 800 };
    const sc2 = scorecard(leads, months, early);
    const g2 = monthGrid(leads, months, sc2.refs, early, sc2.totals);
    expect(months[g2.firstIdx]).toBe("2025-12");
    expect(checkGrid(g2, sc2.totals, sc2.sources)).toEqual([]);
  });

  it("handles no leads and no months", () => {
    const g = monthGrid([], MONTHS, [], noSpend(MONTHS), { costPerSignup: null });
    expect(g).toEqual({
      firstIdx: 0, rows: [], costAvg: null,
      monthly: MONTHS.map((month) => ({ month, leads: 0, signed: 0, notViable: 0, spend: null, costPerSignup: null, costPerLead: null })),
    });
    expect(checkGrid(g, { ...emptyCounts(), spend: null }, [])).toEqual([]);

    const none = monthGrid([], [], [], noSpend([]), { costPerSignup: null });
    expect(none).toEqual({ firstIdx: 0, rows: [], monthly: [], costAvg: null });
    expect(checkGrid(none, { ...emptyCounts(), spend: null }, [])).toEqual([]);
  });

  it("adds back to the scorecard on random data, in both views", () => {
    // A small seeded generator (mulberry32), so a failure reproduces.
    let seed = 20260924;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const sources = [
      "Walker Advertising Contract 26", "Walker Advertising Contract 27", "walker advertising contract 28",
      "GMB 525 W Main St Visalia", "Google My Business", "Intaker", "JustinforJustice Website", "Web Search", "", null,
    ];
    const outcomes = ["Signed", "Signed Referred Out", "Referral Accepted", "Rejected", "Lost", "Referred Out", "Open", "Not Interested", null];
    const subs = ["At fault", "No injuries", "Spam", "SOL expired", "Hired another attorney", "", null];
    const months = monthsBetween(on("2025-11-10"), on("2026-09-24"));
    const rows = Array.from({ length: 1500 }, () => {
      const day = new Date(Date.parse("2025-11-10T08:00:00Z") + rand() * (Date.parse("2026-09-25T06:59:59Z") - Date.parse("2025-11-10T08:00:00Z")));
      return row({ leadDate: day, outcome: pick(outcomes), subStatus: pick(subs), marketingSource: pick(sources) });
    });

    (["channel", "source"] as Grouping[]).forEach((group) => {
      const leads = derive(rows, months, group);
      expect(leads.every((l) => l.i >= 0)).toBe(true);
      // Spend on the first two rows, in some months; plus unmatched spend.
      const probe = scorecard(leads, months, noSpend(months));
      const byRowMonth = new Map<string, (number | null)[]>();
      const byRow = new Map<string, number>();
      probe.sources.slice(0, 2).forEach((s, k) => {
        const cells = months.map((_, i) => (i % (k + 2) === 0 ? 1234.56 + i : null));
        byRowMonth.set(s.name, cells);
        byRow.set(s.name, Math.round(cells.reduce<number>((a, v) => a + (v ?? 0) * 100, 0)) / 100);
      });
      const byMonth = months.map((_, i) => {
        const parts = Array.from(byRowMonth.values()).map((c) => c[i]).filter((v): v is number => v != null);
        if (i === 3) parts.push(99.99);   // unmatched
        return parts.length ? Math.round(parts.reduce((a, v) => a + v * 100, 0)) / 100 : null;
      });
      const matched = Array.from(byRow.values()).reduce((a, v) => a + v, 0);
      const spend: SpendAssignment = {
        byRow, byRowMonth, byMonth, unmatched: [{ source: "Billboard", amount: 99.99, why: "noLeads" }],
        total: Math.round((matched + 99.99) * 100) / 100,
      };
      const sc = scorecard(leads, months, spend);
      const g = monthGrid(leads, months, sc.refs, spend, sc.totals);
      const notViable = leads.filter((l) => !l.signed && l.bucket !== "open" && /at fault|no injur|spam|\bsol\b/i.test(l.subStatus ?? "")).length;

      expect(checkGrid(g, sc.totals, sc.sources, { funnel: { notViable } })).toEqual([]);
      g.rows.forEach((r, k) => expect(r.signedCells).toEqual(sc.sources[k].cells));
      expect(g.monthly.reduce((a, m) => a + m.notViable, 0)).toBe(notViable);
    });
  });
});

describe("checkGrid", () => {
  const leads = derive(FIXTURE, MONTHS, "channel");
  const spend = noSpend(MONTHS);
  const sc = scorecard(leads, MONTHS, spend);

  it("flags a lead that falls outside the months", () => {
    const stray = derive([...FIXTURE, row({ leadDate: on("2026-07-15"), outcome: "Signed", marketingSource: "Intaker" })], MONTHS, "channel");
    const sc2 = scorecard(stray, MONTHS, spend);
    const g = monthGrid(stray, MONTHS, sc2.refs, spend, sc2.totals);
    expect(checkGrid(g, sc2.totals, sc2.sources)).toEqual(expect.arrayContaining([
      "grid: Intaker's lead cells add to 0, but it has 1 leads",
      "grid: the months add to 8 leads, TOTAL 9",
    ]));
  });

  it("flags a grid that disagrees with the scorecard", () => {
    const g = monthGrid(leads, MONTHS, sc.refs, spend, sc.totals);
    const walker = sc.sources.findIndex((s) => s.name === "Walker Advertising");
    const off = sc.sources.map((s, k) => (k === walker ? { ...s, cells: [2, 0], spend: 100 } : s));
    expect(checkGrid(g, sc.totals, off)).toEqual([
      "grid: Walker Advertising's sign-up cells differ from the scorecard's",
      "grid: Walker Advertising's spend cells add to $0, scorecard $100",
    ]);
    expect(checkGrid(g, sc.totals, [...sc.sources, { name: "Radio", leads: 0, signed: 0, spend: null, cells: [0, 0] }]))
      .toEqual(["grid: Radio is on the scorecard but not in the grid"]);
    expect(checkGrid(g, { ...sc.totals, spend: 500 }, sc.sources)).toEqual(["grid: the months' spend adds to $0, TOTAL $500"]);
    expect(checkGrid(g, sc.totals, sc.sources, { funnel: { notViable: 4 } })).toEqual(["grid: 3 not-viable leads, the funnel has 4"]);
  });

  it("flags a row the dashboard left out", () => {
    const g = monthGrid(leads, MONTHS, sc.refs.filter((r) => r.name !== "Walker Advertising"), spend, sc.totals);
    const problems = checkGrid(g, sc.totals, sc.sources);
    expect(problems).toContain("grid: Walker Advertising is on the scorecard but not in the grid");
    expect(problems).toContain("grid: 2026-09: the rows' leads don't add to the month's 5");
  });
});
