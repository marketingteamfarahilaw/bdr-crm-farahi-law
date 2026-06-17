/**
 * Full facility data-quality audit. Checks every facility for:
 *   - wrong NAME      (Google's nearest business at the geocoded point disagrees)
 *   - name != Filevine at the same address (source-of-truth disagreement)
 *   - wrong CATEGORY  (the name implies a different category than stored)
 *   - junk/placeholder names
 *   - missing data    (phone / city / address / agent / geocode)
 *   - duplicate names and duplicate addresses
 * Exports a multi-tab workbook to Downloads. Google checks are run only on the
 * suspect subset (category mismatch / junk / name!=Filevine) to bound API cost.
 *
 * Run: node scripts/migration/facility-audit.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityOf = (a) => { const m = String(a ?? "").match(/,?\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? norm(m[1]) : ""; };
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VALID_CATS = ["body_shop", "chiropractor", "medical_clinic", "physical_therapist", "imaging_center", "other"];
function inferCat(name) {
  const n = String(name ?? "").toLowerCase();
  if (/(imaging|radiolog|\bmri\b|x-?ray)/.test(n)) return "imaging_center";
  if (/(physical therapy|physiotherap|\brehab\b|\bpt\b)/.test(n)) return "physical_therapist";
  if (/(chiropract|chiro\b|\bspine\b|spinal|\bdc\b)/.test(n)) return "chiropractor";
  if (/(urgent care|medical center|medical group|medical clinic|pain manage|pain injury|health center|acupunct|\bsurgery\b|surgical|orthop|\bneuro|dental|dentist|\bdds\b|\bmd\b)/.test(n)) return "medical_clinic";
  if (/(collision|body shop|auto body|autobody|auto repair|auto care|auto service|automotive|\bpaint\b|motorsport|body & frame|body and frame|\bdent\b|\btire\b|muffler|smog|car care|auto center|auto craft)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|\binsurance\b|pharmacy|attorney|\blaw\b|notary|tax service)/.test(n)) return "other";
  return null; // can't tell from name
}
function isJunk(name) {
  const n = clean(name); const ln = n.toLowerCase();
  if (n.length < 3) return "too short";
  if (/(\btest\b|do not use|don't use|\bdnu\b|sample|delete|duplicate|asdf|xxx)/.test(ln)) return "test/placeholder text";
  const GENERIC = new Set(["chiropractor", "chiropractic", "clinic", "autobody", "bodyshop", "collisioncenter", "collision", "ent", "insurance", "pediatric", "towing", "autorepair", "medicalcenter", "urgentcare", "doctor", "office"]);
  if (GENERIC.has(norm(name))) return "generic stub";
  if (/^[a-z]+$/i.test(n) && n.split(/\s+/).length === 1 && n.length <= 12 && !/(towing|chiro|auto|body|clinic|spine|care)/i.test(ln)) return "looks like a person's first name only";
  return null;
}

// ── Filevine maps ──
const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fvNames = new Set(); const fvByAddr = new Map();
for (const r of rows) {
  const name = clean(r[4]); if (!name) continue;
  fvNames.add(norm(name));
  const addr = clean(r[5]); const key = stnum(addr) + "|" + cityOf(addr);
  if (stnum(addr) && cityOf(addr)) { if (!fvByAddr.has(key)) fvByAddr.set(key, new Set()); fvByAddr.get(key).add(name); }
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, category, address, city, phone, phone2, phone3, assignedRepName, latitude, longitude, partnerStatus, notes FROM facilities ORDER BY id");

// ── Deterministic checks ──
const catMismatch = [], junk = [], missing = [], nameVsFv = [];
const byName = new Map(), byAddr = new Map();
for (const f of facs) {
  const inferred = inferCat(f.name);
  if (inferred && inferred !== f.category && !(inferred === "other")) catMismatch.push({ id: f.id, name: f.name, stored: f.category, suggested: inferred, agent: f.assignedRepName });
  const j = isJunk(f.name); if (j) junk.push({ id: f.id, name: f.name, why: j, address: f.address, agent: f.assignedRepName });
  const miss = [];
  if (!clean(f.phone) && !clean(f.phone2) && !clean(f.phone3)) miss.push("phone");
  if (!clean(f.city)) miss.push("city");
  if (!clean(f.address)) miss.push("address");
  if (!clean(f.assignedRepName)) miss.push("agent");
  if (!f.latitude || !f.longitude) miss.push("geocode");
  if (miss.length) missing.push({ id: f.id, name: f.name, missing: miss.join(", "), agent: f.assignedRepName });
  // name vs Filevine at same address
  const aKey = stnum(f.address) + "|" + (norm(f.city) || cityOf(f.address));
  if (stnum(f.address) && (norm(f.city) || cityOf(f.address)) && fvByAddr.has(aKey)) {
    const names = [...fvByAddr.get(aKey)];
    const distinct = names.filter((n) => !nameish(n, f.name));
    if (distinct.length && distinct.length === names.length) nameVsFv.push({ id: f.id, crmName: f.name, filevineName: distinct[0], address: f.address, agent: f.assignedRepName });
  }
  const nk = norm(f.name); if (nk) { if (!byName.has(nk)) byName.set(nk, []); byName.get(nk).push(f); }
  const ak = stnum(f.address) + "|" + (norm(f.city) || cityOf(f.address));
  if (stnum(f.address) && (norm(f.city) || cityOf(f.address))) { if (!byAddr.has(ak)) byAddr.set(ak, []); byAddr.get(ak).push(f); }
}
const dupNames = [...byName.values()].filter((a) => a.length > 1);
const dupAddrs = [...byAddr.values()].filter((a) => a.length > 1);

// ── Targeted Google name verification (suspects only) ──
const suspectIds = new Set([...catMismatch, ...junk, ...nameVsFv].map((x) => x.id));
const suspects = facs.filter((f) => suspectIds.has(f.id) && f.latitude && f.longitude);
console.log(`Facilities: ${facs.length}. Google-verifying ${suspects.length} suspect names…`);
const nearest = async (lat, lng) => { try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=establishment&key=${KEY}`); const j = await r.json(); return (j.results || []).slice(0, 5).map((x) => x.name); } catch { return []; } };
const wrongName = [];
const CONC = 6;
for (let i = 0; i < suspects.length; i += CONC) {
  await Promise.all(suspects.slice(i, i + CONC).map(async (f) => {
    const names = await nearest(f.latitude, f.longitude);
    if (!names.length) return;
    const matchesCrm = names.some((n) => nameish(n, f.name));
    if (!matchesCrm) wrongName.push({ id: f.id, crmName: f.name, googleNearest: names.slice(0, 3).join(" | "), bestGuess: names[0], address: f.address, agent: f.assignedRepName });
  }));
  process.stdout.write(`\r  ${Math.min(i + CONC, suspects.length)}/${suspects.length}`);
  await sleep(70);
}
console.log("");
await c.end();

// ── Export ──
const wb = xlsx.utils.book_new();
const S = (aoa, name) => xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(aoa), name);
S([
  ["FARAHI LAW — FACILITY DATA-QUALITY AUDIT", ""],
  ["Generated (Pacific)", formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd HH:mm")],
  ["Total facilities", facs.length],
  ["", ""],
  ["Likely WRONG NAME (Google's on-site business differs)", wrongName.length],
  ["Name disagrees with Filevine at same address", nameVsFv.length],
  ["CATEGORY mismatch (name implies a different category)", catMismatch.length],
  ["Junk / placeholder names", junk.length],
  ["Missing data (phone/city/address/agent/geocode)", missing.length],
  ["Duplicate-name groups", dupNames.length],
  ["Duplicate-address groups", dupAddrs.length],
], "Summary");
S([["ID", "CRM Name", "Google nearest business", "Best guess", "Address", "Agent"], ...wrongName.map((x) => [x.id, x.crmName, x.googleNearest, x.bestGuess, x.address, x.agent])], "Likely Wrong Name");
S([["ID", "CRM Name", "Filevine name @ address", "Address", "Agent"], ...nameVsFv.map((x) => [x.id, x.crmName, x.filevineName, x.address, x.agent])], "Name vs Filevine");
S([["ID", "Name", "Stored category", "Suggested category", "Agent"], ...catMismatch.map((x) => [x.id, x.name, x.stored, x.suggested, x.agent])], "Category Mismatch");
S([["ID", "Name", "Why", "Address", "Agent"], ...junk.map((x) => [x.id, x.name, x.why, x.address, x.agent])], "Junk Names");
S([["ID", "Name", "Missing", "Agent"], ...missing.map((x) => [x.id, x.name, x.missing, x.agent])], "Missing Data");
const dupRows = [["Normalized name", "Count", "IDs", "Names"]];
for (const g of dupNames) dupRows.push([norm(g[0].name), g.length, g.map((x) => x.id).join(", "), [...new Set(g.map((x) => x.name))].join(" | ")]);
S(dupRows, "Duplicate Names");
const dupARows = [["Address key", "Count", "IDs", "Names"]];
for (const g of dupAddrs) dupARows.push([`${stnum(g[0].address)} ${g[0].city || ""}`, g.length, g.map((x) => x.id).join(", "), [...new Set(g.map((x) => x.name))].join(" | ")]);
S(dupARows, "Duplicate Addresses");

const stamp = formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
const out = `C:/Users/EOR - 4055/Downloads/Farahi Facilities Audit ${stamp}.xlsx`;
xlsx.writeFile(wb, out);
fs.writeFileSync("scripts/migration/facility-audit-result.json", JSON.stringify({ wrongName, nameVsFv, catMismatch, junk, missingCount: missing.length, dupNames: dupNames.length, dupAddrs: dupAddrs.length }, null, 2));

console.log("\n=== FACILITY AUDIT ===");
console.log("Total facilities:", facs.length);
console.log("Likely WRONG NAME (Google):", wrongName.length);
console.log("Name != Filevine @ address:", nameVsFv.length);
console.log("CATEGORY mismatch:", catMismatch.length);
console.log("Junk/placeholder names:", junk.length);
console.log("Missing data:", missing.length);
console.log("Duplicate-name groups:", dupNames.length, "| Duplicate-address groups:", dupAddrs.length);
console.log("\nEXPORTED →", out);
console.log("\nSample likely-wrong names:");
for (const x of wrongName.slice(0, 15)) console.log(`  #${x.id} "${x.crmName}" — Google says: ${x.bestGuess}`);
console.log("\nSample category mismatches:");
for (const x of catMismatch.slice(0, 12)) console.log(`  #${x.id} "${x.name}" — stored ${x.stored} → suggest ${x.suggested}`);
