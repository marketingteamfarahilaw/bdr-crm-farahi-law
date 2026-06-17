/**
 * Builds the current "possibly wrong name" candidate list for deep research:
 * facilities whose name disagrees with Filevine at the same address, unioned with
 * the audit's Google-flagged likely-wrong names. Outputs one file the research
 * agents will read.  Run: node scripts/migration/build-wrongname-candidates.mjs
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
const cityOf = (city, a) => { const c = norm(city); if (c) return c; const m = String(a ?? "").match(/,?\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? norm(m[1]) : ""; };
const nameish = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y)); };

const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fvByAddr = new Map();
for (const r of rows) { const name = clean(r[4]); if (!name) continue; const addr = clean(r[5]); const k = stnum(addr) + "|" + cityOf("", addr); if (stnum(addr) && cityOf("", addr)) { if (!fvByAddr.has(k)) fvByAddr.set(k, new Set()); fvByAddr.get(k).add(name); } }

const audit = (() => { try { return JSON.parse(fs.readFileSync("scripts/migration/facility-audit-result.json", "utf8")); } catch { return { wrongName: [] }; } })();
const googleNearestById = new Map((audit.wrongName || []).map((x) => [x.id, x.bestGuess]));

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, address, city, phone, phone2, phone3, category, assignedRepName FROM facilities");
await c.end();

const cand = [];
for (const f of facs) {
  const aKey = stnum(f.address) + "|" + cityOf(f.city, f.address);
  let filevineName = null;
  if (stnum(f.address) && cityOf(f.city, f.address) && fvByAddr.has(aKey)) {
    const names = [...fvByAddr.get(aKey)].filter((n) => !nameish(n, f.name));
    if (names.length) filevineName = names[0];
  }
  const google = googleNearestById.get(f.id) ?? null;
  if (filevineName || google) {
    cand.push({
      id: f.id, crmName: f.name, address: f.address || "", city: f.city || "",
      phone: [f.phone, f.phone2, f.phone3].map(last10).filter(Boolean)[0] || "",
      filevineName, googleNearest: google, category: f.category, agent: f.assignedRepName,
    });
  }
}
fs.writeFileSync("scripts/migration/wrongname-candidates.json", JSON.stringify(cand));
console.log("Wrong-name candidates:", cand.length);
console.log("  with a Filevine name at same address:", cand.filter((x) => x.filevineName).length);
console.log("  with a Google-nearest flag:", cand.filter((x) => x.googleNearest).length);
console.log("  with both:", cand.filter((x) => x.filevineName && x.googleNearest).length);
