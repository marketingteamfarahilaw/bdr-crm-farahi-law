/**
 * Rebuild call history from the "2.RC" sheet of the Centralized BDR/FR Reports
 * workbook — the team's own spreadsheet copy of the RingCentral log.
 *
 * Calls whose phone number matches a facility become contact_logs rows (which
 * is what the Check-In Report, Call Analytics and Call Logs read). The rest go
 * to rc_unmatched_calls, exactly where the live RingCentral sync puts them, so
 * the check-in matrix still counts them against the rep.
 *
 *   node scripts/migration/import-calls-from-excel.mjs "<workbook.xlsx>" --dry
 *   node scripts/migration/import-calls-from-excel.mjs "<workbook.xlsx>"
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import xlsx from "xlsx";

const FILE = process.argv.find((a) => a.toLowerCase().endsWith(".xlsx"));
const dry = process.argv.includes("--dry");
if (!FILE) { console.error('Usage: node import-calls-from-excel.mjs "<workbook.xlsx>" [--dry]'); process.exit(1); }

const SHEET = "2.RC";
const COL = { agent: 0, phone: 1, name: 2, date: 3, time: 4, action: 5, result: 6, resultDesc: 7, duration: 8, cleanPhone: 11, hashtag: 12 };

const norm = (s) => String(s ?? "").trim();
const digits = (s) => norm(s).replace(/\D/g, "");
const last10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ""; };

/** Excel serial (days since 1899-12-30, local) + optional day-fraction time. */
function excelDate(serial, timeFrac) {
  const n = Number(serial);
  if (!isFinite(n) || n < 1000) return null;
  let ms = Math.round((n - 25569) * 86400 * 1000);          // days -> unix ms (UTC midnight)
  let frac = 0;
  if (typeof timeFrac === "number" && isFinite(timeFrac)) frac = timeFrac;
  else {
    const t = norm(timeFrac).match(/^(\d{1,2}):(\d{2})$/);   // some rows store "16:14"
    if (t) frac = (Number(t[1]) * 3600 + Number(t[2]) * 60) / 86400;
    else { const f = Number(timeFrac); if (isFinite(f) && f > 0 && f < 1) frac = f; }
  }
  ms += Math.round(frac * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/** Duration is stored as a fraction of a day. */
const durationSeconds = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n * 86400) : 0; };
const mmss = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

function mapResult(result, desc) {
  const t = (norm(result) + " " + norm(desc)).toLowerCase();
  if (/voicemail/.test(t)) return "voicemail";
  if (/connected|accepted|call connected/.test(t)) return "connected";
  if (/missed|no answer|not answered|abandoned/.test(t)) return "no_answer";
  if (/busy/.test(t)) return "busy";
  return "other";
}

function mapCallType(hashtag) {
  const t = norm(hashtag).toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return "other";
  if (t.includes("internal")) return "internal";
  if (t.includes("potentialleadsource")) return "potential_lead";
  if (t.includes("bdrpartnercheckin")) return "bdr_checkin";
  if (t.includes("frpartnercheckin")) return "fr_checkin";
  if (t.includes("partnercheckin")) return "partner_checkin";
  return "other";
}

const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`sheet "${SHEET}" not found`); process.exit(1); }
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

const calls = [];
let skippedNoDate = 0;
for (const r of rows) {
  const agent = norm(r[COL.agent]);
  if (!agent || /^agent$/i.test(agent)) continue;
  const when = excelDate(r[COL.date], r[COL.time]);
  if (!when) { skippedNoDate++; continue; }
  const phone = last10(r[COL.cleanPhone]) || last10(r[COL.phone]);
  const secs = durationSeconds(r[COL.duration]);
  calls.push({
    agent,
    phone,
    rawPhone: norm(r[COL.phone]) || phone,
    name: norm(r[COL.name]),
    when,
    result: mapResult(r[COL.result], r[COL.resultDesc]),
    callType: mapCallType(r[COL.hashtag]),
    secs,
  });
}

console.log(`Parsed ${calls.length} calls (skipped ${skippedNoDate} rows with no usable date)`);
const dates = calls.map((c) => c.when.getTime()).sort((a, b) => a - b);
if (dates.length) console.log(`Date range: ${new Date(dates[0]).toISOString().slice(0,10)} → ${new Date(dates[dates.length-1]).toISOString().slice(0,10)}`);
const byType = {}, byAgent = {};
for (const c of calls) { byType[c.callType] = (byType[c.callType]||0)+1; byAgent[c.agent] = (byAgent[c.agent]||0)+1; }
console.log("By type:", byType);
console.log("By agent:", Object.entries(byAgent).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`${k}:${v}`).join("  "));

// --- match against facilities by any of their phone fields ---
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, phone2, phone3, contactPhone FROM facilities");
const byPhone = new Map();
for (const f of facs) for (const p of [f.phone, f.phone2, f.phone3, f.contactPhone]) {
  const k = last10(p); if (k && !byPhone.has(k)) byPhone.set(k, f);
}
let matched = 0;
for (const call of calls) { const f = call.phone ? byPhone.get(call.phone) : null; if (f) { call.facilityId = f.id; matched++; } }
console.log(`Matched to a facility: ${matched} / ${calls.length}  (unmatched ${calls.length - matched} → rc_unmatched_calls)`);

if (dry) { console.log("\n[DRY RUN] nothing written."); await c.end(); process.exit(0); }

const [dl] = await c.query("DELETE FROM contact_logs WHERE fromRingCentral = 0 AND rcCallId LIKE 'xls:%'");
const [du] = await c.query("DELETE FROM rc_unmatched_calls WHERE rcCallId LIKE 'xls:%'");
console.log(`cleared previous excel imports: ${dl.affectedRows} contact_logs, ${du.affectedRows} unmatched`);

let ins = 0, insU = 0, failed = 0, i = 0;
for (const call of calls) {
  const rcId = `xls:${i++}`;                       // stable synthetic id, keeps re-runs idempotent
  try {
    if (call.facilityId) {
      await c.query(
        `INSERT INTO contact_logs (facilityId, contactType, contactDate, callResult, callDuration, callType, summary, repName, direction, fromRingCentral, rcCallId, createdAt)
         VALUES (?, 'call', ?, ?, ?, ?, ?, ?, 'Outbound', 0, ?, NOW())`,
        [call.facilityId, call.when, call.result, mmss(call.secs), call.callType,
         call.name ? `Imported from spreadsheet — ${call.name}` : "Imported from spreadsheet", call.agent, rcId]
      );
      ins++;
    } else {
      await c.query(
        `INSERT INTO rc_unmatched_calls (rcCallId, direction, fromNumber, toNumber, toName, startTime, durationSeconds, callResult, agentName, status, createdAt)
         VALUES (?, 'Outbound', NULL, ?, ?, ?, ?, ?, ?, 'unassigned', NOW())`,
        [rcId, call.rawPhone || null, call.name || null, call.when, call.secs, call.result, call.agent]
      );
      insU++;
    }
  } catch (e) { failed++; if (failed <= 6) console.warn("insert failed:", e.message.slice(0, 120)); }
}
console.log(`✅ Inserted ${ins} contact_logs + ${insU} unmatched calls (${failed} failed).`);
await c.end();
