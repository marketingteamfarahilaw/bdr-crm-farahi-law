/**
 * Links existing Uber Eats FR expenses to their facility. Most already carry the
 * facility NAME but were never linked (facilityId NULL). Match the name to a
 * facility and set facilityId so the expense shows on the partner's profile and
 * in reports. Name match is exact-normalized, then fuzzy contains. Backed up.
 *
 * Run: node scripts/migration/link-uber-expenses.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name FROM facilities");
const byName = new Map();
for (const f of facs) { const k = norm(f.name); if (k && !byName.has(k)) byName.set(k, f); }

const [exps] = await c.query("SELECT id, facilityName FROM fr_expenses WHERE store='Uber Eats' AND facilityId IS NULL AND facilityName IS NOT NULL AND facilityName <> ''");
const backup = []; let linked = 0; const unmatched = [];
for (const e of exps) {
  const k = norm(e.facilityName);
  if (!k) continue;
  let f = byName.get(k);
  if (!f) { // fuzzy: a facility whose normalized name contains, or is contained by, the expense name (min length 6)
    for (const [fk, fv] of byName) { if (k.length >= 6 && (fk.includes(k) || k.includes(fk))) { f = fv; break; } }
  }
  if (f) { backup.push({ id: e.id, facilityName: e.facilityName, linkedTo: f.id }); await c.query("UPDATE fr_expenses SET facilityId=? WHERE id=?", [f.id, e.id]); linked++; }
  else unmatched.push(e.facilityName);
}
fs.writeFileSync("scripts/migration/link-uber-expenses-backup.json", JSON.stringify(backup, null, 2));
console.log(`Uber expenses with a facility name but no link: ${exps.length}`);
console.log(`  linked to a facility: ${linked}`);
console.log(`  name not found in facilities: ${unmatched.length}`);
const u = [...new Set(unmatched)].slice(0, 25);
if (u.length) console.log("  unmatched names:\n   " + u.join("\n   "));
const [[left]] = await c.query("SELECT COUNT(*) n FROM fr_expenses WHERE store='Uber Eats' AND facilityId IS NULL");
console.log(`Uber expenses still unmatched (incl. ones with no facility name): ${left.n}`);
await c.end();
