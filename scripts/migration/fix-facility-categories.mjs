/**
 * Corrects facility CATEGORY from the facility's own (now-correct) name.
 * A prior import left categories scrambled/offset relative to names — e.g.
 * "Arcadia Chiropractic Center" stored as body_shop. The name is the reliable
 * signal, so we re-derive the category from it.
 *
 * SAFETY: only changes a facility when its name UNAMBIGUOUSLY implies a
 * category that differs from the stored one. Ambiguous names are left as-is.
 * Every change is backed up to fix-facility-categories-backup.json.
 *
 * Run: node scripts/migration/fix-facility-categories.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

/** High-confidence name → CRM category. Returns null when ambiguous. Order
 *  matters: chiropractic is checked before body/auto and before rehab/PT. */
const infer = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (/(chiropract|chiro\b|\bspine\b|spinal)/.test(n)) return "chiropractor";
  if (/(collision|body shop|body works|auto body|autobody|auto repair|auto care|auto service|automotive|paint & body|paint and body|\bpaint\b|bodywork|motorsport|\bdent\b|car care|auto collision)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|\btows\b|recovery)/.test(n)) return "other";       // CRM has no towing category
  if (/(imaging|radiolog|\bmri\b|diagnostic imaging)/.test(n)) return "imaging_center";
  if (/(physical therap|physiotherap)/.test(n)) return "physical_therapist";
  if (/(orthoped|\bsurgeon\b|\bsurgery\b|surgical)/.test(n)) return "orthopedic_doctor";
  if (/(urgent care|medical center|medical group|medical clinic|health center|family medicine|walk-in|walk in clinic|pain manage|pain manag|wellness center|medical & )/.test(n)) return "medical_clinic";
  if (/(\binsurance\b)/.test(n)) return "other";
  if (/(pharmacy)/.test(n)) return "other";
  return null;
};

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, category FROM facilities");

const backup = [];
for (const f of facs) {
  const want = infer(f.name);
  if (!want) continue;
  if (f.category === want) continue;
  // Don't downgrade a more-specific medical category to generic on a soft match.
  if (want === "medical_clinic" && ["imaging_center", "physical_therapist", "orthopedic_doctor"].includes(f.category)) continue;
  backup.push({ id: f.id, name: f.name, from: f.category, to: want });
  await c.query("UPDATE facilities SET category = ? WHERE id = ?", [want, f.id]);
}

fs.writeFileSync("scripts/migration/fix-facility-categories-backup.json", JSON.stringify(backup, null, 2));
console.log(`Categories corrected from name: ${backup.length}`);
const buckets = {};
for (const b of backup) { const k = `${b.from} → ${b.to}`; buckets[k] = (buckets[k] ?? 0) + 1; }
console.log("--- changes by direction ---");
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(3)}×  ${k}`);
// post-state distribution
const [dist] = await c.query("SELECT category, COUNT(*) n FROM facilities GROUP BY category ORDER BY n DESC");
console.log("\n--- category distribution now ---");
for (const d of dist) console.log(`${String(d.n).padStart(3)}  ${d.category}`);
await c.end();
