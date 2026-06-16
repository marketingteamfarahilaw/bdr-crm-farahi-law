/**
 * Tests whether the Filevine export is internally consistent (name↔address↔phone
 * aligned) — i.e. trustworthy as a source of truth, unlike the corrupted Excel.
 * For a random sample of Filevine rows that have BOTH an address and a phone,
 * ask Google Places: what business is at this address? what business has this
 * phone? Then see if either agrees with the Filevine name.
 * Also resolves the 8 "matched-by-phone, name-differs" CRM candidates.
 *
 * Run: node scripts/migration/verify-filevine-integrity.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; const xs = x.length >= 5, ys = y.length >= 5; return (xs && y.includes(x)) || (ys && x.includes(y)); };

const placeAtText = async (q) => { try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=name,formatted_address&key=${KEY}`); const j = await r.json(); const c = (j.candidates || [])[0]; return c ? { name: c.name, addr: c.formatted_address } : null; } catch { return null; } };
const placeAtPhone = async (p10) => { try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent("+1" + p10)}&inputtype=phonenumber&fields=name,formatted_address&key=${KEY}`); const j = await r.json(); const c = (j.candidates || [])[0]; return c ? { name: c.name, addr: c.formatted_address } : null; } catch { return null; } };

// Deterministic shuffle by a fixed seed-ish stride (no Math.random — keep reproducible)
const wb = xlsx.readFile("C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx");
const rows = xlsx.utils.sheet_to_json(wb.Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fv = rows.map((r) => ({ name: clean(r[4]), addr: clean(r[5]), city: "", phone: last10(r[7]) || last10(r[8]) || last10(r[9]) })).filter((f) => f.name && f.addr && f.phone);
const sample = []; const stride = Math.max(1, Math.floor(fv.length / 30));
for (let i = 0; i < fv.length && sample.length < 30; i += stride) sample.push(fv[i]);

console.log(`Filevine rows with name+address+phone: ${fv.length}. Testing ${sample.length} for alignment…\n`);
let addrOk = 0, phoneOk = 0, eitherOk = 0;
const results = [];
for (const f of sample) {
  const atAddr = await placeAtText(`${f.name} ${f.addr}`);
  const byPhone = await placeAtPhone(f.phone);
  const aOk = atAddr && nameish(f.name, atAddr.name);
  const pOk = byPhone && nameish(f.name, byPhone.name);
  if (aOk) addrOk++; if (pOk) phoneOk++; if (aOk || pOk) eitherOk++;
  results.push({ fvName: f.name, addr: f.addr, phone: f.phone, googleByName: atAddr?.name, googleByPhone: byPhone?.name, addrOk: !!aOk, phoneOk: !!pOk });
  console.log(`${aOk || pOk ? "✓" : "✗"} "${f.name}"  | byName→${atAddr?.name ?? "—"} | byPhone→${byPhone?.name ?? "—"}`);
}
console.log(`\nAlignment: name confirmed by address ${addrOk}/${sample.length}, by phone ${phoneOk}/${sample.length}, by either ${eitherOk}/${sample.length}`);

// ── Resolve the 8 phone-matched name-diff candidates ──
const report = JSON.parse(fs.readFileSync("scripts/migration/verify-vs-filevine-report.json", "utf8"));
console.log(`\n── 8 CRM-vs-Filevine name conflicts (which is the real business?) ──`);
const conflicts = [];
for (const x of report.matchedByPhoneOnly) {
  const g = await placeAtText(`${x.crmName}`);
  const g2 = await placeAtText(`${x.fvName}`);
  conflicts.push({ id: x.id, crmName: x.crmName, fvName: x.fvName, googleForCRM: g?.name + " — " + g?.addr, googleForFV: g2?.name + " — " + g2?.addr });
  console.log(`#${x.id}\n   CRM "${x.crmName}" → Google: ${g?.name ?? "—"} (${g?.addr ?? "—"})\n   FV  "${x.fvName}" → Google: ${g2?.name ?? "—"} (${g2?.addr ?? "—"})`);
}
fs.writeFileSync("scripts/migration/verify-filevine-integrity-report.json", JSON.stringify({ sample: results, alignment: { addrOk, phoneOk, eitherOk, n: sample.length }, conflicts }, null, 2));
console.log(`\nReport → scripts/migration/verify-filevine-integrity-report.json`);
