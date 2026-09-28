/**
 * Trends & forecast for the Sign-ups Report (Youssef, 2026-09-28: "trends and
 * forecast … by week and by month by year"). Sign-ups per week (Monday to
 * Sunday), month and year, in Pacific days like the rest of the report, and a
 * forecast for the period under way and the next one: what's signed so far,
 * plus the rest of the period at the recent pace — the last eight full weeks,
 * weekday by weekday, so a Friday doesn't expect a weekend's worth of Mondays.
 *
 * Independent of the report's dates (a trend needs its history); the role and
 * current-team filters apply, as they do to everything else on the page.
 */
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { leadIntake } from "../drizzle/schema";
import { CURRENT_TEAM, MONTHLY_SIGNUP_TARGET, isCurrentRep, type TeamRole } from "@shared/team";
import { isNonReportingRep } from "@shared/permissions";
import { isSigned, type SignupsFilter } from "./signupsReport";

export type DayTotals = { leads: number; signed: number; fr: number; bdr: number };
export type TrendPeriod = DayTotals & {
  key: string;
  label: string;
  start: string;
  end: string;
  state: "past" | "current" | "next";
  /** Projected sign-ups for the whole period: the one under way and the next. */
  forecast: number | null;
};
export type TrendView = {
  periods: TrendPeriod[];
  soFar: number;
  forecast: number;
  /** The period before, up to the same point — "by this day last month". */
  samePointBefore: number;
  previous: { label: string; signed: number } | null;
  next: number | null;
  /** The current team's target for one period, for the roles shown. */
  target: number | null;
};

export const PACE_WEEKS = 8;

// Calendar arithmetic on "YYYY-MM-DD" days, in UTC so daylight saving never moves a day.
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (day: string, n: number) => {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
const weekday = (day: string) => utc(day).getUTCDay(); // 0 Sunday … 6 Saturday
const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
};
const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m, 0)));
};
const label = (day: string, pattern: string) => formatInTimeZone(utc(day), "UTC", pattern);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** The three views from sign-ups per Pacific day, as of `today`. */
export function buildTrends(byDay: Map<string, DayTotals>, today: string, monthlyTarget: number | null) {
  const sum = (from: string, to: string) => {
    const t: DayTotals = { leads: 0, signed: 0, fr: 0, bdr: 0 };
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = byDay.get(d);
      if (v) { t.leads += v.leads; t.signed += v.signed; t.fr += v.fr; t.bdr += v.bdr; }
    }
    return t;
  };
  // Sign-ups each weekday brings, on average over the eight full weeks before today.
  const perWeekday = Array<number>(7).fill(0);
  for (let i = 1; i <= PACE_WEEKS * 7; i++) {
    const d = addDays(today, -i);
    perWeekday[weekday(d)] += (byDay.get(d)?.signed ?? 0) / PACE_WEEKS;
  }
  const expected = (from: string, to: string) => {
    let s = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) s += perWeekday[weekday(d)];
    return s;
  };
  const tomorrow = addDays(today, 1);

  const view = (
    spans: { key: string; label: string; start: string; end: string }[],
    current: number,
    target: number | null,
    samePoint: { from: string; to: string },
  ): TrendView => {
    const periods: TrendPeriod[] = spans.map((s, i) => {
      const state = i < current ? "past" : i === current ? "current" : "next";
      const t = state === "next" ? { leads: 0, signed: 0, fr: 0, bdr: 0 } : sum(s.start, earlier(s.end, today));
      const forecast = state === "current" ? Math.round(t.signed + expected(tomorrow, s.end))
        : state === "next" ? Math.round(expected(s.start, s.end))
        : null;
      return { ...s, ...t, state, forecast };
    });
    const cur = periods[current];
    const prev = periods[current - 1];
    return {
      periods,
      soFar: cur.signed,
      forecast: cur.forecast ?? cur.signed,
      samePointBefore: sum(samePoint.from, samePoint.to).signed,
      previous: prev ? { label: prev.label, signed: prev.signed } : null,
      next: periods[current + 1]?.forecast ?? null,
      target,
    };
  };
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Weeks: the last twelve, this one, the next.
  const monday = mondayOf(today);
  const weeks = [];
  for (let i = -12; i <= 1; i++) {
    const start = addDays(monday, 7 * i);
    weeks.push({ key: start, label: label(start, "MMM d"), start, end: addDays(start, 6) });
  }
  const week = view(weeks, 12, monthlyTarget == null ? null : round1((monthlyTarget * 12) / 52),
    { from: addDays(monday, -7), to: addDays(today, -7) });

  // Months: the last twelve, this one, the next. January and the first carry the year.
  const thisMonth = today.slice(0, 7);
  const months = [];
  for (let i = -12; i <= 1; i++) {
    const m = addMonths(thisMonth, i);
    months.push({ key: m, label: label(`${m}-01`, i === -12 || m.endsWith("-01") ? "MMM ''yy" : "MMM"), start: `${m}-01`, end: monthEnd(m) });
  }
  const lastMonth = addMonths(thisMonth, -1);
  const month = view(months, 12, monthlyTarget,
    { from: `${lastMonth}-01`, to: earlier(`${lastMonth}-${today.slice(8)}`, monthEnd(lastMonth)) });

  // Years: every year with sign-ups, up to six, and no forecast past this one.
  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.max(thisYear - 5, Math.min(thisYear, ...Array.from(byDay.keys(), (d) => Number(d.slice(0, 4)))));
  const years = [];
  for (let y = firstYear; y <= thisYear; y++) years.push({ key: String(y), label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
  const lastYear = `${thisYear - 1}-${today.slice(5, 7)}`;
  const year = view(years, years.length - 1, monthlyTarget == null ? null : monthlyTarget * 12,
    { from: `${thisYear - 1}-01-01`, to: earlier(`${lastYear}-${today.slice(8)}`, monthEnd(lastYear)) });

  return { week, month, year };
}

export async function getSignupsTrends(filter: SignupsFilter = {}) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ leadDate: leadIntake.leadDate, outcome: leadIntake.outcome, member: leadIntake.member, role: leadIntake.role })
    .from(leadIntake);
  const byDay = new Map<string, DayTotals>();
  for (const l of rows) {
    // The same leads the rest of the report counts.
    if (!l.leadDate || isNonReportingRep(l.member)) continue;
    if (filter.role && l.role !== filter.role) continue;
    if (filter.member && l.member !== filter.member) continue;
    if (filter.team === "current" && !isCurrentRep(l.member)) continue;
    const d = formatInTimeZone(new Date(l.leadDate), "America/Los_Angeles", "yyyy-MM-dd");
    const t = byDay.get(d) ?? { leads: 0, signed: 0, fr: 0, bdr: 0 };
    t.leads++;
    if (isSigned(l.outcome)) {
      t.signed++;
      if (l.role === "FR") t.fr++;
      if (l.role === "BDR") t.bdr++;
    }
    byDay.set(d, t);
  }
  // Today's team's target, for the roles on show: FR 20 and BDR 5 a rep a month.
  // One rep's own, on their profile; none for someone who has left.
  const roles: TeamRole[] = filter.role ? [filter.role] : ["FR", "BDR"];
  const repRole = filter.member ? (Object.keys(CURRENT_TEAM) as TeamRole[]).find((r) => CURRENT_TEAM[r].includes(filter.member!)) : undefined;
  const monthlyTarget = filter.member
    ? (repRole ? MONTHLY_SIGNUP_TARGET[repRole] ?? null : null)
    : roles.reduce((a, r) => a + (MONTHLY_SIGNUP_TARGET[r] ?? 0) * CURRENT_TEAM[r].filter((n) => !isNonReportingRep(n)).length, 0) || null;
  const today = formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  return { today, paceWeeks: PACE_WEEKS, ...buildTrends(byDay, today, monthlyTarget) };
}
