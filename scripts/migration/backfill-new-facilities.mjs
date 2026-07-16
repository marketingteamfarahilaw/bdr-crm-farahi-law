/**
 * Backfills the MTD "NEW FACILITIES" sheet into the CRM so the New Facilities
 * report shows the team's REAL acquisitions with the sheet's DATE ADDED.
 * For each facility listed under an agent in the workbook:
 *   - match it in the CRM by name (exact normalized, else unique contains)
 *   - set createdAt = the sheet's DATE ADDED (acquisition date)
 *   - prepend "Added <date> (MTD sheet)" to notes so the bulk-import exclusion
 *     no longer hides it from the "new added" report
 *   - set assignedRepName to the sheet's agent ONLY if currently unassigned
 * Unmatched / ambiguous names are reported, never guessed. Full backup.
 *
 * DRY RUN by default:  node scripts/migration/backfill-new-facilities.mjs
 * Apply:               node scripts/migration/backfill-new-facilities.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const WB = "C:/Users/EOR - 4055/Downloads/MTD NEW FACILITIES REPORT - BDR & FR (2).xlsx";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000);

// ── Parse both sheets: agent blocks with (name, dateAdded) entries ──
// An AGENT header is a name row followed (within 3 rows) by the
// "NEW FACILITY ADDED | DATE ADDED" header — facility names never are.
const wb = xlsx.readFile(WB);
const entries = []; // {agent, name, date}
for (const sn of wb.SheetNames) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });
  let agent = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c1 = clean(r[1]);
    if (!c1) continue;
    const isHeader = /NEW FACILITY|DATE ADDED|NAME|TOTAL|REPORT|REPRESENTATIVES|NO\. OF/i.test(c1);
    if (!isHeader && !r[2]) {
      const lookahead = rows.slice(i + 1, i + 4).some((rr) => /NEW FACILITY ADDED/i.test(clean(rr[1])));
      // Agent headers are 1-3 word names (BDRs full names, FRs first names only)
      if (lookahead && /^[A-Za-z][A-Za-z .’'&-]*$/.test(c1) && !/\d/.test(c1) && c1.split(/\s+/).length <= 3) { agent = c1; continue; }
    }
    // Added entry: name in col1 + excel date serial in col2
    if (agent && !isHeader && typeof r[2] === "number" && r[2] > 40000 && r[2] < 60000) {
      const raw = String(r[1]);
      if (raw.includes("\n")) {
        // Multi-facility cell ("VIP Collision in Pomona\nSanchez Body Shop in North Hollywood\n…")
        for (const line of raw.split(/\n+/)) {
          const nm = clean(line).replace(/\s+in\s+[A-Za-z .]+$/i, "").trim();
          if (nm) entries.push({ agent, name: nm, date: serialToDate(r[2]) });
        }
      } else if (c1.length <= 80) {
        entries.push({ agent, name: c1, date: serialToDate(r[2]) });
      }
    }
  }
}
console.log(`Parsed ${entries.length} manual "new facility added" entries from the workbook:`);
const byAgent = new Map();
for (const e of entries) { byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + 1); }
for (const [a, n] of byAgent) console.log(`  ${a}: ${n}`);

// ── Match against the CRM ──
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, assignedRepName, createdAt, notes FROM facilities");
const byNorm = new Map();
for (const f of facs) { const k = norm(f.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(f); }

const matched = [], unmatched = [], ambiguous = [];
for (const e of entries) {
  const k = norm(e.name);
  let cands = byNorm.get(k) ?? [];
  if (!cands.length && k.length >= 6) {
    const hits = [];
    for (const [fk, fv] of byNorm) if (fk.includes(k) || (fk.length >= 6 && k.includes(fk))) hits.push(...fv);
    cands = hits;
  }
  if (cands.length === 1) matched.push({ ...e, facility: cands[0] });
  else if (cands.length > 1) {
    // Duplicate rows / multi-location: take the lowest id (the original record).
    const pick = [...cands].sort((a, b) => a.id - b.id)[0];
    matched.push({ ...e, facility: pick, note: `picked #${pick.id} of ${cands.length}` });
    ambiguous.push({ ...e, candidates: cands.map((x) => `#${x.id} ${x.name}`), picked: pick.id });
  } else unmatched.push(e);
}
console.log(`\nMatched: ${matched.length} | unmatched: ${unmatched.length} | ambiguous: ${ambiguous.length}`);
if (unmatched.length) console.log("  UNMATCHED:\n   " + unmatched.map((e) => `${e.name} (${e.agent})`).join("\n   "));
if (ambiguous.length) console.log("  AMBIGUOUS:\n   " + ambiguous.map((e) => `${e.name} → ${e.candidates.join(" | ")}`).join("\n   "));

console.log("\nSample changes:");
for (const m of matched.slice(0, 10)) console.log(`  #${m.facility.id} "${m.facility.name}" createdAt ${new Date(m.facility.createdAt).toISOString().slice(0, 10)} → ${m.date.toISOString().slice(0, 10)} (${m.agent})`);

const inferCat = (name) => {
  const n = String(name).toLowerCase();
  if (/(chiropract|chiro\b|spine|spinal|\bdc\b|rehabilitation|aligned)/.test(n)) return "chiropractor";
  if (/(urgent care|medical|clinic|health center|wellness)/.test(n)) return "medical_clinic";
  if (/(collision|body shop|auto body|autobody|body and frame|body & frame|auto repair|automotive|auto center|autoshield|paint)/.test(n)) return "body_shop";
  if (/(towing|\btow\b|funeral|insurance|workers center)/.test(n)) return "other";
  return "other";
};

if (APPLY) {
  const backup = { updated: [], created: [] };
  const firstName = (s) => clean(s).split(/\s+/)[0];
  for (const m of matched) {
    const f = m.facility;
    backup.updated.push({ id: f.id, oldCreatedAt: f.createdAt, oldRep: f.assignedRepName, oldNotesPrefix: String(f.notes ?? "").slice(0, 60) });
    const marker = `Added ${m.date.toISOString().slice(0, 10)} by ${m.agent} (MTD sheet)`;
    const newNotes = String(f.notes ?? "").startsWith("Added ") ? f.notes : `${marker}${f.notes ? " · " + f.notes : ""}`;
    const setRep = !clean(f.assignedRepName) ? firstName(m.agent) : null;
    await c.query(
      `UPDATE facilities SET createdAt=?, notes=?${setRep ? ", assignedRepName=?" : ""} WHERE id=?`,
      setRep ? [m.date, newNotes, setRep, f.id] : [m.date, newNotes, f.id]
    );
  }
  // Genuinely-new partners that only exist on the sheet → create them.
  for (const e of unmatched) {
    if (e.name.length > 80) continue; // note blob, not a facility name
    const res = await c.query(
      "INSERT INTO facilities (name, category, assignedRepName, partnerStatus, relationshipStatus, notes, createdAt) VALUES (?,?,?,?,?,?,?)",
      [e.name.slice(0, 255), inferCat(e.name), firstName(e.agent), "active_partner", "active_partner", `Added ${e.date.toISOString().slice(0, 10)} by ${e.agent} (MTD sheet)`, e.date]
    );
    backup.created.push({ id: res[0].insertId, name: e.name });
  }
  fs.writeFileSync("scripts/migration/backfill-new-facilities-backup.json", JSON.stringify(backup, null, 2));
  console.log(`\nAPPLIED — ${matched.length} backfilled, ${backup.created.length} created (backup → backfill-new-facilities-backup.json).`);
} else {
  console.log("\nDRY RUN — re-run with --apply to write.");
}
await c.end();
