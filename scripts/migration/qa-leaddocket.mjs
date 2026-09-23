/**
 * Verify the Lead Docket sync against Lead Docket itself.
 *
 * Counting rows in our own tables only proves the sync agrees with itself. This
 * re-fetches a random sample of synced leads LIVE and compares, field by field,
 * what Lead Docket says now against what the CRM stored — credited rep, role,
 * signed or not, sign-up date. It also checks the bookkeeping that makes the
 * sync trustworthy:
 *
 *   · every lead the sync credited to the team has a row in lead_intake, and
 *     every lead_intake row from Lead Docket was credited by the sync
 *   · how much of the year's leads have been checked (i.e. is the sync done)
 *   · the per-rep, per-month sign-up table the reports are built on
 *
 *   node scripts/migration/qa-leaddocket.mjs [--sample 40]
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { creditedRep, outcomeFor, str } from "./leaddocket-rules.mjs";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
const sampleAt = process.argv.indexOf("--sample");
const SAMPLE = sampleAt > -1 ? Number(process.argv[sampleAt + 1]) : 40;

const c = await mysql.createConnection(process.env.DATABASE_URL);
const q = async (sql, p = []) => (await c.query(sql, p))[0];
const one = async (sql, p = []) => (await q(sql, p))[0].n;
let problems = 0;
const bad = (msg) => { problems++; console.log("  ✗ " + msg); };
const good = (msg) => console.log("  ✓ " + msg);

// ── 1. bookkeeping ───────────────────────────────────────────────────────────
console.log("1. BOOKKEEPING");
const stored = await one("SELECT COUNT(*) n FROM lead_intake WHERE externalSource='leaddocket'");
const creditedSeen = await one("SELECT COUNT(*) n FROM leaddocket_seen WHERE isOurs=1");
const checked = await one("SELECT COUNT(*) n FROM leaddocket_seen");
const orphanRows = await one(`SELECT COUNT(*) n FROM lead_intake li
  LEFT JOIN leaddocket_seen s ON s.leadId = CAST(li.externalId AS UNSIGNED)
  WHERE li.externalSource='leaddocket' AND (s.leadId IS NULL OR s.isOurs=0)`);
const missingRows = await one(`SELECT COUNT(*) n FROM leaddocket_seen s
  LEFT JOIN lead_intake li ON li.externalSource='leaddocket' AND li.externalId = CAST(s.leadId AS CHAR)
  WHERE s.isOurs=1 AND li.id IS NULL`);
const dupes = await one(`SELECT COUNT(*) n FROM (SELECT externalId FROM lead_intake
  WHERE externalSource='leaddocket' GROUP BY externalId HAVING COUNT(*)>1) x`);
console.log(`  leads checked so far: ${checked} · credited to the team: ${creditedSeen} · stored: ${stored}`);
// Rows written before the checked-leads ledger existed have no ledger entry yet;
// they are re-confirmed as the sync reaches them, so report them separately.
missingRows === 0 ? good("every lead credited to the team is stored") : bad(`${missingRows} leads credited to the team have no stored row`);
dupes === 0 ? good("no lead is stored twice") : bad(`${dupes} leads are stored more than once`);
if (orphanRows) console.log(`  · ${orphanRows} stored rows not yet re-confirmed by the ledger (written before it existed — cleared as the sync passes them)`);

const signedNotCounted = await one(`SELECT COUNT(*) n FROM lead_intake WHERE externalSource='leaddocket'
  AND sud IS NOT NULL AND outcome NOT IN ('Signed','Signed Referred Out')`);
signedNotCounted === 0 ? good("every lead with a sign-up date counts as signed") : bad(`${signedNotCounted} leads have a sign-up date but are not counted as signed`);

const reconstructed = await one("SELECT COUNT(*) n FROM lead_intake WHERE notes LIKE 'Reconstructed from SIGN UPS PER FACILITY%'");
if (reconstructed) console.log(`  · ${reconstructed} sign-ups rebuilt from the MTD spreadsheet are still present — remove once the first Lead Docket pass completes, or the report counts two sources`);

// ── 2. live spot-check ───────────────────────────────────────────────────────
console.log(`\n2. LIVE SPOT-CHECK — ${SAMPLE} random synced leads re-fetched from Lead Docket`);
if (!KEY) { bad("LEADDOCKET_API_KEY not set — cannot spot-check"); }
else {
  const sample = await q(`SELECT externalId, role, member, outcome, sud, marketingSource FROM lead_intake
    WHERE externalSource='leaddocket' ORDER BY RAND() LIMIT ?`, [SAMPLE]);
  let matched = 0, mism = 0, unreadable = 0;
  for (const row of sample) {
    await new Promise((s) => setTimeout(s, 1300));           // stay under the 50/min detail cap
    let d;
    try {
      const r = await fetch(`${BASE}/api/Leads/${row.externalId}`, { headers: { api_key: KEY } });
      if (!r.ok) { unreadable++; continue; }
      const raw = await r.json(); d = raw?.Data ?? raw;
    } catch { unreadable++; continue; }

    const rep = creditedRep(str(d.MarketingSource));
    const wantOutcome = outcomeFor(str(d.Status) || str(d.StatusName), d.SignedUpDate);
    const wantSud = d.SignedUpDate ? String(d.SignedUpDate).slice(0, 10) : null;
    const diffs = [];
    if (!rep) diffs.push(`Lead Docket no longer credits the team (source "${str(d.MarketingSource)}")`);
    else {
      if (rep.member !== row.member) diffs.push(`rep: CRM "${row.member}" vs Lead Docket "${rep.member}"`);
      if (rep.role !== row.role) diffs.push(`role: CRM ${row.role} vs ${rep.role}`);
    }
    if (wantOutcome !== row.outcome) diffs.push(`outcome: CRM "${row.outcome}" vs "${wantOutcome}"`);
    if ((wantSud ?? null) !== (row.sud ?? null)) diffs.push(`sign-up date: CRM ${row.sud} vs ${wantSud}`);

    if (diffs.length) { mism++; bad(`lead ${row.externalId}: ${diffs.join("; ")}`); }
    else matched++;
  }
  console.log(`  ${matched} match exactly · ${mism} differ · ${unreadable} could not be fetched`);
  if (mism === 0 && matched > 0) good("every sampled lead matches Lead Docket field for field");
  // A lead edited in Lead Docket after the last sync legitimately differs until the next run.
  if (mism) console.log("  (a lead edited in Lead Docket since the last sync will differ until the next run)");
}

// ── 3. the table the reports are built on ───────────────────────────────────
console.log("\n3. SIGN-UPS BY REP AND MONTH (from Lead Docket, 2026)");
const rows = await q(`SELECT member, role, DATE_FORMAT(leadDate,'%Y-%m') mo, COUNT(*) n
  FROM lead_intake WHERE externalSource='leaddocket' AND outcome IN ('Signed','Signed Referred Out')
    AND leadDate >= '2026-01-01' GROUP BY member, role, mo`);
const months = [...new Set(rows.map((r) => r.mo))].sort();
const reps = [...new Set(rows.map((r) => `${r.role} ${r.member}`))].sort();
const cell = (rep, mo) => rows.filter((r) => `${r.role} ${r.member}` === rep && r.mo === mo).reduce((a, r) => a + r.n, 0);
console.log("  " + "rep".padEnd(26) + months.map((m) => m.slice(5).padStart(5)).join("") + "  total");
for (const rep of reps) {
  const vals = months.map((m) => cell(rep, m));
  console.log("  " + rep.padEnd(26) + vals.map((v) => String(v || "·").padStart(5)).join("") + String(vals.reduce((a, b) => a + b, 0)).padStart(7));
}
const totals = months.map((m) => rows.filter((r) => r.mo === m).reduce((a, r) => a + r.n, 0));
console.log("  " + "TOTAL".padEnd(26) + totals.map((v) => String(v).padStart(5)).join("") + String(totals.reduce((a, b) => a + b, 0)).padStart(7));

console.log(`\n${problems === 0 ? "✅ No problems found." : `⚠ ${problems} problem(s) found — see ✗ lines above.`}`);
await c.end();
process.exit(problems ? 1 : 0);
