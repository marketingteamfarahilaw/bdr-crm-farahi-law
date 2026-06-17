/**
 * Applies the researched wrong-name fixes (from the research-wrong-names workflow).
 * Renames a facility only where the research action is "fix" at high/medium
 * confidence and the recommended name is non-empty and actually different.
 * Backed up + reversible.
 *
 * Input: scripts/migration/wrongname-researched.json = [{id, action, recommendedName, confidence, evidence}]
 * Run: node scripts/migration/apply-wrongname-fixes.mjs            (dry run)
 *      node scripts/migration/apply-wrongname-fixes.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const res = JSON.parse(fs.readFileSync("scripts/migration/wrongname-researched.json", "utf8"));

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name FROM facilities");
const cur = new Map(facs.map((f) => [f.id, f.name]));

const fixes = [], skipped = { keep: 0, uncertain: 0, lowConf: 0, sameName: 0, empty: 0, gone: 0 };
for (const r of res) {
  if (r.action === "keep_crm") { skipped.keep++; continue; }
  if (r.action === "uncertain") { skipped.uncertain++; continue; }
  if (r.confidence === "low") { skipped.lowConf++; continue; }
  const old = cur.get(r.id); if (old === undefined) { skipped.gone++; continue; }
  const nn = clean(r.recommendedName); if (!nn) { skipped.empty++; continue; }
  if (norm(nn) === norm(old)) { skipped.sameName++; continue; }
  fixes.push({ id: r.id, oldName: old, newName: nn, confidence: r.confidence, evidence: r.evidence });
}

console.log(`Researched rows: ${res.length}`);
console.log(`Fixes to apply (fix + high/medium + real change): ${fixes.length}`);
console.log(`Skipped — keep_crm:${skipped.keep} uncertain:${skipped.uncertain} low-conf:${skipped.lowConf} same-name:${skipped.sameName} empty:${skipped.empty} gone:${skipped.gone}`);
console.log("\nSample fixes:");
for (const f of fixes.slice(0, 30)) console.log(`  #${f.id} "${f.oldName}" → "${f.newName}" (${f.confidence}) — ${f.evidence}`);

if (APPLY) {
  fs.writeFileSync("scripts/migration/apply-wrongname-fixes-backup.json", JSON.stringify(fixes.map((f) => ({ id: f.id, oldName: f.oldName, newName: f.newName })), null, 2));
  for (const f of fixes) await c.query("UPDATE facilities SET name=? WHERE id=?", [f.newName, f.id]);
  console.log(`\nAPPLIED ${fixes.length} name fixes (backup → apply-wrongname-fixes-backup.json).`);
} else {
  console.log(`\nDRY RUN — re-run with --apply to write.`);
}
await c.end();
