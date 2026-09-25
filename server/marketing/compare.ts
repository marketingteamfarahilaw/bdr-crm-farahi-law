/**
 * Comparing the selected range with the one before it or the same one last
 * year, plus the current month's pace.
 *
 * The earlier period is counted by the same derive() as the dashboard, so its
 * totals are exactly what the scorecard's TOTAL shows when that range is picked
 * on its own. Rows that had leads then and none now are returned as `gone`, so
 * the per-row changes add up to the change in the total. A period Lead Docket
 * hasn't fully loaded is flagged `partial` and says nothing in the briefing: a
 * half-loaded year must never read as growth.
 */
import { and, gte, lte } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { getDb } from "../db";
import { leaddocketLeads } from "../../drizzle/schema";
import {
  NO_SOURCE, TEAM_CHANNEL, TZ, derive, monthBounds, monthsBetween, pct,
  type Grouping, type Lead, type RowRef,
} from "./common";
import { assignSpend, type SpendRow } from "./spend";
import { periodLoaded, type Coverage } from "./coverage";

export type CompareMode = "prev" | "yoy";

// ── calendar arithmetic on Pacific yyyy-MM-dd strings (no clocks, no zones) ──

const DAY_MS = 86_400_000;
const FLOOR = "2020-01-01";   // "All time" starts here; nothing earlier is in Lead Docket
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
const dayStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month m (1-12) of year y. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isMonthEnd = (s: string) => {
  const { y, m, d } = ymd(s);
  return d === daysIn(y, m);
};
/** Whole days since the epoch, for counting and stepping days. */
const dayNo = (s: string) => {
  const { y, m, d } = ymd(s);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const addDays = (s: string, n: number) => new Date((dayNo(s) + n) * DAY_MS).toISOString().slice(0, 10);
/** 'yyyy-MM' stepped by n months. */
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
/** Every 'yyyy-MM' from one Pacific day's month to another's — the same list monthsBetween gives for toDates(). */
const monthsOf = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from.slice(0, 7), guard = 0; m <= to.slice(0, 7) && guard < 240; m = shiftMonth(m, 1), guard++) out.push(m);
  return out;
};
/** A year earlier. Feb 29 becomes Feb 28, and a month's last day stays its last day. */
const yearBack = (s: string) => {
  const { y, m, d } = ymd(s);
  const last = daysIn(y - 1, m);
  return dayStr(y - 1, m, d === daysIn(y, m) ? last : Math.min(d, last));
};
const wholeMonths = (r: { from: string; to: string }) => ymd(r.from).d === 1 && isMonthEnd(r.to);

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const money = (n: number) => Math.round(n * 100) / 100;
const MINUS = "−";

/**
 * The period to compare with, or null when there is nothing earlier (All time,
 * or a result that would start before 2020).
 * - prev from a 1st: the same number of months before, to the same day (a
 *   month end stays a month end) — Sep 1–24 → Aug 1–24, Jul 1–Sep 24 → Apr 1–Jun 24.
 * - prev from any other day: the same number of days just before.
 * - yoy: both ends a year earlier.
 */
export function comparisonRange(from: string, to: string, mode: CompareMode): { from: string; to: string } | null {
  if (!isDay(from) || !isDay(to) || to < from || from <= FLOOR) return null;
  let out: { from: string; to: string };
  if (mode === "yoy") {
    out = { from: yearBack(from), to: yearBack(to) };
  } else if (ymd(from).d === 1) {
    const n = monthsOf(from, to).length;
    const [ty, tm] = shiftMonth(to.slice(0, 7), -n).split("-").map(Number);
    const last = daysIn(ty, tm);
    out = {
      from: `${shiftMonth(from.slice(0, 7), -n)}-01`,
      to: dayStr(ty, tm, isMonthEnd(to) ? last : Math.min(ymd(to).d, last)),
    };
  } else {
    const days = dayNo(to) - dayNo(from) + 1;
    out = { from: addDays(from, -days), to: addDays(from, -1) };
  }
  return out.from < FLOOR ? null : out;
}

/**
 * 'Aug 1–24, 2026' or 'Jul 1, 2025 – Jun 30, 2026'. With thisYear, a range
 * wholly in that year drops it ('Aug 1–24'), which is how the page names the
 * comparison next to a range that already states its year.
 */
export function rangeWords(from: string, to: string, thisYear?: number): string {
  const f = ymd(from), t = ymd(to);
  const year = (y: number) => (y === thisYear ? "" : `, ${y}`);
  if (from === to) return `${MON[f.m - 1]} ${f.d}${year(f.y)}`;
  if (f.y === t.y && f.m === t.m) return `${MON[f.m - 1]} ${f.d}–${t.d}${year(f.y)}`;
  if (f.y === t.y) return `${MON[f.m - 1]} ${f.d} – ${MON[t.m - 1]} ${t.d}${year(t.y)}`;
  return `${MON[f.m - 1]} ${f.d}, ${f.y} – ${MON[t.m - 1]} ${t.d}, ${t.y}`;
}

/** The same boundaries as the router's toRange: whole Pacific days. */
export function toDates(r: { from: string; to: string }): { from: Date; to: Date } {
  return { from: fromZonedTime(`${r.from}T00:00:00`, TZ), to: fromZonedTime(`${r.to}T23:59:59.999`, TZ) };
}

export type PriorTally = {
  months: string[];
  totals: { leads: number; signed: number };
  byName: Map<string, { leads: number; signed: number; members: Set<string> }>;
  monthly: { month: string; leads: number; signed: number }[];
};

/** All the comparison reads: three columns, on the leadDate index. */
export const PRIOR_COLS = {
  leadDate: leaddocketLeads.leadDate,
  outcome: leaddocketLeads.outcome,
  marketingSource: leaddocketLeads.marketingSource,
  teamRole: leaddocketLeads.teamRole,
};

/**
 * Counts the earlier period's rows exactly as the dashboard counts the current
 * ones — same derive(), so the same row names, isSigned and months.
 */
export function tallyPrior<T extends { leadDate: Date | string | null; outcome: string | null; marketingSource: string | null }>(
  rows: T[], months: string[], group: Grouping,
): PriorTally {
  const totals = { leads: 0, signed: 0 };
  const monthly = months.map((month) => ({ month, leads: 0, signed: 0 }));
  const byName: PriorTally["byName"] = new Map();
  for (const l of derive(rows, months, group)) {
    totals.leads++;
    if (l.signed) totals.signed++;
    if (l.i >= 0) { monthly[l.i].leads++; if (l.signed) monthly[l.i].signed++; }
    const r = byName.get(l.name) ?? { leads: 0, signed: 0, members: new Set<string>() };
    r.leads++;
    if (l.signed) r.signed++;
    if (l.source !== NO_SOURCE && l.source !== TEAM_CHANNEL) r.members.add(l.source);
    byName.set(l.name, r);
  }
  return { months, totals, byName, monthly };
}

/** The earlier period, in one query over the same leads the dashboard reads (BD/FR included, as one row). */
export async function loadPrior(range: { from: Date; to: Date }, group: Grouping): Promise<PriorTally> {
  const months = monthsBetween(range.from, range.to);
  const db = await getDb();
  if (!db) return tallyPrior([], months, group);
  const L = leaddocketLeads;
  const rows = await db.select(PRIOR_COLS).from(L)
    .where(and(gte(L.leadDate, range.from), lte(L.leadDate, range.to)));
  return tallyPrior(rows, months, group);
}

export type Comparison = {
  mode: CompareMode; from: string; to: string; label: string;
  partial: boolean; loadedFrom: string | null;
  totals: { leads: number; signed: number; conversion: number; spend: number | null; costPerLead: number | null; costPerSignup: number | null };
  costComparable: boolean;
  byName: Record<string, { leads: number; signed: number; conversion: number }>;
  gone: { name: string; members: string[]; leads: number; signed: number }[];
  // The earlier period's months, adding up to its totals; loaded whether Lead
  // Docket has all of that month. When the earlier period is the same months
  // moved back (yoy, or prev from a 1st) they're index-aligned to the current
  // months. A prev range from any other day is shifted by days, so its months
  // don't pair up with the current ones and may differ in number: match by month.
  monthly: { month: string; leads: number; signed: number; loaded: boolean }[];
  mover: { name: string; members: string[]; cur: number; prev: number; delta: number } | null;
  insights: string[];
};

type Change = { name: string; members: string[]; cur: number; prev: number; delta: number };

/** Bigger moves first; between equal moves, the one that's larger for its size. */
const byMove = (a: Change, b: Change) =>
  Math.abs(b.delta) - Math.abs(a.delta)
  || Math.abs(b.delta) / Math.sqrt(b.prev + 1) - Math.abs(a.delta) / Math.sqrt(a.prev + 1)
  || a.name.localeCompare(b.name);

export function buildComparison(a: {
  mode: CompareMode;
  range: { from: string; to: string };
  current: {
    from: string; to: string;
    totals: { leads: number; signed: number; conversion: number; spend: number | null; costPerSignup: number | null };
    rows: (RowRef & { leads: number; signed: number })[];
  };
  prior: PriorTally; priorSpend: SpendRow[]; coverage: Coverage; group: Grouping;
}): Comparison {
  const { mode, range, current, prior, coverage } = a;
  // Sign-ups trail leads, so a period counts as loaded only once history reaches
  // LAG_DAYS before it starts (coverage.trustedFrom).
  const partial = !periodLoaded(coverage, toDates(range).from);
  const label = rangeWords(range.from, range.to, Number(current.to.slice(0, 4)));

  // The earlier rows in the dashboard's order, so spend matching (first row wins
  // between case twins) picks the same row it would if this range were shown.
  const rows = Array.from(prior.byName.entries())
    .map(([name, r]) => ({ name, members: Array.from(r.members), leads: r.leads, signed: r.signed }))
    .sort((x, y) => y.signed - x.signed || y.leads - x.leads || x.name.localeCompare(y.name));

  // The same paid-rows cost as the scorecard: unpaid rows don't dilute it.
  const spend = assignSpend(
    a.priorSpend.filter((r) => prior.months.includes(r.month)),
    rows.map(({ name, members }) => ({ name, members })),
    a.group,
    prior.months,
  );
  const paid = rows.filter((r) => spend.byRow.has(r.name));
  const paidLeads = paid.reduce((s, r) => s + r.leads, 0);
  const paidSigned = paid.reduce((s, r) => s + r.signed, 0);
  const totals = {
    leads: prior.totals.leads,
    signed: prior.totals.signed,
    conversion: pct(prior.totals.signed, prior.totals.leads),
    spend: spend.total || null,
    costPerLead: paidLeads ? money(spend.total / paidLeads) : null,
    costPerSignup: paidSigned ? money(spend.total / paidSigned) : null,
  };
  // A part month's spend counts in full, which would distort the change.
  const costComparable = wholeMonths(current) && wholeMonths(range) && (current.totals.spend ?? 0) > 0 && (totals.spend ?? 0) > 0;

  // fromEntries makes own properties, so a source named like an Object method can't collide.
  const byName: Comparison["byName"] = Object.fromEntries(
    rows.map((r): [string, Comparison["byName"][string]] => [r.name, { leads: r.leads, signed: r.signed, conversion: pct(r.signed, r.leads) }]),
  );
  const here = new Set(current.rows.map((r) => r.name));
  const gone = rows.filter((r) => !here.has(r.name));

  // Pair month with month only when the earlier period is exactly the current
  // months moved back. Otherwise (prev from a day other than the 1st, shifted
  // by days) a month-for-month lookup would read months outside the earlier
  // period and drop its leads, so it keeps its own months instead.
  const curMonths = monthsOf(current.from, current.to);
  const step = mode === "yoy" ? 12 : curMonths.length;
  const shifted = curMonths.map((m) => shiftMonth(m, -step));
  const aligned = shifted.length === prior.months.length && shifted.every((m, i) => m === prior.months[i]);
  const priorMonth = new Map(prior.monthly.map((m) => [m.month, m]));
  const monthly = (aligned ? shifted : prior.months).map((month) => {
    const p = priorMonth.get(month);
    return { month, leads: p?.leads ?? 0, signed: p?.signed ?? 0, loaded: periodLoaded(coverage, monthBounds(month).start) };
  });

  // Every row in either period, gone ones at zero, so the changes add up to the total's.
  const changes: Change[] = [
    ...current.rows.map((r) => {
      const prev = prior.byName.get(r.name)?.signed ?? 0;
      return { name: r.name, members: r.members, cur: r.signed, prev, delta: r.signed - prev };
    }),
    ...gone.map((g) => ({ name: g.name, members: g.members, cur: 0, prev: g.signed, delta: -g.signed })),
  ];
  const moves = changes.filter((c) => c.delta !== 0 && c.name !== NO_SOURCE).sort(byMove);
  const mover = partial ? null : moves.find((c) => c.cur + c.prev >= 6) ?? null;

  const insights: string[] = [];
  const cur = current.totals.signed, was = totals.signed;
  if (!partial && cur + was > 0) {
    const d = cur - was;
    const share = was >= 10 ? ` (${Math.round((Math.abs(d) / was) * 100)}%)` : "";
    const how = d === 0 ? `level with ${label}` : `${d > 0 ? "up" : "down"} ${fmt(Math.abs(d))}${share} on ${label}`;
    let line = `Sign-ups: ${fmt(cur)}, ${how} (${fmt(was)}).`;
    const gain = moves.find((c) => c.delta > 0);
    const drop = moves.find((c) => c.delta < 0);
    const parts: string[] = [];
    if (gain) parts.push(`Biggest gain: ${gain.name} (+${fmt(gain.delta)})`);
    if (drop) parts.push(`${gain ? "biggest" : "Biggest"} drop: ${drop.name} (${MINUS}${fmt(-drop.delta)})`);
    if (parts.length) line += ` ${parts.join("; ")}.`;
    insights.push(line);
    const now = current.totals.costPerSignup, then = totals.costPerSignup;
    if (costComparable && now != null && then != null) {
      insights.push(Math.round(now) === Math.round(then)
        ? `Cost per sign-up held at ${usd(now)}.`
        : `Cost per sign-up ${now < then ? "fell" : "rose"} from ${usd(then)} to ${usd(now)}.`);
    }
  }

  return {
    mode, from: range.from, to: range.to, label,
    partial, loadedFrom: coverage.complete ? null : coverage.completeFrom,
    totals, costComparable, byName, gone, monthly, mover, insights,
  };
}

export type Pace = { month: string; day: number; days: number; signed: number; leads: number; projected: number | null; projectedLeads: number | null; text: string | null };

/**
 * A month still in progress, scaled to the whole month — so it reads as a pace,
 * not a drop. Only when the range runs to today and ends in today's month;
 * before the 5th there is too little to project. Pass `from` so a range that
 * starts partway through the month (whose count isn't the month's) gets none.
 */
export function paceOf(monthly: { month: string; leads: number; signed: number }[], to: string, today: string, from?: string): Pace | null {
  const last = monthly[monthly.length - 1];
  const month = today.slice(0, 7);
  if (to !== today || !last || last.month !== month) return null;
  if (from && from > `${month}-01`) return null;
  const [y, m] = month.split("-").map(Number);
  const day = Number(today.slice(8, 10));
  const days = daysIn(y, m);
  const early = day < 5;
  // The formula the Sign-ups Report uses (server/signupsReport.ts).
  const projected = early ? null : Math.round((last.signed / day) * days);
  const projectedLeads = early ? null : Math.round((last.leads / day) * days);
  let text: string | null = null;
  if (projected != null) {
    const prev = monthly[monthly.length - 2];
    const against = prev && prev.month === shiftMonth(month, -1) && (!from || from <= `${prev.month}-01`)
      ? `, against ${fmt(prev.signed)} in ${MONTH[Number(prev.month.slice(5)) - 1]}` : "";
    text = `${MONTH[m - 1]} so far (${day} of ${days} days): ${fmt(last.signed)} sign-up${last.signed === 1 ? "" : "s"}, on pace for about ${fmt(projected)}${against}.`;
  }
  return { month, day, days, signed: last.signed, leads: last.leads, projected, projectedLeads, text };
}

/**
 * A range ending in the last week undercounts: some of its leads will still
 * sign. Says how many of this range's sign-ups took more than a week, which is
 * roughly what the last week is still missing.
 */
export function ripening(leads: Lead[], to: string, today: string): string | null {
  if (!isDay(to) || !isDay(today) || dayNo(today) - dayNo(to) >= 7) return null;
  let signed = 0, measured = 0, late = 0;
  for (const l of leads) {
    if (!l.signed) continue;
    signed++;
    if (!l.signedUpDate || !l.createdDate) continue;
    measured++;
    if (new Date(l.signedUpDate).getTime() - new Date(l.createdDate).getTime() > 7 * DAY_MS) late++;
  }
  if (signed < 50 || !measured) return null;
  const share = Math.round((late / measured) * 100);
  if (!share) return null;
  return `Leads from the last week are still ripening: ${share}% of sign-ups in this period came more than a week after the lead.`;
}

/**
 * Reconciliation: the comparison's totals are the earlier period's, its rows and
 * its months add up to them, and over current plus gone rows the per-row changes
 * add up to the change in sign-ups. Returns the problems; empty means it all adds up.
 */
export function checkComparison(
  c: Comparison, prior: PriorTally, current: { rows: { name: string; signed: number }[]; totals: { signed: number } },
): string[] {
  const out: string[] = [];
  if (c.totals.leads !== prior.totals.leads || c.totals.signed !== prior.totals.signed) {
    out.push(`compare totals ${c.totals.leads}/${c.totals.signed} ≠ prior ${prior.totals.leads}/${prior.totals.signed}`);
  }
  let rowLeads = 0, rowSigned = 0;
  prior.byName.forEach((r) => { rowLeads += r.leads; rowSigned += r.signed; });
  if (rowLeads !== prior.totals.leads || rowSigned !== prior.totals.signed) {
    out.push(`prior rows add to ${rowLeads}/${rowSigned}, totals say ${prior.totals.leads}/${prior.totals.signed}`);
  }
  const monthLeads = prior.monthly.reduce((s, m) => s + m.leads, 0);
  const monthSigned = prior.monthly.reduce((s, m) => s + m.signed, 0);
  if (monthLeads !== prior.totals.leads || monthSigned !== prior.totals.signed) {
    out.push(`prior months add to ${monthLeads}/${monthSigned}, totals say ${prior.totals.leads}/${prior.totals.signed}`);
  }
  // Aligned or not, the comparison's months must hold every earlier lead: a
  // month-for-month lookup that misses the earlier period shows up here.
  const cmpLeads = c.monthly.reduce((s, m) => s + m.leads, 0);
  const cmpSigned = c.monthly.reduce((s, m) => s + m.signed, 0);
  if (cmpLeads !== c.totals.leads || cmpSigned !== c.totals.signed) {
    out.push(`compare months add to ${cmpLeads}/${cmpSigned}, totals say ${c.totals.leads}/${c.totals.signed}`);
  }
  const names = Object.keys(c.byName);
  if (names.length !== prior.byName.size) out.push(`byName has ${names.length} rows, prior has ${prior.byName.size}`);
  const curSigned = current.rows.reduce((s, r) => s + r.signed, 0);
  if (curSigned !== current.totals.signed) out.push(`current rows add to ${curSigned} signed, totals say ${current.totals.signed}`);

  const here = new Set(current.rows.map((r) => r.name));
  const goneNames = new Set<string>();
  for (const g of c.gone) {
    if (here.has(g.name)) out.push(`${g.name} is both a current row and gone`);
    if (goneNames.has(g.name)) out.push(`${g.name} is gone twice`);
    goneNames.add(g.name);
  }
  for (const name of names) {
    if (!here.has(name) && !goneNames.has(name)) out.push(`${name} had sign-ups before but is neither a row nor gone`);
  }
  const prevOf = (name: string) => (Object.prototype.hasOwnProperty.call(c.byName, name) ? c.byName[name].signed : 0);
  const change = current.rows.reduce((s, r) => s + r.signed - prevOf(r.name), 0) - c.gone.reduce((s, g) => s + g.signed, 0);
  if (change !== current.totals.signed - c.totals.signed) {
    out.push(`row changes add to ${change}, the total changed by ${current.totals.signed - c.totals.signed}`);
  }
  return out;
}
