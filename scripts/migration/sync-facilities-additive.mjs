/**
 * Bring facilities in line with the master workbook WITHOUT destroying anything.
 *
 * import-facilities.mjs wipes the facilities table and every child table
 * (contact_logs included) before reloading — fine for a first import, ruinous
 * once the CRM holds live call history. This one only:
 *   · INSERTs facilities present in the workbook but missing from the database
 *   · fills BLANK fields on existing rows (never overwrites edits made in the app)
 *   · promotes a facility to active_partner when the workbook says it is one
 * Nothing is deleted or renamed. Facilities that exist only in the database are
 * reported, never removed.
 *
 *   node scripts/migration/sync-facilities-additive.mjs "<workbook.xlsx>"
 *   node scripts/migration/sync-facilities-additive.mjs "<workbook.xlsx>" --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = process.argv.find((a) => a.toLowerCase().endsWith(".xlsx"));
const APPLY = process.argv.includes("--apply");
if (!FILE) { console.error("Usage: node sync-facilities-additive.mjs <workbook.xlsx> [--apply]"); process.exit(1); }

const ACTIVE = new Set(["Active partners", "Active Chiropractor"]);
const SHEETS = ["Active partners", "Active Chiropractor", "1.Fcilty Typ", "Raw Data for Pivot", "act old list",
  "BDR Independent Facility", "Chiropractor", "Body Shop September", "BS Total Loss Support",
  "Non FR Chiro", "Imaging Center", "Physical Therapy", "ERUC", "Pain Management", "Towing Company",
  "Medical Center", "Insurance Company", "Opthalmologist", "Pharmacy", "Neurologist", "Surgeon"];

// A broken formula in the sheet exports as "#REF!", "#N/A" and so on. Read it as
// blank — otherwise a row of them becomes a facility called "#REF!".
const SHEET_ERROR = /^#(REF!|N\/A|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!|ERROR!?|SPILL!|CALC!)$/i;
const norm = (s) => { const v = String(s ?? "").trim(); return SHEET_ERROR.test(v) ? "" : v; };
const low = (s) => norm(s).toLowerCase();
const digits = (s) => norm(s).replace(/\D/g, "");
const p10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ""; };
const nameKey = (s) => low(s).replace(/[^a-z0-9]/g, "");
const cleanAgent = (s) => { let a = norm(s).replace(/^(fr|bdr)\s+/i, "").trim(); if (/#ref|#n\/a|^n\/a$|^x$/i.test(a)) a = ""; return a; };
const clamp = (s, n) => (norm(s) === "" ? null : norm(s).replace(/[\r\n\t]+/g, " ").slice(0, n));
const text = (s) => (norm(s) === "" ? null : String(s).slice(0, 4000));

function mapCategory(type, sheet) {
  const t = low(type) + " " + low(sheet);
  if (/body\s*shop|collision|auto\s*body|total loss|auto repair/.test(t)) return "body_shop";
  if (/chiro/.test(t)) return "chiropractor";
  if (/physical\s*therap|\bpt\b/.test(t)) return "physical_therapist";
  if (/imaging|\bmri\b|x-?ray|radiolog/.test(t)) return "imaging_center";
  if (/ortho|surgeon/.test(t)) return "orthopedic_doctor";
  if (/medical|clinic|pain|eruc|urgent\s*care|neuro|opthal|ophthal|pharmac/.test(t)) return "medical_clinic";
  return "other";
}

function mapHeader(row) {
  const idx = {};
  row.forEach((cell, i) => {
    const c = low(cell);
    if (!c) return;
    if (idx.name === undefined && /(name of (the )?facilit|company name|^facility$|^faclity$|^name$|name of facility)/.test(c)) idx.name = i;
    if (idx.contact === undefined && /(contact person|contact name|^doctor$)/.test(c)) idx.contact = i;
    if (idx.address === undefined && /address/.test(c)) idx.address = i;
    if (idx.city === undefined && /^city$/.test(c)) idx.city = i;
    if (idx.cleanPhone === undefined && /clean phone/.test(c)) idx.cleanPhone = i;
    if (idx.phone === undefined && /(^phone$|phone number|^phone\b)/.test(c) && !/clean|2|3/.test(c)) idx.phone = i;
    if (idx.phone2 === undefined && /phone\s*2/.test(c)) idx.phone2 = i;
    if (idx.phone3 === undefined && /phone\s*3/.test(c)) idx.phone3 = i;
    if (idx.email === undefined && /email/.test(c)) idx.email = i;
    if (idx.notes === undefined && /^notes$/.test(c)) idx.notes = i;
    if (idx.type === undefined && /(^type$|type of (facilit|provider))/.test(c)) idx.type = i;
    if (idx.agent === undefined && /(^owner$|fr owner|^agent$|^bdr$|^field rep$|^agent\b)/.test(c)) idx.agent = i;
  });
  return idx;
}

const wb = xlsx.readFile(FILE);
const byKey = new Map();
for (const sheet of SHEETS) {
  const ws = wb.Sheets[sheet];
  if (!ws) continue;
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  let hi = -1, idx = null;
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const m = mapHeader(rows[r]);
    if (m.name === undefined && m.contact !== undefined && m.contact >= 1 && m.contact - 1 !== m.type) m.name = m.contact - 1;
    if (m.name !== undefined && (m.phone !== undefined || m.cleanPhone !== undefined)) { hi = r; idx = m; break; }
  }
  if (hi < 0) continue;
  const status = ACTIVE.has(sheet) ? "active_partner" : "prospect";
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = norm(row[idx.name]);
    if (!name || /^total$|^leads$|^partner$|^unassigned/i.test(name)) continue;
    const phone = norm(row[idx.cleanPhone] ?? "") || norm(row[idx.phone] ?? "");
    const key = nameKey(name) + "|" + (p10(phone) || "");
    const rec = {
      name, phone,
      category: mapCategory(idx.type !== undefined ? row[idx.type] : "", sheet),
      contactName: idx.contact !== undefined ? norm(row[idx.contact]) : "",
      address: idx.address !== undefined ? norm(row[idx.address]) : "",
      city: idx.city !== undefined ? norm(row[idx.city]) : "",
      phone2: idx.phone2 !== undefined ? norm(row[idx.phone2]) : "",
      phone3: idx.phone3 !== undefined ? norm(row[idx.phone3]) : "",
      contactEmail: idx.email !== undefined ? norm(row[idx.email]) : "",
      notes: idx.notes !== undefined ? norm(row[idx.notes]) : "",
      assignedRepName: idx.agent !== undefined ? cleanAgent(row[idx.agent]) : "",
      status,
    };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, rec); continue; }
    if (rec.status === "active_partner") prev.status = "active_partner";
    for (const f of ["contactName", "address", "city", "phone", "phone2", "phone3", "contactEmail", "notes"]) {
      if ((!prev[f] || prev[f].length < rec[f].length) && rec[f]) prev[f] = rec[f];
    }
    if (!prev.assignedRepName && rec.assignedRepName) prev.assignedRepName = rec.assignedRepName;
    if (prev.category === "other" && rec.category !== "other") prev.category = rec.category;
  }
}
const wanted = [...byKey.values()];

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [existing] = await c.query("SELECT * FROM facilities");
const byPhone = new Map(), byName = new Map();
for (const f of existing) {
  for (const p of [f.phone, f.phone2, f.phone3]) { const d = p10(p); if (d && !byPhone.has(d)) byPhone.set(d, f); }
  const k = nameKey(f.name); if (k && !byName.has(k)) byName.set(k, f);
}
const findExisting = (rec) => byPhone.get(p10(rec.phone)) ?? byName.get(nameKey(rec.name)) ?? null;

const FILL = ["address", "city", "phone", "phone2", "phone3", "contactName", "contactEmail", "notes", "assignedRepName"];
let toInsert = 0, toFill = 0, toPromote = 0;
const seen = new Set();
for (const rec of wanted) {
  const cur = findExisting(rec);
  if (!cur) {
    toInsert++;
    if (toInsert <= 10) console.log(`  + ${rec.name}  (${rec.city || "no city"}, ${rec.phone || "no phone"}, ${rec.assignedRepName || "unassigned"})`);
    if (APPLY) {
      await c.query(
        `INSERT INTO facilities (name, category, address, city, phone, phone2, phone3, contactName, contactEmail, partnerStatus, relationshipStatus, assignedRepName, notes, territory, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,'warm_lead',?,?,?,NOW(),NOW())`,
        [clamp(rec.name, 255), clamp(rec.category, 100), text(rec.address), clamp(rec.city, 255), clamp(rec.phone, 50),
         clamp(rec.phone2, 50), clamp(rec.phone3, 50), clamp(rec.contactName, 255), clamp(rec.contactEmail, 320),
         rec.status, clamp(rec.assignedRepName, 255), text(rec.notes), clamp(rec.city, 255)]
      );
    }
    continue;
  }
  seen.add(cur.id);
  const sets = [], vals = [];
  for (const col of FILL) {
    if ((cur[col] == null || cur[col] === "") && rec[col]) {
      sets.push(`\`${col}\`=?`);
      vals.push(col === "notes" || col === "address" ? text(rec[col]) : clamp(rec[col], col === "contactEmail" ? 320 : 255));
    }
  }
  if (sets.length) { toFill++; if (APPLY) await c.query(`UPDATE facilities SET ${sets.join(", ")}, updatedAt=NOW() WHERE id=?`, [...vals, cur.id]); }
  if (rec.status === "active_partner" && cur.partnerStatus !== "active_partner") {
    toPromote++;
    if (APPLY) await c.query("UPDATE facilities SET partnerStatus='active_partner', updatedAt=NOW() WHERE id=?", [cur.id]);
  }
}

const dbOnly = existing.filter((f) => !seen.has(f.id));
console.log(`\nWorkbook: ${wanted.length} facilities | database before: ${existing.length}`);
console.log(`  to insert (missing from DB): ${toInsert}`);
console.log(`  existing rows with blanks to fill: ${toFill}`);
console.log(`  to promote to active partner: ${toPromote}`);
console.log(`  in DB but not in this workbook (left untouched): ${dbOnly.length}`);
if (APPLY) {
  const [[after]] = await c.query("SELECT COUNT(*) n FROM facilities");
  console.log(`\n✅ facilities now: ${after.n}`);
} else {
  console.log("\n[DRY RUN] re-run with --apply to write.");
}
await c.end();
