import "dotenv/config";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
import { syncRcMeetings } from "../server/rcMeetingSync";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows]: any = await c.query("SELECT userId FROM user_ringcentral_tokens");
let total = 0;
for (const r of rows) {
  try {
    const tok = await getValidRCTokenForUser(r.userId);
    if (!tok) { console.log("user", r.userId, "no token"); continue; }
    const res = await syncRcMeetings(tok, { pages: 3 });
    console.log("user", r.userId, "→ scanned", res.scanned, "logged", res.logged);
    total += res.logged;
  } catch (e: any) { console.log("user", r.userId, "FAIL", e?.response?.status ?? e?.message); }
}
const [[t]]: any = await c.query("SELECT COUNT(*) n FROM rc_meetings");
const [recent]: any = await c.query("SELECT hostName, topic, startTime, durationSeconds, participantCount, participants FROM rc_meetings ORDER BY startTime DESC LIMIT 6");
console.log("\nTotal new logged:", total, "| rc_meetings rows now:", t.n);
for (const m of recent) console.log(` ${m.startTime?.toISOString?.()?.slice(0,16) ?? m.startTime} | host ${m.hostName} | ${Math.round(m.durationSeconds/60)}min | ${m.participantCount}p | ${JSON.stringify(m.participants)}`);
await c.end();
process.exit(0);
