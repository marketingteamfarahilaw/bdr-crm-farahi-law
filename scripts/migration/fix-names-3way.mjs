/**
 * Fixes genuinely-wrong facility names with high confidence.
 * A facility is a "suspect" if its current name does NOT appear anywhere in the
 * Excel "Active partners" sheet. For each suspect, look up its phone in BOTH:
 *   - the Excel (phone → name), and
 *   - Google Places (phone → business name).
 * If BOTH agree on a name (and it differs from the current), rename to it —
 * two independent sources agreeing is safe. Everything else goes to a report
 * (fix-names-3way-report) for a human to decide. Renames are backed up.
 *
 * Run: node scripts/migration/fix-names-3way.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const nameish = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y))); };
const infer = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (/(chiropract|chiro\b|\bspine\b|spinal|\bdc\b|wellness|injury)/.test(n)) return "chiropractor";
  if (/(collision|body shop|auto body|autobody|auto repair|auto care|auto service|automotive|\bpaint\b|motorsport|\bdent\b|autopro)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|recovery)/.test(n)) return "other";
  if (/(imaging|radiolog|\bmri\b)/.test(n)) return "imaging_center";
  if (/(urgent care|medical center|medical group|pain manage)/.test(n)) return "medical_clinic";
  if (/(\binsurance\b|pharmacy|tax service)/.test(n)) return "other";
  return null;
};
const gLookup = async (p10) => {
  if (!KEY) return null;
  try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent("+1" + p10)}&inputtype=phonenumber&fields=name&key=${KEY}`); const j = await r.json(); return (j.candidates || [])[0]?.name ?? null; } catch { return null; }
};

// Excel maps
const rows = xlsx.utils.sheet_to_json(xlsx.readFile("C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (6).xlsx").Sheets["Active partners"], { header: 1, defval: "" });
const exByPhone = new Map(); const exNames = new Set();
for (let i = 2; i < rows.length; i++) { const r = rows[i]; const nm = clean(r[2]); if (!nm) continue; exNames.add(norm(nm)); const p = last10(r[6]) || last10(r[7]); if (p && !exByPhone.has(p)) exByPhone.set(p, nm); }

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, category, assignedRepName FROM facilities");
const suspects = facs.filter((f) => last10(f.phone) && !exNames.has(norm(f.name)));
console.log(`Suspect facilities (name not in Excel): ${suspects.length}. Cross-checking Excel + Google by phone…`);

const backup = []; const report = [];
const CONC = 8;
for (let i = 0; i < suspects.length; i += CONC) {
  const batch = suspects.slice(i, i + CONC);
  await Promise.all(batch.map(async (f) => {
    const p = last10(f.phone);
    const ex = exByPhone.get(p) ?? null;
    const go = await gLookup(p);
    if (ex && go && nameish(ex, go) && !nameish(ex, f.name)) {
      backup.push({ id: f.id, oldName: f.name, oldCategory: f.category, newName: ex });
      const cat = infer(ex) ?? f.category;
      await c.query("UPDATE facilities SET name=?, category=? WHERE id=?", [ex, cat, f.id]);
    } else {
      report.push({ id: f.id, agent: f.assignedRepName, crmName: f.name, excelForPhone: ex, googleForPhone: go });
    }
  }));
  process.stdout.write(`\r  ${Math.min(i + CONC, suspects.length)}/${suspects.length}`);
}
console.log("");
fs.writeFileSync("scripts/migration/fix-names-3way-backup.json", JSON.stringify(backup, null, 2));
fs.writeFileSync("scripts/migration/fix-names-3way-report.json", JSON.stringify(report, null, 2));
console.log(`\nAUTO-FIXED (Excel + Google agreed): ${backup.length}`);
for (const b of backup.slice(0, 25)) console.log(`  #${b.id} "${b.oldName}" → "${b.newName}"`);
console.log(`\nNEEDS HUMAN REVIEW (sources disagree / no Google): ${report.length} → fix-names-3way-report.json`);
await c.end();
