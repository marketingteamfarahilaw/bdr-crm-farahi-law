// End-to-end check of the Intake AI engine:
//  1) deterministic scoring + California SOL cases
//  2) a live LLM extraction over a realistic (English/Spanish mix) intake call
// Run: corepack pnpm exec tsx scripts/migration/intake-ai-test.ts
import "dotenv/config";
import { analyzeIntakeTranscript, computeSol, scoreLead, type IntakeExtraction } from "../../server/intakeAI";

// ── 1) Deterministic checks ───────────────────────────────────────────────────
const base: IntakeExtraction = {
  isPotentialClient: true, callPurpose: "new_case", subject: "Car Accident Inquiry",
  injuryFlags: { fracture: "no_indication", headInjury: "no_indication", lossOfConsciousness: "unknown", surgery: "no_indication", scarring: "no_indication", permanentImpairment: "no_indication", priorInjurySameRegion: "unknown" },
  employment: "employed_full_time",
  firstName: "Maria", lastName: "Lopez", phone: null, email: null, preferredLanguage: "Spanish",
  callerName: null, callerRelationship: null, clientLocation: "Bakersfield, CA",
  caseType: "auto_accident", incidentDate: null, incidentLocation: null, incidentDescription: null,
  injuries: "neck and back pain", injurySeverity: "moderate",
  treatmentStatus: "er_visit", treatmentDetails: null,
  liabilityAssessment: "clear_other_party", liabilityNotes: null, policeReport: "yes",
  defendantInsured: "yes", defendantInsurer: "State Farm", clientInsurer: null,
  umCoverage: "unknown", healthInsurance: null, propertyDamage: null, lostWages: "yes",
  priorAttorney: "no", governmentEntity: "no", referredBy: null,
  clientFactorScore: 7, summary: "", keyPoints: [], redFlags: [], missingInfo: [], suggestedQuestions: [], recommendation: "",
};

const recent = new Date(); recent.setMonth(recent.getMonth() - 2);
const old = new Date(); old.setFullYear(old.getFullYear() - 3);

const s1 = computeSol("auto_accident", recent, "no");
const s2 = computeSol("auto_accident", old, "no");
const s3 = computeSol("auto_accident", recent, "yes");
const s4 = computeSol("medical_malpractice", recent, "no");
console.log("SOL  2mo-old auto:", s1.solRisk, "(expect ok)");
console.log("SOL  3yr-old auto:", s2.solRisk, "(expect expired)");
console.log("SOL  govt entity :", s3.solRisk, s3.solDate?.toISOString().slice(0, 10), "(expect ~4mo away → warning)");
console.log("SOL  med-mal 1yr :", s4.solRisk, s4.solDate?.toISOString().slice(0, 10));

const good = scoreLead(base, "ok");
const atFault = scoreLead({ ...base, liabilityAssessment: "client_at_fault" }, "ok");
const priorAtt = scoreLead({ ...base, priorAttorney: "yes" }, "ok");
const expired = scoreLead(base, "expired");
const again = scoreLead(base, "ok");
console.log("\nScore strong auto case :", good.rubric.total, good.tier, "(expect >=75 hot-ish)");
console.log("Score client at fault  :", atFault.rubric.total, atFault.tier, "(cap 25)");
console.log("Score prior attorney   :", priorAtt.rubric.total, priorAtt.tier, "(cap 40)");
console.log("Score expired SOL      :", expired.rubric.total, expired.tier, "(cap 10)");
console.log("Deterministic          :", good.rubric.total === again.rubric.total ? "YES" : "NO !!");

// ── 2) Live LLM extraction ────────────────────────────────────────────────────
const TRANSCRIPT = `
Agent: Thank you for calling Farahi Law Firm, this is Daniela, how can I help you?
Caller: Hola, sí, buenas tardes. Me dieron este número... I was in a car accident last Tuesday. A truck ran the red light on Ming Avenue here in Bakersfield and hit my driver side.
Agent: I'm so sorry. Were you injured?
Caller: Yes, my neck and my left shoulder. The ambulance took me to Mercy Hospital, they did X-rays. Nothing broken gracias a Dios, but the doctor said whiplash and I should see a specialist. I still can't sleep from the pain.
Agent: Did the police come?
Caller: Yes, there is a police report. The officer said the other driver was at fault, he even got a ticket.
Agent: Do you know if the truck driver has insurance?
Caller: It was a company truck, like a delivery company. They gave me the insurance — Progressive Commercial, I have the paper.
Agent: And do you have auto insurance yourself?
Caller: Sí, tengo full coverage con AAA.
Agent: Have you spoken to any other lawyer about this?
Caller: No, no, you are the first ones. My cuñada said you helped her family.
Agent: Are you missing work?
Caller: Yes, I work in the fields, I haven't worked since the accident. My name is Rosa Jimenez, my number is 661-555-0142.
Agent: Thank you Rosa, our team will call you back today.
`;

console.log("\nRunning live LLM extraction…");
const a = await analyzeIntakeTranscript(TRANSCRIPT, { direction: "Inbound", callerNumber: "661-555-0142", agentName: "Daniela", callDate: new Date() });
if (!a) { console.error("EXTRACTION FAILED"); process.exit(1); }
console.log("Name      :", a.extraction.firstName, a.extraction.lastName, "| lang:", a.extraction.preferredLanguage);
console.log("Case      :", a.extraction.caseType, "| incident:", a.extraction.incidentDate, "| location:", a.extraction.incidentLocation);
console.log("Injuries  :", a.extraction.injurySeverity, "—", a.extraction.injuries);
console.log("Liability :", a.extraction.liabilityAssessment, "| police report:", a.extraction.policeReport);
console.log("Insurance : defendant", a.extraction.defendantInsured, `(${a.extraction.defendantInsurer})`, "| client:", a.extraction.clientInsurer);
console.log("Prior atty:", a.extraction.priorAttorney, "| lost wages:", a.extraction.lostWages);
console.log("SOL       :", a.solRisk, a.solDate?.toISOString().slice(0, 10));
console.log("SCORE     :", a.rubric.total, "/100 →", a.tier, JSON.stringify(a.rubric));
console.log("Summary   :", a.extraction.summary);
console.log("Questions :", a.extraction.suggestedQuestions.slice(0, 3));
console.log("\nINTAKE-AI-OK");
