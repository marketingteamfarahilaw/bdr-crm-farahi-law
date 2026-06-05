/**
 * Merge duplicate facilities: move all child rows from <dupId...> onto
 * <canonicalId>, then delete the duplicates.
 * Usage: node scripts/migration/merge-dups.mjs <canonicalId> <dupId> [dupId...]
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const CANONICAL = parseInt(process.argv[2], 10);
const DUPS = process.argv.slice(3).map((x) => parseInt(x, 10)).filter(Boolean);
if (!CANONICAL || !DUPS.length) {
  console.error("usage: node merge-dups.mjs <canonicalId> <dupId> [dupId...]");
  process.exit(1);
}

const CHILD_TABLES = [
  "contact_logs", "facility_tasks", "facility_leads_sent", "facility_leads",
  "facility_gratitude", "facility_updates", "facility_referrals",
  "fr_expenses", "bdr_expenses", "referral_rewards", "referral_tracker", "uber_receipts",
];

const c = await mysql.createConnection(process.env.DATABASE_URL);
const ph = DUPS.map(() => "?").join(",");
console.log(`Merging facilities [${DUPS.join(", ")}] → #${CANONICAL}\n`);
let moved = 0;
for (const t of CHILD_TABLES) {
  try {
    const [r] = await c.query(`UPDATE ${t} SET facilityId=? WHERE facilityId IN (${ph})`, [CANONICAL, ...DUPS]);
    if (r.affectedRows) { console.log(`  ${t}: moved ${r.affectedRows}`); moved += r.affectedRows; }
  } catch (e) { console.warn(`  ${t}: skipped (${e.code || e.message})`); }
}
const [d] = await c.query(`DELETE FROM facilities WHERE id IN (${ph})`, DUPS);
console.log(`\nMoved ${moved} child rows. Deleted ${d.affectedRows} duplicate facility record(s).`);
await c.end();
