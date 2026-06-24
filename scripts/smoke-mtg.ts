import "dotenv/config";
import { getDailyLog } from "../server/dailyLogDb";
const log = await getDailyLog("2026-06-24", { all: true });
console.log("2026-06-24 totals:", JSON.stringify(log.totals));
for (const p of log.byPerson.filter((x:any)=>x.meetings>0).slice(0,5)) {
  console.log(`  ${p.person}: ${p.meetings} meetings`);
  for (const e of p.events.filter((e:any)=>e.kind==='meeting').slice(0,2)) console.log(`     · ${e.detail}`);
}
process.exit(0);
