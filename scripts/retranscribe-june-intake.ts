import "dotenv/config";
import axios from "axios";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
import { processRecordedCall } from "../server/intakeSync";

const RC = "https://platform.ringcentral.com";
const ADMIN_USER = 4710004;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
// extension per intake agent
const [exts]: any = await pool.query("SELECT t.userId, t.extensionId, us.name FROM user_ringcentral_tokens t JOIN users us ON us.id=t.userId WHERE us.role IN ('intake_manager','intake_agent','intake_frontline')");
const extOf = new Map<number, { extensionId: string; name: string }>(exts.map((e: any) => [e.userId, { extensionId: String(e.extensionId), name: e.name }]));

const [pending]: any = await pool.query(
  "SELECT id, rcCallId, agentId, agentName, direction, fromNumber, toNumber, durationSeconds, callDate FROM intake_calls WHERE callDate >= '2026-06-01' AND callDate < '2026-07-01' AND hasRecording=1 AND (transcript IS NULL OR transcript='') AND rcCallId IS NOT NULL ORDER BY callDate"
);
console.log(`[retranscribe] pending recorded June calls: ${pending.length}`);

let ok = 0, noUri = 0, fail = 0, processed = 0;
let admin: string | null = null, tokenAge = 0;
for (const p of pending) {
  processed++;
  // refresh admin token every 20 calls (RC access tokens live ~1h; whisper is slow)
  if (!admin || tokenAge >= 20) { admin = await getValidRCTokenForUser(ADMIN_USER); tokenAge = 0; if (!admin) { console.log("[retranscribe] no admin token — abort"); break; } }
  tokenAge++;
  const ext = extOf.get(p.agentId);
  if (!ext) { fail++; continue; }
  try {
    // re-fetch the record to get a fresh recording contentUri
    const rec = await axios.get(`${RC}/restapi/v1.0/account/~/extension/${ext.extensionId}/call-log/${encodeURIComponent(p.rcCallId)}`, { headers: { Authorization: `Bearer ${admin}` }, params: { view: "Detailed" }, validateStatus: () => true });
    if (rec.status === 429) { const wait = Number(rec.headers["retry-after"] ?? 30); console.log(`[retranscribe] 429 on call-log, waiting ${wait}s`); await sleep(wait * 1000); tokenAge = 20; continue; }
    const uri: string | null = rec.data?.recording?.contentUri ?? null;
    if (!uri) { noUri++; await pool.query("UPDATE intake_calls SET hasRecording=0 WHERE id=?", [p.id]); continue; }
    const callerNumber = p.direction === "Inbound" ? p.fromNumber : p.toNumber;
    const r = await processRecordedCall({ callId: p.id, recordingUrl: uri, accessToken: admin, direction: p.direction, callerNumber, durationSecs: p.durationSeconds ?? 0, callDate: p.callDate, agent: { id: p.agentId, name: p.agentName || ext.name || "Intake" } });
    if (r.transcribed) { ok++; } else { fail++; await sleep(8000); } // failed → likely media rate limit; back off
    if (processed % 10 === 0) console.log(`[retranscribe] ${processed}/${pending.length} — ok:${ok} noRecording:${noUri} fail:${fail}`);
    await sleep(1500); // stay under the ~10/min media budget alongside whisper time
  } catch (e: any) {
    fail++;
    console.log(`[retranscribe] #${p.id} ERROR ${e?.response?.status ?? ""} ${String(e?.message).slice(0, 100)}`);
    await sleep(5000);
  }
}
console.log(`[retranscribe] DONE. ok:${ok} noRecording:${noUri} fail:${fail} of ${pending.length}`);
const [[tr]]: any = await pool.query("SELECT COUNT(*) n FROM intake_calls WHERE callDate>='2026-06-01' AND callDate<'2026-07-01' AND transcript IS NOT NULL AND transcript<>''");
const [[leads]]: any = await pool.query("SELECT COUNT(*) n FROM intake_leads");
console.log(`[retranscribe] June transcribed now: ${tr.n} | intake_leads: ${leads.n}`);
await pool.end();
process.exit(0);
