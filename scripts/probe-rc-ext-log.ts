import "dotenv/config";
import axios from "axios";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
const RC = "https://platform.ringcentral.com";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows]: any = await c.query("SELECT t.userId, t.extensionId, us.name FROM user_ringcentral_tokens t JOIN users us ON us.id=t.userId WHERE us.role IN ('intake_manager','intake_agent','intake_frontline')");
await c.end();
const admin = await getValidRCTokenForUser(4710004);
console.log("admin token (4710004):", admin ? "OK" : "NONE");
for (const r of rows) {
  try {
    const resp = await axios.get(`${RC}/restapi/v1.0/account/~/extension/${r.extensionId}/call-log`, { headers: { Authorization: "Bearer " + admin }, params: { dateFrom: "2026-06-01T00:00:00Z", dateTo: "2026-07-01T00:00:00Z", perPage: 100, page: 1, view: "Detailed" } });
    console.log(`ext ${r.extensionId} (${r.name}) → ${resp.status} records:${resp.data?.records?.length ?? 0} totalPages:${resp.data?.paging?.totalPages ?? "?"}`);
  } catch (e: any) { console.log(`ext ${r.extensionId} (${r.name}) → FAIL ${e.response?.status} ${JSON.stringify(e.response?.data?.errors?.[0]?.errorCode ?? e.message).slice(0, 60)}`); }
}
process.exit(0);
