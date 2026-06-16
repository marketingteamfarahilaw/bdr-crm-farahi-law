/**
 * Verifies each facility's name against Google Places, looked up BY its phone
 * number (the authoritative "who owns this number" check the user asked for).
 *
 * READ-ONLY. Writes a report to verify-facility-phones-report.json with three
 * buckets:
 *   confirmed  — Google's business name for that phone matches the CRM name.
 *   mismatch   — Google returns a DIFFERENT business (either the CRM name is
 *                wrong, OR the phone on this facility is wrong — a human must
 *                judge which, so we do NOT auto-change).
 *   noListing  — Google has no business for that number (cell/unlisted) — can't verify.
 *
 * Run: node scripts/migration/verify-facility-phones.mjs
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("No GOOGLE_MAPS_API_KEY"); process.exit(1); }

const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (s) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
const cityOf = (addr) => { const m = String(addr ?? "").match(/,\s*([^,]+),\s*[A-Z]{2}\s*\d{5}/); return m ? m[1].trim().toLowerCase() : ""; };
const nameMatch = (a, b) => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || (na.length >= 5 && nb.includes(na)) || (nb.length >= 5 && na.includes(nb))) return true;
  const ta = tokens(a), tb = tokens(b); if (!ta.size || !tb.size) return false;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size) >= 0.5;
};

const lookup = async (phone10) => {
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent("+1" + phone10)}&inputtype=phonenumber&fields=name,formatted_address&key=${KEY}`;
  try { const r = await fetch(url); const j = await r.json(); const cand = (j.candidates || [])[0]; return { status: j.status, name: cand?.name ?? null, addr: cand?.formatted_address ?? null }; }
  catch (e) { return { status: "FETCH_ERROR", name: null, addr: null }; }
};

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, category, city, phone FROM facilities WHERE phone IS NOT NULL AND phone <> '' ORDER BY id");
const targets = facs.filter((f) => last10(f.phone));
console.log(`Verifying ${targets.length} facilities by phone against Google Places…`);

const report = { confirmed: [], mismatch: [], noListing: [] };
const CONC = 8;
for (let i = 0; i < targets.length; i += CONC) {
  const batch = targets.slice(i, i + CONC);
  await Promise.all(batch.map(async (f) => {
    const g = await lookup(last10(f.phone));
    if (g.status !== "OK" || !g.name) { report.noListing.push({ id: f.id, name: f.name, phone: f.phone }); return; }
    if (nameMatch(f.name, g.name)) { report.confirmed.push({ id: f.id, name: f.name }); return; }
    const sameCity = f.city && cityOf(g.addr) && norm(f.city) === norm(cityOf(g.addr));
    report.mismatch.push({ id: f.id, crmName: f.name, googleName: g.name, googleAddr: g.addr, crmCity: f.city, sameCity });
  }));
  process.stdout.write(`\r  ${Math.min(i + CONC, targets.length)}/${targets.length}`);
}
console.log("");

fs.writeFileSync("scripts/migration/verify-facility-phones-report.json", JSON.stringify(report, null, 2));
console.log(`\nVERIFIED ✓ ${report.confirmed.length}  |  MISMATCH ⚠️ ${report.mismatch.length}  |  NO GOOGLE LISTING ❓ ${report.noListing.length}`);
console.log("\n--- mismatches (Google's business for this phone ≠ CRM name) ---");
for (const m of report.mismatch) console.log(`#${m.id} CRM:"${m.crmName}"  ↔ Google:"${m.googleName}" (${m.googleAddr})${m.sameCity ? "  [SAME CITY]" : ""}`);
await c.end();
