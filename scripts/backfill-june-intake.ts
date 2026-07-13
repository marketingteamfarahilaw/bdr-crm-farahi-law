import "dotenv/config";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
import { syncIntakeCalls } from "../server/intakeSync";

const ADMIN_USER = 4710004;
// 3-day windows across June (LA-ish, in UTC) — refresh token per window to avoid expiry.
const windows: [string, string][] = [];
for (let d = 1; d <= 30; d += 3) {
  const from = `2026-06-${String(d).padStart(2, "0")}T07:00:00Z`;
  const toD = Math.min(d + 3, 31);
  const to = toD <= 30 ? `2026-06-${String(toD).padStart(2, "0")}T07:00:00Z` : `2026-07-01T07:00:00Z`;
  windows.push([from, to]);
}

const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows]: any = await c.query("SELECT t.userId, t.extensionId, us.name FROM user_ringcentral_tokens t JOIN users us ON us.id=t.userId WHERE us.role IN ('intake_manager','intake_agent','intake_frontline')");
const [[before]]: any = await c.query("SELECT COUNT(*) n FROM intake_calls");
console.log(`[backfill] June intake — ${rows.length} extensions × ${windows.length} windows. intake_calls before: ${before.n}`);

const totals: any = { scanned: 0, logged: 0, transcribed: 0, leadsCreated: 0, leadsUpdated: 0 };
for (const [from, to] of windows) {
  const admin = await getValidRCTokenForUser(ADMIN_USER); // fresh per window
  if (!admin) { console.log("[backfill] no admin token — abort"); break; }
  for (const r of rows) {
    try {
      const res = await syncIntakeCalls(admin, { agent: { id: r.userId, name: r.name || "Intake" }, extensionId: String(r.extensionId), dateFromISO: from, dateToISO: to, maxPages: 10, perPage: 250, settleMinutes: 0 });
      for (const k of Object.keys(totals)) totals[k] += (res as any)[k] ?? 0;
      if (res.logged || res.transcribed) console.log(`[backfill] ${from.slice(5,10)} ${r.name}: +${res.logged} logged, ${res.transcribed} transcribed, +${res.leadsCreated} leads`);
    } catch (e: any) { console.log(`[backfill] ${from.slice(5,10)} ${r.name} FAIL: ${e?.response?.status ?? ""} ${e?.message}`); }
  }
}
const [[after]]: any = await c.query("SELECT COUNT(*) n FROM intake_calls");
const [[leads]]: any = await c.query("SELECT COUNT(*) n FROM intake_leads");
console.log(`[backfill] DONE. totals=${JSON.stringify(totals)} | intake_calls ${before.n}→${after.n} | intake_leads=${leads.n}`);
await c.end();
process.exit(0);
