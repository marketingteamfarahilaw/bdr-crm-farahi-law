/**
 * Imports partners present in the Filevine "List of Projects" export but missing
 * from the CRM. Source of truth = Filevine. Safe + reversible:
 *   - dedup vs CRM by normalized name OR phone(last10) OR street-number+city
 *   - dedup within Filevine by normalized name (keep the richest row)
 *   - exclude junk/test rows and bare generic stubs
 *   - assign each to its Filevine agent (first name) EXCEPT "Justin" (admin
 *     default) which is left unassigned
 *   - tag notes "Imported from Filevine 2026-06-16" and log every inserted id
 *     to import-filevine-partners-inserted.json so the import can be undone
 *
 * DRY RUN by default. Pass --apply to insert.
 *   node scripts/migration/import-filevine-partners.mjs            (dry run)
 *   node scripts/migration/import-filevine-partners.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const TAG = "Imported from Filevine 2026-06-16";

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityOf = (a) => { const m = String(a ?? "").match(/,\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? clean(m[1]) : ""; };
const zipOf = (a) => { const m = String(a ?? "").match(/(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|United States))?\s*$/); return m ? m[1] : ""; };

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "");
const agentOf = (fp) => { const first = clean(fp).replace(/@.*/, "").split(/\s+/)[0]; if (!first) return null; if (first.toLowerCase() === "justin") return null; return cap(first); };

const infer = (name) => {
  const n = String(name ?? "").toLowerCase();
  if (/(imaging|radiolog|\bmri\b|x-?ray)/.test(n)) return "imaging_center";
  if (/(physical therapy|\bpt\b|rehab|physiotherap)/.test(n)) return "physical_therapist";
  if (/(chiropract|chiro\b|\bspine\b|spinal|\bdc\b|wellness|injury)/.test(n)) return "chiropractor";
  if (/(urgent care|medical center|medical group|medical clinic|pain manage|pain injury|health center|\bmd\b|clinic|acupunct|surgery|surgical|orthop|neuro|dental|dentist|\bdds\b)/.test(n)) return "medical_clinic";
  if (/(collision|body shop|auto body|autobody|auto repair|auto care|auto service|automotive|\bpaint\b|motorsport|\bdent\b|autopro|\btire\b|muffler|smog|mechanic|car care|auto center|glass)/.test(n)) return "body_shop";
  return "other"; // towing, insurance, misc
};
const statusOf = (phase) => ({ "active": "active_partner", "follow-up needed": "needs_follow_up", "inactive": "dormant", "nurture stage": "prospect", "not qualified": "prospect" }[clean(phase).toLowerCase()] || "prospect");

const isJunk = (name) => {
  const n = clean(name).toLowerCase();
  if (n.length < 3) return true;
  if (/(\btest\b|do not use|don't use|\bdnu\b|sample|delete|duplicate)/.test(n)) return true;
  const GENERIC = new Set(["autobody", "bodyshop", "clinic", "chiropractor", "chiropractic", "collisioncenter", "collision", "ent", "insurance", "autoinsurance", "pediatric", "towing", "autorepair", "medicalcenter", "urgentcare", "carwash", "cv", "joe", "na", "tba"]);
  return GENERIC.has(norm(name));
};

// ── Filevine: distinct partners (richest row per normalized name) ──
const rows = xlsx.utils.sheet_to_json(xlsx.readFile(FV).Sheets["List of Projects"], { header: 1, defval: "" }).slice(1);
const fvMap = new Map();
for (const r of rows) {
  const name = clean(r[4]); if (!name) continue;
  const rec = { name, phase: clean(r[1]), agent: clean(r[2]), addr: clean(r[5]), phones: [r[7], r[8], r[9]].map(last10).filter(Boolean) };
  const k = norm(name);
  const prev = fvMap.get(k);
  const richness = (x) => (x.addr ? 2 : 0) + (x.phones.length ? 1 : 0) + (agentOf(x.agent) ? 1 : 0);
  if (!prev || richness(rec) > richness(prev)) fvMap.set(k, rec);
}

// ── CRM dedup keys ──
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT name, phone, phone2, phone3, address, city FROM facilities");
const crmNames = new Set(facs.map((f) => norm(f.name)));
const crmPhones = new Set(); for (const f of facs) for (const p of [f.phone, f.phone2, f.phone3]) { const x = last10(p); if (x) crmPhones.add(x); }
const crmAddr = new Set(); for (const f of facs) { const key = stnum(f.address) + "|" + norm(f.city || cityOf(f.address)); if (stnum(f.address) && norm(f.city || cityOf(f.address))) crmAddr.add(key); }

// ── Decide imports ──
const toImport = []; let skipExisting = 0, skipJunk = 0;
for (const [k, f] of fvMap) {
  if (crmNames.has(k)) { skipExisting++; continue; }
  if (isJunk(f.name)) { skipJunk++; continue; }
  if (f.phones.some((p) => crmPhones.has(p))) { skipExisting++; continue; }
  const akey = stnum(f.addr) + "|" + norm(cityOf(f.addr));
  if (stnum(f.addr) && norm(cityOf(f.addr)) && crmAddr.has(akey)) { skipExisting++; continue; }
  toImport.push(f);
}

const byAgent = new Map(); const byStatus = new Map(); let withAddr = 0, assigned = 0;
for (const f of toImport) {
  const a = agentOf(f.agent) || "(unassigned)"; byAgent.set(a, (byAgent.get(a) || 0) + 1);
  const s = statusOf(f.phase); byStatus.set(s, (byStatus.get(s) || 0) + 1);
  if (f.addr) withAddr++; if (agentOf(f.agent)) assigned++;
}
console.log(`Filevine distinct partners: ${fvMap.size}`);
console.log(`  already in CRM (name/phone/address): ${skipExisting}`);
console.log(`  junk/generic excluded: ${skipJunk}`);
console.log(`  → TO IMPORT: ${toImport.length}  (with address: ${withAddr}, with agent: ${assigned}, unassigned: ${toImport.length - assigned})`);
console.log(`\nby agent:`); for (const [a, n] of [...byAgent].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${a}`);
console.log(`by status:`); for (const [s, n] of [...byStatus].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
console.log(`\nsample of 12:`);
for (const f of toImport.slice(0, 12)) console.log(`  "${f.name}" [${agentOf(f.agent) || "—"}] ${statusOf(f.phase)} ${f.addr || "(no addr)"}`);

if (APPLY) {
  const inserted = [];
  for (const f of toImport) {
    const rep = agentOf(f.agent);
    const vals = {
      name: f.name.slice(0, 255),
      category: infer(f.name),
      address: f.addr || null,
      city: cityOf(f.addr) || null,
      zipCode: zipOf(f.addr) || null,
      phone: f.phones[0] || null, phone2: f.phones[1] || null, phone3: f.phones[2] || null,
      assignedRepName: rep,
      partnerStatus: statusOf(f.phase),
      relationshipStatus: statusOf(f.phase) === "active_partner" ? "active_partner" : "warm_lead",
      notes: `${TAG} · Phase: ${f.phase || "?"} · FV First Primary: ${f.agent || "?"}`,
    };
    const res = await c.query(
      "INSERT INTO facilities (name, category, address, city, zipCode, phone, phone2, phone3, assignedRepName, partnerStatus, relationshipStatus, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [vals.name, vals.category, vals.address, vals.city, vals.zipCode, vals.phone, vals.phone2, vals.phone3, vals.assignedRepName, vals.partnerStatus, vals.relationshipStatus, vals.notes]
    );
    inserted.push(res[0].insertId);
  }
  fs.writeFileSync("scripts/migration/import-filevine-partners-inserted.json", JSON.stringify({ tag: TAG, count: inserted.length, ids: inserted }, null, 2));
  console.log(`\nAPPLIED — inserted ${inserted.length} facilities. IDs logged to import-filevine-partners-inserted.json (delete those ids to undo).`);
} else {
  console.log(`\nDRY RUN — nothing inserted. Re-run with --apply to import.`);
}
await c.end();
