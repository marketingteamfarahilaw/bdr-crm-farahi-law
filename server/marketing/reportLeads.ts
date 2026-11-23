/**
 * What the Marketing Report counts: Lead Docket's leads that didn't sign, plus
 * every sign-up on the FLF Sign Up History sheet (flf_signups). The sheet is
 * the sign-up record intake keeps, so a sign-up's date, channel and in-house /
 * referred-out come from it; Lead Docket stays the record of leads that never
 * signed, since the sheet lists sign-ups only. Total Leads is the two together,
 * so every scorecard column still adds up to it (decided Nov 23, 2026).
 *
 * - A Lead Docket lead linked to a sheet row is that row, whatever Lead Docket
 *   says of it — never counted twice.
 * - A lead Lead Docket marks signed but the sheet doesn't list isn't counted
 *   (the Data audit lists it as missing from the sheet).
 * - A sheet row with no lead still counts, with no lead behind it (a negative
 *   leadId, so it can't collide with one).
 *
 * It's one subquery named like the Lead Docket table, with its columns, so
 * every query the report already makes — the scorecard, the comparison, each
 * drill-down and export — reads it unchanged and they can't disagree. Until the
 * sheet has synced once, it is just the Lead Docket table.
 */
import { sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { getFlfSyncStatus, remapFlfSignups } from "../flfSignups";

/** Outcomes isSigned() counts (server/signupsReport.ts), as SQL compares them. */
const SIGNED_SQL = `'signed', 'signed referred out', 'referral accepted'`;

/**
 * When a sign-up counts: its Sign Up Date at 19:30 UTC — midday Pacific in
 * summer and winter alike, so always that Pacific day — or the 1st of the
 * month it counts in when the date is blank or mistyped (countMonthOf).
 */
const SIGNED_AT = `TIMESTAMP(IF(LEFT(f.signDay, 7) = f.countMonth, f.signDay, CONCAT(f.countMonth, '-01')), '19:30:00')`;

const COMBINED = sql.raw(`(
  SELECT ld.leadId, ld.createdDate, ld.signedUpDate, ld.leadDate, ld.status, ld.subStatus, ld.outcome, ld.caseType,
    ld.marketingSource, ld.contactSource, ld.campaign, ld.clientName, ld.city, ld.county, ld.state, ld.intakeBy,
    ld.teamRep, ld.teamRole
  FROM leaddocket_leads ld
  WHERE LOWER(TRIM(REPLACE(COALESCE(ld.outcome, ''), '_', ' '))) NOT IN (${SIGNED_SQL})
    AND NOT EXISTS (SELECT 1 FROM flf_signups fx WHERE fx.leadId = ld.leadId)
  UNION ALL
  SELECT COALESCE(f.leadId, -f.id), fl.createdDate, ${SIGNED_AT}, ${SIGNED_AT}, 'Signed Up', NULL,
    IF(f.kind = 'referred', 'Signed Referred Out', 'Signed'), COALESCE(NULLIF(f.caseType, ''), fl.caseType),
    NULLIF(f.reportSource, ''), fl.contactSource, fl.campaign, f.clientName, fl.city, fl.county, fl.state,
    COALESCE(NULLIF(f.intaker, ''), fl.intakeBy), NULLIF(f.reportTeamRep, ''), f.reportTeamRole
  FROM flf_signups f LEFT JOIN leaddocket_leads fl ON fl.leadId = f.leadId
) AS \`leaddocket_leads\``);

const LEAD_DOCKET_ONLY = sql.raw("`leaddocket_leads`");

let cached: { until: number; on: boolean } | null = null;
let placed: Promise<unknown> | null = null;

/** Whether sign-ups come from the sheet: once it has synced. Checked at most once a minute. */
export async function sheetSignupsOn(): Promise<boolean> {
  if (cached && cached.until > Date.now()) return cached.on;
  const on = !!(await getFlfSyncStatus()).lastSuccessAt;
  // Rows the sync wrote before placements existed get theirs, once per process.
  if (on) await (placed ??= remapFlfSignups(true).catch((e) => { placed = null; console.warn("[marketing] placing sheet sign-ups failed:", e?.message ?? e); }));
  cached = { until: Date.now() + 60_000, on };
  return on;
}

/**
 * Lead Docket columns to select from reportLeads(). Drizzle won't select a
 * table's own columns from a subquery, so each goes as an expression — same
 * name, same decoding (timestamps stay Dates).
 */
export function reportCols<T extends Record<string, MySqlColumn>>(cols: T): { [K in keyof T]: SQL<T[K]["_"]["data"] | (T[K]["_"]["notNull"] extends true ? never : null)> } {
  return Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, sql`${c}`.mapWith(c)])) as any;
}

/** The FROM for every Marketing Report read: `.from(await reportLeads())`. */
export async function reportLeads(): Promise<SQL> {
  return (await sheetSignupsOn()) ? COMBINED : LEAD_DOCKET_ONLY;
}
