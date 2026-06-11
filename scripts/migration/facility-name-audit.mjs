/**
 * Audits CRM facility names against the team's Compiled Partners workbook
 * (Sheet2, "UPDATED 6/2/2026") by phone match. Report-only — no writes.
 */
import "dotenv/config";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FILE = "C:/Users/EOR - 4055/Downloads/FR _ BDR Compiled Partners.xlsx";
const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[wb.SheetNames[1]]; // Sheet2 = newest snapshot
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// header row 2 → data from row 3 (index 2)
const book = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const name = clean(r[2]);
  if (!name) continue;
  book.push({
    agent: clean(r[0]), type: clean(r[1]), name,
    contact: clean(r[3]), address: clean(r[4]), city: clean(r[5]),
    p1: last10(r[6]), p2: last10(r[8]), p3: last10(r[9]),
    email: clean(r[10]),
  });
}
console.log("Workbook rows:", book.length);

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, contactPhone, assignedRepName, category, city FROM facilities");
console.log("CRM facilities:", facs.length);

const crmByPhone = new Map();
for (const f of facs) {
  for (const p of [f.phone, f.phone2, f.phone3, f.contactPhone]) {
    const k = last10(p);
    if (k && !crmByPhone.has(k)) crmByPhone.set(k, f);
  }
}

const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
let same = 0, diff = 0, missing = 0;
const mismatches = [];
for (const b of book) {
  const hit = [b.p1, b.p2, b.p3].map((p) => p && crmByPhone.get(p)).find(Boolean);
  if (!hit) { missing++; continue; }
  if (norm(hit.name) === norm(b.name) || norm(hit.name).includes(norm(b.name)) || norm(b.name).includes(norm(hit.name))) same++;
  else { diff++; mismatches.push({ id: hit.id, crm: hit.name, excel: b.name, agent: b.agent, phone: b.p1 }); }
}
console.log(`\nMatched by phone: ${same + diff} | names AGREE: ${same} | names DIFFER: ${diff} | workbook rows not in CRM: ${missing}`);
console.log("\n--- sample mismatches (CRM name  ⇄  workbook name) ---");
for (const m of mismatches.slice(0, 30)) console.log(`#${m.id} "${m.crm}"  ⇄  "${m.excel}"  (${m.agent})`);
if (mismatches.length > 30) console.log(`… and ${mismatches.length - 30} more`);
await c.end();
