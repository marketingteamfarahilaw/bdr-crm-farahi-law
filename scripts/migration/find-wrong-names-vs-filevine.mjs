/**
 * Finds CRM facilities whose NAME disagrees with the Filevine record at the SAME
 * location (same street#+city, or same phone). Filevine is the source of truth
 * and its columns are aligned, so a name mismatch at a confirmed-same location =
 * a wrong CRM name. Focuses on the original (pre-import) facilities. Read-only —
 * writes find-wrong-names-vs-filevine-report.json for review / Google check.
 *
 * Run: node scripts/migration/find-wrong-names-vs-filevine.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityOf = (a) => { const m = String(a ?? "").match(/,?\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? norm(m[1]) : ""; };
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y)); };

const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fvByPhone = new Map(); const fvByAddr = new Map();
for (const r of rows) {
  const name = clean(r[4]); if (!name) continue;
  for (const p of [r[7], r[8], r[9]].map(last10).filter(Boolean)) if (!fvByPhone.has(p)) fvByPhone.set(p, name);
  const addr = clean(r[5]); const key = stnum(addr) + "|" + cityOf(addr);
  if (stnum(addr) && cityOf(addr)) { if (!fvByAddr.has(key)) fvByAddr.set(key, new Set()); fvByAddr.get(key).add(name); }
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, address, city, assignedRepName, notes FROM facilities WHERE notes IS NULL OR notes NOT LIKE 'Imported from Filevine%'");
await c.end();

const candidates = [];
for (const f of facs) {
  const crmKey = norm(f.name);
  // address match (strongest)
  const aKey = stnum(f.address) + "|" + (norm(f.city) || cityOf(f.address));
  let fvName = null, by = null;
  if (stnum(f.address) && (norm(f.city) || cityOf(f.address)) && fvByAddr.has(aKey)) {
    const names = [...fvByAddr.get(aKey)];
    const distinct = names.filter((n) => !nameish(n, f.name));
    if (distinct.length === 1) { fvName = distinct[0]; by = "address"; }
    else if (names.length === 1 && !nameish(names[0], f.name)) { fvName = names[0]; by = "address"; }
  }
  // phone match (secondary)
  if (!fvName) {
    for (const p of [f.phone, f.phone2, f.phone3].map(last10).filter(Boolean)) {
      const n = fvByPhone.get(p);
      if (n && !nameish(n, f.name)) { fvName = n; by = "phone"; break; }
    }
  }
  if (fvName) candidates.push({ id: f.id, crmName: f.name, fvName, by, address: f.address, city: f.city, phone: f.phone, agent: f.assignedRepName });
}

candidates.sort((a, b) => (a.by === "address" ? 0 : 1) - (b.by === "address" ? 0 : 1));
console.log(`Original CRM facilities checked: ${facs.length}`);
console.log(`Name disagrees with Filevine at same location: ${candidates.length}`);
console.log(`  by address: ${candidates.filter((x) => x.by === "address").length} | by phone: ${candidates.filter((x) => x.by === "phone").length}\n`);
for (const x of candidates.slice(0, 50)) console.log(`  #${x.id} [${x.by}] "${x.crmName}"  →  "${x.fvName}"   (${x.address || "?"})`);
fs.writeFileSync("scripts/migration/find-wrong-names-vs-filevine-report.json", JSON.stringify(candidates, null, 2));
console.log(`\nFull list → scripts/migration/find-wrong-names-vs-filevine-report.json`);
