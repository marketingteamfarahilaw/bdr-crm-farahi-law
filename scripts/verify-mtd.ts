import "dotenv/config";
import { getVisitMatrix, getCheckinMatrix } from "../server/crmDb";
for (const month of ["2026-06", "2026-07"]) {
  console.log(`\n===== ${month} =====`);
  const v = await getVisitMatrix(month, null);
  console.log("VISITS:", v.map((b: any) => `${b.rep.split(" ")[0]}=${b.totals.calls}(${b.totals.facilities}f)`).join("  "));
  const ci = await getCheckinMatrix(month, null);
  console.log("CHECK-INS:", ci.map((b: any) => `${b.rep.split(" ")[0]}=${b.totals.calls}(${b.totals.facilities}f)`).join("  "));
}
process.exit(0);
