/**
 * REVERTS the bad fix-facility-names-v6 renames.
 *
 * The v6 reconciliation trusted the team spreadsheet's phone→name column, but
 * that column is scrambled (e.g. a Laguna Hills clinic's phone was listed under
 * "Gilroy Family Chiropractic"). So v6 OVERWROTE the team's already-correct
 * names with wrong ones. This restores each facility to its pre-v6 name (the
 * correct one) and re-derives the category from that name. Idempotent.
 *
 * Run: node scripts/migration/revert-v6-renames.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const infer = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (/(chiropract|chiro\b|\bspine\b|spinal)/.test(n)) return "chiropractor";
  if (/(collision|body shop|body works|auto body|autobody|auto repair|auto care|auto service|automotive|paint & body|paint and body|\bpaint\b|bodywork|motorsport|\bdent\b|car care|auto collision)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|recovery)/.test(n)) return "other";
  if (/(imaging|radiolog|\bmri\b)/.test(n)) return "imaging_center";
  if (/(physical therap|physiotherap)/.test(n)) return "physical_therapist";
  if (/(orthoped|\bsurgeon\b|\bsurgery\b)/.test(n)) return "orthopedic_doctor";
  if (/(urgent care|medical center|medical group|medical clinic|health center|pain manage|wellness center)/.test(n)) return "medical_clinic";
  if (/(\binsurance\b|pharmacy)/.test(n)) return "other";
  return null;
};

const c = await mysql.createConnection(process.env.DATABASE_URL);
const b = JSON.parse(fs.readFileSync("scripts/migration/fix-facility-names-v6-backup.json", "utf8"));
let n = 0;
for (const r of b.renamed || []) {
  const cat = infer(r.oldName) || r.oldCategory || null;
  await c.query("UPDATE facilities SET name = ?, category = COALESCE(?, category) WHERE id = ?", [r.oldName, cat, r.id]);
  n++;
}
console.log(`Reverted ${n} v6 renames to their correct (pre-v6) names.`);
await c.end();
