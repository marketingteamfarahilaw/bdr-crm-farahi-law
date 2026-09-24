/**
 * The one place the importers and syncs turn source dates into instants.
 *
 * Two rules, both easy to get wrong:
 *
 *  1. Connect to the database with timezone "Z", exactly as the app does
 *     (server/db.ts). The server runs in Pacific time, and a connection without
 *     it writes and reads every date as Pacific wall-clock, while the app reads
 *     them as UTC — so each date a script wrote showed up 7–8 hours off in the
 *     app. Every script in this folder now connects with { timezone: "Z" }.
 *
 *  2. Convert each source's dates to real instants:
 *     · Lead Docket writes UTC with no zone marker ("2026-09-23T00:37:08.923").
 *       Parse it as UTC (ldInstant), and derive calendar dates in Pacific time.
 *     · The Google Sheets hold Pacific calendar dates and wall-clock times.
 *       A date with no time of day becomes Pacific noon, which is the same
 *       calendar date in Pacific time and in UTC, so no page can show it on
 *       another day.
 */
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const TZ = "America/Los_Angeles";
const pad = (n) => String(n).padStart(2, "0");

/** A Lead Docket timestamp (UTC, usually without a zone marker) → the real instant. */
export function ldInstant(s) {
  if (!s) return null;
  const t = String(s).trim();
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : t + "Z");
  return isNaN(d.getTime()) ? null : d;
}

/** The Pacific calendar date of an instant, as "YYYY-MM-DD". */
export const pacificYmd = (d) => (d ? formatInTimeZone(d, TZ, "yyyy-MM-dd") : null);

/** A Pacific calendar date (and optional wall-clock seconds past midnight) → instant. */
export function pacific(y, m, d, secs = null) {
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (secs == null) return fromZonedTime(`${date}T12:00:00`, TZ);
  const s = Math.max(0, Math.min(86399, Math.round(secs)));
  return fromZonedTime(`${date}T${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`, TZ);
}

/** An Excel date serial (a day count, no zone) → its calendar date parts. */
export function serialParts(n) {
  const d = new Date(Math.round((Number(n) - 25569) * 86400000));
  return isNaN(d.getTime()) ? null : { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
