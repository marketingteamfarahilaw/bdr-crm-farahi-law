import { formatInTimeZone } from "date-fns-tz";

const TZ = "America/Los_Angeles";

export type PeriodKey = "month" | "last" | "year" | "lastYear" | "all";
export type Period = { key: PeriodKey; label: string; range: { from: string; to: string } | null };

/** Today in Pacific, as the reports count days ("YYYY-MM-DD"). */
export const pacificToday = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

/** The standard report periods in Pacific days; All time has no range. */
export function periodPresets(): Period[] {
  const today = pacificToday();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return [
    { key: "month", label: "This month", range: { from: `${y}-${pad(m)}-01`, to: today } },
    { key: "last", label: "Last month", range: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastDay(py, pm)}` } },
    { key: "year", label: "This year", range: { from: `${y}-01-01`, to: today } },
    { key: "lastYear", label: "Last year", range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } },
    { key: "all", label: "All time", range: null },
  ];
}

/** "2026-03" → "Mar 26". */
export const shortMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

/** "2026-03-31" → "Mar 31, 2026" (a calendar day, shown the same wherever the reader is). */
export const longDay = (d?: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
