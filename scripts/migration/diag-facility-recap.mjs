/**
 * Diagnose the missing recap: which facility holds the dialed number, and does
 * it have the call logged but no transcript/recap (facility_updates)?
 * Usage: node scripts/migration/diag-facility-recap.mjs 9168610028
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const num = process.argv[2] || "9168610028";
const c = await mysql.createConnection(process.env.DATABASE_URL);

const [facs] = await c.query(
  `SELECT id, name, city, partnerStatus, phone, phone2, phone3, contactPhone
   FROM facilities
   WHERE name LIKE '%Accident and Injury%'
      OR phone LIKE '%${num}%' OR phone2 LIKE '%${num}%' OR phone3 LIKE '%${num}%' OR contactPhone LIKE '%${num}%'
   ORDER BY id`
);
console.log(`\n=== Facilities matching name 'Accident and Injury' or number ${num} ===`);
for (const f of facs) {
  console.log(`#${f.id}  "${f.name}"  (${f.city || "?"})  [${f.partnerStatus}]`);
  console.log(`     phones: ${[f.phone, f.phone2, f.phone3, f.contactPhone].filter(Boolean).join("  |  ") || "(none)"}`);
}

for (const f of facs) {
  const [[lc]] = await c.query(`SELECT COUNT(*) n FROM contact_logs WHERE facilityId=?`, [f.id]);
  const [[uc]] = await c.query(`SELECT COUNT(*) n FROM facility_updates WHERE facilityId=?`, [f.id]);
  const [logs] = await c.query(
    `SELECT contactDate, callResult, fromRingCentral rc, rcCallId, LEFT(summary,68) s FROM contact_logs WHERE facilityId=? ORDER BY contactDate DESC LIMIT 6`, [f.id]);
  const [upds] = await c.query(
    `SELECT updateDate, updateType, LEFT(summary,68) s FROM facility_updates WHERE facilityId=? ORDER BY updateDate DESC LIMIT 6`, [f.id]);
  console.log(`\n── #${f.id} "${f.name}" :: ${lc.n} contact_logs, ${uc.n} facility_updates ──`);
  console.log("  LOGS:");
  for (const l of logs) console.log(`    ${new Date(l.contactDate).toISOString().slice(0,16)} | ${l.callResult || "?"} | rc=${l.rc} | callId=${l.rcCallId || "-"} | ${l.s || ""}`);
  console.log("  UPDATES (recaps):");
  if (!upds.length) console.log("    (none)");
  for (const u of upds) console.log(`    ${new Date(u.updateDate).toISOString().slice(0,16)} | ${u.updateType} | ${u.s || ""}`);
}
await c.end();
