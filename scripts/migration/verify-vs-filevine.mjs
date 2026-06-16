/**
 * Verifies the CRM facilities against the Filevine "List of Projects" export
 * (the firm's source of truth). Reports, by name match:
 *   - CRM facilities found in Filevine (and whether agent/phone/address agree)
 *   - CRM facilities NOT in Filevine (suspect names / orphans)
 *   - Filevine projects missing from the CRM (the coverage gap)
 * Read-only. Writes verify-vs-filevine-report.json.
 *
 * Run: node scripts/migration/verify-vs-filevine.mjs
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FV = "C:/Users/EOR - 4055/Downloads/List of Projects 2026-06-16 1618.xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const firstName = (s) => clean(s).toLowerCase().replace(/@.*/, "").split(/\s+/)[0] || "";
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";

// ── Filevine ──
const wb = xlsx.readFile(FV);
const rows = xlsx.utils.sheet_to_json(wb.Sheets["List of Projects"], { header: 1, defval: "" });
const fv = [];
for (const r of rows.slice(1)) {
  const name = clean(r[4]); if (!name) continue;
  fv.push({ name, phase: clean(r[1]), agent: clean(r[2]), addr: clean(r[5]), phones: [r[7], r[8], r[9]].map(last10).filter(Boolean), key: norm(name) });
}
const fvByName = new Map();
for (const f of fv) { if (!fvByName.has(f.key)) fvByName.set(f.key, f); }
const fvByPhone = new Map();
for (const f of fv) for (const p of f.phones) if (!fvByPhone.has(p)) fvByPhone.set(p, f);

// ── CRM ──
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, address, city, assignedRepName, partnerStatus FROM facilities");
await c.end();

const matchedByName = []; const matchedByPhoneOnly = []; const notInFilevine = [];
for (const f of facs) {
  const k = norm(f.name);
  let fvHit = fvByName.get(k);
  let how = "name";
  if (!fvHit) { // fuzzy name contains
    for (const [fk, fvv] of fvByName) { if (k.length >= 6 && (fk.includes(k) || k.includes(fk))) { fvHit = fvv; how = "name~"; break; } }
  }
  if (!fvHit) { // try phone
    const ps = [f.phone, f.phone2, f.phone3].map(last10).filter(Boolean);
    for (const p of ps) { if (fvByPhone.has(p)) { fvHit = fvByPhone.get(p); how = "phone"; break; } }
    if (fvHit) { matchedByPhoneOnly.push({ id: f.id, crmName: f.name, fvName: fvHit.name, agentCRM: f.assignedRepName, agentFV: fvHit.agent }); continue; }
  }
  if (!fvHit) { notInFilevine.push({ id: f.id, name: f.name, agent: f.assignedRepName, phone: f.phone, city: f.city }); continue; }
  const agentOk = firstName(f.assignedRepName) && firstName(f.assignedRepName) === firstName(fvHit.agent);
  matchedByName.push({ id: f.id, how, crmName: f.name, fvName: fvHit.name, fvPhase: fvHit.phase, agentCRM: f.assignedRepName, agentFV: fvHit.agent, agentOk, fvAddr: fvHit.addr });
}

// Filevine projects not in CRM (by name)
const crmNames = new Set(facs.map((f) => norm(f.name)));
const fvMissing = fv.filter((f) => !crmNames.has(f.key));
const fvMissingDistinct = new Map();
for (const f of fvMissing) if (!fvMissingDistinct.has(f.key)) fvMissingDistinct.set(f.key, f);

const agentMismatch = matchedByName.filter((m) => !m.agentOk);
console.log(`CRM facilities: ${facs.length}  |  Filevine projects: ${fv.length} (${fvByName.size} distinct names)`);
console.log(`\nCRM matched in Filevine by name: ${matchedByName.length}`);
console.log(`  of those, assigned-agent MISMATCH: ${agentMismatch.length}`);
console.log(`CRM matched only by phone (name differs!): ${matchedByPhoneOnly.length}`);
console.log(`CRM NOT in Filevine at all: ${notInFilevine.length}`);
console.log(`\nFilevine projects MISSING from CRM (distinct names): ${fvMissingDistinct.size}`);

console.log(`\n── CRM names NOT found in Filevine (first 40) ──`);
for (const x of notInFilevine.slice(0, 40)) console.log(`  #${x.id} [${x.agent || "-"}] "${x.name}" (${x.city || "?"})`);

console.log(`\n── Matched by phone but NAME differs (likely wrong CRM name) ──`);
for (const x of matchedByPhoneOnly.slice(0, 30)) console.log(`  #${x.id} CRM "${x.crmName}"  ≠  FV "${x.fvName}"`);

fs.writeFileSync("scripts/migration/verify-vs-filevine-report.json", JSON.stringify({
  counts: { crm: facs.length, fv: fv.length, fvDistinct: fvByName.size, matchedByName: matchedByName.length, agentMismatch: agentMismatch.length, matchedByPhoneOnly: matchedByPhoneOnly.length, notInFilevine: notInFilevine.length, fvMissing: fvMissingDistinct.size },
  notInFilevine, matchedByPhoneOnly, agentMismatch, fvMissing: [...fvMissingDistinct.values()].map((f) => ({ name: f.name, agent: f.agent, phase: f.phase, addr: f.addr })),
}, null, 2));
console.log(`\nFull report → scripts/migration/verify-vs-filevine-report.json`);
