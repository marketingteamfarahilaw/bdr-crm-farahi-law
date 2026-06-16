/**
 * Reconciles CRM facility names against the newest team master —
 * "Centralized BDR_FR Reports (6).xlsx" → sheet "Active partners".
 *
 * Rule (conservative, phone-keyed):
 *  - A facility's PRIMARY phone is its reliable identity. If that phone matches
 *    an Active-partners row whose name differs from the CRM name, the CRM name
 *    is wrong → rename to the team's name (and fix category; fill agent/city/
 *    contact when the CRM has them blank).
 *  - If only a SECONDARY phone slot matches (primary phone not in the team
 *    directory), it's ambiguous (possible contamination) → FLAG, do NOT change.
 *  - Active-partners rows with no phone match anywhere AND no name match in the
 *    CRM → import as a new facility.
 *
 * Everything changed is backed up to fix-facility-names-v6-backup.json.
 * Run: node scripts/migration/fix-facility-names-v6.mjs
 */
import "dotenv/config";
import xlsx from "xlsx";
import fs from "fs";
import mysql from "mysql2/promise";

const FILE = "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (6).xlsx";
const wb = xlsx.readFile(FILE);
const rows = xlsx.utils.sheet_to_json(wb.Sheets["Active partners"], { header: 1, defval: "" });

const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const CAT = (t) => {
  const x = norm(t);
  if (x.includes("body") || x.includes("collision") || x.includes("autorepair") || x.includes("totalloss")) return "body_shop";
  if (x.includes("chiro")) return "chiropractor";
  if (x.includes("imaging")) return "imaging_center";
  if (x.includes("physicaltherap")) return "physical_therapist";
  if (x.includes("urgent") || x.includes("eruc") || x.includes("medical") || x.includes("pain")) return "medical_clinic";
  if (x.includes("tow")) return "other";
  return "other";
};

const book = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[2]);
  if (!name) continue;
  book.push({
    agent: clean(r[0]), type: clean(r[1]), name, contact: clean(r[3]),
    address: clean(r[4]), city: clean(r[5]), rawPhone: clean(r[6]),
    p1: last10(r[6]), p2: last10(r[8]), p3: last10(r[9]), email: clean(r[10]), notes: clean(r[11]),
  });
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, contactPhone, assignedRepName, category, city, contactName FROM facilities");

// CRM index: which facility owns a phone, and in which slot.
const slotOf = new Map();      // phone10 → { f, slot }
for (const f of facs) {
  for (const [slot, val] of [["phone", f.phone], ["phone2", f.phone2], ["phone3", f.phone3], ["contactPhone", f.contactPhone]]) {
    const k = last10(val);
    if (k && !slotOf.has(k)) slotOf.set(k, { f, slot });
  }
}
const crmByPrimary = new Map();
for (const f of facs) { const k = last10(f.phone); if (k && !crmByPrimary.has(k)) crmByPrimary.set(k, f); }
const crmNames = new Set(facs.map((f) => norm(f.name)));

const backup = { renamed: [], imported: [], flagged: [] };

for (const b of book) {
  // 1) PRIMARY-phone identity match → safe rename when name differs.
  const primaryHit = [b.p1, b.p2, b.p3].map((p) => p && crmByPrimary.get(p)).find(Boolean);
  if (primaryHit) {
    const agree = norm(primaryHit.name) === norm(b.name) || norm(primaryHit.name).includes(norm(b.name)) || norm(b.name).includes(norm(primaryHit.name));
    if (agree) continue;
    backup.renamed.push({ id: primaryHit.id, oldName: primaryHit.name, newName: b.name, oldCategory: primaryHit.category });
    await c.query(
      "UPDATE facilities SET name = ?, category = ?, city = COALESCE(NULLIF(city,''), ?), contactName = COALESCE(NULLIF(contactName,''), ?), assignedRepName = COALESCE(NULLIF(assignedRepName,''), ?) WHERE id = ?",
      [b.name, CAT(b.type), b.city || null, b.contact || null, b.agent || null, primaryHit.id],
    );
    continue;
  }

  // 2) Only a SECONDARY slot matches → ambiguous, flag (don't touch).
  const secHit = [b.p1, b.p2, b.p3].map((p) => p && slotOf.get(p)).find(Boolean);
  if (secHit) {
    backup.flagged.push({ id: secHit.f.id, crmName: secHit.f.name, teamName: b.name, matchedSlot: secHit.slot, agent: b.agent });
    continue;
  }

  // 3) No phone match anywhere — import only if the name isn't already present.
  if (!crmNames.has(norm(b.name))) {
    backup.imported.push({ name: b.name, agent: b.agent, phone: b.rawPhone });
    await c.query(
      `INSERT INTO facilities (name, category, partnerStatus, relationshipStatus, phone, contactName, address, city, assignedRepName, notes)
       VALUES (?, ?, 'active_partner', 'active_partner', ?, ?, ?, ?, ?, ?)`,
      [b.name, CAT(b.type), b.rawPhone || null, b.contact || null, b.address || null, b.city || null, b.agent || null,
       "From Centralized Reports (6) · Active partners"],
    );
    crmNames.add(norm(b.name));
  }
}

fs.writeFileSync("scripts/migration/fix-facility-names-v6-backup.json", JSON.stringify(backup, null, 2));
const [n] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`Renamed: ${backup.renamed.length} | imported: ${backup.imported.length} | FLAGGED for review (no change): ${backup.flagged.length}`);
console.log(`Facilities total: ${n[0].n}. Backup: scripts/migration/fix-facility-names-v6-backup.json`);
console.log("\n--- renamed ---");
for (const r of backup.renamed) console.log(`#${r.id} "${r.oldName}" → "${r.newName}"`);
console.log("\n--- flagged (primary phone not in team directory; left unchanged) ---");
for (const f of backup.flagged) console.log(`#${f.id} CRM "${f.crmName}" — team file shows "${f.teamName}" on its ${f.matchedSlot}`);
await c.end();
