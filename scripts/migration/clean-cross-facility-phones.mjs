/**
 * Clears secondary phone numbers (phone2/phone3/contactPhone) that are provably
 * ANOTHER facility's PRIMARY phone — contamination from past imports/merges that
 * caused calls to be attributed to the wrong facility. Never touches the primary
 * `phone` field. Backs up every change to a JSON file first (reversible).
 */
import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const last10 = (s) => { const d = (s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

const [rows] = await c.query("SELECT id, name, phone, phone2, phone3, contactPhone FROM facilities");

// primary number -> facilities that own it as their primary phone
const primaryOwner = new Map();
for (const r of rows) {
  const p = last10(r.phone);
  if (p) { if (!primaryOwner.has(p)) primaryOwner.set(p, []); primaryOwner.get(p).push(r); }
}

const FIELDS = ["phone2", "phone3", "contactPhone"];
const changes = [];
for (const r of rows) {
  for (const field of FIELDS) {
    const v = last10(r[field]);
    if (!v) continue;
    const owners = primaryOwner.get(v) || [];
    const owner = owners.find((o) => o.id !== r.id);
    if (owner) changes.push({ id: r.id, name: r.name, field, oldValue: r[field], belongsTo: owner.id + " " + owner.name });
  }
}

const backupPath = "scripts/migration/backup-cross-facility-phones.json";
fs.writeFileSync(backupPath, JSON.stringify(changes, null, 2));
console.log(`Backed up ${changes.length} change(s) → ${backupPath}\n`);

let applied = 0;
for (const ch of changes) {
  await c.query(`UPDATE facilities SET ${ch.field} = NULL WHERE id = ?`, [ch.id]); // field is from a fixed whitelist
  console.log(`  cleared #${ch.id} ${JSON.stringify(ch.name)} ${ch.field} (was ${ch.oldValue} — belongs to ${ch.belongsTo})`);
  applied++;
}
console.log(`\nDone. Cleared ${applied} contaminated secondary phone number(s).`);
await c.end();
