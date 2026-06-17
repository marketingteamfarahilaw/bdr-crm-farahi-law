/**
 * Applies the LLM category classifications (from the classify-facility-categories
 * workflow) to the facilities table. Updates category where the LLM's category
 * differs from the stored one at high/medium confidence. Backed up + reversible.
 *
 * Input: scripts/migration/cat-classified.json = [{id, category, confidence}]
 * Run: node scripts/migration/apply-categories.mjs            (dry run)
 *      node scripts/migration/apply-categories.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const VALID = new Set(["body_shop", "chiropractor", "physical_therapist", "imaging_center", "medical_clinic", "other"]);
const cls = JSON.parse(fs.readFileSync("scripts/migration/cat-classified.json", "utf8"));

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, category FROM facilities");
const cur = new Map(facs.map((f) => [f.id, f]));

const changes = []; let skippedLow = 0, unchanged = 0, invalid = 0;
for (const r of cls) {
  if (!VALID.has(r.category)) { invalid++; continue; }
  const f = cur.get(r.id); if (!f) continue;
  if (r.category === f.category) { unchanged++; continue; }
  if (r.confidence === "low") { skippedLow++; continue; }
  changes.push({ id: r.id, name: f.name, from: f.category, to: r.category, confidence: r.confidence });
}

// Tally of change directions
const dir = new Map();
for (const ch of changes) { const k = `${ch.from} → ${ch.to}`; dir.set(k, (dir.get(k) || 0) + 1); }
console.log(`Classified rows: ${cls.length} | unchanged: ${unchanged} | low-confidence skipped: ${skippedLow} | invalid: ${invalid}`);
console.log(`Category CHANGES to apply (high/medium): ${changes.length}`);
for (const [k, n] of [...dir.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log("\nSamples:");
for (const ch of changes.slice(0, 25)) console.log(`  #${ch.id} "${ch.name}"  ${ch.from} → ${ch.to} (${ch.confidence})`);

if (APPLY) {
  fs.writeFileSync("scripts/migration/apply-categories-backup.json", JSON.stringify(changes.map((c) => ({ id: c.id, oldCategory: c.from, newCategory: c.to })), null, 2));
  for (const ch of changes) await c.query("UPDATE facilities SET category=? WHERE id=?", [ch.to, ch.id]);
  console.log(`\nAPPLIED ${changes.length} category changes (backup → apply-categories-backup.json).`);
  const [dist] = await c.query("SELECT category, COUNT(*) n FROM facilities GROUP BY category ORDER BY n DESC");
  console.log("Category distribution now:"); for (const d of dist) console.log(`  ${d.category}  ${d.n}`);
} else {
  console.log(`\nDRY RUN — re-run with --apply to write.`);
}
await c.end();
