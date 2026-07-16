import "dotenv/config";
import { fromZonedTime } from "date-fns-tz";
import { getNewFacilitiesReport } from "../server/teamReports";
for (const month of ["2026-06", "2026-07"]) {
  const [y, m] = month.split("-").map(Number);
  const from = fromZonedTime(`${month}-01 00:00:00`, "America/Los_Angeles");
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const to = new Date(fromZonedTime(`${next} 00:00:00`, "America/Los_Angeles").getTime() - 1);
  const r = await getNewFacilitiesReport({ from, to }, { excludeImports: true, agentNames: null });
  console.log(`\n${month}: total start=${r?.total.startCount} added=${r?.total.addedCount} dropped≈${r?.total.droppedApprox} active=${r?.total.active}`);
  for (const rep of (r?.reps ?? []).slice(0, 6)) console.log(`  ${rep.rep}: start=${rep.startCount} added=${rep.addedCount} dropped≈${rep.droppedApprox} active=${rep.active}` + (rep.added.length ? ` | ${rep.added.slice(0,3).map((a:any)=>a.name+" ("+a.date+")").join(", ")}` : ""));
}
process.exit(0);
