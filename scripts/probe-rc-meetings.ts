import "dotenv/config";
import axios from "axios";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
const RC = "https://platform.ringcentral.com";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows]: any = await c.query("SELECT userId FROM user_ringcentral_tokens");
await c.end();
console.log("connected RC users:", rows.map((r: any) => r.userId).join(", ") || "(none)");
for (const r of rows.slice(0, 3)) {
  const tok = await getValidRCTokenForUser(r.userId);
  if (!tok) { console.log("user", r.userId, "→ no valid token"); continue; }
  try {
    const resp = await axios.get(RC + "/rcvideo/v1/history/meetings", { headers: { Authorization: `Bearer ${tok}` }, params: { perPage: 5 } });
    console.log("user", r.userId, "OK → keys:", Object.keys(resp.data), "| meetings:", (resp.data.meetings || resp.data.records || []).length);
    console.log(JSON.stringify(resp.data, null, 2).slice(0, 2200));
    break;
  } catch (e: any) { console.log("user", r.userId, "FAIL", e?.response?.status, JSON.stringify(e?.response?.data)?.slice(0, 250)); }
}
process.exit(0);
