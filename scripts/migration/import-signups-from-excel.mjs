/**
 * Rebuild sign-ups from the "SIGN UPS PER FACILITY" sheet of the MTD BDR
 * CHECK-IN & FR VISIT REPORT workbook, into lead_intake — the table the
 * Sign-ups Report (/signups-report) counts.
 *
 * The sheet is AGGREGATED: one row per rep+facility, then a five-column block
 * per month (HIGH / MEDIUM / LOW / RANK X / TOTAL). lead_intake stores one row
 * per sign-up, so each count is expanded into that many rows. The originals
 * carry no client names or exact days, so each generated row is dated to the
 * middle of its month and marked as reconstructed in `notes` — the monthly,
 * per-rep, per-facility and per-tier totals are exact; individual identities
 * are not recoverable from this source.
 *
 *   node scripts/migration/import-signups-from-excel.mjs "<MTD workbook.xlsx>" [--year 2026] --dry
 *   node scripts/migration/import-signups-from-excel.mjs "<MTD workbook.xlsx>"
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = process.argv.find((a) => a.toLowerCase().endsWith(".xlsx"));
const dry = process.argv.includes("--dry");
const yearArg = process.argv[process.argv.indexOf("--year") + 1];
const YEAR = /^\d{4}$/.test(yearArg || "") ? Number(yearArg) : 2026;
if (!FILE) { console.error("Usage: node import-signups-from-excel.mjs <MTD workbook.xlsx> [--year 2026] [--dry]"); process.exit(1); }

const SHEET = "SIGN UPS PER FACILITY";
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST"];
const TIERS = ["High", "Medium", "Low", "Rank X"];   // column order inside each month block
const FIRST_MONTH_COL = 6;                            // col 6 = JANUARY / HIGH
const BLOCK = 5;                                      // HIGH, MEDIUM, LOW, RANK X, TOTAL

const norm = (s) => String(s ?? "").trim();
const clamp = (s, n) => (norm(s) === "" ? null : norm(s).replace(/[\r\n\t]+/g, " ").slice(0, n));
const count = (v) => { const n = Number(norm(v)); return isFinite(n) && n > 0 ? Math.round(n) : 0; };

const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`sheet "${SHEET}" not found`); process.exit(1); }
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

const signups = [];
let rowsUsed = 0, tierMismatch = 0;
for (const r of rows.slice(4)) {                      // data starts under the two header rows
  const member = norm(r[1]);
  const facility = norm(r[2]);
  if (!member && !facility) continue;
  if (/^name$|^facility name$/i.test(member)) continue;
  rowsUsed++;
  const role = norm(r[0]);
  const type = norm(r[3]);
  const territory = norm(r[4]);
  const location = norm(r[5]);

  MONTHS.forEach((monthName, mi) => {
    const base = FIRST_MONTH_COL + mi * BLOCK;
    const tierCounts = TIERS.map((_, ti) => count(r[base + ti]));
    const stated = count(r[base + 4]);                // the sheet's own TOTAL column
    const summed = tierCounts.reduce((a, b) => a + b, 0);
    if (stated && summed !== stated) tierMismatch++;
    // Mid-month: the sheet records a month, never a day.
    const when = new Date(Date.UTC(YEAR, mi, 15));
    tierCounts.forEach((n, ti) => {
      for (let k = 0; k < n; k++) {
        signups.push({ when, month: monthName, role, member, facility, type, territory, location, value: TIERS[ti] });
      }
    });
  });
}

const byMonth = {}, byTier = {}, byMember = {};
for (const s of signups) {
  const k = s.month.slice(0, 3);
  byMonth[k] = (byMonth[k] || 0) + 1;
  byTier[s.value] = (byTier[s.value] || 0) + 1;
  byMember[s.member] = (byMember[s.member] || 0) + 1;
}
console.log(`Source rows used : ${rowsUsed}`);
console.log(`Sign-ups expanded: ${signups.length}`);
console.log("By month :", byMonth);
console.log("By tier  :", byTier);
console.log("By member:", Object.entries(byMember).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join("  "));
if (tierMismatch) console.log(`note: ${tierMismatch} month cells where HIGH+MEDIUM+LOW+RANK X did not equal the sheet's TOTAL column (tier columns are used, TOTAL ignored)`);

if (dry) { console.log("\n[DRY RUN] nothing written."); process.exit(0); }

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [del] = await c.query("DELETE FROM lead_intake WHERE notes LIKE 'Reconstructed from SIGN UPS PER FACILITY%'");
console.log(`cleared previous reconstructions: ${del.affectedRows}`);

let ok = 0, bad = 0;
for (const s of signups) {
  try {
    await c.query(
      `INSERT INTO lead_intake (leadDate, role, member, leadName, value, outcome, facility, typeOfFacility, clientLocation, notes, createdAt, updatedAt)
       VALUES (?,?,?,?,?,'Signed',?,?,?,?,NOW(),NOW())`,
      [s.when, clamp(s.role, 80), clamp(s.member, 120), "(name not recorded)", clamp(s.value, 60),
       clamp(s.facility, 255), clamp(s.type, 120), clamp(s.location, 255),
       `Reconstructed from SIGN UPS PER FACILITY — ${s.month} ${YEAR}, ${s.value}` + (s.territory ? `, territory ${s.territory}` : "")]
    );
    ok++;
  } catch (e) { bad++; if (bad <= 5) console.warn("insert failed:", e.message.slice(0, 120)); }
}
console.log(`✅ Inserted ${ok} sign-ups${bad ? `, ${bad} failed` : ""}.`);
await c.end();
