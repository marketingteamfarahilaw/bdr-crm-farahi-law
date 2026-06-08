/**
 * Removes facilities flagged as not-in-the-Excel-master, but ONLY the ones with
 * zero activity (no calls/leads/referrals/tasks/recaps). Facilities that have
 * real history are kept and reported, so an agent's work is never silently lost.
 * Deleted rows are backed up to JSON first (reversible).
 */
import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [flagged] = await c.query("SELECT * FROM facilities WHERE managementNote='Not in active Excel master — review'");
if (!flagged.length) { console.log("Nothing flagged."); await c.end(); process.exit(0); }
const ids = flagged.map((r) => r.id);
const inList = ids.join(",");

const [act] = await c.query(
  "SELECT DISTINCT facilityId FROM (" +
    "SELECT facilityId FROM contact_logs WHERE facilityId IN (" + inList + ") " +
    "UNION ALL SELECT facilityId FROM facility_leads WHERE facilityId IN (" + inList + ") " +
    "UNION ALL SELECT facilityId FROM facility_referrals WHERE facilityId IN (" + inList + ") " +
    "UNION ALL SELECT facilityId FROM facility_tasks WHERE facilityId IN (" + inList + ") " +
    "UNION ALL SELECT facilityId FROM facility_updates WHERE facilityId IN (" + inList + ")" +
  ") t"
);
const hasActivity = new Set(act.map((r) => r.facilityId));

const toDelete = flagged.filter((f) => !hasActivity.has(f.id));
const toKeep = flagged.filter((f) => hasActivity.has(f.id));

fs.writeFileSync("scripts/migration/removed-non-master-facilities.json", JSON.stringify(toDelete, null, 2));

for (const f of toDelete) await c.query("DELETE FROM facilities WHERE id=?", [f.id]);

console.log("✅ Deleted " + toDelete.length + " non-master facilities (zero activity). Backup: scripts/migration/removed-non-master-facilities.json");
console.log("\nKept " + toKeep.length + " that HAVE history (calls/tasks/recaps) — your call on these:");
for (const f of toKeep) console.log("  #" + f.id + "  " + JSON.stringify(f.name) + "  " + (f.phone || "") + "  " + (f.city || ""));

const [[remaining]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log("\nFacilities remaining in CRM: " + remaining.n);
await c.end();
