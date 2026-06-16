/**
 * Applies Google's verified business name to each facility whose phone Google
 * matched to a DIFFERENT business than the CRM had (the 257 mismatches from
 * verify-facility-phones-report.json). The phone number is treated as the
 * reliable key (it's what the team dials), so each facility is relabeled to the
 * business that actually owns its number — name + category + address + city —
 * keeping the record internally consistent. Phone, agent, status untouched.
 *
 * Full old values backed up to apply-google-names-backup.json (reversible).
 * Run: node scripts/migration/apply-google-names.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const report = JSON.parse(fs.readFileSync("scripts/migration/verify-facility-phones-report.json", "utf8"));
const cityOf = (addr) => { const m = String(addr ?? "").match(/,\s*([^,]+),\s*[A-Z]{2}\s*\d{5}/); return m ? m[1].trim() : null; };
const infer = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (/(chiropract|chiro\b|\bspine\b|spinal|\bdc\b|d\.c\.|injury center|injury doctor|wellness|rehab|sports medicine)/.test(n)) return "chiropractor";
  if (/(collision|body shop|body works|auto body|autobody|auto repair|auto care|auto service|automotive|paint & body|paint and body|\bpaint\b|bodywork|motorsport|\bdent\b|car care|auto collision|autopro|auto color|coach)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|recovery|tow service)/.test(n)) return "other";
  if (/(imaging|radiolog|\bmri\b)/.test(n)) return "imaging_center";
  if (/(physical therap|physiotherap)/.test(n)) return "physical_therapist";
  if (/(orthoped|\bsurgeon\b|\bsurgery\b|surgical)/.test(n)) return "orthopedic_doctor";
  if (/(urgent care|medical center|medical group|medical clinic|health center|pain manage|accident center|\bmd\b|\bmds\b)/.test(n)) return "medical_clinic";
  if (/(\binsurance\b|tax service)/.test(n)) return "other";
  if (/(pharmacy)/.test(n)) return "other";
  return null;
};

const c = await mysql.createConnection(process.env.DATABASE_URL);
const backup = [];
let applied = 0;
for (const m of report.mismatch) {
  const [[cur]] = await c.query("SELECT id, name, category, address, city FROM facilities WHERE id = ?", [m.id]);
  if (!cur) continue;
  const newCat = infer(m.googleName) ?? cur.category;
  const newCity = cityOf(m.googleAddr) ?? cur.city;
  backup.push({ id: cur.id, oldName: cur.name, oldCategory: cur.category, oldAddress: cur.address, oldCity: cur.city, newName: m.googleName });
  await c.query("UPDATE facilities SET name = ?, category = ?, address = ?, city = ? WHERE id = ?",
    [m.googleName, newCat, m.googleAddr, newCity, cur.id]);
  applied++;
}
fs.writeFileSync("scripts/migration/apply-google-names-backup.json", JSON.stringify(backup, null, 2));
console.log(`Renamed ${applied} facilities to Google's verified business for their phone (name+category+address+city).`);
console.log("Backup: scripts/migration/apply-google-names-backup.json");
// spot checks
for (const id of [451296, 451008, 451318, 451343]) {
  const [[r]] = await c.query("SELECT id, name, category, city FROM facilities WHERE id = ?", [id]);
  if (r) console.log(`  #${r.id} → "${r.name}" (${r.category}, ${r.city})`);
}
await c.end();
