// Import real facilities from the Centralized BDR/FR Reports workbook.
// Header-aware: finds each sheet's header row and maps columns by keyword, so it
// tolerates the different layouts. Dedupes by name+phone (active wins).
//   node scripts/migration/import-facilities.mjs --dry   (parse + report only)
//   node scripts/migration/import-facilities.mjs          (wipe + import)
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (3).xlsx";
const dry = process.argv.includes("--dry");
const wb = xlsx.readFile(FILE);

// sheet -> default status. Active lists = active_partner; everything else prospect.
const ACTIVE = new Set(["Active partners", "Active Chiropractor"]);
const SHEETS = [
  "Active partners", "Active Chiropractor", "1.Fcilty Typ", "Raw Data for Pivot", "act old list",
  "BDR Independent Facility", "Chiropractor", "Body Shop September", "BS Total Loss Support",
  "Non FR Chiro", "Imaging Center", "Physical Therapy", "ERUC", "Pain Management", "Towing Company",
  "Medical Center", "Insurance Company", "Opthalmologist", "Pharmacy", "Neurologist", "Surgeon",
];

const norm = (s) => String(s ?? "").trim();
const low = (s) => norm(s).toLowerCase();
const digits = (s) => norm(s).replace(/\D/g, "");
const nameKey = (s) => low(s).replace(/[^a-z0-9]/g, "");
const cleanAgent = (s) => { let a = norm(s).replace(/^(fr|bdr)\s+/i, "").trim(); if (/#ref|#n\/a|^n\/a$|^x$/i.test(a)) a = ""; return a; };

function mapCategory(type, sheet) {
  const t = low(type) + " " + low(sheet);
  if (/body\s*shop|collision|auto\s*body|total loss|auto repair/.test(t)) return "body_shop";
  if (/chiro/.test(t)) return "chiropractor";
  if (/physical\s*therap|\bpt\b/.test(t)) return "physical_therapist";
  if (/imaging|\bmri\b|x-?ray|radiolog/.test(t)) return "imaging_center";
  if (/surgeon|orthop|neuro/.test(t)) return "orthopedic_doctor";
  if (/medical|clinic|urgent|eruc|pain|wellness|pharmacy|ophthal|opthal/.test(t)) return "medical_clinic";
  return "other"; // towing, insurance, etc.
}

// build a column index map from a header row
function mapHeader(h) {
  const idx = {};
  h.forEach((cell, i) => {
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
    if (idx.specialty === undefined && /special/.test(c)) idx.specialty = i;
  });
  return idx;
}

const byKey = new Map();
let parsed = 0;
for (const sheet of SHEETS) {
  const ws = wb.Sheets[sheet];
  if (!ws) { console.warn("missing sheet:", sheet); continue; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // find header row: has a name-ish col AND a phone-ish col
  let hi = -1, idx = null;
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const m = mapHeader(rows[r]);
    // Fallback: many type sheets have an unlabeled name column right before "Contact Person".
    if (m.name === undefined && m.contact !== undefined && m.contact >= 1 && m.contact - 1 !== m.type) m.name = m.contact - 1;
    if (m.name !== undefined && (m.phone !== undefined || m.cleanPhone !== undefined)) { hi = r; idx = m; break; }
  }
  if (hi < 0) { console.warn("no header found:", sheet); continue; }
  const status = ACTIVE.has(sheet) ? "active_partner" : "prospect";
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = norm(row[idx.name]);
    if (!name || /^total$|^leads$|^partner$|^unassigned/i.test(name)) continue;
    const phone = norm(row[idx.cleanPhone] ?? "") || norm(row[idx.phone] ?? "");
    const key = nameKey(name) + "|" + (digits(phone).slice(-10) || "");
    const rec = {
      name,
      category: mapCategory(idx.type !== undefined ? row[idx.type] : "", sheet),
      contactName: idx.contact !== undefined ? norm(row[idx.contact]) : "",
      address: idx.address !== undefined ? norm(row[idx.address]) : "",
      city: idx.city !== undefined ? norm(row[idx.city]) : "",
      phone: phone,
      phone2: idx.phone2 !== undefined ? norm(row[idx.phone2]) : "",
      phone3: idx.phone3 !== undefined ? norm(row[idx.phone3]) : "",
      contactEmail: idx.email !== undefined ? norm(row[idx.email]) : "",
      notes: idx.notes !== undefined ? norm(row[idx.notes]) : "",
      assignedRepName: idx.agent !== undefined ? cleanAgent(row[idx.agent]) : "",
      status,
      _sheet: sheet,
    };
    parsed++;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, rec); continue; }
    // merge: active wins for status; fill blanks; keep longer values
    if (rec.status === "active_partner") existing.status = "active_partner";
    for (const f of ["contactName", "address", "city", "phone", "phone2", "phone3", "contactEmail", "notes"]) {
      if ((!existing[f] || existing[f].length < rec[f].length) && rec[f]) existing[f] = rec[f];
    }
    if (!existing.assignedRepName && rec.assignedRepName) existing.assignedRepName = rec.assignedRepName; // first (Active partners) wins
    if (existing.category === "other" && rec.category !== "other") existing.category = rec.category;
  }
}

const facilities = [...byKey.values()];
const byCat = {}, byStat = {}, byAgent = {};
for (const f of facilities) {
  byCat[f.category] = (byCat[f.category] || 0) + 1;
  byStat[f.status] = (byStat[f.status] || 0) + 1;
  if (f.assignedRepName) byAgent[f.assignedRepName] = (byAgent[f.assignedRepName] || 0) + 1;
}
console.log(`Parsed ${parsed} rows → ${facilities.length} unique facilities`);
console.log("By status:", byStat);
console.log("By category:", byCat);
console.log("By agent (top):", Object.entries(byAgent).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join("  "));
console.log("Samples:");
for (const f of facilities.slice(0, 4)) console.log("  ", JSON.stringify({ name: f.name, category: f.category, city: f.city, phone: f.phone, contact: f.contactName, agent: f.assignedRepName, status: f.status }));

if (dry) { console.log("\n[DRY RUN] nothing written."); process.exit(0); }

// ---- apply: wipe facilities + their children, then insert ----
const c = await mysql.createConnection(process.env.DATABASE_URL);
const childTables = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads", "facility_leads_sent", "facility_gratitude"];
for (const t of childTables) { try { const [r] = await c.query(`DELETE FROM \`${t}\``); console.log(`cleared ${t}: ${r.affectedRows}`); } catch (e) { console.warn(t, e.message); } }
const [df] = await c.query("DELETE FROM facilities");
console.log(`cleared facilities: ${df.affectedRows}`);

// map agent first names to existing users for assignedRepId
const [users] = await c.query("SELECT id, name FROM users");
const userByFirst = new Map();
for (const u of users) { const fn = low(u.name).split(" ")[0]; if (fn) userByFirst.set(fn, u.id); }
const repId = (name) => userByFirst.get(low(name).split(" ")[0]) ?? null;

const clamp = (s, n) => (s == null || s === "" ? null : String(s).replace(/[\r\n\t]+/g, " ").trim().slice(0, n) || null);
const text = (s) => (s == null || s === "" ? null : String(s).slice(0, 4000));
let inserted = 0, failed = 0;
for (const f of facilities) {
  try {
    await c.query(
      `INSERT INTO facilities (name, category, address, city, phone, phone2, phone3, contactName, contactEmail, partnerStatus, relationshipStatus, assignedRepId, assignedRepName, notes, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [clamp(f.name, 255), clamp(f.category, 100), text(f.address), clamp(f.city, 255), clamp(f.phone, 50), clamp(f.phone2, 50), clamp(f.phone3, 50),
       clamp(f.contactName, 255), clamp(f.contactEmail, 320), f.status, "warm_lead", repId(f.assignedRepName), clamp(f.assignedRepName, 255), text(f.notes)]
    );
    inserted++;
  } catch (e) { failed++; if (failed <= 6) console.warn("insert failed:", String(f.name).slice(0, 40), "-", e.message); }
}
console.log(`✅ Inserted ${inserted} facilities (${failed} failed).`);
await c.end();
