import "dotenv/config";
import mysql from "mysql2/promise";
import { analyzeCallTranscript, maybeCreateVisitFromCall } from "../server/rcSync";

const callDate = new Date("2026-07-10T18:00:00Z"); // Fri Jul 10, 2026 (LA)
const transcript = `
Rep: Hi, this is Miguel from Farahi Law, is Jaron there?
Jaron: This is Jaron. Hey Miguel, how are you?
Rep: Doing great. I wanted to check in on the two referrals we sent over, and also — I'm going to be in the area next Tuesday, could I come by around 12:30 and bring lunch for the shop?
Jaron: Next Tuesday 12:30 works. We'll be here, park in the back.
Rep: Perfect, I'll bring the new referral sheets too. Anything you guys need?
Jaron: Maybe a few more of those brochures in Spanish.
Rep: Done. See you Tuesday!
`;
console.log("1) Extracting…");
const analysis = await analyzeCallTranscript(transcript, callDate);
console.log("   visitPlanned:", JSON.stringify(analysis.visitPlanned));

const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [[fac]]: any = await c.query("SELECT id, name, assignedRepId, assignedRepName FROM facilities WHERE name LIKE 'Tip Top Auto Body%' LIMIT 1");
console.log("2) Test facility:", JSON.stringify(fac));
const created = await maybeCreateVisitFromCall(fac, analysis, callDate, "Miguel");
console.log("   created:", created);
const [rows]: any = await c.query("SELECT id, title, description, dueDate, priority, followUpReason, assignedToName, status FROM facility_tasks WHERE facilityId=? AND followUpReason='visit' ORDER BY id DESC LIMIT 1", [fac.id]);
console.log("3) Visit task:", JSON.stringify(rows[0], null, 2).slice(0, 700));
const again = await maybeCreateVisitFromCall(fac, analysis, callDate, "Miguel");
console.log("4) Dedupe (2nd run creates?):", again, "(should be false)");
if (rows[0]) { await c.query("DELETE FROM facility_tasks WHERE id=?", [rows[0].id]); console.log("5) Test row cleaned up"); }
await c.end();
process.exit(0);
