import "dotenv/config";
import { getVisitMatrix } from "../server/crmDb";
for (const month of ["2026-06", "2026-07"]) {
  const m = await getVisitMatrix(month, null);
  console.log(`\n${month}: ${m.length} FR blocks`);
  for (const b of m.slice(0, 3)) {
    console.log(`  ${b.rep} — ${b.totals.facilities} facilities, ${b.totals.calls} visits`);
    for (const r of b.rows.slice(0, 3)) console.log(`    ${r.label} | total ${r.total} | ` + r.checkIns.map((c: any) => `${c.date}(${c.count})`).join("  "));
  }
}
process.exit(0);
