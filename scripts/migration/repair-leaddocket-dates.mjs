/**
 * One-time repair: Lead Docket dates stored 7–8 hours late.
 *
 * Until dates.mjs existed, the sync parsed Lead Docket's zone-less UTC strings
 * on a server running in Pacific time, so every leadDate landed 7–8 hours late
 * (a third of all leads on the next day) and each sign-up date (sud) was the
 * UTC calendar day rather than the Pacific one. The stored instant still
 * encodes exactly what Lead Docket wrote, so this recovers that string (the
 * stored instant read as Pacific wall-clock) and re-reads it as UTC.
 *
 * Rows the fixed sync has rewritten since the deploy (ledger checkedAt after
 * --after) are already right and are skipped. Refuses to run twice.
 *
 *   node scripts/migration/repair-leaddocket-dates.mjs --after 2026-09-24T17:00:00Z [--apply]
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";
import { ldInstant, pacificYmd, TZ } from "./dates.mjs";

const APPLY = process.argv.includes("--apply");
const at = process.argv.indexOf("--after");
const AFTER = at > -1 ? new Date(process.argv[at + 1]) : null;
if (!AFTER || isNaN(AFTER.getTime())) { console.error("--after <deploy time, ISO> is required"); process.exit(1); }

const c = await mysql.createConnection(process.env.DATABASE_URL);
const MARK = "leaddocket_dates_utc_repaired";
const [[done]] = await c.query("SELECT COUNT(*) n FROM app_settings WHERE settingKey=?", [MARK]);
if (done.n) { console.error("Already repaired — running it again would shift the dates a second time."); process.exit(1); }

const rows = (await c.query(`SELECT li.id, li.externalId, li.leadDate, li.sud, s.checkedAt
  FROM lead_intake li LEFT JOIN leaddocket_seen s ON s.leadId = CAST(li.externalId AS UNSIGNED)
  WHERE li.externalSource='leaddocket' AND li.leadDate IS NOT NULL`))[0];

let fixed = 0, skipped = 0, dayMoved = 0, monthMoved = 0, sudChanged = 0;
for (const r of rows) {
  if (r.checkedAt && new Date(r.checkedAt) >= AFTER) { skipped++; continue; }
  const written = formatInTimeZone(r.leadDate, TZ, "yyyy-MM-dd'T'HH:mm:ss.SSS");   // what Lead Docket wrote
  const leadDate = ldInstant(written);
  const sud = r.sud ? pacificYmd(leadDate) : null;                                  // leadDate is SignedUpDate for signed leads
  if (pacificYmd(leadDate) !== pacificYmd(r.leadDate)) dayMoved++;
  if (pacificYmd(leadDate).slice(0, 7) !== pacificYmd(r.leadDate).slice(0, 7)) monthMoved++;
  if (sud !== r.sud) sudChanged++;
  if (APPLY) await c.query("UPDATE lead_intake SET leadDate=?, sud=? WHERE id=?", [leadDate, sud, r.id]);
  fixed++;
}
if (APPLY) await c.query("INSERT INTO app_settings (settingKey, settingValue) VALUES (?, ?)", [MARK, new Date().toISOString()]);

console.log(`${fixed} Lead Docket leads re-dated (${skipped} already written by the fixed sync).`);
console.log(`  ${dayMoved} move to a different Pacific day, ${monthMoved} to a different month; ${sudChanged} sign-up dates change.`);
console.log(APPLY ? "✅ Applied. Run mirror-leads-to-facilities.mjs next so every page picks it up." : "[DRY RUN] nothing written — add --apply.");
await c.end();
