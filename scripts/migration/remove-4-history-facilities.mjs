/**
 * Deletes the remaining non-master facilities that have activity, plus their
 * activity rows (so nothing is orphaned). Everything is backed up to JSON first
 * (fully reversible).
 */
import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT * FROM facilities WHERE managementNote='Not in active Excel master — review'");
if (!facs.length) { console.log("None left to remove."); await c.end(); process.exit(0); }
const ids = facs.map((f) => f.id);
const inList = ids.join(",");

const ACTIVITY = ["contact_logs", "facility_leads", "facility_referrals", "facility_tasks", "facility_updates", "facility_gratitude", "facility_leads_sent"];
const backup = { facilities: facs, activity: {} };
for (const tbl of ACTIVITY) {
  try { const [rows] = await c.query(`SELECT * FROM ${tbl} WHERE facilityId IN (${inList})`); backup.activity[tbl] = rows; }
  catch { backup.activity[tbl] = []; }
}
fs.writeFileSync("scripts/migration/removed-4-history-facilities.json", JSON.stringify(backup, null, 2));
console.log("Backed up " + facs.length + " facilities + their activity → scripts/migration/removed-4-history-facilities.json");

let actDeleted = 0;
for (const tbl of ACTIVITY) { const [r] = await c.query(`DELETE FROM ${tbl} WHERE facilityId IN (${inList})`); actDeleted += r.affectedRows; }
for (const f of facs) await c.query("DELETE FROM facilities WHERE id=?", [f.id]);

console.log("✅ Deleted " + facs.length + " facilities and " + actDeleted + " activity rows:");
for (const f of facs) console.log("  #" + f.id + "  " + JSON.stringify(f.name));
const [[n]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log("\nFacilities remaining in CRM: " + n.n + " (your master file).");
await c.end();
