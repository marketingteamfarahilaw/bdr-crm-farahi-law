/**
 * Repair: each Lead Docket sign-up date (lead_intake.sud) should be the PACIFIC
 * day the client signed.
 *
 * The sync took the first ten characters of Lead Docket's UTC timestamp, so a
 * client who signed at 5:37pm Pacific on Sep 22 got a sign-up date of Sep 23.
 * Team Reports buckets sign-ups by that field, so it disagreed with the
 * Sign-ups Report (which uses the exact moment) for every evening sign-up, and
 * for month-end ones it put them in the wrong month.
 *
 * For a signed lead, leadDate IS the exact sign-up moment, so the right sud is
 * simply its Pacific date. Recomputing from it is idempotent — safe to re-run.
 *
 *   node scripts/migration/repair-leaddocket-dates.mjs [--apply]
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { pacificYmd } from "./dates.mjs";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });

const [rows] = await c.query(`SELECT id, leadDate, sud FROM lead_intake
  WHERE externalSource='leaddocket' AND sud IS NOT NULL AND leadDate IS NOT NULL`);

let changed = 0, monthChanged = 0;
for (const r of rows) {
  const sud = pacificYmd(r.leadDate);
  if (sud === r.sud) continue;
  changed++;
  if (sud.slice(0, 7) !== String(r.sud).slice(0, 7)) monthChanged++;
  if (APPLY) await c.query("UPDATE lead_intake SET sud=? WHERE id=?", [sud, r.id]);
}

console.log(`${rows.length} signed Lead Docket leads checked: ${changed} sign-up dates were the UTC day, not the Pacific one (${monthChanged} of them in the wrong month).`);
console.log(APPLY ? "✅ Fixed." : "[DRY RUN] nothing written — add --apply.");
await c.end();
