import "dotenv/config";
import mysql from "mysql2/promise";
import { getVisitMatrix } from "../server/crmDb";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
// simulate what the Record FR Visit dialog creates
const [res]: any = await c.query(
  "INSERT INTO contact_logs (facilityId, contactType, contactDate, summary, repName) VALUES (?,?,?,?,?)",
  [451298, "visit", new Date("2026-07-15T19:00:00Z"), "FR visit by Lupe (smoke test)", "Lupe"]
);
const m = await getVisitMatrix("2026-07", null);
const lupe = m.find((b: any) => b.rep === "Lupe");
const row = lupe?.rows.find((r: any) => r.facilityId === 451298);
console.log("Lupe July block:", lupe ? `${lupe.totals.facilities} facilities` : "(none)");
console.log("Tip Top row:", row ? JSON.stringify(row.checkIns) : "(missing!)");
await c.query("DELETE FROM contact_logs WHERE id=?", [res.insertId]);
console.log("test row cleaned up");
process.exit(0);
