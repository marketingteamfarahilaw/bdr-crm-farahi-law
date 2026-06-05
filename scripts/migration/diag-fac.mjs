/** Look up a facility by name or number (normalized) + show its logs/recaps. */
import "dotenv/config";
import mysql from "mysql2/promise";

const q = process.argv[2] || "";
const digits = q.replace(/\D/g, "");
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query(
  `SELECT id, name, city, phone FROM facilities
   WHERE name LIKE ?
      ${digits.length >= 7 ? `OR REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','') LIKE '%${digits}%'` : ""}
   ORDER BY id`,
  [`%${q}%`]
);
if (!facs.length) console.log("(no facility matched)");
for (const f of facs) {
  console.log(`\n#${f.id}  ${f.name}  (${f.city || "?"})  ${f.phone}`);
  const [logs] = await c.query(`SELECT contactDate, callResult, fromRingCentral rc, rcCallId, LEFT(summary,60) s FROM contact_logs WHERE facilityId=? ORDER BY contactDate DESC LIMIT 6`, [f.id]);
  const [upd] = await c.query(`SELECT updateDate, updateType, LEFT(summary,60) s FROM facility_updates WHERE facilityId=? ORDER BY updateDate DESC LIMIT 4`, [f.id]);
  for (const l of logs) console.log(`   LOG ${new Date(l.contactDate).toISOString().slice(0,16)} | ${l.callResult} | rc=${l.rc} | ${l.rcCallId || "-"} | ${l.s || ""}`);
  for (const u of upd) console.log(`   RECAP ${new Date(u.updateDate).toISOString().slice(0,16)} | ${u.updateType} | ${u.s || ""}`);
}
await c.end();
