import { describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { NO_SOURCE, TZ, derive, monthsBetween, pct, type Grouping, type Lead } from "./common";
import type { Coverage } from "./coverage";
import {
  PRIOR_COLS, buildComparison, checkComparison, comparisonRange, paceOf, rangeWords, ripening, tallyPrior, toDates,
  type Comparison, type PriorTally,
} from "./compare";

// A stand-in with the spend feature's matching rule (first row wins by lower
// case; a channel takes its sources' spend), so these tests don't depend on
// that feature's module — only on how the comparison uses what it returns.
vi.mock("./spend", async (importOriginal) => {
  const real = await importOriginal<typeof import("./spend")>();
  const { channelOfSource } = await import("@shared/marketing");
  return {
    ...real,
    assignSpend: (spend: { month: string; source: string; amount: number }[], rows: { name: string }[], group: Grouping, months: string[]) => {
      const byKey = new Map<string, string>();
      for (const r of rows) if (!byKey.has(r.name.toLowerCase())) byKey.set(r.name.toLowerCase(), r.name);
      const byRow = new Map<string, number>();
      const unmatched: { source: string; amount: number; why: "noLeads" }[] = [];
      let total = 0;
      for (const s of spend) {
        total += s.amount;
        const target = group === "channel"
          ? byKey.get(channelOfSource(s.source).toLowerCase()) ?? byKey.get(s.source.toLowerCase())
          : byKey.get(s.source.toLowerCase());
        if (target) byRow.set(target, (byRow.get(target) ?? 0) + s.amount);
        else unmatched.push({ source: s.source, amount: s.amount, why: "noLeads" });
      }
      return { byRow, byRowMonth: new Map(), byMonth: months.map(() => null), unmatched, total };
    },
  };
});

// ── fixtures ──

type Row = { leadDate: Date | null; outcome: string | null; marketingSource: string | null };
const at = (day: string, time = "12:00") => fromZonedTime(`${day}T${time}:00`, TZ);
const many = (n: number, day: string, outcome: string | null, source: string | null, time?: string): Row[] =>
  Array.from({ length: n }, () => ({ leadDate: at(day, time), outcome, marketingSource: source }));

const GMB_V = "GMB 525 W Main St Visalia", GMB_F = "GMB 1 Main St Fresno";
const GMB = "Google Business Profile (GMB)", WALKER = "Walker Advertising";

const ROWS: Row[] = [
  // Aug 1–24
  ...many(6, "2026-08-03", "Signed", GMB_V),
  ...many(4, "2026-08-05", "Rejected", GMB_V),
  ...many(9, "2026-08-10", "Signed", "Walker Advertising Contract 26"),
  ...many(11, "2026-08-11", null, "Walker Advertising Contract 26"),
  ...many(3, "2026-08-12", "Signed", "Billboard 99"),
  ...many(2, "2026-08-12", "Open", "Billboard 99"),
  ...many(2, "2026-08-14", "Signed", null),
  ...many(3, "2026-08-14", "Rejected", "  "),
  ...many(1, "2026-08-24", "Open", null, "23:30"),          // the last minutes of Aug 24, Pacific: in
  // Aug 25–31: in neither range
  ...many(1, "2026-08-25", "Signed", null, "00:10"),
  ...many(4, "2026-08-28", "Signed", "Walker Advertising Contract 26"),
  // Sep 1–24
  ...many(10, "2026-09-02", "Signed", GMB_V),
  ...many(5, "2026-09-03", "Signed", GMB_F),
  ...many(5, "2026-09-03", "Open", GMB_F),
  ...many(2, "2026-09-08", "Signed Referred Out", "Walker Advertising Contract 27"),
  ...many(8, "2026-09-09", "Rejected", "Walker Advertising Contract 27"),
  ...many(4, "2026-09-15", "Referral Accepted", "Web Search"),
  ...many(1, "2026-09-20", "Signed", null),
  ...many(1, "2026-09-20", "Open", ""),
  { leadDate: null, outcome: "Signed", marketingSource: "Web Search" },   // undated: never counted
];

/** What the database returns for a range: the rows whose leadDate is inside it. */
const within = (rows: Row[], r: { from: string; to: string }) => {
  const { from, to } = toDates(r);
  return rows.filter((x) => x.leadDate && x.leadDate >= from && x.leadDate <= to);
};

/** The dashboard's own count of a range, as its loop does it: derive() then tally per row. */
function dashboard(rows: Row[], r: { from: string; to: string }, group: Grouping) {
  const d = toDates(r);
  const months = monthsBetween(d.from, d.to);
  const byName = new Map<string, { name: string; members: Set<string>; leads: number; signed: number }>();
  let leads = 0, signed = 0;
  for (const l of derive(within(rows, r), months, group)) {
    leads++;
    if (l.signed) signed++;
    const s = byName.get(l.name) ?? { name: l.name, members: new Set<string>(), leads: 0, signed: 0 };
    s.leads++;
    if (l.signed) s.signed++;
    if (l.source !== NO_SOURCE) s.members.add(l.source);
    byName.set(l.name, s);
  }
  const list = Array.from(byName.values())
    .map((s) => ({ name: s.name, members: Array.from(s.members), leads: s.leads, signed: s.signed }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads || a.name.localeCompare(b.name));
  return {
    from: r.from, to: r.to, months,
    rows: list,
    totals: { leads, signed, conversion: pct(signed, leads), spend: null as number | null, costPerSignup: null as number | null },
  };
}

const coverage = (over: Partial<Coverage> = {}): Coverage => ({
  total: 50_000, stored: 50_000, remaining: 0, at: null,
  complete: true, completeFrom: null, method: "complete", trustedFrom: null,
  newestLeadAt: null, syncedAt: null, syncState: "ok", backfillRunning: false,
  asOf: "2026-09-24T20:00:00.000Z",
  ...over,
});
// Loaded back to Jan 22, 2026: periods from Feb 21 on can be compared.
const LOADING = coverage({
  remaining: 40_000, complete: false, method: "cursor",
  completeFrom: "2026-01-22T08:00:00.000Z", trustedFrom: "2026-02-21T08:00:00.000Z",
});

function compare(opts: {
  cur: { from: string; to: string }; mode?: "prev" | "yoy"; group?: Grouping; rows?: Row[]; cov?: Coverage;
  spend?: { month: string; source: string; amount: number }[]; curSpend?: { spend: number; costPerSignup: number };
}) {
  const group = opts.group ?? "channel", mode = opts.mode ?? "prev", rows = opts.rows ?? ROWS;
  const range = comparisonRange(opts.cur.from, opts.cur.to, mode)!;
  const current = dashboard(rows, opts.cur, group);
  if (opts.curSpend) Object.assign(current.totals, opts.curSpend);
  const d = toDates(range);
  const prior = tallyPrior(within(rows, range), monthsBetween(d.from, d.to), group);
  const c = buildComparison({ mode, range, current, prior, priorSpend: opts.spend ?? [], coverage: opts.cov ?? LOADING, group });
  return { c, prior, current, range };
}

// ── tests ──

describe("comparisonRange", () => {
  it("steps back whole months from a 1st", () => {
    expect(comparisonRange("2026-09-01", "2026-09-24", "prev")).toEqual({ from: "2026-08-01", to: "2026-08-24" });
    expect(comparisonRange("2026-08-01", "2026-08-31", "prev")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(comparisonRange("2026-07-01", "2026-09-24", "prev")).toEqual({ from: "2026-04-01", to: "2026-06-24" });
    expect(comparisonRange("2025-10-01", "2026-09-24", "prev")).toEqual({ from: "2024-10-01", to: "2025-09-24" });
    expect(comparisonRange("2025-10-01", "2026-09-30", "prev")).toEqual({ from: "2024-10-01", to: "2025-09-30" });
  });

  it("keeps a month end a month end and clamps other days", () => {
    expect(comparisonRange("2026-09-01", "2026-09-30", "prev")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(comparisonRange("2026-03-01", "2026-03-31", "prev")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonRange("2026-03-01", "2026-03-30", "prev")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonRange("2026-01-01", "2026-01-15", "prev")).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });

  it("takes the same number of days just before any other range", () => {
    expect(comparisonRange("2026-09-10", "2026-09-24", "prev")).toEqual({ from: "2026-08-26", to: "2026-09-09" });
    expect(comparisonRange("2026-03-05", "2026-03-05", "prev")).toEqual({ from: "2026-03-04", to: "2026-03-04" });
    expect(comparisonRange("2026-03-02", "2026-03-08", "prev")).toEqual({ from: "2026-02-23", to: "2026-03-01" });
  });

  it("goes back a year for yoy", () => {
    expect(comparisonRange("2026-01-01", "2026-09-24", "yoy")).toEqual({ from: "2025-01-01", to: "2025-09-24" });
    expect(comparisonRange("2028-02-01", "2028-02-29", "yoy")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(comparisonRange("2029-02-01", "2029-02-28", "yoy")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(comparisonRange("2027-02-10", "2027-02-20", "yoy")).toEqual({ from: "2026-02-10", to: "2026-02-20" });
  });

  it("has nothing to compare All time, or anything reaching before 2020, with", () => {
    expect(comparisonRange("2020-01-01", "2026-09-24", "prev")).toBeNull();
    expect(comparisonRange("2020-01-01", "2026-09-24", "yoy")).toBeNull();
    expect(comparisonRange("2019-06-01", "2019-06-30", "prev")).toBeNull();
    expect(comparisonRange("2020-06-01", "2020-06-30", "yoy")).toBeNull();
    expect(comparisonRange("2020-01-02", "2020-01-10", "prev")).toBeNull();
    expect(comparisonRange("2020-02-01", "2020-02-29", "prev")).toEqual({ from: "2020-01-01", to: "2020-01-31" });
    expect(comparisonRange("2026-09-24", "2026-09-01", "prev")).toBeNull();
    expect(comparisonRange("", "2026-09-01", "prev")).toBeNull();
  });
});

describe("rangeWords", () => {
  it("names a range the way the page does", () => {
    expect(rangeWords("2026-08-01", "2026-08-24")).toBe("Aug 1–24, 2026");
    expect(rangeWords("2025-07-01", "2026-06-30")).toBe("Jul 1, 2025 – Jun 30, 2026");
    expect(rangeWords("2026-04-01", "2026-06-24")).toBe("Apr 1 – Jun 24, 2026");
    expect(rangeWords("2026-03-04", "2026-03-04")).toBe("Mar 4, 2026");
  });

  it("drops a year the page already states", () => {
    expect(rangeWords("2026-08-01", "2026-08-24", 2026)).toBe("Aug 1–24");
    expect(rangeWords("2025-01-01", "2025-09-24", 2026)).toBe("Jan 1 – Sep 24, 2025");
    expect(rangeWords("2025-12-01", "2026-01-24", 2026)).toBe("Dec 1, 2025 – Jan 24, 2026");
  });
});

describe("the earlier period", () => {
  it("reads exactly four columns — teamRole puts a rep's lead in the BD/FR team row", () => {
    expect(Object.keys(PRIOR_COLS).sort()).toEqual(["leadDate", "marketingSource", "outcome", "teamRole"]);
  });

  it("totals what the scorecard shows when that range is chosen directly", () => {
    for (const group of ["channel", "source"] as const) {
      const { c, prior, range } = compare({ cur: { from: "2026-09-01", to: "2026-09-24" }, group });
      expect(range).toEqual({ from: "2026-08-01", to: "2026-08-24" });
      const direct = dashboard(ROWS, range, group);
      expect(c.totals.leads).toBe(direct.totals.leads);
      expect(c.totals.signed).toBe(direct.totals.signed);
      expect(c.totals.conversion).toBe(direct.totals.conversion);
      expect(Object.keys(c.byName).sort()).toEqual(direct.rows.map((r) => r.name).sort());
      for (const r of direct.rows) expect(c.byName[r.name]).toEqual({ leads: r.leads, signed: r.signed, conversion: pct(r.signed, r.leads) });
      expect(prior.monthly).toEqual([{ month: "2026-08", leads: direct.totals.leads, signed: direct.totals.signed }]);
    }
  });

  it("counts Pacific days: late on Aug 24 is in, just after midnight isn't", () => {
    const { c } = compare({ cur: { from: "2026-09-01", to: "2026-09-24" } });
    expect(c.totals).toMatchObject({ leads: 41, signed: 20 });
    expect(c.byName[NO_SOURCE]).toMatchObject({ leads: 6, signed: 2 });
  });
});

describe("buildComparison", () => {
  const sep = { from: "2026-09-01", to: "2026-09-24" };

  it("adds the per-row changes, gone rows included, up to the change in sign-ups", () => {
    for (const group of ["channel", "source"] as const) {
      const { c, prior, current } = compare({ cur: sep, group });
      const prevOf = (n: string) => c.byName[n]?.signed ?? 0;
      const sum = current.rows.reduce((s, r) => s + r.signed - prevOf(r.name), 0) + c.gone.reduce((s, g) => s - g.signed, 0);
      expect(sum).toBe(current.totals.signed - c.totals.signed);
      expect(checkComparison(c, prior, current)).toEqual([]);
    }
  });

  it("lists rows that had leads before and none now as gone", () => {
    const { c } = compare({ cur: sep });
    expect(c.gone).toEqual([{ name: "Billboard 99", members: ["Billboard 99"], leads: 5, signed: 3 }]);
  });

  it("names the biggest mover and writes the headline", () => {
    const { c } = compare({ cur: sep });
    expect(c.partial).toBe(false);
    expect(c.label).toBe("Aug 1–24");
    expect(c.mover).toMatchObject({ name: GMB, cur: 15, prev: 6, delta: 9 });
    expect(c.mover!.members.sort()).toEqual([GMB_F, GMB_V].sort());
    expect(c.insights).toEqual([
      `Sign-ups: 22, up 2 (10%) on Aug 1–24 (20). Biggest gain: ${GMB} (+9); biggest drop: ${WALKER} (−7).`,
    ]);
  });

  it("leaves the % off a change on fewer than 10, and says level when level", () => {
    const small: Row[] = [...many(4, "2026-08-03", "Signed", "Web Search"), ...many(6, "2026-09-03", "Signed", "Web Search")];
    expect(compare({ cur: sep, rows: small }).c.insights[0]).toBe("Sign-ups: 6, up 2 on Aug 1–24 (4). Biggest gain: Web Search (+2).");
    const level: Row[] = [...many(12, "2026-08-03", "Signed", "Web Search"), ...many(12, "2026-09-03", "Signed", "Web Search")];
    expect(compare({ cur: sep, rows: level }).c.insights[0]).toBe("Sign-ups: 12, level with Aug 1–24 (12).");
    expect(compare({ cur: sep, rows: level }).c.mover).toBeNull();
  });

  it("needs at least 6 sign-ups between the two periods to call a mover", () => {
    const rows: Row[] = [...many(1, "2026-08-03", "Signed", "A"), ...many(4, "2026-09-03", "Signed", "A")];
    expect(compare({ cur: sep, rows }).c.mover).toBeNull();
    rows.push(...many(1, "2026-09-04", "Signed", "A"));
    expect(compare({ cur: sep, rows }).c.mover).toMatchObject({ name: "A", cur: 5, prev: 1, delta: 4 });
  });

  it("breaks a tie by the change that's larger for its size", () => {
    const rows: Row[] = [
      ...many(20, "2026-08-03", "Signed", "Big"), ...many(25, "2026-09-03", "Signed", "Big"),
      ...many(2, "2026-08-03", "Signed", "Small"), ...many(7, "2026-09-03", "Signed", "Small"),
    ];
    expect(compare({ cur: sep, rows }).c.mover?.name).toBe("Small");
  });

  it("goes grey and quiet when the earlier period isn't fully loaded", () => {
    const { c, prior, current } = compare({ cur: { from: "2026-01-01", to: "2026-09-24" }, mode: "yoy" });
    expect(c.from).toBe("2025-01-01");
    expect(c.label).toBe("Jan 1 – Sep 24, 2025");
    expect(c.partial).toBe(true);
    expect(c.loadedFrom).toBe(LOADING.completeFrom);
    expect(c.mover).toBeNull();
    expect(c.insights).toEqual([]);
    expect(c.monthly.map((m) => m.month)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"]);
    expect(c.monthly.every((m) => !m.loaded)).toBe(true);
    // Still reconciles: grey is about trust, not about the arithmetic.
    expect(checkComparison(c, prior, current)).toEqual([]);
  });

  it("counts a period as loaded only from 30 days after history is complete", () => {
    const edge = coverage({ complete: false, remaining: 10, completeFrom: "2026-07-02T07:00:00.000Z", trustedFrom: "2026-08-01T07:00:00.000Z" });
    expect(compare({ cur: sep, cov: edge }).c.partial).toBe(false);
    const later = coverage({ complete: false, remaining: 10, completeFrom: "2026-07-03T07:00:00.000Z", trustedFrom: "2026-08-02T07:00:00.000Z" });
    expect(compare({ cur: sep, cov: later }).c.partial).toBe(true);
    expect(compare({ cur: sep, cov: coverage() }).c).toMatchObject({ partial: false, loadedFrom: null });
  });

  it("aligns last year's months with this year's, month for month", () => {
    const rows: Row[] = [...many(3, "2025-08-10", "Signed", "A"), ...many(7, "2025-09-10", "Signed", "A"), ...many(9, "2026-09-02", "Signed", "A")];
    const { c } = compare({ cur: { from: "2026-08-01", to: "2026-09-24" }, mode: "yoy", rows, cov: coverage() });
    expect(c.monthly).toEqual([
      { month: "2025-08", leads: 3, signed: 3, loaded: true },
      { month: "2025-09", leads: 7, signed: 7, loaded: true },
    ]);
  });

  it("keeps the earlier period's own months when 'Previous' is shifted by days, not months", () => {
    // Sep 15–24 → Sep 5–14: the same month, so there is no 'month before' to pair with.
    const one: Row[] = [...many(1, "2026-09-08", "Signed", "A"), ...many(2, "2026-09-18", "Signed", "A")];
    const a = compare({ cur: { from: "2026-09-15", to: "2026-09-24" }, rows: one, cov: coverage() });
    expect(a.range).toEqual({ from: "2026-09-05", to: "2026-09-14" });
    expect(a.c.totals).toMatchObject({ leads: 1, signed: 1 });
    expect(a.c.monthly).toEqual([{ month: "2026-09", leads: 1, signed: 1, loaded: true }]);
    expect(checkComparison(a.c, a.prior, a.current)).toEqual([]);

    // Sep 10–24 → Aug 26–Sep 9: one current month, two earlier ones, both kept.
    const two: Row[] = [...many(3, "2026-08-28", "Signed", "A"), ...many(2, "2026-09-04", "Rejected", "A"), ...many(1, "2026-09-12", "Signed", "A")];
    const b = compare({ cur: { from: "2026-09-10", to: "2026-09-24" }, rows: two, cov: coverage() });
    expect(b.c.monthly).toEqual([
      { month: "2026-08", leads: 3, signed: 3, loaded: true },
      { month: "2026-09", leads: 2, signed: 0, loaded: true },
    ]);
    expect(checkComparison(b.c, b.prior, b.current)).toEqual([]);

    // Aug 15–Sep 24 → Jul 5–Aug 14: Jul and Aug, not Jun and Jul.
    const span: Row[] = [...many(4, "2026-07-10", "Signed", "A"), ...many(5, "2026-08-10", "Open", "A")];
    const s = compare({ cur: { from: "2026-08-15", to: "2026-09-24" }, rows: span, cov: coverage() });
    expect(s.range).toEqual({ from: "2026-07-05", to: "2026-08-14" });
    expect(s.c.monthly).toEqual([
      { month: "2026-07", leads: 4, signed: 4, loaded: true },
      { month: "2026-08", leads: 5, signed: 0, loaded: true },
    ]);
    expect(checkComparison(s.c, s.prior, s.current)).toEqual([]);
  });

  it("still pairs month for month when 'Previous' starts on a 1st", () => {
    const rows: Row[] = [...many(2, "2026-04-10", "Signed", "A"), ...many(3, "2026-06-20", "Signed", "A"), ...many(1, "2026-08-02", "Signed", "A")];
    const { c, prior, current } = compare({ cur: { from: "2026-07-01", to: "2026-09-24" }, rows, cov: coverage() });
    expect(c.monthly).toEqual([
      { month: "2026-04", leads: 2, signed: 2, loaded: true },
      { month: "2026-05", leads: 0, signed: 0, loaded: true },
      { month: "2026-06", leads: 3, signed: 3, loaded: true },
    ]);
    expect(checkComparison(c, prior, current)).toEqual([]);
  });

  it("is empty, not broken, with no leads on either side", () => {
    const { c, prior, current } = compare({ cur: sep, rows: [] });
    expect(c.totals).toEqual({ leads: 0, signed: 0, conversion: 0, spend: null, costPerLead: null, costPerSignup: null });
    expect(c.byName).toEqual({});
    expect(c).toMatchObject({ gone: [], mover: null, insights: [], costComparable: false });
    expect(c.monthly).toEqual([{ month: "2026-08", leads: 0, signed: 0, loaded: true }]);
    expect(checkComparison(c, prior, current)).toEqual([]);
  });

  it("costs the earlier period over its paid rows, and compares cost only between whole months", () => {
    const rows: Row[] = [
      ...many(8, "2026-07-06", "Signed", "Walker Advertising Contract 26"),
      ...many(12, "2026-07-07", "Rejected", "Walker Advertising Contract 26"),
      ...many(10, "2026-07-08", "Signed", GMB_V),
      ...many(10, "2026-08-06", "Signed", "Walker Advertising Contract 27"),
    ];
    const spend = [
      { month: "2026-07", source: "Walker Advertising Contract 26", amount: 4000 },
      { month: "2026-08", source: "Walker Advertising", amount: 3980 },   // the current month's: not the earlier period's
    ];
    const whole = compare({ cur: { from: "2026-08-01", to: "2026-08-31" }, rows, spend, curSpend: { spend: 3980, costPerSignup: 398 }, cov: coverage() }).c;
    expect(whole.totals).toMatchObject({ spend: 4000, costPerLead: 200, costPerSignup: 500 });
    expect(whole.costComparable).toBe(true);
    expect(whole.insights[1]).toBe("Cost per sign-up fell from $500 to $398.");

    const part = compare({ cur: { from: "2026-08-01", to: "2026-08-24" }, rows, spend, curSpend: { spend: 3980, costPerSignup: 398 }, cov: coverage() }).c;
    expect(part.costComparable).toBe(false);
    expect(part.insights).toHaveLength(1);

    const unpaid = compare({ cur: { from: "2026-08-01", to: "2026-08-31" }, rows, spend: [], curSpend: { spend: 3980, costPerSignup: 398 }, cov: coverage() }).c;
    expect(unpaid.totals).toMatchObject({ spend: null, costPerLead: null, costPerSignup: null });
    expect(unpaid.costComparable).toBe(false);
  });
});

describe("checkComparison", () => {
  it("catches a row that drops out of both the rows and the gone list", () => {
    const { c, prior, current } = compare({ cur: { from: "2026-09-01", to: "2026-09-24" } });
    const broken: Comparison = { ...c, gone: [] };
    expect(checkComparison(broken, prior, current).length).toBeGreaterThan(0);
    const off: PriorTally = { ...prior, totals: { ...prior.totals, signed: prior.totals.signed + 1 } };
    expect(checkComparison(c, off, current).length).toBeGreaterThan(0);
  });

  it("catches months that miss the earlier period's leads", () => {
    const { c, prior, current } = compare({ cur: { from: "2026-09-01", to: "2026-09-24" } });
    // What the month-for-month lookup used to return for a range shifted by days.
    const misread: Comparison = { ...c, monthly: [{ month: "2026-07", leads: 0, signed: 0, loaded: true }] };
    expect(checkComparison(misread, prior, current)).toEqual([`compare months add to 0/0, totals say ${c.totals.leads}/${c.totals.signed}`]);
  });
});

describe("paceOf", () => {
  const monthly = [{ month: "2026-08", leads: 400, signed: 170 }, { month: "2026-09", leads: 380, signed: 140 }];

  it("projects the month in progress", () => {
    expect(paceOf(monthly, "2026-09-24", "2026-09-24")).toEqual({
      month: "2026-09", day: 24, days: 30, signed: 140, leads: 380, projected: 175, projectedLeads: 475,
      text: "September so far (24 of 30 days): 140 sign-ups, on pace for about 175, against 170 in August.",
    });
  });

  it("says nothing before the 5th", () => {
    const early = paceOf([{ month: "2026-09", leads: 40, signed: 12 }], "2026-09-04", "2026-09-04");
    expect(early).toMatchObject({ day: 4, projected: null, projectedLeads: null, text: null });
    expect(paceOf([{ month: "2026-09", leads: 50, signed: 1 }], "2026-09-05", "2026-09-05")?.text)
      .toBe("September so far (5 of 30 days): 1 sign-up, on pace for about 6.");
  });

  it("only applies to a range running to today, ending in today's month", () => {
    expect(paceOf(monthly, "2026-09-23", "2026-09-24")).toBeNull();
    expect(paceOf(monthly.slice(0, 1), "2026-08-31", "2026-08-31")?.month).toBe("2026-08");
    expect(paceOf(monthly.slice(0, 1), "2026-09-24", "2026-09-24")).toBeNull();
    expect(paceOf([], "2026-09-24", "2026-09-24")).toBeNull();
    // A range starting partway through the month doesn't hold the month's count.
    expect(paceOf(monthly.slice(1), "2026-09-24", "2026-09-24", "2026-09-10")).toBeNull();
    expect(paceOf(monthly, "2026-09-24", "2026-09-24", "2026-08-15")?.text).toBe(
      "September so far (24 of 30 days): 140 sign-ups, on pace for about 175.",
    );
  });
});

describe("ripening", () => {
  const lead = (lagDays: number | null, signed = true) => ({
    signed,
    createdDate: new Date("2026-09-01T17:00:00Z"),
    signedUpDate: lagDays == null ? null : new Date(Date.parse("2026-09-01T17:00:00Z") + lagDays * 86_400_000),
  }) as unknown as Lead;
  const leads = [...Array.from({ length: 54 }, () => lead(2)), ...Array.from({ length: 6 }, () => lead(9)), lead(null), lead(null, false)];

  it("says what share of sign-ups took more than a week", () => {
    expect(ripening(leads, "2026-09-24", "2026-09-24")).toBe(
      "Leads from the last week are still ripening: 10% of sign-ups in this period came more than a week after the lead.",
    );
    expect(ripening(leads, "2026-09-18", "2026-09-24")).not.toBeNull();
  });

  it("stays quiet for older ranges, small ones, and when nothing signs late", () => {
    expect(ripening(leads, "2026-09-17", "2026-09-24")).toBeNull();
    expect(ripening(leads.slice(0, 40), "2026-09-24", "2026-09-24")).toBeNull();
    expect(ripening(Array.from({ length: 60 }, () => lead(1)), "2026-09-24", "2026-09-24")).toBeNull();
    expect(ripening([], "2026-09-24", "2026-09-24")).toBeNull();
  });
});
