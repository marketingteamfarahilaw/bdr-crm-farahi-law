/**
 * REVERTS apply-google-names: restores the friend's Excel-sourced facility
 * names that the Google pass overwrote. The team confirmed the Excel
 * "Active partners" sheet — not Google — is the source of truth. Idempotent.
 * Run: node scripts/migration/revert-google-names.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
const b = JSON.parse(fs.readFileSync("scripts/migration/apply-google-names-backup.json", "utf8"));
let n = 0;
for (const r of b) {
  await c.query("UPDATE facilities SET name=?, category=?, address=?, city=? WHERE id=?", [r.oldName, r.oldCategory, r.oldAddress, r.oldCity, r.id]);
  n++;
}
console.log(`Reverted ${n} facilities back to their Excel/friend names.`);
await c.end();
