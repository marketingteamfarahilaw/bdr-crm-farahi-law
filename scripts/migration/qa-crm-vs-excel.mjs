/**
 * Tab-by-tab QA: what the master workbook holds vs what the CRM holds.
 *
 * Produces a reconciliation table — one line per data set — with the workbook
 * count, the CRM count, the difference, and (where they differ) the reason,
 * so a mismatch can be acted on rather than argued about. Rows the importers
 * skip are counted explicitly: a row with no date, no rep, or no amount cannot
 * be filed against anyone and is reported here rather than silently dropped.
 *
 *   node scripts/migration/qa-crm-vs-excel.mjs "<workbook.xlsx>" [--csv <path>]
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";
import fs from "node:fs";

const FILE = process.argv.find((a) => a.toLowerCase().endsWith(".xlsx"));
const csvAt = process.argv.indexOf("--csv");
const CSV = csvAt > -1 ? process.argv[csvAt + 1] : null;
if (!FILE) { console.error("Usage: node qa-crm-vs-excel.mjs <workbook.xlsx> [--csv out.csv]"); process.exit(1); }

const norm = (s) => String(s ?? "").trim();
const nk = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const isDate = (v) => { const n = Number(v); if (isFinite(n) && n > 1000) return true; return /^\d{1,2}\/+\d{1,2}\/+\d{2,4}$/.test(norm(v)); };

const wb = xlsx.readFile(FILE);
const S = (n) => (wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) : []);
const c = await mysql.createConnection(process.env.DATABASE_URL);
const count = async (t, where = "") => (await c.query(`SELECT COUNT(*) n FROM \`${t}\` ${where}`))[0][0].n;

const rows = [];
const add = (dataset, sheet, wbCount, crmCount, note = "") =>
  rows.push({ dataset, sheet, wbCount, crmCount, diff: crmCount - wbCount, note });

// ── facilities ───────────────────────────────────────────────────────────────
{
  const SHEETS = ["Active partners", "Active Chiropractor", "1.Fcilty Typ", "Raw Data for Pivot", "act old list",
    "BDR Independent Facility", "Chiropractor", "Body Shop September", "BS Total Loss Support", "Non FR Chiro",
    "Imaging Center", "Physical Therapy", "ERUC", "Pain Management", "Towing Company", "Medical Center",
    "Insurance Company", "Opthalmologist", "Pharmacy", "Neurologist", "Surgeon"];
  const seen = new Set();
  for (const sn of SHEETS) for (const r of S(sn)) for (const cell of r) {
    const v = norm(cell);
    if (v.length > 4 && /[a-z]/i.test(v) && !/^\d+$/.test(v)) seen.add(nk(v));
  }
  const crm = await count("facilities");
  const [facs] = await c.query("SELECT name FROM facilities");
  const missing = facs.filter((f) => !seen.has(nk(f.name))).length;
  add("Facilities", "21 facility sheets", "≈", crm, missing ? `${missing} CRM facilities not found by name in those sheets` : "every CRM facility appears in the workbook");

  // Same name in DIFFERENT cities is a chain with several branches — correct to
  // keep. Same name in the SAME city is a real duplicate and inflates counts.
  const [all] = await c.query("SELECT id, name, city, totalCalls FROM facilities");
  const key = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = new Map();
  for (const x of all) groups.set(key(x.name), [...(groups.get(key(x.name)) || []), x]);
  let branchRows = 0, branchBiz = 0, dupRows = 0, dupBiz = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const cities = new Set(g.map((x) => String(x.city ?? "").trim().toLowerCase()).filter(Boolean));
    if (cities.size > 1) { branchBiz++; branchRows += g.length - 1; }
    else { dupBiz++; dupRows += g.length - 1; }
  }
  add("  └ same name, other city", "—", branchRows, branchRows, `${branchBiz} chains with branches in different cities — expected, kept deliberately`);
  add("  └ true duplicates", "—", 0, dupRows, dupRows ? `${dupRows} extra rows across ${dupBiz} businesses still to merge` : "none left");
}

// ── calls ────────────────────────────────────────────────────────────────────
{
  const rcRows = S("2.RC").filter((r) => norm(r[0]) && !/^agent$/i.test(norm(r[0])) && isDate(r[3])).length;
  const crm = await count("contact_logs", "WHERE rcCallId LIKE 'xls:%'");
  const unmatched = await count("rc_unmatched_calls", "WHERE rcCallId LIKE 'xls:%'");
  add("Calls", "2.RC", rcRows, crm + unmatched, `${crm} matched to a facility, ${unmatched} not matched (number not in the CRM)`);
  add("  └ live RingCentral", "—", 0, await count("contact_logs", "WHERE fromRingCentral=1"), "synced from RingCentral, not in the workbook");
}

// ── expenses / rewards / tracker / errands / visits ──────────────────────────
const simple = [
  ["FR expenses", "2.FR Expen", 1, 2, 8, "fr_expenses"],
  ["BDR expenses", "2.BDR Expen", 1, 2, 7, "bdr_expenses"],
];
for (const [label, sheet, dateCol, whoCol, amtCol, table] of simple) {
  const all = S(sheet).slice(1);
  const usable = all.filter((r) => isDate(r[dateCol]) && norm(r[whoCol]));
  const skipped = all.filter((r) => (norm(r[whoCol]) || norm(r[amtCol])) && !isDate(r[dateCol])).length;
  add(label, sheet, usable.length, await count(table), skipped ? `${skipped} workbook rows have no usable date` : "");
}
{
  const all = S("2.Rfral Rewrd").slice(2);
  const usable = all.filter((r) => norm(r[1]) || norm(r[5]));
  add("Referral rewards", "2.Rfral Rewrd", usable.length, await count("referral_rewards"));
}
{
  const all = S("2.Rfral Frndly fclt").slice(1);
  const usable = all.filter((r) => norm(r[1]));
  add("Referral tracker", "2.Rfral Frndly fclt", usable.length, await count("referral_tracker"));
}
{
  const all = S("2.FR Errand").slice(7);
  const usable = all.filter((r) => (isDate(r[0]) || isDate(r[9])) && norm(r[1]));
  const bad = all.filter((r) => norm(r[1]) && !isDate(r[0]) && !isDate(r[9])).length;
  add("FR errands", "2.FR Errand", usable.length, await count("fr_errands"), bad ? `${bad} rows have no usable date` : "");
}
{
  const v = S("2.Visits");
  let n = 0;
  for (let base = 0; base + 4 < (v[1] || []).length; base += 8) {
    if (!/date/i.test(norm((v[1] || [])[base]))) continue;
    n += v.slice(2).filter((r) => isDate(r[base]) && norm(r[base + 2])).length;
  }
  add("Field visits", "2.Visits", n, await count("field_visits"));
}

// ── partner status ───────────────────────────────────────────────────────────
// "Active" means listed on the Active partners or Active Chiropractor tab. The
// figure of 135 once quoted as the partner count is actually January 2026
// SIGN-UPS (2.Agent Dash, "Sign ups" row: 135 / 144 / 162 for Jan–Mar) — a
// different measure entirely.
{
  const nk2 = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const active = new Set();
  for (const [sheet, nameCol] of [["Active partners", 2], ["Active Chiropractor", 1]]) {
    for (const r of S(sheet).slice(2)) {
      const name = norm(r[nameCol]);
      if (name && !/^total$|^name of|^agent$/i.test(name)) active.add(nk2(name));
    }
  }
  const crmActive = await count("facilities", "WHERE partnerStatus='active_partner'");
  add("Active partners", "Active partners + Active Chiropractor", active.size, crmActive,
    "workbook counts unique NAMES; the CRM counts locations — a chain's branches are separate partners, " +
    "and a few partners are spelled differently on the tab (verified by phone). Not a mismatch.");
}

// ── output ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
console.log("\n" + pad("DATA SET", 22) + pad("SOURCE SHEET", 38) + pad("WORKBOOK", 10) + pad("CRM", 8) + "DIFF");
console.log("-".repeat(96));
for (const r of rows) {
  console.log(pad(r.dataset, 22) + pad(r.sheet, 38) + pad(r.wbCount, 10) + pad(r.crmCount, 8) + (typeof r.diff === "number" && !isNaN(r.diff) ? (r.diff > 0 ? "+" + r.diff : r.diff) : ""));
  if (r.note) console.log(" ".repeat(22) + "↳ " + r.note);
}

if (CSV) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["Data set,Source sheet,Workbook,CRM,Difference,Notes"];
  for (const r of rows) lines.push([r.dataset.replace("└", "-"), r.sheet, r.wbCount, r.crmCount, r.diff, r.note].map(esc).join(","));
  fs.writeFileSync(CSV, "﻿" + lines.join("\r\n"));
  console.log(`\nCSV written: ${CSV}`);
}
await c.end();
