/**
 * Authoritatively corrects facilities from the firm's real Excel master
 * ("Centralized BDR_FR Reports"), matched by phone. Fixes the import row-shift
 * that put the wrong NAME on the right phone, and full-syncs name, phones,
 * category, assigned agent, contact, address, city, email. Facilities not in the
 * active master are flagged for review (never deleted).
 *
 * Full backup of the facilities table is written before any change.
 * Usage: node scripts/migration/sync-facilities-from-excel.mjs "<xlsx>" [--apply]
 *   (without --apply it's a DRY RUN — reports what it would do, writes nothing)
 */
import "dotenv/config";
import fs from "node:fs";
import XLSX from "xlsx";
import mysql from "mysql2/promise";

const XLSX_PATH = process.argv.find((a) => a.endsWith(".xlsx")) || "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (4).xlsx";
const APPLY = process.argv.includes("--apply");

const last10 = (s) => { const d = String(s == null ? "" : s).replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const clean = (s) => String(s == null ? "" : s).trim();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function mapCategory(type) {
  const t = norm(type);
  if (!t) return null;
  if (t.includes("bodyshop") || t.includes("collision") || t.includes("autobody") || t.includes("totalloss")) return "body_shop";
  if (t.includes("chiro")) return "chiropractor";
  if (t.includes("physicaltherapy") || t === "pt") return "physical_therapist";
  if (t.includes("imaging")) return "imaging_center";
  if (t.includes("ortho") || t.includes("surgeon")) return "orthopedic_doctor";
  if (t.includes("medical") || t.includes("clinic") || t.includes("pain") || t.includes("eruc") || t.includes("urgentcare")) return "medical_clinic";
  return "other"; // towing, insurance, pharmacy, neurologist, opthalmologist, etc.
}

const wb = XLSX.readFile(XLSX_PATH);
const toRows = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) : []);

const master = [];
const byKey = new Map();
function addRec(rec) {
  rec.primary = last10(rec.primary);
  if (!rec.name) return;
  const key = rec.primary || "n:" + norm(rec.name);
  if (byKey.has(key)) {
    const ex = byKey.get(key);
    for (const f of ["phone2", "phone3", "type", "agent", "contact", "address", "city", "email"]) if (!ex[f] && rec[f]) ex[f] = rec[f];
    if (rec.structured) ex.structured = true;
    return;
  }
  byKey.set(key, rec); master.push(rec);
}

// Structured sheets (same column layout: agent,type,name,contact,address,city,phone,cleanPhone,phone2,phone3,email,notes,specialty)
for (const sheet of ["Active partners", "1.Fcilty Typ"]) {
  const rows = toRows(sheet);
  const start = sheet === "Active partners" ? 2 : 7;
  for (const r of rows.slice(start)) {
    if (!clean(r[2])) continue;
    addRec({ name: clean(r[2]), primary: last10(r[7] || r[6]), phone2: last10(r[8]), phone3: last10(r[9]), type: clean(r[1]), agent: clean(r[0]), contact: clean(r[3]), address: clean(r[4]), city: clean(r[5]), email: clean(r[10]), structured: true });
  }
}
// Category sheets — robustly grab name (col0/col1) + the first 10-digit phone in the row
const CAT = { "Body Shop September": "Body Shop", "Non FR Chiro": "Chiropractor", "Imaging Center": "Imaging Center", "Physical Therapy": "Physical Therapy", "Pain Management": "Pain Management", "Towing Company": "Towing", "Medical Center": "Medical Center", "Insurance Company": "Insurance", "Opthalmologist": "Opthalmologist", "Pharmacy": "Pharmacy", "Neurologist": "Neurologist", "Surgeon": "Surgeon", "Chiropractor": "Chiropractor", "Active Chiropractor": "Chiropractor", "BS Total Loss Support": "Body Shop" };
for (const [sh, type] of Object.entries(CAT)) {
  const rows = toRows(sh); if (!rows.length) continue;
  const hdr = rows.findIndex((r) => r.some((c) => /company name|name of the facility/i.test(String(c))));
  for (const r of rows.slice((hdr < 0 ? 0 : hdr) + 1)) {
    const name = clean(r[0]) || (sh === "BS Total Loss Support" ? clean(r[1]) : "");
    const phone = r.map(last10).find(Boolean) || "";
    if (!name || !phone) continue;
    addRec({ name, primary: phone, phone2: "", phone3: "", type, agent: "", contact: "", address: "", city: "", email: "", structured: false });
  }
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [db] = await c.query("SELECT * FROM facilities");
if (APPLY) fs.writeFileSync("scripts/migration/backup-facilities-full.json", JSON.stringify(db, null, 2));

const dbByPrimary = new Map(), dbBySecondary = new Map();
for (const f of db) {
  const p = last10(f.phone); if (p && !dbByPrimary.has(p)) dbByPrimary.set(p, f);
  for (const s of [f.phone2, f.phone3, f.contactPhone].map(last10).filter(Boolean)) if (!dbBySecondary.has(s)) dbBySecondary.set(s, f);
}
const findDb = (rec) => {
  for (const p of [rec.primary, rec.phone2, rec.phone3].filter(Boolean)) if (dbByPrimary.has(p)) return dbByPrimary.get(p);
  for (const p of [rec.primary, rec.phone2, rec.phone3].filter(Boolean)) if (dbBySecondary.has(p)) return dbBySecondary.get(p);
  return null;
};

const touched = new Set();
let updated = 0, renamed = 0, noMatch = 0;
const samples = [];
for (const rec of master) {
  const f = findDb(rec);
  if (!f) { noMatch++; continue; }
  if (touched.has(f.id)) continue;
  touched.add(f.id);
  const set = {};
  if (rec.name) { if (norm(rec.name) !== norm(f.name)) { renamed++; if (samples.length < 25) samples.push({ id: f.id, was: f.name, now: rec.name }); } set.name = rec.name; }
  if (rec.primary) set.phone = rec.primary;
  if (rec.structured) { set.phone2 = rec.phone2 || null; set.phone3 = rec.phone3 || null; }
  const cat = mapCategory(rec.type);
  if (cat && cat !== "other") set.category = cat;
  else if (cat === "other" && (!f.category || f.category === "other")) set.category = "other";
  if (rec.agent) set.assignedRepName = rec.agent;
  if (rec.contact) set.contactName = rec.contact;
  if (rec.address) set.address = rec.address;
  if (rec.city) set.city = rec.city;
  if (rec.email) set.contactEmail = rec.email;
  updated++;
  if (APPLY) {
    const cols = Object.keys(set);
    if (cols.length) await c.query("UPDATE facilities SET " + cols.map((k) => k + "=?").join(", ") + " WHERE id=?", [...cols.map((k) => set[k]), f.id]);
  }
}

let flagged = 0;
for (const f of db) {
  if (touched.has(f.id)) continue;
  flagged++;
  if (APPLY) {
    const note = f.managementNote && f.managementNote.trim() ? f.managementNote : "Not in active Excel master — review";
    await c.query("UPDATE facilities SET managementFlag=1, managementNote=? WHERE id=?", [note, f.id]);
  }
}

console.log("Excel master facilities:", master.length);
console.log(`Matched & ${APPLY ? "UPDATED" : "would update"}:`, updated, "| renamed:", renamed, "| Excel rows with no DB match:", noMatch);
console.log(`DB facilities ${APPLY ? "FLAGGED" : "would flag"} (not in master):`, flagged);
console.log("\nSample renames (db #id: old → new):");
for (const s of samples) console.log("  #" + s.id + ": " + JSON.stringify(s.was) + " → " + JSON.stringify(s.now));
console.log(APPLY ? "\n✅ APPLIED. Backup: scripts/migration/backup-facilities-full.json" : "\nDRY RUN — re-run with --apply to write.");
await c.end();
