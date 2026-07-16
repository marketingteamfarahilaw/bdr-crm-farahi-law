import "dotenv/config";
import { fromZonedTime } from "date-fns-tz";
import { getNewFacilitiesReport } from "../server/teamReports";
const from = fromZonedTime("2026-06-01 00:00:00", "America/Los_Angeles");
const to = new Date(fromZonedTime("2026-07-01 00:00:00", "America/Los_Angeles").getTime() - 1);
const r = await getNewFacilitiesReport({ from, to }, { excludeImports: true, agentNames: null });
for (const rep of r?.reps ?? []) console.log(`[${(rep as any).group}] ${rep.rep}: added=${rep.addedCount} active=${rep.active}`);
process.exit(0);
