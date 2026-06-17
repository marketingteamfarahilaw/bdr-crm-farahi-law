/**
 * Fixes shifted CRM facility names using Filevine (source of truth), but ONLY
 * where Google's nearest-business at the facility's geocoded coordinates confirms
 * the Filevine name AND refutes the current CRM name. Conservative: anything
 * ambiguous or where Google matches the CRM name is left untouched.
 * Only handles ADDRESS-matched candidates (phone matches are unreliable here).
 *
 * DRY RUN by default. Pass --apply to write (full backup).
 *   node scripts/migration/verify-fix-names-vs-filevine.mjs
 *   node scripts/migration/verify-fix-names-vs-filevine.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cands = JSON.parse(fs.readFileSync("scripts/migration/find-wrong-names-vs-filevine-report.json", "utf8")).filter((c) => c.by === "address");
const c = await mysql.createConnection(process.env.DATABASE_URL);

const nearest = async (lat, lng) => {
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=establishment&key=${KEY}`);
    const j = await r.json();
    return (j.results || []).slice(0, 5).map((x) => x.name);
  } catch { return []; }
};

const toFix = [], keep = [], review = [];
const CONC = 5;
for (let i = 0; i < cands.length; i += CONC) {
  await Promise.all(cands.slice(i, i + CONC).map(async (cd) => {
    const [[f]] = await c.query("SELECT latitude, longitude FROM facilities WHERE id=?", [cd.id]);
    if (!f?.latitude || !f?.longitude) { review.push({ ...cd, reason: "no geo" }); return; }
    const names = await nearest(f.latitude, f.longitude);
    const hitFV = names.some((n) => nameish(n, cd.fvName));
    const hitCRM = names.some((n) => nameish(n, cd.crmName));
    if (hitFV && !hitCRM) toFix.push({ ...cd, googleNearest: names[0] });
    else if (hitCRM) keep.push({ ...cd, googleNearest: names[0] });
    else review.push({ ...cd, googleNearest: names[0] ?? null });
  }));
  process.stdout.write(`\r  verified ${Math.min(i + CONC, cands.length)}/${cands.length}`);
  await sleep(80);
}
console.log("");
console.log(`Address candidates: ${cands.length}`);
console.log(`  ✓ Google confirms Filevine (CRM name wrong) → FIX: ${toFix.length}`);
console.log(`  CRM name confirmed correct → keep: ${keep.length}`);
console.log(`  ambiguous/no-geo → manual review: ${review.length}`);
fs.writeFileSync("scripts/migration/verify-fix-names-vs-filevine-result.json", JSON.stringify({ toFix, keep, review }, null, 2));
console.log("\nSample fixes:");
for (const x of toFix.slice(0, 20)) console.log(`  #${x.id} "${x.crmName}" → "${x.fvName}"  (Google: ${x.googleNearest})`);
console.log("\nKept (CRM was right):");
for (const x of keep.slice(0, 10)) console.log(`  #${x.id} keep "${x.crmName}"  (FV claimed "${x.fvName}")`);

if (APPLY) {
  const backup = [];
  for (const x of toFix) { backup.push({ id: x.id, oldName: x.crmName, newName: x.fvName }); await c.query("UPDATE facilities SET name=? WHERE id=?", [x.fvName, x.id]); }
  fs.writeFileSync("scripts/migration/verify-fix-names-vs-filevine-backup.json", JSON.stringify(backup, null, 2));
  console.log(`\nAPPLIED ${backup.length} name fixes (backup → verify-fix-names-vs-filevine-backup.json).`);
} else {
  console.log(`\nDRY RUN — nothing changed. Re-run with --apply to fix the ${toFix.length} confirmed.`);
}
await c.end();
