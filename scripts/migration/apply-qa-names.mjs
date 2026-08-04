/**
 * Applies the deep-QA name research (qa-facility-names workflow).
 * Renames where action='fix' at high/medium confidence and the name actually
 * changes. Backed up + reversible.
 *
 * Input: scripts/migration/qa-names-researched.json = [{id, action, recommendedName, confidence, evidence}]
 * Run: node scripts/migration/apply-qa-names.mjs            (dry run)
 *      node scripts/migration/apply-qa-names.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const res = JSON.parse(fs.readFileSync("scripts/migration/qa-names-researched.json", "utf8"));

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name FROM facilities");
const cur = new Map(facs.map((f) => [f.id, f.name]));

const fixes = [], skipped = { keep: 0, uncertain: 0, lowConf: 0, same: 0, empty: 0, gone: 0 };
for (const r of res) {
  if (r.action === "keep") { skipped.keep++; continue; }
  if (r.action === "uncertain") { skipped.uncertain++; continue; }
  if (r.confidence === "low") { skipped.lowConf++; continue; }
  const old = cur.get(r.id); if (old === undefined) { skipped.gone++; continue; }
  const nn = clean(r.recommendedName); if (!nn || nn.length < 3) { skipped.empty++; continue; }
  if (nn === old) { skipped.same++; continue; } // exact same incl. case
  fixes.push({ id: r.id, oldName: old, newName: nn, confidence: r.confidence, evidence: r.evidence, caseOnly: norm(nn) === norm(old) });
}
console.log(`Researched: ${res.length} | fixes to apply: ${fixes.length} (case/format-only: ${fixes.filter((f) => f.caseOnly).length})`);
console.log(`Skipped — keep:${skipped.keep} uncertain:${skipped.uncertain} low:${skipped.lowConf} same:${skipped.same} empty:${skipped.empty} gone:${skipped.gone}\n`);
for (const f of fixes.slice(0, 30)) console.log(`  #${f.id} "${f.oldName}" → "${f.newName}" (${f.confidence}${f.caseOnly ? ", format" : ""})`);

if (APPLY) {
  fs.writeFileSync("scripts/migration/apply-qa-names-backup.json", JSON.stringify(fixes.map((f) => ({ id: f.id, oldName: f.oldName, newName: f.newName })), null, 2));
  for (const f of fixes) await c.query("UPDATE facilities SET name=? WHERE id=?", [f.newName, f.id]);
  console.log(`\nAPPLIED ${fixes.length} name fixes (backup → apply-qa-names-backup.json).`);
} else {
  console.log("\nDRY RUN — re-run with --apply to write.");
}
await c.end();
