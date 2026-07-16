import "dotenv/config";
import { getVisitMatrix } from "../server/crmDb";
const m = await getVisitMatrix("2026-03", null);
console.log(`2026-03: ${m.length} FR blocks`);
for (const b of m.slice(0, 4)) {
  console.log(`  ${b.rep} — ${b.totals.facilities} facilities, ${b.totals.calls} visits`);
  for (const r of b.rows.slice(0, 3)) console.log(`    ${r.label} | total ${r.total} | ` + r.checkIns.map((c: any) => `${c.date}(${c.count})`).join("  "));
}
process.exit(0);
