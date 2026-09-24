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
import { createHash } from "node:crypto";
import { canonical } from "./leaddocket-rules.mjs";
import { pacific, serialParts } from "./dates.mjs";

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
  // Pacific noon of the sheet's calendar date — see dates.mjs.
  const at = (y, m, d) => { const x = pacific(y, m, d); return isNaN(x.getTime()) ? null : x; };
  const n = Number(serial);
  if (isFinite(n) && n > 1000) {
    const p = serialParts(n);
    if (!p) return null;
    // The sheet contains typed years like 5026 for 2026. Excel stores those as a
    // real date 3000 years out, which MySQL rejects outright, silently losing the
    // row — so pull it back rather than dropping a real errand.
    return at(p.y > 2100 ? p.y - 3000 : p.y, p.m, p.d);
  }
  const t = norm(serial).replace(/\/{2,}/g, "/");
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return at(yr, Number(m[1]), Number(m[2]));
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

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The tracker's Month column mixes typed names ("January ") with dates Excel
 *  stored as serials (46082). A bare name takes the year that puts it closest
 *  to the row's own sent or sign-up date. */
function monthOf(v, ref) {
  const n = Number(norm(v));
  if (norm(v) && isFinite(n) && n > 1000) {
    const d = excelDate(n);
    return d ? pacific(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) : null;
  }
  const i = MONTH_NAMES.findIndex((m) => low(v).length >= 3 && m.toLowerCase().startsWith(low(v).slice(0, 3)));
  if (i < 0) return null;
  const at = (ref ?? new Date()).getTime();
  const y0 = new Date(at).getUTCFullYear();
  const y = [y0 - 1, y0, y0 + 1].reduce((best, yr) =>
    Math.abs(Date.UTC(yr, i, 15) - at) < Math.abs(Date.UTC(best, i, 15) - at) ? yr : best);
  return pacific(y, i + 1, 1);
}
const monthName = (d) => (d ? MONTH_NAMES[d.getUTCMonth()] + " " + d.getUTCFullYear() : "");

const tracker = [];
for (const r of sheet("2.Rfral Frndly fclt").slice(1)) {
  const client = norm(r[1]); if (!client) continue;
  const st = low(r[9]);
  const sud = excelDate(r[2]), sent = excelDate(r[10]);
  const month = monthOf(r[0], sent ?? sud);
  // A bare number in PD Coordinator is a date typed into the wrong column, not a person.
  const coordinator = /^\d+(\.\d+)?$/.test(norm(r[4])) ? "" : norm(r[4]);
  tracker.push({ month: monthName(month) || norm(r[0]), monthDate: month, sud, sent, client, facilityType: norm(r[3]), coordinator,
    partnerStatus: norm(r[5]), facility: norm(r[6]), owner: norm(r[7]), bdr: norm(r[8]),
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

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
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

// createdAt is the referral's own date, not the import time: the tracker's
// year and date filters read it.
await load("referral_tracker", tracker, (t) => [
  "INSERT INTO referral_tracker (month, clientName, pdCoordinator, partnerStatus, facilityId, facilityName, facilityType, bdrAssigned, status, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())",
  [clamp(t.month, 20), clamp(t.client, 255), clamp(t.coordinator, 255), clamp(t.partnerStatus, 100), facId(t.facility, ""), clamp(t.facility, 255), clamp(t.facilityType, 100), clamp(t.bdr, 255), t.status, text(t.notes),
    t.sent ?? t.monthDate ?? t.sud ?? new Date()]]);

// ─── Partner Referral Tracker (outbound_referrals) ────────────────────────────
// The team logs the clients it refers out to partners in this sheet, so the
// sheet is the source of the Partner Referral Tracker's outbound rows. The sheet
// has no ids, so each row is keyed on its own contents. A row someone has
// edited in the app (updatedAt later than syncedAt) is left alone from then on,
// and referrals added in the app are never touched.
{
  const OUT_STATUS = {
    "Successful Sent": "Referral Sent",
    "Demo Sent": "Referral Sent",          // client demographics sent to the facility
    "In Progress": "Facility Selected",
    "Pending": "Pending Review",
    "Unsuccessful": "Not Referred",
  };
  const fullName = (s) => canonical(s)?.full ?? norm(s);
  const seen = new Map();
  const rows = tracker.map((t) => {
    const base = [key(t.client), key(t.facility), iso(t.sud), iso(t.sent)].join("|");
    const n = (seen.get(base) ?? 0) + 1;       // the sheet repeats some rows exactly
    seen.set(base, n);
    return {
      externalId: createHash("sha1").update(base + "#" + n).digest("hex"),
      when: t.sent ?? t.monthDate ?? t.sud ?? new Date(),
      clientName: clamp(t.client, 255),
      dateSigned: t.sud,
      referralType: clamp(t.facilityType, 100),
      assignedAgent: clamp(fullName(t.bdr), 100),
      recommendedFacility: clamp(t.facility, 255),
      facilityOwner: clamp(fullName(t.owner), 100),
      referralSentDate: t.sent,
      status: OUT_STATUS[t.status] ?? "Pending Review",
      facilityHadSentLeads: /^active/i.test(t.partnerStatus) ? 1 : 0,
      notes: [`From the Referral-Friendly Facility sheet${t.month ? ` (${t.month})` : ""}`, `sheet status: ${t.status}`,
        t.partnerStatus && `partner: ${t.partnerStatus}`, t.coordinator && `PD coordinator: ${t.coordinator}`].filter(Boolean).join(" · "),
    };
  });

  const have = new Map((await c.query(
    "SELECT id, externalId, UNIX_TIMESTAMP(updatedAt) u, UNIX_TIMESTAMP(syncedAt) s FROM outbound_referrals WHERE externalSource='sheet'"))[0]
    .map((r) => [r.externalId, r]));
  const editedInApp = (r) => r.s != null && Number(r.u) > Number(r.s) + 1;
  const FIELDS = ["clientName", "dateSigned", "referralType", "assignedAgent", "recommendedFacility", "facilityOwner", "referralSentDate", "status", "facilityHadSentLeads", "notes"];
  let ins = 0, upd = 0, kept = 0, del = 0;
  for (const r of rows) {
    const cur = have.get(r.externalId);
    have.delete(r.externalId);
    if (cur && editedInApp(cur)) { kept++; continue; }
    if (cur) {
      await c.query(`UPDATE outbound_referrals SET ${FIELDS.map((f) => "`" + f + "`=?").join(", ")}, lastUpdatedBy='Google Sheets', syncedAt=NOW(), updatedAt=NOW() WHERE id=?`,
        [...FIELDS.map((f) => r[f]), cur.id]);
      upd++;
    } else {
      await c.query(`INSERT INTO outbound_referrals (${FIELDS.map((f) => "`" + f + "`").join(", ")}, referralNeeded, lastUpdatedBy, externalId, externalSource, syncedAt, createdAt, updatedAt)
        VALUES (${FIELDS.map(() => "?").join(", ")}, 1, 'Google Sheets', ?, 'sheet', NOW(), ?, NOW())`,
        [...FIELDS.map((f) => r[f]), r.externalId, r.when]);
      ins++;
    }
  }
  // Gone from the sheet: remove it here too, unless someone has worked on it in the app.
  for (const r of have.values()) {
    if (editedInApp(r)) { kept++; continue; }
    await c.query("DELETE FROM outbound_referrals WHERE id=?", [r.id]);
    del++;
  }
  console.log(`outbound_referrals: ${ins} added, ${upd} updated, ${del} removed, ${kept} left alone (edited in the app)`);
}

// ─── leads sent to partners (facility_leads, sent_to_facility) ────────────────
// The Command Center, facility profiles and Representative Performance count
// "leads sent" from facility_leads, which nothing filled — so reciprocity read 0
// everywhere. Every outbound referral that actually went out (sheet or app) is
// mirrored there, keyed on the referral's id, and facility totals recounted.
{
  const WENT_OUT = ["Referral Sent", "Facility Confirmed", "Client Scheduled", "Client Attended", "Completed"];
  const [outs] = await c.query(
    `SELECT id, clientName, recommendedFacility, assignedAgent, referralSentDate, createdAt, status, clientAttended
     FROM outbound_referrals WHERE status IN (${WENT_OUT.map(() => "?").join(",")})`, WENT_OUT);
  const have = new Map((await c.query("SELECT id, externalId FROM facility_leads WHERE externalSource='outbound'"))[0].map((r) => [r.externalId, r.id]));
  let ins = 0, upd = 0, del = 0, linkedOut = 0;
  for (const o of outs) {
    const when = o.referralSentDate ?? o.createdAt;
    const fid = facId(o.recommendedFacility, "");
    if (fid) linkedOut++;
    const row = [fid, when, clamp(o.assignedAgent, 255),
      text(["Outbound referral", o.clientName, o.status].filter(Boolean).join(" · "))];
    const id = have.get(String(o.id));
    have.delete(String(o.id));
    if (id) {
      await c.query("UPDATE facility_leads SET facilityId=?, leadDate=?, repName=?, notes=?, createdAt=?, updatedAt=NOW() WHERE id=?", [...row, when, id]);
      upd++;
    } else {
      // createdAt = the referral's own date: notifications alert on recently created leads.
      await c.query(`INSERT INTO facility_leads (facilityId, leadDate, repName, notes, direction, method, outcome, signedCase, externalId, externalSource, createdAt, updatedAt)
        VALUES (?,?,?,?, 'sent_to_facility', 'other', 'pending', 0, ?, 'outbound', ?, NOW())`, [...row, String(o.id), when]);
      ins++;
    }
  }
  for (const id of have.values()) { await c.query("DELETE FROM facility_leads WHERE id=?", [id]); del++; }
  await c.query(`UPDATE facilities f
    LEFT JOIN (SELECT facilityId, COUNT(*) n FROM facility_leads WHERE direction='sent_to_facility' AND facilityId IS NOT NULL GROUP BY facilityId) x
      ON x.facilityId = f.id
    SET f.totalLeadsSent = COALESCE(x.n, 0)`);
  console.log(`leads sent to partners: ${outs.length} (${linkedOut} matched to a facility) — ${ins} added, ${upd} updated, ${del} removed; facility totals recounted`);
}

await load("fr_errands", errands, (e) => [
  "INSERT INTO fr_errands (errandDate, clientName, clientTier, taskType, agentName, status, address, notes, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())",
  [e.when, clamp(e.client, 255), e.tier, clamp(e.task, 255), clamp(e.agent, 255), e.status, text(e.address), text(e.notes)]]);

await load("field_visits", visits, (v) => [
  "INSERT INTO field_visits (visitDate, agentName, agentRole, facilitiesVisited, facilityCount, hoursWorked, notes, createdAt, updatedAt) VALUES (?,?,'FR',?,?,?,?,NOW(),NOW())",
  [v.when, clamp(v.agent, 255), JSON.stringify(v.names.map((n) => ({ id: facId(n, ""), name: n }))), v.count, clamp(v.hours, 20), text(v.notes)]]);

console.log("✅ done");
await c.end();
