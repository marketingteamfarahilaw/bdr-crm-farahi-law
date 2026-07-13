import "dotenv/config";
import axios from "axios";
import { getValidRCTokenForUser, getValidRCToken } from "../server/crmRouter";
const RC = "https://platform.ringcentral.com";
async function testAccountLog(tok: string, who: string) {
  try {
    const r = await axios.get(RC + "/restapi/v1.0/account/~/call-log", { headers: { Authorization: "Bearer " + tok }, params: { dateFrom: "2026-06-01T00:00:00Z", dateTo: "2026-06-02T00:00:00Z", perPage: 5, view: "Detailed" } });
    console.log(who + " ACCOUNT-log → " + r.status + " records:" + (r.data?.records?.length ?? 0) + " totalPages:" + (r.data?.paging?.totalPages ?? "?"));
    return true;
  } catch (e: any) { console.log(who + " ACCOUNT-log → FAIL " + e.response?.status + " " + JSON.stringify(e.response?.data?.errors?.[0]?.errorCode ?? e.response?.data?.message ?? e.message).slice(0, 90)); return false; }
}
try { const ct = await getValidRCToken(); console.log("company JWT: OK"); await testAccountLog(ct, "[company JWT]"); } catch (e: any) { console.log("company JWT: FAIL " + String(e.message).slice(0, 90)); }
for (const uid of [4710001, 4710002, 4710003, 4710004, 5070008]) {
  const tok = await getValidRCTokenForUser(uid).catch(() => null);
  if (!tok) { console.log("user " + uid + ": no token"); continue; }
  await testAccountLog(tok, "user " + uid);
}
process.exit(0);
