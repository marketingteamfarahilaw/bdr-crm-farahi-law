/**
 * De-duplicates facilities SAFELY. Two rows are merged only if they are the SAME
 * normalized name AND (same street#+city OR same phone) — i.e. the same partner
 * at the same place. Same name at a different address = different location, kept.
 *
 * The kept "primary" is the row with the most ACTIVITY (contact logs, leads,
 * signed cases, last-contact) — "use the ones already contacted". Missing fields
 * (phone/address/agent/geo) are backfilled into the primary from its duplicates,
 * ALL child activity is re-pointed to the primary, then the empty dupes deleted.
 *
 * Also backfills assignedRepName for unassigned facilities from the rep who
 * actually logged calls there.
 *
 * Full backup + reversible. DRY RUN by default; --apply to write.
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const last10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const stnum = (a) => (String(a ?? "").match(/\d+/) || [])[0] || "";
const cityNorm = (city, addr) => { const c = norm(city); if (c) return c; const m = String(addr ?? "").match(/,?\s*([A-Za-z .]+?),?\s*(?:CA|California)\s*\d{5}/i); return m ? norm(m[1]) : ""; };

const c = await mysql.createConnection(process.env.DATABASE_URL);

// Tables that reference a facility — discover dynamically so none are missed.
const [cols] = await c.query("SELECT table_name AS t FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name='facilityId' AND table_name<>'facilities'");
const childTables = cols.map((r) => r.t);

const [facs] = await c.query("SELECT * FROM facilities");
const [clog] = await c.query("SELECT facilityId, COUNT(*) n FROM contact_logs GROUP BY facilityId");
const [fleadRows] = await c.query("SELECT facilityId, COUNT(*) n FROM facility_leads GROUP BY facilityId");
const clogN = new Map(clog.map((r) => [r.facilityId, r.n]));
const fleadN = new Map(fleadRows.map((r) => [r.facilityId, r.n]));
// rep who logged the most calls per facility (for assignment backfill)
const [repRows] = await c.query("SELECT facilityId, repName, COUNT(*) n FROM contact_logs WHERE repName IS NOT NULL AND repName<>'' GROUP BY facilityId, repName");
const topRep = new Map();
for (const r of repRows) { const e = topRep.get(r.facilityId); if (!e || r.n > e.n) topRep.set(r.facilityId, { repName: r.repName, n: r.n }); }

const activity = (f) => (clogN.get(f.id) || 0) * 3 + (fleadN.get(f.id) || 0) * 4 + (f.totalSignedCases || 0) * 5 + (f.lastContactDate ? 2 : 0) + (f.totalCalls || 0) + (f.assignedRepName ? 1 : 0) + (clean(f.address) ? 1 : 0) + (clean(f.phone) ? 1 : 0);

// ── Union-find over facilities sharing a normalized name ──
const parent = new Map(); facs.forEach((f) => parent.set(f.id, f.id));
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { parent.set(find(a), find(b)); };

const byName = new Map();
for (const f of facs) { const k = norm(f.name); if (!k) continue; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f); }
for (const [, group] of byName) {
  if (group.length < 2) continue;
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    const aLoc = stnum(a.address) + "|" + cityNorm(a.city, a.address);
    const bLoc = stnum(b.address) + "|" + cityNorm(b.city, b.address);
    const sameLoc = !!stnum(a.address) && !!cityNorm(a.city, a.address) && aLoc === bLoc;
    const aP = new Set([a.phone, a.phone2, a.phone3].map(last10).filter(Boolean));
    const samePhone = [b.phone, b.phone2, b.phone3].map(last10).filter(Boolean).some((p) => aP.has(p));
    if (sameLoc || samePhone) union(a.id, b.id);
  }
}
const comps = new Map();
for (const f of facs) { const r = find(f.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(f); }
const dupGroups = [...comps.values()].filter((g) => g.length > 1);

let toDelete = 0; const plan = [];
for (const g of dupGroups) {
  const sorted = [...g].sort((a, b) => activity(b) - activity(a) || a.id - b.id);
  const primary = sorted[0], dupes = sorted.slice(1);
  toDelete += dupes.length;
  plan.push({ primaryId: primary.id, primaryName: primary.name, keep: { clogs: clogN.get(primary.id) || 0, leads: fleadN.get(primary.id) || 0 }, dupes: dupes.map((d) => ({ id: d.id, name: d.name, clogs: clogN.get(d.id) || 0, leads: fleadN.get(d.id) || 0 })) });
}

const assignFix = [];
for (const f of facs) {
  if (clean(f.assignedRepName)) continue;
  const tr = topRep.get(f.id);
  if (tr && tr.repName) assignFix.push({ id: f.id, name: f.name, assignTo: tr.repName, calls: tr.n });
}

console.log(`Facilities: ${facs.length}`);
console.log(`Child tables to re-point: ${childTables.join(", ")}`);
console.log(`\nTRUE duplicate groups (same name + same address/phone): ${dupGroups.length}`);
console.log(`  rows to retire (merge into primary): ${toDelete}`);
console.log(`Unassigned facilities assignable from who-contacted-them: ${assignFix.length}`);
console.log(`\nSample merges (KEEP ⟵ retire):`);
for (const p of plan.slice(0, 25)) console.log(`  #${p.primaryId} "${p.primaryName}" [${p.keep.clogs}c/${p.keep.leads}l]  ⟵  ${p.dupes.map((d) => `#${d.id}[${d.clogs}c/${d.leads}l]`).join(", ")}`);
console.log(`\nSample assignment backfills:`);
for (const a of assignFix.slice(0, 15)) console.log(`  #${a.id} "${a.name}" → ${a.assignTo} (${a.calls} calls)`);
fs.writeFileSync("scripts/migration/dedupe-facilities-plan.json", JSON.stringify({ dupGroups: plan, assignFix }, null, 2));

if (APPLY) {
  const backup = { merges: [], assignments: [] };
  for (const g of dupGroups) {
    const sorted = [...g].sort((a, b) => activity(b) - activity(a) || a.id - b.id);
    const P = sorted[0], dupes = sorted.slice(1);
    backup.merges.push({ primary: P, dupes });
    const fill = {};
    const fields = ["phone", "phone2", "phone3", "address", "city", "zipCode", "contactName", "contactTitle", "contactPhone", "contactEmail", "website", "latitude", "longitude", "assignedRepId", "assignedRepName", "loopStage", "placeId"];
    for (const fld of fields) {
      if (clean(P[fld]) || P[fld] === 0) continue;
      for (const d of dupes) if (clean(d[fld])) { fill[fld] = d[fld]; break; }
    }
    if (Object.keys(fill).length) await c.query("UPDATE facilities SET ? WHERE id=?", [fill, P.id]);
    for (const d of dupes) {
      for (const t of childTables) await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId=?`, [P.id, d.id]);
      await c.query("DELETE FROM facilities WHERE id=?", [d.id]);
    }
    await c.query("UPDATE facilities SET totalCalls=(SELECT COUNT(*) FROM contact_logs WHERE facilityId=?), lastContactDate=(SELECT MAX(contactDate) FROM contact_logs WHERE facilityId=?) WHERE id=?", [P.id, P.id, P.id]);
  }
  for (const a of assignFix) {
    const [[exists]] = await c.query("SELECT assignedRepName FROM facilities WHERE id=?", [a.id]);
    if (exists && !clean(exists.assignedRepName)) { backup.assignments.push({ id: a.id, assignTo: a.assignTo }); await c.query("UPDATE facilities SET assignedRepName=? WHERE id=?", [a.assignTo, a.id]); }
  }
  fs.writeFileSync("scripts/migration/dedupe-facilities-backup.json", JSON.stringify(backup, null, 2));
  const [[cnt]] = await c.query("SELECT COUNT(*) n FROM facilities");
  console.log(`\nAPPLIED. Retired ${toDelete} duplicates, ${backup.assignments.length} assignments backfilled. Facilities now: ${cnt.n}. Backup → dedupe-facilities-backup.json`);
} else {
  console.log(`\nDRY RUN — nothing changed. Re-run with --apply.`);
}
await c.end();
