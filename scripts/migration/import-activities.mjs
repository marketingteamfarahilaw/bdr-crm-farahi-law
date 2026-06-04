// Import BDR/FR activity data from the workbook into the matching CRM tables.
// FR Expenses, BDR Expenses, Referral Rewards, Referral Tracker, Field Visits.
// (FR Errand sheet is only a summary count — nothing to import; demo cleared.)
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = "C:/Users/EOR - 4055/Downloads/Centralized BDR_FR Reports (3).xlsx";
const wb = xlsx.readFile(FILE); // raw (serials), we convert ourselves
const S = (n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
const norm = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim();
const toDate = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === "number" && v > 1) return new Date(Math.round((v - 25569) * 86400000));
  if (typeof v === "string" && v.trim()) { const d = new Date(v); return isNaN(+d) ? null : d; }
  return null;
};
const num = (v) => { let n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); if (isNaN(n)) n = 0; return Math.max(-99999999.99, Math.min(99999999.99, n)); };
const clip = (s, n) => { const t = norm(s); return t ? t.slice(0, n) : null; };

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone FROM facilities");
const fidByName = new Map();
for (const f of facs) { const k = norm(f.name).toLowerCase().replace(/[^a-z0-9]/g, ""); if (k && !fidByName.has(k)) fidByName.set(k, f.id); }
const fid = (name) => fidByName.get(norm(name).toLowerCase().replace(/[^a-z0-9]/g, "")) ?? null;

async function run(label, table, rowsBuilder) {
  const [d] = await c.query(`DELETE FROM \`${table}\``);
  const recs = rowsBuilder();
  let ok = 0, fail = 0;
  for (const r of recs) {
    try { await c.query(`INSERT INTO \`${table}\` (${Object.keys(r).join(",")}) VALUES (${Object.keys(r).map(() => "?").join(",")})`, Object.values(r)); ok++; }
    catch (e) { fail++; if (fail <= 3) console.warn(`  ${table} fail:`, e.message.slice(0, 80)); }
  }
  console.log(`${label}: cleared ${d.affectedRows}, inserted ${ok}${fail ? `, ${fail} failed` : ""}`);
}

// ---- FR Expenses ----
await run("FR Expenses", "fr_expenses", () => {
  const rows = S("2.FR Expen").slice(1);
  const out = [];
  for (const r of rows) {
    const date = toDate(r[1]); const agent = norm(r[2]); if (!date || !agent) continue;
    const card = /personal/i.test(norm(r[9])) ? "Personal" : "Company";
    out.push({ expenseDate: date, agentName: clip(agent, 255), facilityId: fid(r[3]), facilityName: clip(r[3], 255), store: clip(r[6], 255), reason: clip(r[5], 500), amount: num(r[8]), cardType: card, notes: clip(r[7], 4000) });
  }
  return out;
});

// ---- BDR Expenses ----
await run("BDR Expenses", "bdr_expenses", () => {
  const rows = S("2.BDR Expen").slice(1);
  const out = [];
  for (const r of rows) {
    const date = toDate(r[1]); const agent = norm(r[2]); if (!date || !agent) continue;
    out.push({ month: clip(r[0], 20), expenseDate: date, agentName: clip(agent, 255), facilityId: fid(r[3]), facilityName: clip(r[3], 255), facilityPhone: clip(r[4], 50), store: clip(r[5], 255), reason: clip(r[6], 500), amount: num(r[7]) });
  }
  return out;
});

// ---- Referral Rewards (header on row 1) ----
await run("Referral Rewards", "referral_rewards", () => {
  const rows = S("2.Rfral Rewrd").slice(2);
  const rtype = (t) => { t = norm(t).toLowerCase(); if (/body/.test(t)) return "Body Shop"; if (/chiro/.test(t)) return "Chiro"; if (/tow/.test(t)) return "Towing"; if (/medical/.test(t)) return "Medical"; if (/physical|therap/.test(t)) return "Physical Therapy"; return "Other"; };
  const tier = (t) => { t = norm(t); if (/rank\s*x/i.test(t)) return "Rank X"; if (/high/i.test(t)) return "High"; if (/medium/i.test(t)) return "Medium"; return "Standard"; };
  const stat = (s) => { s = norm(s).toLowerCase(); if (/accept/.test(s)) return "Accepted"; if (/den/.test(s)) return "Denied"; return "Pending"; };
  const out = [];
  for (const r of rows) {
    const agent = norm(r[1]); if (!agent) continue;
    out.push({ agentName: clip(agent, 255), sud: clip(toDate(r[2]) ? toDate(r[2]).toISOString().slice(0, 10) : r[2], 100), referralType: rtype(r[3]), facilityId: fid(r[4]), facilityName: clip(r[4], 255), clientName: clip(r[5], 255), clientTier: tier(r[6]), payoutAmount: num(r[9]) || null, status: stat(r[8]), caseNumber: clip(r[13], 100), coordinator: clip(r[12], 255), deliveryType: clip(r[14], 100) });
  }
  return out;
});

// ---- Referral Tracker ----
await run("Referral Tracker", "referral_tracker", () => {
  const rows = S("2.Rfral Frndly fclt").slice(1);
  const stat = (s) => { s = norm(s); if (/successful/i.test(s)) return "Successful Sent"; if (/demo/i.test(s)) return "Demo Sent"; if (/unsuccess/i.test(s)) return "Unsuccessful"; if (/progress|dispatch/i.test(s)) return "In Progress"; return "Pending"; };
  const out = [];
  for (const r of rows) {
    const client = norm(r[1]); if (!client) continue;
    out.push({ month: clip(r[0], 20), clientName: clip(client, 255), pdCoordinator: clip(r[4], 255), partnerStatus: clip(r[5], 100), facilityId: fid(r[6]), facilityName: clip(r[6], 255), facilityType: clip(r[3], 100), bdrAssigned: clip(r[8], 255), status: stat(r[9]) });
  }
  return out;
});

// ---- Field Visits (4 agent blocks of 8 cols, header on row 1) ----
await run("Field Visits", "field_visits", () => {
  const rows = S("2.Visits").slice(2);
  const out = [];
  for (const r of rows) {
    for (const base of [0, 8, 16, 24]) {
      const date = toDate(r[base]); const agent = norm(r[base + 2]); if (!date || !agent) continue;
      const facility = norm(r[base + 4]);
      const hoursFrac = typeof r[base + 3] === "number" ? r[base + 3] : 0;
      const hrs = hoursFrac > 0 && hoursFrac < 1 ? (hoursFrac * 24).toFixed(1) : String(num(r[base + 3]) || 0);
      out.push({ visitDate: date, agentName: clip(agent, 255), agentRole: "FR", facilitiesVisited: JSON.stringify(facility ? [{ name: facility }] : []), facilityCount: Number(num(r[base + 1])) || (facility && !/no visit/i.test(facility) ? 1 : 0), hoursWorked: clip(hrs, 20), notes: clip([norm(r[base + 5]), norm(r[base + 6])].filter(Boolean).join(" · "), 4000) });
    }
  }
  return out;
});

// ---- FR Errands: sheet is only a summary; clear demo, nothing to import ----
const [fe] = await c.query("DELETE FROM fr_errands");
console.log(`FR Errands: cleared ${fe.affectedRows} (no detailed errand data in workbook)`);

await c.end();
