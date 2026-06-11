// One-time backfill: re-run the upgraded intake brain (INTAKE_LLM_MODEL) over
// every transcribed call that did NOT produce a lead, and route any that were
// misclassified by the old budget model. Calls already linked to a lead are
// left untouched. Run: corepack pnpm exec tsx scripts/migration/reanalyze-intake-calls.ts
import "dotenv/config";
import mysql from "mysql2/promise";
import { routeAnalyzedTranscript } from "../../server/intakeSync";
import { VOICE_AGENT_NAME } from "../../server/intakeDb";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const [calls] = await c.query<any[]>(
  `SELECT id, transcript, transcriptLang, direction, fromNumber, toNumber, durationSeconds, callDate,
          agentId, agentName, callPurpose
   FROM intake_calls
   WHERE transcript IS NOT NULL AND leadId IS NULL AND (agentName IS NULL OR agentName <> ?)
   ORDER BY id`,
  [VOICE_AGENT_NAME],
);
console.log(`Re-analyzing ${calls.length} transcribed, lead-less calls with ${process.env.INTAKE_LLM_MODEL ?? "gpt-4o"}…\n`);

let created = 0, updated = 0, reclassified = 0;
for (const call of calls) {
  const callerNumber = call.direction === "Inbound" ? call.fromNumber : call.toNumber;
  try {
    const r = await routeAnalyzedTranscript({
      callId: call.id,
      transcript: call.transcript,
      transcriptLang: call.transcriptLang,
      direction: call.direction,
      callerNumber,
      durationSecs: call.durationSeconds ?? 0,
      callDate: call.callDate ? new Date(call.callDate) : null,
      agent: { id: call.agentId ?? null, name: call.agentName ?? "Intake" },
    });
    const [[after]] = await c.query<any[]>("SELECT callPurpose, LEFT(subject,50) s FROM intake_calls WHERE id = ?", [call.id]);
    const changed = after.callPurpose !== call.callPurpose;
    if (changed) reclassified++;
    if (r.leadCreated) created++;
    if (r.leadUpdated) updated++;
    if (changed || r.leadCreated || r.leadUpdated) {
      console.log(`#${call.id} ${call.callPurpose ?? "?"} → ${after.callPurpose}${r.leadCreated ? "  ➜ LEAD CREATED" : r.leadUpdated ? "  ➜ lead updated" : ""}  | ${after.s}`);
    }
  } catch (e: any) {
    console.warn(`#${call.id} failed:`, e?.message ?? e);
  }
}
console.log(`\nDone. Reclassified: ${reclassified} · new leads: ${created} · merged into existing: ${updated}`);
const [[n]] = await c.query<any[]>("SELECT COUNT(*) n FROM intake_leads");
console.log("intake_leads total now:", n.n);
await c.end();
