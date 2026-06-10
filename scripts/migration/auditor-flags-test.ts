import "dotenv/config";
import { analyzeIntakeTranscript } from "../../server/intakeAI";
const T = `Agent: Farahi Law Firm, this is Daniela.
Caller: Hi, I fell at a grocery store in Fresno two weeks ago - wet floor, no sign. I broke my wrist, the doctor put a cast and says I might need surgery. I also hit my head and blacked out for a few seconds; I still get dizzy. I have a big cut on my arm that is scarring. I work full time at a warehouse but I cannot lift anything now. My name is Robert Avila, 559-555-0177. No, I have not talked to other lawyers.
Agent: Did the store make a report?
Caller: Yes, the manager wrote an incident report.`;
const a = await analyzeIntakeTranscript(T, { direction: "Inbound", callerNumber: "559-555-0177", agentName: "Daniela", callDate: new Date() });
if (!a) { console.error("FAILED"); process.exit(1); }
console.log("Subject   :", a.extraction.subject);
console.log("Flags     :", JSON.stringify(a.extraction.injuryFlags));
console.log("Employment:", a.extraction.employment, "| lost wages:", a.extraction.lostWages);
console.log("Case      :", a.extraction.caseType, "| severity:", a.extraction.injurySeverity);
console.log("SCORE     :", a.rubric.total, "->", a.tier);
