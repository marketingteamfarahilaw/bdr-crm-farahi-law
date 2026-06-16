/**
 * Conservative de-dupe of facilities with the SAME normalized name.
 * For each duplicate group: keep the "richest" row (most child records, then
 * most filled phone/contact fields, then lowest id). Delete the others ONLY
 * if they carry ZERO child records — anything with activity is kept + reported.
 * Full backup of every deleted row → dedupe-facilities-backup.json.
 *
 * Run: node scripts/migration/dedupe-facilities.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const childTables = [
  "contact_logs", "facility_tasks", "facility_updates", "facility_leads",
  "facility_leads_sent", "facility_referrals", "facility_gratitude",
];

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT * FROM facilities");

const refsOf = async (id) => {
  let n = 0;
  for (const t of childTables) {
    try { const [[r]] = await c.query(`SELECT COUNT(*) n FROM ${t} WHERE facilityId = ?`, [id]); n += Number(r.n); }
    catch { /* ignore */ }
  }
  return n;
};
const filled = (f) => [f.phone, f.phone2, f.phone3, f.contactPhone, f.contactName, f.address, f.city, f.assignedRepName, f.email].filter((x) => x && String(x).trim()).length;

const groups = new Map();
for (const f of facs) { const k = norm(f.name); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }

const backup = { deleted: [], keptConflicts: [] };
for (const [, rows] of groups) {
  if (rows.length < 2) continue;
  // score each row: refs first, then filled fields
  const scored = [];
  for (const f of rows) scored.push({ f, refs: await refsOf(f.id), fill: filled(f) });
  scored.sort((a, b) => b.refs - a.refs || b.fill - a.fill || a.f.id - b.f.id);
  const keep = scored[0];
  for (const s of scored.slice(1)) {
    if (s.refs > 0) { backup.keptConflicts.push({ id: s.f.id, name: s.f.name, refs: s.refs, keptId: keep.f.id }); continue; }
    backup.deleted.push(s.f);
    await c.query("DELETE FROM facilities WHERE id = ?", [s.f.id]);
  }
}

fs.writeFileSync("scripts/migration/dedupe-facilities-backup.json", JSON.stringify(backup, null, 2));
const [[n]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`Duplicate copies removed: ${backup.deleted.length} | kept (both had activity — manual merge): ${backup.keptConflicts.length}`);
console.log(`Facilities total now: ${n.n}. Backup: scripts/migration/dedupe-facilities-backup.json`);
if (backup.keptConflicts.length) {
  console.log("\n--- duplicate names where BOTH copies have activity (left for manual merge) ---");
  for (const k of backup.keptConflicts) console.log(`#${k.id} "${k.name}" (${k.refs} records) — duplicate of kept #${k.keptId}`);
}
await c.end();
