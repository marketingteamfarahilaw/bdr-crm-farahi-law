/**
 * The one place the importers and syncs turn source dates into instants.
 *
 * The firm works in Pacific time and every report groups by Pacific days, but
 * the sources write dates three different ways — and each one was being read
 * wrong, moving records onto the neighbouring day (and, at month end, into the
 * neighbouring month):
 *
 *   · Lead Docket writes UTC with no zone marker ("2026-09-23T00:37:08.923").
 *     The server runs in Pacific time, so a bare parse read it as Pacific and
 *     put every lead 7–8 hours late — a third of them on the next day.
 *   · The Google Sheets hold Pacific calendar dates and wall-clock times, which
 *     were stored as if they were UTC: a "9/1" expense became 5pm on Aug 31, and
 *     every call from the call-history sheet showed 7–8 hours early.
 *
 * A date with no time of day becomes Pacific noon, which is the same calendar
 * date in Pacific time and in UTC, so no page can show it on another day.
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
