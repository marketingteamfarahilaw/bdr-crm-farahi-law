/**
 * Dedup facilities by phone (last 10 digits). For each duplicated number, keep
 * the record with the most history (recaps → activity → longest name → lowest id)
 * and merge the others onto it, then delete them. Skips placeholder numbers.
 *
 *   node scripts/migration/dedup-merge.mjs           # dry run (no changes)
 *   node scripts/migration/dedup-merge.mjs --apply   # backup + merge
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection(process.env.DATABASE_URL);
const norm = `RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10)`;
const CHILD = [
  "contact_logs", "facility_tasks", "facility_leads_sent", "facility_leads",
  "facility_gratitude", "facility_updates", "facility_referrals",
  "fr_expenses", "bdr_expenses", "referral_rewards", "referral_tracker", "uber_receipts",
];

const [groups] = await c.query(
  `SELECT ${norm} np, GROUP_CONCAT(id ORDER BY id) ids
   FROM facilities
   WHERE phone IS NOT NULL AND phone <> '' AND CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) >= 10
     AND ${norm} NOT LIKE '%0000000'
   GROUP BY np HAVING COUNT(*) > 1`
);

const plan = [];
for (const g of groups) {
  const ids = g.ids.split(",").map(Number);
  const [act] = await c.query(
    `SELECT f.id, LENGTH(f.name) namelen,
       (SELECT COUNT(*) FROM facility_updates WHERE facilityId=f.id) recaps,
       (SELECT COUNT(*) FROM contact_logs WHERE facilityId=f.id)
        + (SELECT COUNT(*) FROM facility_updates WHERE facilityId=f.id)
        + (SELECT COUNT(*) FROM facility_leads_sent WHERE facilityId=f.id)
        + (SELECT COUNT(*) FROM facility_referrals WHERE facilityId=f.id) activity
     FROM facilities f WHERE f.id IN (${ids.join(",")})`
  );
  act.sort((a, b) => b.recaps - a.recaps || b.activity - a.activity || b.namelen - a.namelen || a.id - b.id);
  const dups = act.slice(1).map((x) => x.id);
  if (dups.length) plan.push({ np: g.np, canonical: act[0].id, dups });
}
const totalDups = plan.reduce((s, p) => s + p.dups.length, 0);
console.log(`Plan: ${plan.length} groups, ${totalDups} duplicates to merge.`);

if (!APPLY) {
  for (const p of plan.slice(0, 18)) console.log(`  ${p.np}: keep #${p.canonical}  ←  merge ${p.dups.join(",")}`);
  console.log(`\nDry run only. Re-run with --apply to back up + execute.`);
  await c.end();
  process.exit(0);
}

// ── Backup ──
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "scripts/migration/backups");
fs.mkdirSync(dir, { recursive: true });
const [allFacs] = await c.query(`SELECT * FROM facilities`);
const childMaps = {};
for (const t of CHILD) { const [rows] = await c.query(`SELECT id, facilityId FROM ${t}`); childMaps[t] = rows; }
const file = path.join(dir, `dedup-backup-${ts}.json`);
fs.writeFileSync(file, JSON.stringify({ ts, facilities: allFacs, childMaps }));
console.log(`Backup: ${file} (${allFacs.length} facilities)`);

// ── Apply ──
let moved = 0, deleted = 0;
for (const p of plan) {
  const ph = p.dups.map(() => "?").join(",");
  for (const t of CHILD) {
    try { const [r] = await c.query(`UPDATE ${t} SET facilityId=? WHERE facilityId IN (${ph})`, [p.canonical, ...p.dups]); moved += r.affectedRows; }
    catch (e) { console.warn(`  ${t}: ${e.code || e.message}`); }
  }
  try { const [d] = await c.query(`DELETE FROM facilities WHERE id IN (${ph})`, p.dups); deleted += d.affectedRows; }
  catch (e) { console.warn(`  delete ${p.dups}: ${e.code || e.message}`); }
}
console.log(`\nDONE: ${plan.length} groups merged, ${moved} child rows moved, ${deleted} duplicate facilities deleted.`);
await c.end();
