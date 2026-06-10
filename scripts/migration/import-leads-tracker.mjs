/**
 * Imports the "New Sales Tracker" sheet of BDR_FR Leads Tracker (1).xlsx into
 * lead_intake so the Team Reports (Sign-Ups, Leads & Targets) match the Excel.
 * Idempotent — skips rows already present (leadName + leadDate + member).
 */
import "dotenv/config";
import xlsx from "xlsx";
import mysql from "mysql2/promise";

const FILE = "C:/Users/EOR - 4055/Downloads/BDR_FR Leads Tracker (1).xlsx";
const wb = xlsx.readFile(FILE);
const ws = wb.Sheets["New Sales Tracker"];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

const serialToDate = (v) => {
  const n = Number(v);
  if (!isFinite(n) || n < 40000 || n > 60000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000 + 12 * 3600000); // noon UTC, day-stable
};
const serialToUs = (v) => {
  const d = serialToDate(v);
  return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}` : null;
};
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const c = await mysql.createConnection(process.env.DATABASE_URL);
let inserted = 0, skipped = 0, dupes = 0;

for (let i = 2; i < rows.length; i++) {  // rows 1-2 are headers
  const r = rows[i];
  const leadName = clean(r[7]);
  if (!leadName) { skipped++; continue; }
  const leadDate = serialToDate(r[0]) ?? serialToDate(r[3]);
  if (!leadDate) { skipped++; continue; }

  const member = clean(r[1]);                       // TM (FR/BDR)
  const attribution = clean(r[6]);                  // "Field Representative X / Facility" | "BDR Y / Facility"
  // Role comes from WHO the TM is (roster), not the attribution text — a lead
  // sourced via a BDR facility can still belong to an FR.
  const role = /zulema|lupe|genysys|jezel/i.test(member) ? "FR"
    : /grace|ally|queenie|miguel/i.test(member) ? "BDR"
    : /field representative/i.test(attribution) ? "FR" : "BDR";
  // facility = text after the rep name's slash, if any
  let facility = null;
  const slash = attribution.indexOf("/");
  if (slash > -1) facility = clean(attribution.slice(slash + 1)) || null;

  const value = clean(r[8]) || null;
  const caseType = clean(r[9]) || null;             // goes to classification? No — typeOfFacility is wrong; use classification for caseType per tracker
  const finalOutcome = clean(r[14]) || clean(r[10]) || null;
  const sud = serialToUs(r[12]);
  const phone = clean(r[5]) || null;
  const intakeBy = clean(r[4]);

  const [exist] = await c.query(
    "SELECT id FROM lead_intake WHERE leadName = ? AND member = ? AND DATE(leadDate) = DATE(?) LIMIT 1",
    [leadName, member, leadDate],
  );
  if (exist.length) { dupes++; continue; }

  await c.query(
    `INSERT INTO lead_intake (leadDate, role, member, leadName, phone, value, outcome, classification, sud, facility, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadDate, role, member, leadName, phone, value, finalOutcome, caseType, sud, facility,
     intakeBy ? `Imported from Leads Tracker. Intake by: ${intakeBy}` : "Imported from Leads Tracker"],
  );
  inserted++;
}

const [tot] = await c.query("SELECT COUNT(*) n FROM lead_intake");
console.log(`Inserted ${inserted}, duplicates skipped ${dupes}, empty skipped ${skipped}. lead_intake total: ${tot[0].n}`);
await c.end();
