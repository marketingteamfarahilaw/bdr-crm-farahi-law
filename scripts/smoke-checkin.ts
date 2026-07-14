import "dotenv/config";
import { getCheckinMatrix } from "../server/crmDb";
const m = await getCheckinMatrix("2026-06", null);
console.log("rep blocks:", m.length);
for (const b of m.slice(0, 3)) {
  console.log(`\n${b.rep} — ${b.totals.facilities} facilities, ${b.totals.calls} calls`);
  for (const r of b.rows.slice(0, 5)) {
    console.log(`  ${r.isPhoneOnly ? "[ph] " : ""}${r.label} | total ${r.total} | ` + r.checkIns.map((c: any) => `${c.date}(${c.count})`).join("  "));
  }
}
process.exit(0);
