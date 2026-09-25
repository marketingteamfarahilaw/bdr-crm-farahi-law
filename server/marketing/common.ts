/**
 * What every part of the Marketing Report counts with: the time zone, the
 * BD/FR filter, the months a range touches, the columns it reads, and derive()
 * — the one place a lead gets its month, its row, whether it signed and its
 * scorecard column. Every panel works from derive()'s output, so every number
 * on the page adds back to the scorecard.
 */
import { sql } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { leaddocketLeads } from "../../drizzle/schema";
import { isSigned, scorecardBucket, type ScoreBucket } from "../signupsReport";
import { NO_SOURCE, TEAM_CHANNEL, channelOfSource, REASON_KEYS, REASON_LABEL, NOT_VIABLE, NOT_VIABLE_KEYS, type ReasonKey } from "@shared/marketing";

export { NO_SOURCE, TEAM_CHANNEL, channelOfSource, REASON_KEYS, REASON_LABEL, NOT_VIABLE, NOT_VIABLE_KEYS };
export type { ReasonKey, ScoreBucket };

export const TZ = "America/Los_Angeles";

export const monthOf = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM");
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
export const keyOf = (s: string) => s.toLowerCase();

/** Credited to a BDR or FR rep. Malvin Rosales (Intake) is credited like a rep but isn't BD/FR. */
export const isBdFr = (role: string | null | undefined) => role === "BDR" || role === "FR";

/**
 * The source a lead is reported under: "BD/FR team" for a BDR or FR rep's lead
 * (its Marketing Source names the rep, "BDR Grace Lanayon"), otherwise its
 * Marketing Source. The report covers every Lead Docket lead; the team's are one
 * row, whose numbers equal the Sign-ups Report's.
 */
export const sourceOf = (l: { marketingSource: string | null; teamRole?: string | null }) =>
  isBdFr(l.teamRole) ? TEAM_CHANNEL : clean(l.marketingSource) || NO_SOURCE;

/** Not a BD/FR lead — for a drill into a named Marketing Source, which must not pick up a rep's lead. */
export const notBdFr = sql`(${leaddocketLeads.teamRole} IS NULL OR ${leaddocketLeads.teamRole} NOT IN ('BDR', 'FR'))`;
/** A BD/FR lead — the "BD/FR team" row. */
export const bdFrOnly = sql`(${leaddocketLeads.teamRole} IN ('BDR', 'FR'))`;

export type Grouping = "channel" | "source";

/** The row a source is counted in: "No source" and "BD/FR team" stay whole either way; the rest group by channel on request. */
export const rowNameOf = (source: string, group: Grouping) =>
  group === "channel" && source !== NO_SOURCE && source !== TEAM_CHANNEL ? channelOfSource(source) : source;

/** Every Pacific month the range touches, oldest first. */
export function monthsBetween(from: Date, to: Date) {
  const out: string[] = [];
  let [y, m] = monthOf(from).split("-").map(Number);
  const last = monthOf(to);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The start of a Pacific month, and of the one after it. */
export function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: fromZonedTime(`${month}-01T00:00:00`, TZ), end: fromZonedTime(`${next}-01T00:00:00`, TZ) };
}

/**
 * The index in `months` of the Pacific month a moment falls in, or -1 outside
 * them. The dashboard walks up to ~45k rows several times, and formatting each
 * one in a time zone is what made that slow, so this compares against the month
 * starts once and binary-searches.
 */
export function monthIndexer(months: string[]): (d: Date | string | number) => number {
  const starts = months.map((m) => monthBounds(m).start.getTime());
  const end = months.length ? monthBounds(months[months.length - 1]).end.getTime() : -Infinity;
  return (d) => {
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    if (!starts.length || !(t >= starts[0] && t < end)) return -1;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
}

export type Counts = Record<ScoreBucket, number> & { leads: number; signed: number };
export const emptyCounts = (): Counts => ({ leads: 0, signed: 0, open: 0, rejected: 0, referredOut: 0, notInterested: 0, signedReferred: 0, signedInHouse: 0 });

/** The lead columns the dashboard reads — pass to db.select(). */
export const LEAD_COLS = {
  leadDate: leaddocketLeads.leadDate,
  createdDate: leaddocketLeads.createdDate,
  signedUpDate: leaddocketLeads.signedUpDate,
  outcome: leaddocketLeads.outcome,
  status: leaddocketLeads.status,
  subStatus: leaddocketLeads.subStatus,
  caseType: leaddocketLeads.caseType,
  marketingSource: leaddocketLeads.marketingSource,
  contactSource: leaddocketLeads.contactSource,
  campaign: leaddocketLeads.campaign,
  teamRole: leaddocketLeads.teamRole,   // BDR/FR leads report as the "BD/FR team" row
};
export type LeadRow = Pick<typeof leaddocketLeads.$inferSelect, keyof typeof LEAD_COLS>;

/** What derive() adds to a row. */
export type Derived<T> = T & {
  i: number;            // index in the dashboard's months; -1 outside them
  source: string;       // sourceOf()
  name: string;         // rowNameOf(): the scorecard row it counts in
  signed: boolean;      // isSigned(outcome)
  bucket: ScoreBucket;  // scorecardBucket(outcome)
};
export type Lead = Derived<LeadRow>;

/**
 * The one place a lead gets its month index, row name, isSigned and scorecard
 * bucket, so every panel (and the comparison period) classifies it the same.
 * Rows with no leadDate are dropped, as the dashboard always has.
 */
export function derive<T extends { leadDate: Date | string | null; outcome: string | null; marketingSource: string | null; teamRole?: string | null }>(
  rows: T[], months: string[], group: Grouping,
): Derived<T>[] {
  const indexOf = monthIndexer(months);
  const out: Derived<T>[] = [];
  for (const r of rows) {
    if (!r.leadDate) continue;
    const source = sourceOf(r);
    out.push({
      ...r,
      i: indexOf(r.leadDate),
      source,
      name: rowNameOf(source, group),
      signed: isSigned(r.outcome),
      bucket: scorecardBucket(r.outcome),
    });
  }
  return out;
}

/** A scorecard row: its name and, for a channel, the Lead Docket sources it groups. */
export type RowRef = { name: string; members: string[] };

/**
 * Which leads a clicked number stands for. In the list fields, '' means NULL or
 * empty. The server applies it with the same classifiers the dashboard counts
 * with, so a drill-down's total equals the number clicked.
 */
export type DrillScope = {
  source?: string;
  sources?: string[];
  contactSources?: string[];
  month?: string;
  bucket?: ScoreBucket;
  reasons?: ReasonKey[];
  subStatus?: string;
  caseTypes?: string[];
  notCaseTypes?: string[];
  campaigns?: string[];
};

/** A clickable number: what the clients modal shows and asks the server for. */
export type DrillLink = { title: string; chips?: string[]; scope: DrillScope; status?: "signed" | "all" };
