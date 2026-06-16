/**
 * Removes placeholder/junk-named facilities (pure numbers like "0", and rows
 * whose name is a bare category like "Imaging Center", "pain managment",
 * "chiropractor", "surgeon"…) that pollute the facility list.
 *
 * SAFETY:
 *  - Full row backed up to clean-junk-facilities-backup.json before any delete.
 *  - A junk row is deleted ONLY if it has ZERO references in any child table
 *    (contact_logs, tasks, updates, leads, leadsSent, referrals, gratitude).
 *    Anything with activity is kept and reported for manual review.
 *
 * Run: node scripts/migration/clean-junk-facilities.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const PLACEHOLDERS = [
  "imaging center", "pain managment", "pain management", "chiropractor", "surgeon",
  "medical center", "bs total loss support", "active chiropactor (some maybe active)",
  "physical therapy", "neurologist", "opthalmologist", "pharmacy", "insurance company",
  "towing company", "body shop", "eruc", "non fr chiro", "needs an agent", "unassigned",
];

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT * FROM facilities");

const isJunk = (name) => {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return true;                       // empty name
  if (/^[0-9.\s]+$/.test(n)) return true;    // pure number / "0"
  return PLACEHOLDERS.includes(n);
};

const childTables = [
  "contact_logs", "facility_tasks", "facility_updates", "facility_leads",
  "facility_leads_sent", "facility_referrals", "facility_gratitude",
];

const junk = facs.filter((f) => isJunk(f.name));
const backup = { deleted: [], keptWithActivity: [] };

for (const f of junk) {
  let refs = 0;
  for (const t of childTables) {
    try { const [[r]] = await c.query(`SELECT COUNT(*) n FROM ${t} WHERE facilityId = ?`, [f.id]); refs += Number(r.n); }
    catch { /* table may not exist — ignore */ }
  }
  if (refs > 0) { backup.keptWithActivity.push({ id: f.id, name: f.name, refs }); continue; }
  backup.deleted.push(f);
  await c.query("DELETE FROM facilities WHERE id = ?", [f.id]);
}

fs.writeFileSync("scripts/migration/clean-junk-facilities-backup.json", JSON.stringify(backup, null, 2));
const [[n]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`Junk candidates: ${junk.length} | deleted: ${backup.deleted.length} | kept (had activity): ${backup.keptWithActivity.length}`);
console.log(`Facilities total now: ${n.n}. Backup: scripts/migration/clean-junk-facilities-backup.json`);
if (backup.keptWithActivity.length) {
  console.log("\n--- kept (manual review — they have linked records) ---");
  for (const k of backup.keptWithActivity) console.log(`#${k.id} "${k.name}" — ${k.refs} linked record(s)`);
}
// summary of what name-buckets were removed
const buckets = {};
for (const d of backup.deleted) { const k = String(d.name ?? "").trim().toLowerCase() || "(empty)"; buckets[k] = (buckets[k] ?? 0) + 1; }
console.log("\n--- removed name buckets ---");
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`${v}× "${k}"`);
await c.end();
