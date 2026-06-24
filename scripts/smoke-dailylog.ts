import "dotenv/config";
import { getActiveDates, getDailyLog } from "../server/dailyLogDb";
const dates = await getActiveDates({ all: true });
console.log("Active dates (top 8):", dates.slice(0, 8).map(d => `${d.date}(${d.count})`).join(", "));
const target = dates[0]?.date;
if (target) {
  const log = await getDailyLog(target, { all: true });
  console.log(`\n=== ${log.date} ===`);
  console.log("totals:", JSON.stringify(log.totals));
  console.log("byPerson:", log.byPerson.length, "| byFacility:", log.byFacility.length);
  for (const p of log.byPerson.slice(0, 3)) console.log(`  ${p.person}: ${p.calls} calls, ${p.facilitiesContacted} facilities, ${p.visits} visits, ${p.notesAdded} notes, ${p.tasksCompleted} tasks done, ${p.pendingFollowUps} pending | ${p.events.length} events`);
  const ev = log.byPerson[0]?.events?.[0];
  if (ev) console.log("  sample event:", JSON.stringify({ kind: ev.kind, who: ev.who, facility: ev.facilityName, detail: String(ev.detail).slice(0, 80) }));
}
console.log("\nOK");
process.exit(0);
