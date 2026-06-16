/**
 * Fixes WRONG facility names using the Excel as source of truth, keyed by
 * ADDRESS (not phone — the phone column is scrambled, and not name — a wrong
 * name can't be found by name). For each CRM facility we find the Excel
 * "Active partners" row at the same address (street number + shared street-name
 * token + same city) and, if the Excel name differs, rename to the Excel name.
 *
 * DRY RUN by default — prints candidates only. Pass --apply to write (backed up).
 *
 * Run: node scripts/migration/fix-names-by-address.mjs            (dry run)
 *      node scripts/migration/fix-names-by-address.mjs --apply    (apply)
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const XLSX_PATH = "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (6).xlsx";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const STOP = new Set(["st","street","ave","avenue","blvd","boulevard","rd","road","dr","drive","ln","lane","way","ct","court","pl","place","hwy","highway","pkwy","parkway","ste","suite","unit","apt","fl","floor","n","s","e","w","north","south","east","west","the"]);
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const sttok = (a) => String(a ?? "").toLowerCase().split(/[,#]/)[0].replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter((w) => w && w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w));
const cityN = (s) => clean(s).toLowerCase().replace(/[^a-z]/g, "");
// names "the same" if normalized equal or one clearly contains the other
const sameName = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y))); };

// ── Excel Active partners → rows with name/address/city ──
const rows = xlsx.utils.sheet_to_json(xlsx.readFile(XLSX_PATH).Sheets["Active partners"], { header: 1, defval: "" });
const ex = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i]; const name = clean(r[2]); const addr = clean(r[4]); const city = clean(r[5]);
  if (!name || !addr) continue;
  ex.push({ name, addr, city, num: stnum(addr), toks: new Set(sttok(addr)), cityN: cityN(city) });
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, address, city, assignedRepName FROM facilities");

const candidates = []; const ambiguous = [];
for (const f of facs) {
  if (!f.address) continue;
  const num = stnum(f.address); if (!num) continue;
  const toks = sttok(f.address); const fcity = cityN(f.city);
  // Excel rows at the same street number with a shared street-name token
  const hits = ex.filter((e) => e.num === num && toks.some((t) => e.toks.has(t)));
  // Prefer same-city hits when we have a city on both sides
  const cityHits = fcity ? hits.filter((e) => e.cityN && e.cityN === fcity) : hits;
  const use = cityHits.length ? cityHits : hits;
  if (!use.length) continue;
  // Distinct Excel names among the address matches
  const names = [...new Set(use.map((e) => e.name))];
  const allSameAsCrm = names.every((n) => sameName(n, f.name));
  if (allSameAsCrm) continue;               // already correct
  if (names.length > 1) { ambiguous.push({ id: f.id, agent: f.assignedRepName, crmName: f.name, address: f.address, city: f.city, excelNames: names }); continue; }
  candidates.push({ id: f.id, agent: f.assignedRepName, crmName: f.name, newName: names[0], address: f.address, city: f.city, cityConfirmed: !!cityHits.length });
}

candidates.sort((a, b) => Number(b.cityConfirmed) - Number(a.cityConfirmed));
console.log(`Facilities: ${facs.length} | Excel rows w/ address: ${ex.length}`);
console.log(`RENAME candidates (address matches one Excel name that differs): ${candidates.length}`);
console.log(`  — city-confirmed: ${candidates.filter((x) => x.cityConfirmed).length}`);
console.log(`AMBIGUOUS (address matched >1 Excel name — skipped): ${ambiguous.length}\n`);
for (const x of candidates.slice(0, 40)) console.log(`  ${x.cityConfirmed ? "✓" : "?"} #${x.id} [${x.agent || "-"}]  "${x.crmName}"  →  "${x.newName}"   (${x.address}, ${x.city || "?"})`);

fs.writeFileSync("scripts/migration/fix-names-by-address-report.json", JSON.stringify({ candidates, ambiguous }, null, 2));
console.log(`\nFull report → scripts/migration/fix-names-by-address-report.json`);

if (APPLY) {
  const backup = [];
  // Only apply city-confirmed renames (strongest: same number + street + city).
  const toApply = candidates.filter((x) => x.cityConfirmed);
  for (const x of toApply) { backup.push({ id: x.id, oldName: x.crmName, newName: x.newName }); await c.query("UPDATE facilities SET name=? WHERE id=?", [x.newName, x.id]); }
  fs.writeFileSync("scripts/migration/fix-names-by-address-backup.json", JSON.stringify(backup, null, 2));
  console.log(`\nAPPLIED ${toApply.length} city-confirmed renames (backup → fix-names-by-address-backup.json).`);
  console.log(`Skipped ${candidates.length - toApply.length} non-city-confirmed (left in report for review).`);
} else {
  console.log(`\nDRY RUN — nothing changed. Re-run with --apply to write the city-confirmed renames.`);
}
await c.end();
