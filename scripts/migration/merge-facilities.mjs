// Merge duplicate facility records into one. Reassigns ALL child rows (any
// table with a facilityId column) from the duplicates to the keeper, then
// deletes the now-empty duplicate facility rows.
//
//   node -r dotenv/config scripts/migration/merge-facilities.mjs <keepId> <dupId> [dupId...]
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const args = process.argv.slice(2).map((n) => parseInt(n, 10));
const keep = args[0];
const dups = args.slice(1).filter((n) => Number.isInteger(n) && n !== keep);
if (!Number.isInteger(keep) || dups.length === 0) {
  console.error("Usage: node merge-facilities.mjs <keepId> <dupId> [dupId...]");
  process.exit(1);
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [cols] = await c.query(
  "SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='facilityId'"
);
const placeholders = dups.map(() => "?").join(",");
let moved = 0;
for (const { t } of cols) {
  const [r] = await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId IN (${placeholders})`, [keep, ...dups]);
  if (r.affectedRows) {
    console.log(`  ${t}: moved ${r.affectedRows}`);
    moved += r.affectedRows;
  }
}
const [d] = await c.query(`DELETE FROM facilities WHERE id IN (${placeholders})`, dups);
console.log(`✅ Merged ${dups.length} duplicate(s) into #${keep}: moved ${moved} child rows, deleted ${d.affectedRows} facilities.`);
await c.end();
