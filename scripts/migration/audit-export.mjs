/**
 * Full audit + Excel export of the live CRM. Produces a multi-sheet workbook:
 *   Audit Summary · Facilities · Intake Leads · Leads Tracker · Team · Call Activity
 * Saved to the user's Downloads folder.
 *
 * Run: node scripts/migration/audit-export.mjs
 */
import "dotenv/config";
import xlsx from "xlsx";
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";

const LA = "America/Los_Angeles";
const d = (v) => (v ? formatInTimeZone(new Date(v), LA, "yyyy-MM-dd") : "");
const tally = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = (r[key] ?? "(blank)") || "(blank)"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });

const [facs] = await c.query("SELECT * FROM facilities ORDER BY assignedRepName, name");
const [users] = await c.query("SELECT id,name,email,role,agentName FROM users ORDER BY role,name");
const [intake] = await c.query("SELECT * FROM intake_leads ORDER BY id DESC");
const [leadTrk] = await c.query("SELECT * FROM lead_intake ORDER BY leadDate DESC");
const [calls] = await c.query("SELECT repName, callResult, contactType FROM contact_logs WHERE contactType='call'");
const [icalls] = await c.query("SELECT COUNT(*) n FROM intake_calls");
const [visits] = await c.query("SELECT COUNT(*) n FROM field_visits");

// ── Audit summary ──
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const dupNames = (() => { const m = new Map(); for (const f of facs) { const k = norm(f.name); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.values()].filter((n) => n > 1).length; })();
const noPhone = facs.filter((f) => !f.phone || !String(f.phone).trim()).length;
const noCity = facs.filter((f) => !f.city || !String(f.city).trim()).length;
const noAgent = facs.filter((f) => !f.assignedRepName || !String(f.assignedRepName).trim()).length;

const summary = [
  ["FARAHI LAW — CRM AUDIT", ""],
  ["Generated (Pacific)", formatInTimeZone(new Date(), LA, "yyyy-MM-dd HH:mm")],
  ["", ""],
  ["FACILITIES", ""],
  ["Total facilities", facs.length],
  ["  — missing phone", noPhone],
  ["  — missing city", noCity],
  ["  — missing assigned agent", noAgent],
  ["  — duplicate-name groups", dupNames],
  ["", ""],
  ["Facilities by category", ""],
  ...tally(facs, "category").map(([k, v]) => [`  ${k}`, v]),
  ["", ""],
  ["Facilities by assigned agent", ""],
  ...tally(facs, "assignedRepName").map(([k, v]) => [`  ${k}`, v]),
  ["", ""],
  ["Facilities by partner status", ""],
  ...tally(facs, "partnerStatus").map(([k, v]) => [`  ${k}`, v]),
  ["", ""],
  ["INTAKE (AI Case Desk)", ""],
  ["Intake leads", intake.length],
  ...tally(intake, "status").map(([k, v]) => [`  status: ${k}`, v]),
  ...tally(intake, "qualificationTier").map(([k, v]) => [`  tier: ${k}`, v]),
  ["Intake calls captured", icalls[0].n],
  ["", ""],
  ["LEADS TRACKER (BDR/FR)", ""],
  ["Lead rows", leadTrk.length],
  ["  signed", leadTrk.filter((r) => /signed/i.test(r.outcome ?? "")).length],
  ...tally(leadTrk, "role").map(([k, v]) => [`  role: ${k}`, v]),
  ["", ""],
  ["ACTIVITY", ""],
  ["Facility call logs", calls.length],
  ["  connected", calls.filter((c) => c.callResult === "connected").length],
  ["Field visits logged", visits[0].n],
  ["", ""],
  ["TEAM", ""],
  ["Users", users.length],
  ...tally(users, "role").map(([k, v]) => [`  ${k}`, v]),
];

// ── Sheets ──
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summary), "Audit Summary");

const facSheet = [["ID", "Name", "Category", "Partner Status", "Assigned Agent", "Phone", "Phone 2", "Phone 3", "Contact", "Email", "Address", "City", "Signed Cases", "Leads Received", "Last Contact", "Created"]];
for (const f of facs) facSheet.push([f.id, f.name, f.category, f.partnerStatus, f.assignedRepName, f.phone, f.phone2, f.phone3, f.contactName, f.contactEmail, f.address, f.city, f.totalSignedCases, f.totalLeadsReceived, d(f.lastContactDate), d(f.createdAt)]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(facSheet), "Facilities");

const intSheet = [["ID", "First", "Last", "Phone", "Case Type", "Status", "Tier", "Score", "SOL Risk", "Assigned", "Created"]];
for (const l of intake) intSheet.push([l.id, l.firstName, l.lastName, l.phone, l.caseType, l.status, l.qualificationTier, l.qualificationScore, l.solRisk, l.assignedToName, d(l.createdAt)]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(intSheet), "Intake Leads");

const ltSheet = [["Lead Date", "Role", "Member", "Lead Name", "Last", "Value", "Outcome", "Classification", "Sign-up Date", "Facility"]];
for (const l of leadTrk) ltSheet.push([d(l.leadDate), l.role, l.member, l.leadName, l.lastName, l.value, l.outcome, l.classification, l.sud, l.facility]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(ltSheet), "Leads Tracker");

const teamSheet = [["Name", "Email", "Role", "Agent Name"]];
for (const u of users) teamSheet.push([u.name, u.email, u.role, u.agentName]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(teamSheet), "Team");

const byAgent = new Map();
for (const c2 of calls) { const a = c2.repName ?? "(unknown)"; const e = byAgent.get(a) ?? { total: 0, connected: 0 }; e.total++; if (c2.callResult === "connected") e.connected++; byAgent.set(a, e); }
const caSheet = [["Agent", "Total Calls", "Connected", "Connect %"]];
for (const [a, e] of [...byAgent.entries()].sort((x, y) => y[1].total - x[1].total)) caSheet.push([a, e.total, e.connected, e.total ? Math.round((e.connected / e.total) * 100) + "%" : "0%"]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(caSheet), "Call Activity");

// ── Needs Attention sheet ──
const na = [["NEEDS ATTENTION — facilities to clean up", "", "", ""]];
na.push(["", "", "", ""]);
na.push([`Missing phone (${noPhone})`, "", "", ""]);
na.push(["ID", "Name", "Category", "City"]);
for (const f of facs.filter((x) => !x.phone || !String(x.phone).trim())) na.push([f.id, f.name, f.category, f.city]);
na.push(["", "", "", ""]);
na.push([`Missing city (${noCity})`, "", "", ""]);
na.push(["ID", "Name", "Category", "Agent"]);
for (const f of facs.filter((x) => !x.city || !String(x.city).trim())) na.push([f.id, f.name, f.category, f.assignedRepName]);
na.push(["", "", "", ""]);
na.push(["Duplicate-name groups (both copies may have activity — manual merge)", "", "", ""]);
na.push(["Name", "Count", "IDs", ""]);
{
  const m = new Map();
  for (const f of facs) { const k = norm(f.name); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
  for (const [, arr] of m) if (arr.length > 1) na.push([arr[0].name, arr.length, arr.map((x) => x.id).join(", "), ""]);
}
na.push(["", "", "", ""]);
na.push(["Agent-name note", "", "", ""]);
na.push(["'Miguel Flores' merged into 'Miguel'", "", "", ""]);
na.push(["User agentName vs facility name mismatch (affects scoping):", "", "", ""]);
na.push(["  Grace's login agentName is 'Gracel' but facilities use 'Grace'", "", "", ""]);
na.push(["  Queenie's login agentName is 'Queenie Miranda' but facilities use 'Queenie'", "", "", ""]);
xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(na), "Needs Attention");

const stamp = formatInTimeZone(new Date(), LA, "yyyy-MM-dd");
const out = `C:/Users/EOR - 4055/Downloads/Farahi CRM Audit ${stamp}.xlsx`;
xlsx.writeFile(wb, out);
console.log("EXPORTED →", out);
console.log("\n=== AUDIT SUMMARY ===");
for (const [k, v] of summary) if (k || v !== "") console.log((String(k)).padEnd(34), v);
await c.end();
