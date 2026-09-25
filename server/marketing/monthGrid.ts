/**
 * The channel × month grid, in every metric the page can switch to: sign-ups,
 * leads, the not-viable count behind the share, and spend for cost per sign-up.
 *
 * Pure — it works from derive()'s leads and the spend assignment the dashboard
 * already built, so every cell adds back to a scorecard number (checkGrid).
 */
import { NOT_VIABLE, type Counts, type Lead, type RowRef } from "./common";
import { reasonOf } from "./reasons";
import type { SpendAssignment } from "./spend";

export type MonthGrid = {
  firstIdx: number;   // first month index with any lead; the page hides earlier columns (All time otherwise shows ~80 mostly empty ones)
  rows: {
    name: string; members: string[]; leads: number; signed: number;
    leadCells: number[]; signedCells: number[]; notViableCells: number[]; spendCells: (number | null)[];
  }[];   // dashboard row order
  monthly: {
    month: string; leads: number; signed: number; notViable: number;
    spend: number | null; costPerSignup: number | null; costPerLead: number | null;
  }[];
  costAvg: number | null;   // = totals.costPerSignup, for heat scaling
};

type GridRow = MonthGrid["rows"][number];

// Money is compared in whole cents, so a float sum never reads as a mismatch.
const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => Math.round(n * 100) / 100;

export function monthGrid(leads: Lead[], months: string[], rows: RowRef[], spend: SpendAssignment, totals: { costPerSignup: number | null }): MonthGrid {
  const zeros = () => months.map(() => 0);
  const out: GridRow[] = rows.map((r) => {
    const entered = spend.byRowMonth.get(r.name);
    return {
      name: r.name, members: r.members, leads: 0, signed: 0,
      leadCells: zeros(), signedCells: zeros(), notViableCells: zeros(),
      spendCells: months.map((_, i) => entered?.[i] ?? null),
    };
  });
  // The first row of a name wins, as in assignSpend, so no lead counts twice.
  const byName = new Map<string, GridRow>();
  out.forEach((g) => { if (!byName.has(g.name)) byName.set(g.name, g); });

  const monthly: MonthGrid["monthly"] = months.map((month, i) => ({
    month, leads: 0, signed: 0, notViable: 0, spend: spend.byMonth[i] ?? null, costPerSignup: null, costPerLead: null,
  }));

  let firstIdx = months.length;
  for (const l of leads) {
    const g = byName.get(l.name);
    // Row totals count every lead, like the scorecard, so a lead outside the
    // months shows up in checkGrid instead of silently leaving the grid.
    if (g) { g.leads++; if (l.signed) g.signed++; }
    if (l.i < 0 || l.i >= months.length) continue;
    if (l.i < firstIdx) firstIdx = l.i;
    const nv = NOT_VIABLE.has(reasonOf(l.bucket, l.status, l.subStatus));
    const m = monthly[l.i];
    m.leads++;
    if (l.signed) m.signed++;
    if (nv) m.notViable++;
    if (g) {
      g.leadCells[l.i]++;
      if (l.signed) g.signedCells[l.i]++;
      if (nv) g.notViableCells[l.i]++;
    }
  }

  monthly.forEach((m, i) => {
    // A month with spend but no leads still shows, so the cost view's columns
    // add up to the spend on the scorecard.
    if (m.spend != null && i < firstIdx) firstIdx = i;
    // The one-month version of the totals' formula: only rows that paid that
    // month divide, so unpaid channels don't make paid ones look cheaper.
    let paidSigned = 0, paidLeads = 0;
    byName.forEach((g) => {
      if ((g.spendCells[i] ?? 0) > 0) { paidSigned += g.signedCells[i]; paidLeads += g.leadCells[i]; }
    });
    m.costPerSignup = m.spend != null && paidSigned ? money(m.spend / paidSigned) : null;
    m.costPerLead = m.spend != null && paidLeads ? money(m.spend / paidLeads) : null;
  });

  return { firstIdx: firstIdx < months.length ? firstIdx : 0, rows: out, monthly, costAvg: totals.costPerSignup };
}

/**
 * Everything the grid shows must add back to numbers already on the page: each
 * row to its scorecard row, each month to the monthly totals, the spend to the
 * TOTAL spend (unmatched included), and — when `why` is passed — the not-viable
 * cells to the funnel. Returns the problems found; empty means it all adds up.
 */
export function checkGrid(
  g: MonthGrid,
  totals: Counts & { spend: number | null },
  sources: { name: string; leads: number; signed: number; spend: number | null; cells: number[] }[],
  why?: { funnel: { notViable: number } },
): string[] {
  const problems: string[] = [];
  const say = (s: string) => problems.push(`grid: ${s}`);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const sumCents = (a: (number | null)[]) => a.reduce<number>((x, y) => x + (y == null ? 0 : cents(y)), 0);
  const n = g.monthly.length;

  const bySource = new Map(sources.map((s) => [s.name, s] as const));
  const seen = new Set<string>();
  g.rows.forEach((r) => {
    if (r.leadCells.length !== n || r.signedCells.length !== n || r.notViableCells.length !== n || r.spendCells.length !== n) {
      say(`${r.name}'s cells are not aligned to the ${n} months`);
      return;
    }
    const leads = sum(r.leadCells), signed = sum(r.signedCells);
    if (leads !== r.leads) say(`${r.name}'s lead cells add to ${leads}, but it has ${r.leads} leads`);
    if (signed !== r.signed) say(`${r.name}'s sign-up cells add to ${signed}, but it has ${r.signed} signed`);
    if (r.notViableCells.some((v, i) => v > r.leadCells[i])) say(`${r.name} has a month with more not-viable leads than leads`);

    const s = bySource.get(r.name);
    if (!s) { say(`${r.name} is not on the scorecard`); return; }
    if (seen.has(r.name)) say(`${r.name} appears twice`);
    seen.add(r.name);
    if (s.leads !== r.leads) say(`${r.name}: ${r.leads} leads, scorecard ${s.leads}`);
    if (s.signed !== r.signed) say(`${r.name}: ${r.signed} signed, scorecard ${s.signed}`);
    if (s.cells.length !== n || s.cells.some((v, i) => v !== r.signedCells[i])) say(`${r.name}'s sign-up cells differ from the scorecard's`);
    const spent = sumCents(r.spendCells);
    if (spent !== cents(s.spend ?? 0)) say(`${r.name}'s spend cells add to $${spent / 100}, scorecard $${s.spend ?? 0}`);
  });
  sources.forEach((s) => { if (!seen.has(s.name)) say(`${s.name} is on the scorecard but not in the grid`); });

  const col = (pick: (r: GridRow) => number[], i: number) => g.rows.reduce((a, r) => a + (pick(r)[i] ?? 0), 0);
  g.monthly.forEach((m, i) => {
    if (col((r) => r.leadCells, i) !== m.leads) say(`${m.month}: the rows' leads don't add to the month's ${m.leads}`);
    if (col((r) => r.signedCells, i) !== m.signed) say(`${m.month}: the rows' sign-ups don't add to the month's ${m.signed}`);
    if (col((r) => r.notViableCells, i) !== m.notViable) say(`${m.month}: the rows' not-viable leads don't add to the month's ${m.notViable}`);
  });

  const leads = sum(g.monthly.map((m) => m.leads));
  const signed = sum(g.monthly.map((m) => m.signed));
  const notViable = sum(g.monthly.map((m) => m.notViable));
  if (leads !== totals.leads) say(`the months add to ${leads} leads, TOTAL ${totals.leads}`);
  if (signed !== totals.signed) say(`the months add to ${signed} signed, TOTAL ${totals.signed}`);
  if (sum(g.rows.map((r) => r.leads)) !== totals.leads) say(`the rows add to ${sum(g.rows.map((r) => r.leads))} leads, TOTAL ${totals.leads}`);
  if (sum(g.rows.map((r) => r.signed)) !== totals.signed) say(`the rows add to ${sum(g.rows.map((r) => r.signed))} signed, TOTAL ${totals.signed}`);
  if (why && notViable !== why.funnel.notViable) say(`${notViable} not-viable leads, the funnel has ${why.funnel.notViable}`);
  const spend = sumCents(g.monthly.map((m) => m.spend));
  if (spend !== cents(totals.spend ?? 0)) say(`the months' spend adds to $${spend / 100}, TOTAL $${totals.spend ?? 0}`);

  if (n && (g.firstIdx < 0 || g.firstIdx >= n)) say(`firstIdx ${g.firstIdx} is outside the ${n} months`);
  else if (g.monthly.slice(0, g.firstIdx).some((m) => m.leads || m.spend != null)) say(`a month before firstIdx has leads or spend`);
  return problems;
}
