/**
 * Corrected, strict re-analysis of CRM vs Filevine after adversarial review:
 *   1) EXACT normalized-name match only (no fuzzy substring) → honest confirmed count
 *   2) Agent mismatch recomputed on exact matches only
 *   3) The 8 phone-conflicts: compare the CRM's STORED address vs the Filevine
 *      row's address (street number + city) to see if they're the SAME location
 *      (i.e. the CRM name is genuinely wrong) — the reviewers' key claim.
 * Read-only.  Run: node scripts/migration/verify-vs-filevine-strict.mjs
 */
import "dotenv/config";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const fn = (s) => clean(s).toLowerCase().replace(/@.*/, "").split(/\s+/)[0] || "";
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityOf = (a) => { const m = String(a ?? "").match(/,\s*([A-Za-z .]+?),?\s*(CA|California)?\s*\d{5}/); return m ? clean(m[1]).toLowerCase() : ""; };

const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" });
const fv = [];
for (const r of rows.slice(1)) { const name = clean(r[4]); if (!name) continue; fv.push({ name, agent: clean(r[2]), addr: clean(r[5]), phones: [r[7], r[8], r[9]].map(last10).filter(Boolean), key: norm(name) }); }
const fvByNameExact = new Map();
for (const f of fv) if (!fvByNameExact.has(f.key)) fvByNameExact.set(f.key, f);
const fvByPhone = new Map();
for (const f of fv) for (const p of f.phones) if (!fvByPhone.has(p)) fvByPhone.set(p, f);

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, address, city, assignedRepName FROM facilities");

let exact = 0, agentMismatchExact = 0;
const justinExact = [];
for (const f of facs) {
  const hit = fvByNameExact.get(norm(f.name));
  if (!hit) continue;
  exact++;
  if (fn(f.assignedRepName) && fn(f.assignedRepName) !== fn(hit.agent)) {
    agentMismatchExact++;
    if (fn(hit.agent) === "justin") justinExact.push(f.id);
  }
}
console.log(`CRM facilities: ${facs.length}`);
console.log(`EXACT name matches in Filevine: ${exact}  (vs 489 fuzzy reported earlier)`);
console.log(`Agent mismatch on EXACT matches: ${agentMismatchExact}  (vs 356)`);
console.log(`  of those, Filevine agent = Justin: ${justinExact.length}  (vs 113)`);

// ── The 8 phone-conflicts: address comparison ──
console.log(`\n── 8 phone-conflicts: CRM stored address vs Filevine address (same location?) ──`);
const ids = [450869, 450896, 450958, 451065, 451108, 451772, 451822, 451842];
let sameLoc = 0;
for (const id of ids) {
  const f = facs.find((x) => x.id === id); if (!f) continue;
  const ps = [f.phone, f.phone2, f.phone3].map(last10).filter(Boolean);
  let hit = null; for (const p of ps) if (fvByPhone.has(p)) { hit = fvByPhone.get(p); break; }
  const crmNum = stnum(f.address), fvNum = stnum(hit?.addr);
  const crmCity = (clean(f.city).toLowerCase() || cityOf(f.address));
  const fvCity = cityOf(hit?.addr);
  const same = !!crmNum && crmNum === fvNum && !!crmCity && !!fvCity && (crmCity.includes(fvCity) || fvCity.includes(crmCity));
  if (same) sameLoc++;
  console.log(`#${id} ${same ? "SAME LOCATION → CRM name likely wrong" : "different/unclear"}`);
  console.log(`    CRM "${f.name}"  @ ${f.address || "(no addr)"} | city=${f.city || "?"}`);
  console.log(`    FV  "${hit?.name ?? "(no phone match)"}"  @ ${hit?.addr ?? "-"}`);
}
console.log(`\nSame-location (CRM name wrong, Filevine right): ${sameLoc}/8`);
await c.end();
