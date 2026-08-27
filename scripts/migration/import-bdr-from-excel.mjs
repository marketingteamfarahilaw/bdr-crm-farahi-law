/**
 * Rebuild the BDR/FR operational tables from the Centralized BDR/FR Reports
 * workbook: FR + BDR expenses, referral rewards, the referral-friendly tracker,
 * FR errands and field visits.
 *
 * Each importer clears only its own table, so it is safe to re-run.
 *
 *   node scripts/migration/import-bdr-from-excel.mjs "<workbook.xlsx>" --dry
 *   node scripts/migration/import-bdr-from-excel.mjs "<workbook.xlsx>"
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = process.argv.find((a) => a.toLowerCase().endsWith(".xlsx"));
const dry = process.argv.includes("--dry");
if (!FILE) { console.error("Usage: node import-bdr-from-excel.mjs <workbook.xlsx> [--dry]"); process.exit(1); }

const norm = (s) => String(s ?? "").trim();
const low = (s) => norm(s).toLowerCase();
const digits = (s) => norm(s).replace(/\D/g, "");
const last10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ""; };
/** Some cells hold several amounts on separate lines (one row covering a few
 *  clients). Sum them rather than concatenating the digits. */
const money = (v) => {
  const lines = String(v ?? "").split(String.fromCharCode(10));
  const parts = lines
    .map((x) => x.replace(/[^0-9.]/g, ""))
    .filter((x) => x !== "")            // an empty cell is not a zero amount
    .map(Number)
    .filter((n) => isFinite(n));
  if (!parts.length) return null;
  const total = parts.reduce((a, b) => a + b, 0);
  return isFinite(total) ? total : null;
};
const text = (s) => (norm(s) === "" ? null : norm(s).slice(0, 4000));
const clamp = (s, n) => (norm(s) === "" ? null : norm(s).replace(/[\r\n\t]+/g, " ").slice(0, n));
const key = (s) => low(s).replace(/[^a-z0-9]/g, "");

/** Excel serial, or a typed date like "3/25/2026" (the sheet also contains
 *  typos such as "2//27/2026" and "3/25//2026", so slashes are collapsed). */
function excelDate(serial) {
  const n = Number(serial);
  if (isFinite(n) && n > 1000) {
    const d = new Date(Math.round((n - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const t = norm(serial).replace(/\/{2,}/g, "/");
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(yr, Number(m[1]) - 1, Number(m[2])));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
const tier = (v) => { const t = low(v); if (t.includes("rank")) return "Rank X"; if (t.includes("high")) return "High"; if (t.includes("medium")) return "Medium"; return "Standard"; };
const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");

const wb = xlsx.readFile(FILE);
const sheet = (n) => (wb.Sheets[n] ? xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) : []);

// ─── parse ────────────────────────────────────────────────────────────────────
const frExpenses = [];
for (const r of sheet("2.FR Expen").slice(1)) {
  const when = excelDate(r[1]); const agent = norm(r[2]);
  const amt = money(r[8]) ?? 0;      // a blank amount is still a real logged expense row
  if (!when || !agent) continue;
  frExpenses.push({ when, agent, facility: norm(r[3]), store: norm(r[6]), reason: norm(r[5]), amount: amt,
    card: /personal/i.test(norm(r[9])) ? "Personal" : "Company", notes: norm(r[7]) });
}

const bdrExpenses = [];
for (const r of sheet("2.BDR Expen").slice(1)) {
  const when = excelDate(r[1]); const agent = norm(r[2]);
  const amt = money(r[7]) ?? 0;      // a blank amount is still a real logged expense row
  if (!when || !agent) continue;
  bdrExpenses.push({ month: norm(r[0]), when, agent, facility: norm(r[3]), phone: norm(r[4]),
    store: norm(r[5]), reason: norm(r[6]), amount: amt });
}

const rewards = [];
for (const r of sheet("2.Rfral Rewrd").slice(2)) {
  const agent = norm(r[1]); const client = norm(r[5]);
  if (!agent && !client) continue;   // keep rows missing one or the other
  const st = low(r[8]);
  const t = low(r[3]);
  const refType = t.includes("chiro") ? "Chiro"
    : /body|collision/.test(t) ? "Body Shop"
    : t.includes("tow") ? "Towing"
    : /physical|therapy/.test(t) ? "Physical Therapy"
    : /medical|clinic|urgent/.test(t) ? "Medical" : "Other";
  rewards.push({ agent: agent || "(unknown)", sud: iso(excelDate(r[2])) || norm(r[2]),
    refType, facility: norm(r[4]), client, tier: tier(r[6]),
    payout: money(r[9]) ?? money(r[7]),
    status: st.includes("accept") ? "Accepted" : st.includes("den") ? "Denied" : "Pending",
    caseNumber: norm(r[13]), coordinator: norm(r[12]), delivery: norm(r[14]),
    notes: [norm(r[15]), norm(r[16]), norm(r[17]), norm(r[18]), norm(r[19])].filter(Boolean).join(" · ") });
}

const tracker = [];
for (const r of sheet("2.Rfral Frndly fclt").slice(1)) {
  const client = norm(r[1]); if (!client) continue;
  const st = low(r[9]);
  tracker.push({ month: norm(r[0]), client, facilityType: norm(r[3]), coordinator: norm(r[4]),
    partnerStatus: norm(r[5]), facility: norm(r[6]), bdr: norm(r[8]),
    status: st.includes("successful sent") ? "Successful Sent" : st.includes("demo") ? "Demo Sent"
      : st.includes("unsuccessful") ? "Unsuccessful" : st.includes("progress") ? "In Progress" : "Pending",
    notes: [norm(r[7]) ? "Facility owner: " + norm(r[7]) : "", iso(excelDate(r[10])) ? "Date sent: " + iso(excelDate(r[10])) : ""].filter(Boolean).join(" · ") });
}

const errands = [];
for (const r of sheet("2.FR Errand").slice(7)) {
  const when = excelDate(r[0]) || excelDate(r[9]);   // fall back to Month Completed
  const client = norm(r[1]); const task = norm(r[3]) || norm(r[6]) || "Errand";
  if (!when || !client) continue;
  const st = low(r[5]);
  errands.push({ when, client, tier: tier(r[2]), task, agent: norm(r[4]),
    status: st.includes("complete") ? "Completed" : (st.includes("pending") || st.includes("progress")) ? "In Progress" : "Not Completed",
    address: norm(r[8]),
    notes: [norm(r[7]), norm(r[6]) ? "Type: " + norm(r[6]) : "", norm(r[11]) ? "Urgency: " + norm(r[11]) : ""].filter(Boolean).join(" · ") });
}

// Field visits: the sheet holds one 8-column block per FR, laid side by side.
const visits = [];
{
  const rows = sheet("2.Visits");
  const header = rows[1] || [];
  for (let base = 0; base + 4 < header.length; base += 8) {
    if (!/date/i.test(norm(header[base]))) continue;
    for (const r of rows.slice(2)) {
      const when = excelDate(r[base]); const agent = norm(r[base + 2]);
      if (!when || !agent) continue;
      const facilityText = norm(r[base + 4]);
      const names = facilityText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const real = names.filter((n) => !/^no visit/i.test(n));
      const hours = Number(r[base + 3]);
      const noVisit = names.find((n) => /^no visit/i.test(n)) || "";
      visits.push({ when, agent, names: real,
        count: Number(r[base + 1]) || real.length,
        hours: isFinite(hours) && hours > 0 ? (hours * 24).toFixed(2) : null,
        notes: [noVisit, norm(r[base + 5]) ? "Marketing: " + norm(r[base + 5]) : "", norm(r[base + 6]) ? "Lunch: " + norm(r[base + 6]) : ""].filter(Boolean).join(" · ") });
    }
  }
}

const sum = (a) => a.reduce((t, x) => t + (x.amount || 0), 0).toFixed(2);
console.log("FR expenses      : " + frExpenses.length + " rows  ($" + sum(frExpenses) + ")");
console.log("BDR expenses     : " + bdrExpenses.length + " rows  ($" + sum(bdrExpenses) + ")");
console.log("Referral rewards : " + rewards.length + " rows");
console.log("Referral tracker : " + tracker.length + " rows");
console.log("FR errands       : " + errands.length + " rows");
console.log("Field visits     : " + visits.length + " rows");

if (dry) { console.log("\n[DRY RUN] nothing written."); process.exit(0); }

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3 FROM facilities");
const facByName = new Map(), facByPhone = new Map();
for (const f of facs) {
  const k = key(f.name); if (k && !facByName.has(k)) facByName.set(k, f.id);
  for (const p of [f.phone, f.phone2, f.phone3]) { const d = last10(p); if (d && !facByPhone.has(d)) facByPhone.set(d, f.id); }
}
const facId = (name, phone) => facByPhone.get(last10(phone)) ?? facByName.get(key(name)) ?? null;

async function load(table, rows, build) {
  const [d] = await c.query("DELETE FROM `" + table + "`");
  let ok = 0, bad = 0;
  for (const row of rows) {
    try { const [sql, params] = build(row); await c.query(sql, params); ok++; }
    catch (e) { bad++; if (bad <= 3) console.warn("  " + table + " failed: " + e.message.slice(0, 110)); }
  }
  console.log(table + ": cleared " + d.affectedRows + ", inserted " + ok + (bad ? ", failed " + bad : ""));
}

await load("fr_expenses", frExpenses, (e) => [
  "INSERT INTO fr_expenses (expenseDate, agentName, facilityId, facilityName, store, reason, amount, cardType, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())",
  [e.when, clamp(e.agent, 255), facId(e.facility, ""), clamp(e.facility, 255), clamp(e.store, 255), clamp(e.reason, 500), e.amount, e.card, text(e.notes)]]);

await load("bdr_expenses", bdrExpenses, (e) => [
  "INSERT INTO bdr_expenses (month, expenseDate, agentName, facilityId, facilityName, facilityPhone, store, reason, amount, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())",
  [clamp(e.month, 20), e.when, clamp(e.agent, 255), facId(e.facility, e.phone), clamp(e.facility, 255), clamp(e.phone, 50), clamp(e.store, 255), clamp(e.reason, 500), e.amount]]);

await load("referral_rewards", rewards, (r) => [
  "INSERT INTO referral_rewards (agentName, sud, referralType, facilityId, facilityName, clientName, clientTier, payoutAmount, status, caseNumber, coordinator, deliveryType, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())",
  [clamp(r.agent, 255), clamp(r.sud, 100), r.refType, facId(r.facility, ""), clamp(r.facility, 255), clamp(r.client || "(unknown)", 255), r.tier, r.payout, r.status, clamp(r.caseNumber, 100), clamp(r.coordinator, 255), clamp(r.delivery, 100), text(r.notes)]]);

await load("referral_tracker", tracker, (t) => [
  "INSERT INTO referral_tracker (month, clientName, pdCoordinator, partnerStatus, facilityId, facilityName, facilityType, bdrAssigned, status, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())",
  [clamp(t.month, 20), clamp(t.client, 255), clamp(t.coordinator, 255), clamp(t.partnerStatus, 100), facId(t.facility, ""), clamp(t.facility, 255), clamp(t.facilityType, 100), clamp(t.bdr, 255), t.status, text(t.notes)]]);

await load("fr_errands", errands, (e) => [
  "INSERT INTO fr_errands (errandDate, clientName, clientTier, taskType, agentName, status, address, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())",
  [e.when, clamp(e.client, 255), e.tier, clamp(e.task, 255), clamp(e.agent, 255), e.status, text(e.address), text(e.notes)]]);

await load("field_visits", visits, (v) => [
  "INSERT INTO field_visits (visitDate, agentName, agentRole, facilitiesVisited, facilityCount, hoursWorked, notes, createdAt, updatedAt) VALUES (?,?,'FR',?,?,?,?,NOW(),NOW())",
  [v.when, clamp(v.agent, 255), JSON.stringify(v.names.map((n) => ({ id: facId(n, ""), name: n }))), v.count, clamp(v.hours, 20), text(v.notes)]]);

console.log("✅ done");
await c.end();
