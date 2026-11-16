/**
 * Month-end snapshots of the Digital Marketing Report. Lead Docket keeps
 * changing after a month closes — a status corrected, a source re-tagged — so
 * a closed month's numbers drift from what the team reviewed. A manager can
 * lock a closed month: its report (numbers and client lists) is saved as it
 * stands, and from then on that month loads from the saved copy, marked
 * "Locked", instead of live data. Unlocking deletes the copy and the month
 * goes back to live.
 *
 * Only a whole closed Pacific month can be locked, and only that exact range
 * reads the copy: any other range stays live.
 */
import { sql } from "drizzle-orm";
import superjson from "superjson";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { TZ, monthBounds } from "./marketing/common";
import { getDigitalMarketingReport, type DigitalReport } from "./digitalMarketing";

export type Lock = { month: string; lockedAt: string; lockedBy: string | null };

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`CREATE TABLE IF NOT EXISTS report_snapshots (
      month CHAR(7) NOT NULL PRIMARY KEY,
      report LONGTEXT NOT NULL,
      lockedBy VARCHAR(120) NULL,
      lockedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The last day of a 'yyyy-MM' month. */
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
/** The month a range is, when it is exactly one whole month; otherwise null. */
export const wholeMonthOf = (from: string, to: string) =>
  from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7) && to === monthEnd(from.slice(0, 7)) ? from.slice(0, 7) : null;
/** Whether a month has ended, by the Pacific calendar. */
export const isClosed = (month: string, today: string) => month < today.slice(0, 7);

const toLock = (r: { month: string; lockedAt: Date | string; lockedBy: string | null }): Lock => ({
  month: r.month, lockedAt: new Date(r.lockedAt).toISOString(), lockedBy: r.lockedBy,
});

/** The saved report for a month, or null when it isn't locked. */
export async function readSnapshot(month: string): Promise<{ report: DigitalReport; lock: Lock } | null> {
  const db = await getDb();
  if (!db) return null;
  await ensureTable();
  const [rows] = (await db.execute(sql`SELECT month, report, lockedBy, lockedAt FROM report_snapshots WHERE month = ${month}`)) as any;
  const r = rows?.[0];
  if (!r) return null;
  return { report: superjson.parse<DigitalReport>(r.report), lock: toLock(r) };
}

export async function listLocks(): Promise<Lock[]> {
  const db = await getDb();
  if (!db) return [];
  await ensureTable();
  const [rows] = (await db.execute(sql`SELECT month, lockedBy, lockedAt FROM report_snapshots ORDER BY month DESC`)) as any;
  return (rows ?? []).map(toLock);
}

/** Save a closed month's report as it stands now. Locking an already locked month refreshes its copy. */
export async function lockMonth(month: string, by: string): Promise<Lock> {
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a month to lock.");
  if (!isClosed(month, today)) throw new Error("Only a month that has ended can be locked.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureTable();
  const { start, end } = monthBounds(month);
  const report = await getDigitalMarketingReport(
    { from: start, to: new Date(end.getTime() - 1), fromDay: `${month}-01`, toDay: monthEnd(month) }, today,
  );
  if (!report) throw new Error("Couldn't read the month's report.");
  await db.execute(sql`INSERT INTO report_snapshots (month, report, lockedBy) VALUES (${month}, ${superjson.stringify(report)}, ${by})
    ON DUPLICATE KEY UPDATE report = VALUES(report), lockedBy = VALUES(lockedBy), lockedAt = CURRENT_TIMESTAMP`);
  return (await readSnapshot(month))!.lock;
}

export async function unlockMonth(month: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureTable();
  await db.execute(sql`DELETE FROM report_snapshots WHERE month = ${month}`);
}
