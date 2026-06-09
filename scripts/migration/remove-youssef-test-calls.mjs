/**
 * Removes Youssef El Karmi's test calls/recaps (all were just for testing).
 * Backs up everything first and decrements each facility's totalCalls.
 */
import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const LIKE = "repName LIKE '%Youssef%'";
const TASK_WHERE = "assignedToName LIKE '%Youssef%' AND (description LIKE '%synced call%' OR description LIKE '%from call on%')";

const [calls] = await c.query(`SELECT * FROM contact_logs WHERE ${LIKE}`);
const [recaps] = await c.query(`SELECT * FROM facility_updates WHERE ${LIKE}`);
const [tasks] = await c.query(`SELECT * FROM facility_tasks WHERE ${TASK_WHERE}`);
fs.writeFileSync("scripts/migration/removed-youssef-test-calls.json", JSON.stringify({ calls, recaps, tasks }, null, 2));
console.log(`Backed up ${calls.length} calls, ${recaps.length} recaps, ${tasks.length} tasks → scripts/migration/removed-youssef-test-calls.json`);

// Decrement totalCalls per facility for the deleted CALL rows
const perFac = new Map();
for (const r of calls) { if (r.contactType === "call" && r.facilityId) perFac.set(r.facilityId, (perFac.get(r.facilityId) || 0) + 1); }
for (const [fid, n] of perFac) await c.query("UPDATE facilities SET totalCalls = GREATEST(totalCalls - ?, 0) WHERE id=?", [n, fid]);

const [dc] = await c.query(`DELETE FROM contact_logs WHERE ${LIKE}`);
const [dr] = await c.query(`DELETE FROM facility_updates WHERE ${LIKE}`);
const [dt] = await c.query(`DELETE FROM facility_tasks WHERE ${TASK_WHERE}`);

console.log(`✅ Deleted ${dc.affectedRows} call(s), ${dr.affectedRows} recap(s), ${dt.affectedRows} task(s). Adjusted totalCalls on ${perFac.size} facilities.`);
await c.end();
