/**
 * Backfills the MTD BDR CHECK-IN & FR VISIT workbook (v11) into the CRM:
 *   - FR VISITS (right-hand matrix, all agent sections): visit-type contact
 *     logs credited to the section's agent, one log per counted visit per day.
 *   - FR CHECK-INS (left-hand matrix) ONLY for agents with NO RingCentral
 *     connection (Jezel, Zulema, Lupe, Genysys) — their calls were never
 *     auto-synced. BDR check-ins are skipped (already synced from RingCentral;
 *     backfilling would double count).
 * Facilities matched by name (exact normalized, else unique contains).
 * Idempotent: every created log is tagged "[MTD sheet]" and skipped if one
 * already exists for the same facility+day+rep+type.
 *
 * DRY RUN by default:  node scripts/migration/backfill-mtd-v11.mjs
 * Apply:               node scripts/migration/backfill-mtd-v11.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const WB = "C:/Users/EOR - 4055/Downloads/MTD BDR CHECK-IN & FR VISIT REPORT (11).xlsx";
const NO_RC_AGENTS = new Set(["jezel", "zulema", "lupe", "genysys"]); // first names — no RingCentral, calls never synced

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const first = (s) => clean(s).toLowerCase().split(/\s+/)[0] ?? "";
// Excel serial → Date at noon LA (19:00 UTC in summer) so day bucketing is stable.
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000 + 19 * 3600000);

// ── Parse v11: per-section check-in + visit entries ──
const wb = xlsx.readFile(WB);
const checkins = []; // {agent, facility, date, count}
const visits = [];
for (const sn of ["JUNE 2026", "JULY 2026"]) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });
  let agent = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c1 = clean(r[1]);
    if (c1 && !r[2] && /^[A-Za-z][A-Za-z .’'-]+$/.test(c1) && !/FACILITY|NAME|TOTAL|REPORT|REPRESENTATIVE|CHECK/i.test(c1)) {
      const hasHeader = rows.slice(i + 1, i + 4).some((rr) => /FACILITY NAME/i.test(String(rr[1])));
      if (hasHeader) { agent = c1; continue; }
    }
    if (!agent) continue;
    // Left block: facility col1, check-in date/count pairs at (2,3)(4,5)(6,7)(8,9)
    if (c1 && !/FACILITY NAME/i.test(c1)) {
      for (const [dc, cc] of [[2, 3], [4, 5], [6, 7], [8, 9]]) {
        if (typeof r[dc] === "number" && r[dc] > 40000 && r[dc] < 60000) {
          checkins.push({ agent, facility: c1, date: serialToDate(r[dc]), count: Math.max(1, Number(r[cc]) || 1) });
        }
      }
    }
    // Right block: facility col11, visit date/count pairs at (12,13)(14,15)
    const c11 = clean(r[11]);
    if (c11 && !/FACILITY NAME/i.test(c11)) {
      for (const [dc, cc] of [[12, 13], [14, 15]]) {
        if (typeof r[dc] === "number" && r[dc] > 40000 && r[dc] < 60000) {
          visits.push({ agent, facility: c11, date: serialToDate(r[dc]), count: Math.max(1, Number(r[cc]) || 1) });
        }
      }
    }
  }
}
const frCheckins = checkins.filter((e) => NO_RC_AGENTS.has(first(e.agent)));
console.log(`Parsed: ${visits.length} visit entries (all agents) | ${checkins.length} check-in entries → ${frCheckins.length} for no-RC agents (backfillable)`);

// ── Facility matching ──
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name FROM facilities");
const byNorm = new Map();
for (const f of facs) { const k = norm(f.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(f); }
const GENERIC = new Set(["auto", "body", "shop", "collision", "center", "centre", "repair", "repairs", "paint", "frame", "the", "and", "inc", "llc", "corp", "towing", "tow", "chiropractic", "chiro", "chiropractor", "clinic", "pain", "injury", "health", "wellness", "care", "medical", "insurance", "services", "service", "group", "works", "autobody", "collisions"]);
const tokensOf = (name) => clean(name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 4 && !GENERIC.has(t) && !/^\d+$/.test(t));
const matchFac = (name) => {
  const k = norm(name);
  let cands = byNorm.get(k) ?? [];
  if (!cands.length && k.length >= 6) {
    const hits = [];
    for (const [fk, fv] of byNorm) if (fk.includes(k) || (fk.length >= 6 && k.includes(fk))) hits.push(...fv);
    cands = hits;
  }
  if (!cands.length) {
    // Distinctive-token pass: exactly ONE facility contains the entry's first
    // distinctive token (e.g. "Diablos Collision" → "Diablos Auto Collision…").
    const toks = tokensOf(name);
    if (toks.length) {
      const t = toks[0];
      const hits = facs.filter((f) => norm(f.name).includes(t));
      if (hits.length === 1) cands = hits;
    }
  }
  if (cands.length >= 1) return [...cands].sort((a, b) => a.id - b.id)[0];
  return null;
};
// True when NO existing facility shares any distinctive token — safe to create.
const clearlyNew = (name) => {
  const toks = tokensOf(name);
  if (!toks.length) return false;
  return toks.every((t) => !facs.some((f) => norm(f.name).includes(t)));
};
const inferCat = (name) => {
  const n = String(name).toLowerCase();
  if (/(chiropract|chiro\b|spine)/.test(n)) return "chiropractor";
  if (/(clinic|health|wellness|medical|urgent)/.test(n)) return "medical_clinic";
  if (/(towing|\btow\b)/.test(n)) return "other";
  return "body_shop";
};

// ── Facilities that only exist on the sheet → create (apply mode) ──
const allEntries = [...visits.map((e) => ({ ...e, kind: "visit" })), ...frCheckins.map((e) => ({ ...e, kind: "call" }))];
const toCreate = new Map();
for (const e of allEntries) {
  if (matchFac(e.facility)) continue;
  const k = norm(e.facility);
  if (!toCreate.has(k) && clearlyNew(e.facility) && clean(e.facility).length <= 70) {
    toCreate.set(k, { name: clean(e.facility), agent: e.agent, date: e.date });
  }
}
console.log(`Facilities only on the sheet → will create: ${toCreate.size}`);
for (const v of [...toCreate.values()].slice(0, 12)) console.log(`   + ${v.name} (${v.agent})`);
if (APPLY) {
  for (const v of toCreate.values()) {
    const [res] = await c.query(
      "INSERT INTO facilities (name, category, assignedRepName, partnerStatus, relationshipStatus, notes, createdAt) VALUES (?,?,?,?,?,?,?)",
      [v.name, inferCat(v.name), clean(v.agent).split(/\s+/)[0], "active_partner", "active_partner", `Added from MTD sheet activity (${v.agent})`, v.date]
    );
    const f = { id: res.insertId, name: v.name };
    facs.push(f);
    const k = norm(v.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(f);
  }
}

// Existing MTD-tagged logs for idempotency
const [existing] = await c.query("SELECT facilityId, repName, contactType, DATE(CONVERT_TZ(contactDate, '+00:00', '-07:00')) d FROM contact_logs WHERE summary LIKE '%[MTD sheet]%'");
const seen = new Set(existing.map((e) => `${e.facilityId}|${first(e.repName)}|${e.contactType}|${e.d instanceof Date ? e.d.toISOString().slice(0, 10) : e.d}`));

const plan = { visits: [], calls: [], unmatchedV: new Set(), unmatchedC: new Set() };
for (const [list, type, out, un] of [[visits, "visit", plan.visits, plan.unmatchedV], [frCheckins, "call", plan.calls, plan.unmatchedC]]) {
  for (const e of list) {
    const f = matchFac(e.facility);
    if (!f) { un.add(`${e.facility} (${e.agent})`); continue; }
    const dayKey = e.date.toISOString().slice(0, 10);
    const key = `${f.id}|${first(e.agent)}|${type}|${dayKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ facilityId: f.id, facilityName: f.name, agent: e.agent, date: e.date, count: Math.min(e.count, 5), type });
  }
}
const totV = plan.visits.reduce((s, p) => s + p.count, 0);
const totC = plan.calls.reduce((s, p) => s + p.count, 0);
console.log(`To create — visits: ${plan.visits.length} facility-days (${totV} logs) | FR check-in calls: ${plan.calls.length} facility-days (${totC} logs)`);
console.log(`Unmatched — visits: ${plan.unmatchedV.size} | check-ins: ${plan.unmatchedC.size}`);
if (plan.unmatchedV.size) console.log("  visit unmatched:\n   " + [...plan.unmatchedV].slice(0, 15).join("\n   "));
if (plan.unmatchedC.size) console.log("  checkin unmatched:\n   " + [...plan.unmatchedC].slice(0, 15).join("\n   "));

if (APPLY) {
  let made = 0;
  for (const p of [...plan.visits, ...plan.calls]) {
    for (let k = 0; k < p.count; k++) {
      await c.query(
        "INSERT INTO contact_logs (facilityId, contactType, contactDate, callResult, callType, summary, repName) VALUES (?,?,?,?,?,?,?)",
        [p.facilityId, p.type, new Date(p.date.getTime() + k * 60000), p.type === "call" ? "other" : null, p.type === "call" ? "fr_checkin" : null, `${p.type === "visit" ? "FR visit" : "FR check-in call"} by ${p.agent} [MTD sheet]`, p.agent]
      );
      made++;
    }
  }
  fs.writeFileSync("scripts/migration/backfill-mtd-v11-summary.json", JSON.stringify({ made, visits: plan.visits.length, calls: plan.calls.length, unmatchedV: [...plan.unmatchedV], unmatchedC: [...plan.unmatchedC] }, null, 2));
  console.log(`\nAPPLIED — ${made} contact logs created. (Re-runs are no-ops — tagged [MTD sheet].)`);
} else {
  console.log("\nDRY RUN — re-run with --apply to write.");
}
await c.end();
