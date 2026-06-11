/**
 * Reconciles CRM facilities with the team's Compiled Partners workbook
 * (Sheet2, "UPDATED 6/2/2026") — the current source of truth:
 *
 *  1. Phone matched on the CRM facility's PRIMARY number but the name differs
 *     → the CRM name is wrong: rename to the workbook name (fill agent/city/
 *       contact when empty).
 *  2. Phone matched only on a SECONDARY slot (phone2/phone3/contactPhone) and
 *     the name differs → that secondary number is contamination: remove it,
 *     and import the workbook facility as its own record.
 *  3. Workbook partner with no phone match anywhere → import as new facility.
 *
 * Everything changed/removed is backed up to fix-facility-names-backup.json.
 */
import "dotenv/config";
import xlsx from "xlsx";
import fs from "fs";
import mysql from "mysql2/promise";

const FILE = "C:/Users/EOR - 4055/Downloads/FR _ BDR Compiled Partners.xlsx";
const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[wb.SheetNames[1]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CAT = (t) => {
  const x = norm(t);
  if (x.includes("body") || x.includes("collision") || x.includes("totalloss")) return "body_shop";
  if (x.includes("chiro")) return "chiropractor";
  if (x.includes("imaging")) return "imaging_center";
  if (x.includes("urgent") || x.includes("eruc") || x.includes("medical")) return "medical_clinic";
  if (x.includes("pain")) return "medical_clinic";
  return "other";
};

const book = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[2]);
  if (!name) continue;
  book.push({
    agent: clean(r[0]), type: clean(r[1]), name,
    contact: clean(r[3]), address: clean(r[4]), city: clean(r[5]),
    rawPhone: clean(r[6]), p1: last10(r[6]), p2: last10(r[8]), p3: last10(r[9]),
    email: clean(r[10]), notes: clean(r[11]),
  });
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, contactPhone, assignedRepName, category, city, contactName FROM facilities");

const slotIndex = new Map(); // phone10 → { f, slot }
for (const f of facs) {
  const slots = [["phone", f.phone], ["phone2", f.phone2], ["phone3", f.phone3], ["contactPhone", f.contactPhone]];
  for (const [slot, val] of slots) {
    const k = last10(val);
    if (k && !slotIndex.has(k)) slotIndex.set(k, { f, slot });
  }
}

const backup = { renamed: [], strippedPhones: [], imported: [] };
const claimed = new Set();
let renamed = 0, stripped = 0, imported = 0, agreed = 0;

for (const b of book) {
  const hit = [b.p1, b.p2, b.p3].map((p) => p && slotIndex.get(p)).find(Boolean);

  if (hit && !claimed.has(hit.f.id)) {
    const namesAgree = norm(hit.f.name) === norm(b.name) || norm(hit.f.name).includes(norm(b.name)) || norm(b.name).includes(norm(hit.f.name));
    if (namesAgree) { agreed++; claimed.add(hit.f.id); continue; }

    if (hit.slot === "phone") {
      // primary phone is this business — the CRM name is wrong
      backup.renamed.push({ id: hit.f.id, oldName: hit.f.name, newName: b.name });
      await c.query(
        "UPDATE facilities SET name = ?, category = ?, city = COALESCE(NULLIF(city,''), ?), contactName = COALESCE(NULLIF(contactName,''), ?), assignedRepName = COALESCE(NULLIF(assignedRepName,''), ?) WHERE id = ?",
        [b.name, CAT(b.type), b.city || null, b.contact || null, b.agent || null, hit.f.id],
      );
      renamed++; claimed.add(hit.f.id);
      continue;
    }
    // secondary slot → contamination: strip the number, then import below
    backup.strippedPhones.push({ id: hit.f.id, facility: hit.f.name, slot: hit.slot, phone: hit.f[hit.slot] });
    await c.query(`UPDATE facilities SET ${hit.slot} = NULL WHERE id = ?`, [hit.f.id]);
    stripped++;
  } else if (hit) {
    // CRM facility already claimed by an earlier workbook row sharing the phone — import this one separately
  }

  // import as a new facility
  backup.imported.push({ name: b.name, agent: b.agent, phone: b.rawPhone });
  await c.query(
    `INSERT INTO facilities (name, category, partnerStatus, relationshipStatus, phone, contactName, address, city, assignedRepName, notes)
     VALUES (?, ?, 'active_partner', 'active_partner', ?, ?, ?, ?, ?, ?)`,
    [b.name, CAT(b.type), b.rawPhone || null, b.contact || null, b.address || null, b.city || null, b.agent || null,
     b.notes ? `From Compiled Partners 6/2: ${b.notes}` : "From Compiled Partners 6/2"],
  );
  imported++;
}

fs.writeFileSync("scripts/migration/fix-facility-names-backup.json", JSON.stringify(backup, null, 2));
const [n] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`Names agreed: ${agreed} | renamed: ${renamed} | contaminated phones stripped: ${stripped} | new partners imported: ${imported}`);
console.log(`Facilities total now: ${n[0].n}. Backup: scripts/migration/fix-facility-names-backup.json`);
await c.end();
