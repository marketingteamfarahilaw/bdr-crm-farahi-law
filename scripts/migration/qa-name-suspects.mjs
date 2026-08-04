/**
 * Deep-QA pass 1: build the consolidated facility-NAME suspect list.
 * Signals:
 *   A. junk/placeholder/format problems (regex heuristics)
 *   B. Google nearest-business mismatch at the geocoded point (for geo rows)
 *   C. disagrees with Filevine at the same address
 *   D. recently created skeleton rows (MTD sheet / activity creations)
 *   E. near-duplicate names sharing distinctive tokens (merge/rename review)
 * Output: scripts/migration/qa-name-suspects.json  (read-only pass)
 *
 * Run: node scripts/migration/qa-name-suspects.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityOf = (city, a) => { const c = norm(city); if (c) return c; const m = String(a ?? "").match(/,?\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? norm(m[1]) : ""; };
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GENERIC = new Set(["auto", "body", "shop", "collision", "center", "centre", "repair", "repairs", "paint", "frame", "the", "and", "inc", "llc", "corp", "towing", "tow", "chiropractic", "chiro", "chiropractor", "clinic", "pain", "injury", "health", "wellness", "care", "medical", "insurance", "services", "service", "group", "works", "autobody", "collisions", "family", "spine"]);
const toks = (name) => clean(name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 4 && !GENERIC.has(t) && !/^\d+$/.test(t));

function formatIssue(name) {
  const n = clean(name);
  if (n.length < 4) return "very short";
  if (/(\btest\b|do not use|\bdnu\b|sample|asdf|delete)/i.test(n)) return "placeholder text";
  if (/^[a-z]/.test(n) && n === n.toLowerCase()) return "all lowercase";
  if (n === n.toUpperCase() && /[A-Z]{4,}/.test(n) && n.split(/\s+/).length >= 2) return "ALL CAPS";
  if (/\s(in)\s+[A-Z][a-z]+$/.test(n)) return "contains ' in City'";
  if (/[-–—:,]$/.test(n)) return "trailing punctuation";
  if (/^\S+$/.test(n) && n.length <= 12 && !/\d/.test(n) && toks(n).length === 0) return "single generic word";
  if (/^[A-Z][a-z]+$/.test(n)) return "looks like a first name only";
  return null;
}

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, address, city, phone, category, assignedRepName, latitude, longitude, notes, createdAt FROM facilities");
await c.end();

// Filevine by-address map
const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fvByAddr = new Map();
for (const r of rows) { const name = clean(r[4]); if (!name) continue; const addr = clean(r[5]); const k = stnum(addr) + "|" + cityOf("", addr); if (stnum(addr) && cityOf("", addr)) { if (!fvByAddr.has(k)) fvByAddr.set(k, new Set()); fvByAddr.get(k).add(name); } }

const suspects = new Map(); // id -> {reasons:[], ...}
const add = (f, reason, extra = {}) => {
  if (!suspects.has(f.id)) suspects.set(f.id, { id: f.id, name: f.name, address: f.address, city: f.city, phone: f.phone, category: f.category, agent: f.assignedRepName, reasons: [], ...extra });
  const s = suspects.get(f.id);
  s.reasons.push(reason);
  Object.assign(s, extra);
};

// A. format/junk
for (const f of facs) { const iss = formatIssue(f.name); if (iss) add(f, `format: ${iss}`); }
// C. Filevine disagreement at same address
for (const f of facs) {
  const k = stnum(f.address) + "|" + (norm(f.city) || cityOf("", f.address));
  if (stnum(f.address) && (norm(f.city) || cityOf("", f.address)) && fvByAddr.has(k)) {
    const names = [...fvByAddr.get(k)].filter((n) => !nameish(n, f.name));
    if (names.length && names.length === fvByAddr.get(k).size) add(f, "differs from Filevine @ address", { filevineName: names[0] });
  }
}
// D. recent skeleton creations (no address → unverifiable by geo; names may be rough)
for (const f of facs) {
  const nt = String(f.notes ?? "");
  if ((nt.startsWith("Added from MTD sheet") || nt.startsWith("Added ")) && !clean(f.address)) add(f, "skeleton row from sheet (no address)");
}
// E. near-duplicates by distinctive token (report groups)
const tokenMap = new Map();
for (const f of facs) for (const t of toks(f.name)) { if (!tokenMap.has(t)) tokenMap.set(t, []); tokenMap.get(t).push(f); }
const dupGroups = [];
const seenPair = new Set();
for (const [t, list] of tokenMap) {
  if (list.length < 2 || list.length > 5) continue;
  const key = list.map((f) => f.id).sort().join(",");
  if (seenPair.has(key)) continue;
  seenPair.add(key);
  // only when names are similar-ish beyond the token (avoid chains/franchises with cities)
  dupGroups.push({ token: t, facilities: list.map((f) => ({ id: f.id, name: f.name, city: f.city, agent: f.assignedRepName })) });
}

// B. Google nearest-business check for geocoded suspects (bounded)
const geoSuspects = [...suspects.values()].filter((s) => { const f = facs.find((x) => x.id === s.id); return f?.latitude && f?.longitude; });
console.log(`Suspects so far: ${suspects.size} (geo-checkable: ${geoSuspects.length}). Google-checking…`);
const nearest = async (lat, lng) => { try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=establishment&key=${KEY}`); const j = await r.json(); return (j.results || []).slice(0, 4).map((x) => x.name); } catch { return []; } };
let done = 0;
for (const s of geoSuspects) {
  const f = facs.find((x) => x.id === s.id);
  const names = await nearest(f.latitude, f.longitude);
  if (names.length) {
    s.googleNearest = names.slice(0, 3);
    if (!names.some((n) => nameish(n, f.name))) s.reasons.push("Google nearest differs");
  }
  if (++done % 40 === 0) { process.stdout.write(`\r  ${done}/${geoSuspects.length}`); await sleep(400); }
  await sleep(90);
}
console.log("");

const out = [...suspects.values()];
fs.writeFileSync("scripts/migration/qa-name-suspects.json", JSON.stringify({ suspects: out, dupGroups }, null, 1));
console.log(`TOTAL suspects: ${out.length}`);
const byReason = {};
for (const s of out) for (const r of s.reasons) byReason[r.split(":")[0]] = (byReason[r.split(":")[0]] ?? 0) + 1;
console.log("by signal:", JSON.stringify(byReason));
console.log(`near-duplicate token groups: ${dupGroups.length}`);
