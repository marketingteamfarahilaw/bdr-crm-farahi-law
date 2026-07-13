import "dotenv/config";
import { getValidRCTokenForUser } from "../server/crmRouter";
import { syncIntakeCalls } from "../server/intakeSync";
const admin = await getValidRCTokenForUser(4710004);
const res = await syncIntakeCalls(admin!, { agent: { id: 8790029, name: "Karen Vega" }, extensionId: "607881022", dateFromISO: "2026-06-13T00:00:00Z", dateToISO: "2026-06-14T00:00:00Z", maxPages: 1, perPage: 100, settleMinutes: 0 });
console.log("TEST (Karen, June 13, 1 page):", JSON.stringify(res));
process.exit(0);
