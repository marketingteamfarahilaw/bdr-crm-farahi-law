import { describe, expect, it } from "vitest";
import { buildTrends, type DayTotals } from "./signupsTrends";

// One sign-up every weekday for the last eight weeks, none at weekends: the pace
// the forecast should find. Today is Monday 2026-09-28, with two sign-ups so far.
function history() {
  const byDay = new Map<string, DayTotals>();
  for (let i = 1; i <= 56; i++) {
    const d = new Date(Date.UTC(2026, 8, 28 - i));
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) byDay.set(d.toISOString().slice(0, 10), { leads: 2, signed: 1, fr: 1, bdr: 0 });
  }
  byDay.set("2026-09-28", { leads: 3, signed: 2, fr: 1, bdr: 1 });
  return byDay;
}

describe("buildTrends", () => {
  const t = buildTrends(history(), "2026-09-28", 100);

  it("forecasts the rest of the week weekday by weekday", () => {
    expect(t.week.soFar).toBe(2);
    expect(t.week.forecast).toBe(6);            // 2 so far + Tue–Fri at 1 a day, nothing at the weekend
    expect(t.week.next).toBe(5);
    expect(t.week.samePointBefore).toBe(1);     // last Monday
    expect(t.week.periods).toHaveLength(14);
    expect(t.week.periods[12]).toMatchObject({ key: "2026-09-28", label: "Sep 28", state: "current", fr: 1, bdr: 1 });
  });

  it("forecasts the month to its last day, and compares with last month by this day", () => {
    // September's weekdays before the 28th: 19, plus the 2 today; then the 29th and 30th.
    expect(t.month.soFar).toBe(21);
    expect(t.month.forecast).toBe(23);
    expect(t.month.samePointBefore).toBe(20);   // August 1–28: 20 weekdays
    expect(t.month.periods[12]).toMatchObject({ key: "2026-09", label: "Sep", state: "current" });
    expect(t.month.periods[0].label).toBe("Sep '25");
    expect(t.month.target).toBe(100);
  });

  it("gives the year a forecast but no next year, and scales the target", () => {
    expect(t.year.periods.at(-1)).toMatchObject({ key: "2026", state: "current" });
    expect(t.year.next).toBeNull();
    expect(t.year.target).toBe(1200);
    expect(t.week.target).toBe(23.1);
  });
});
