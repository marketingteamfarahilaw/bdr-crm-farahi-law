/**
 * App-wide date handling — everything renders in California (Pacific) time.
 *
 * Timestamps are stored as UTC instants (correct + DST-safe); this module makes
 * the whole CRM DISPLAY them in America/Los_Angeles regardless of the viewer's
 * device timezone. Import `format` from here instead of "date-fns" and existing
 * format strings keep working — they just render in LA time.
 */
import { formatInTimeZone } from "date-fns-tz";

export * from "date-fns";

export const APP_TIME_ZONE = "America/Los_Angeles";

/** Drop-in replacement for date-fns `format` that always renders in LA time. */
export function format(date: Date | number | string, fmt: string, options?: any): string {
  try {
    return formatInTimeZone(date, APP_TIME_ZONE, fmt, options);
  } catch {
    return "";
  }
}
