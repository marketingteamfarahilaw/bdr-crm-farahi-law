/**
 * Syncs the Excel "Active partners" sheet (the team's source of truth) INTO the
 * CRM, keyed by facility NAME (safe — not the scrambled phone column):
 *   - For each Excel row, find the CRM facility with the same name and copy the
 *     Excel's phone / phone2 / phone3 (+ category, city, address, contact, email)
 *     onto it. The name is set to the exact Excel spelling.
 *   - Excel rows with no name match in the CRM are imported as new facilities.
 * Every changed/created row is backed up to sync-excel-to-crm-backup.json.
 *
 * Run: node scripts/migration/sync-excel-to-crm.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FILE = "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (6).xlsx";
const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FILE).Sheets["Active partners"], { header: 1, defval: "" });
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
/** Pull up to 3 clean 10-digit US numbers from one or more (possibly messy,
 *  multi-number, note-laden) Excel phone cells. Returns formatted XXX-XXX-XXXX. */
const phonesFrom = (...cells) => {
  const text = cells.filter(Boolean).join(" / ");
  const out = [];
  const matches = text.match(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || [];
  for (const m of matches) {
    const d = m.replace(/\D/g, "").slice(-10);
    if (d.length === 10) { const f = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; if (!out.includes(f)) out.push(f); }
  }
  return out;
};
const CAT = (t) => {
  const x = norm(t);
  if (x.includes("body") || x.includes("collision") || x.includes("autorepair") || x.includes("totalloss") || x.includes("auto")) return "body_shop";
  if (x.includes("chiro")) return "chiropractor";
  if (x.includes("imaging")) return "imaging_center";
  if (x.includes("physicaltherap")) return "physical_therapist";
  if (x.includes("urgent") || x.includes("eruc") || x.includes("medical") || x.includes("pain")) return "medical_clinic";
  return "other";
};

const book = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[2]);
  if (!name) continue;
  const ph = phonesFrom(r[6], r[8], r[9]);
  book.push({
    agent: clean(r[0]), type: clean(r[1]), name, contact: clean(r[3]).slice(0, 250),
    address: clean(r[4]), city: clean(r[5]).slice(0, 100),
    phone: ph[0] ?? null, phone2: ph[1] ?? null, phone3: ph[2] ?? null, email: clean(r[10]).slice(0, 300),
  });
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT * FROM facilities");
const byName = new Map();
for (const f of facs) { const k = norm(f.name); if (k && !byName.has(k)) byName.set(k, f); }

const backup = { updated: [], imported: [], excelDupNames: [] };
const seen = new Set();
for (const b of book) {
  const k = norm(b.name);
  if (seen.has(k)) { backup.excelDupNames.push(b.name); continue; }  // duplicate name within Excel — sync once
  seen.add(k);
  const f = byName.get(k);
  const cat = CAT(b.type);
  if (f) {
    backup.updated.push({ id: f.id, before: { name: f.name, phone: f.phone, phone2: f.phone2, phone3: f.phone3, category: f.category, city: f.city, address: f.address } });
    await c.query(
      "UPDATE facilities SET name=?, phone=?, phone2=?, phone3=?, category=?, city=COALESCE(NULLIF(?,''),city), address=COALESCE(NULLIF(?,''),address), contactName=COALESCE(NULLIF(?,''),contactName), contactEmail=COALESCE(NULLIF(?,''),contactEmail) WHERE id=?",
      [b.name, b.phone || null, b.phone2 || null, b.phone3 || null, cat, b.city, b.address, b.contact, b.email, f.id],
    );
  } else {
    backup.imported.push({ name: b.name, phone: b.phone, agent: b.agent });
    await c.query(
      `INSERT INTO facilities (name, category, partnerStatus, relationshipStatus, phone, phone2, phone3, contactName, contactEmail, address, city, assignedRepName, notes)
       VALUES (?,?, 'active_partner','active_partner', ?,?,?,?,?,?,?,?, 'Synced from Excel Active partners')`,
      [b.name, cat, b.phone || null, b.phone2 || null, b.phone3 || null, b.contact || null, b.email || null, b.address || null, b.city || null, b.agent || null],
    );
  }
}

fs.writeFileSync("scripts/migration/sync-excel-to-crm-backup.json", JSON.stringify(backup, null, 2));
console.log(`Excel rows: ${book.length}`);
console.log(`  facilities updated (name+phones+details from Excel): ${backup.updated.length}`);
console.log(`  new facilities imported (not previously in CRM): ${backup.imported.length}`);
console.log(`  Excel duplicate-name rows synced once: ${backup.excelDupNames.length}`);
const [[n]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`Facilities total now: ${n.n}. Backup: scripts/migration/sync-excel-to-crm-backup.json`);
// spot check
for (const id of [451296, 451008, 451343]) {
  const [[r]] = await c.query("SELECT name, phone, category, city FROM facilities WHERE id=?", [id]);
  if (r) console.log(`  #${id} → "${r.name}" · ${r.phone} · ${r.category} · ${r.city}`);
}
await c.end();
