/**
 * Intake (AI Case Desk) database helpers.
 *
 * Lives entirely on the intake_* tables — deliberately NO imports from the
 * facility CRM helpers so the two sides stay decoupled.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  intakeCalls,
  intakeLeadEvents,
  intakeLeads,
  type InsertIntakeCall,
  type InsertIntakeLead,
  type InsertIntakeLeadEvent,
  type IntakeLead,
} from "../drizzle/schema";
import { getDb } from "./db";
import { computeSol, scoreLead, evaluateFirmCriteria, type IntakeAnalysis, type IntakeExtraction } from "./intakeAI";

/** Display name for the AI voice agent's calls — also the test-mode filter key. */
export const VOICE_AGENT_NAME = "Maya — AI Voice Agent";

const onlyDigits = (s?: string | null) => (s || "").replace(/\D/g, "");
export const last10 = (s?: string | null) => { const d = onlyDigits(s); return d.length >= 10 ? d.slice(-10) : d; };

/** Statuses where the lead is still being worked — a new call from the same
 *  number attaches here instead of opening a duplicate. */
const OPEN_STATUSES = ["new", "reviewing", "qualified"] as const;

// ─── Calls ────────────────────────────────────────────────────────────────────

export async function createIntakeCall(data: InsertIntakeCall): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(intakeCalls).values(data);
  return (result[0] as any)?.insertId ?? 0;
}

export async function updateIntakeCall(id: number, data: Partial<InsertIntakeCall>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(intakeCalls).set(data).where(eq(intakeCalls.id, id));
}

export async function getIntakeCall(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(intakeCalls).where(eq(intakeCalls.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getExistingIntakeRcCallIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (!db || ids.length === 0) return new Set();
  const rows = await db.select({ rcCallId: intakeCalls.rcCallId }).from(intakeCalls).where(inArray(intakeCalls.rcCallId, ids));
  return new Set(rows.map((r) => r.rcCallId).filter((x): x is string => !!x));
}

export async function getExistingIntakeRcSessionIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (!db || ids.length === 0) return new Set();
  const rows = await db.select({ rcSessionId: intakeCalls.rcSessionId }).from(intakeCalls).where(inArray(intakeCalls.rcSessionId, ids));
  return new Set(rows.map((r) => r.rcSessionId).filter((x): x is string => !!x));
}

export async function listIntakeCalls(filters?: { leadId?: number; unlinkedOnly?: boolean; from?: Date; to?: Date; limit?: number; excludeVoiceAgent?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filters?.leadId) conds.push(eq(intakeCalls.leadId, filters.leadId));
  if (filters?.unlinkedOnly) conds.push(sql`${intakeCalls.leadId} IS NULL`);
  if (filters?.excludeVoiceAgent) conds.push(sql`(${intakeCalls.agentName} IS NULL OR ${intakeCalls.agentName} <> ${VOICE_AGENT_NAME})`);
  if (filters?.from) conds.push(gte(intakeCalls.callDate, filters.from));
  if (filters?.to) conds.push(lte(intakeCalls.callDate, filters.to));
  let q = db.select().from(intakeCalls);
  if (conds.length) q = q.where(and(...conds)) as any;
  return (q as any).orderBy(desc(intakeCalls.callDate)).limit(filters?.limit ?? 300);
}

export async function linkCallToLead(callId: number, leadId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(intakeCalls).set({ leadId }).where(eq(intakeCalls.id, callId));
}

/** Calls whose recording hadn't been attached yet when first synced.
 *  RingCentral can take several minutes to publish a recording — we re-check
 *  these in a 5–90 minute window so a real client call never slips through
 *  untranscribed (and we stop retrying after that, e.g. internal calls that
 *  are never recorded). */
export async function listRecordinglessRecentCalls(agentId: number) {
  const db = await getDb();
  if (!db) return [];
  const now = Date.now();
  return db
    .select()
    .from(intakeCalls)
    .where(and(
      eq(intakeCalls.agentId, agentId),
      eq(intakeCalls.aiProcessed, 0),
      eq(intakeCalls.hasRecording, 0),
      gte(intakeCalls.callDate, new Date(now - 90 * 60 * 1000)),
      lte(intakeCalls.callDate, new Date(now - 5 * 60 * 1000)),
      sql`${intakeCalls.durationSeconds} >= 15`,
      sql`${intakeCalls.rcCallId} IS NOT NULL`,
    ))
    .limit(30);
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function createIntakeLead(data: InsertIntakeLead): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(intakeLeads).values(data);
  return (result[0] as any)?.insertId ?? 0;
}

export async function updateIntakeLead(id: number, data: Partial<InsertIntakeLead>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(intakeLeads).set(data).where(eq(intakeLeads.id, id));
}

export async function getIntakeLead(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(intakeLeads).where(eq(intakeLeads.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function deleteIntakeLead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(intakeLeads).where(eq(intakeLeads.id, id));
  await db.update(intakeCalls).set({ leadId: null }).where(eq(intakeCalls.leadId, id));
  await db.delete(intakeLeadEvents).where(eq(intakeLeadEvents.leadId, id));
}

export async function listIntakeLeads(filters?: {
  status?: string; tier?: string; caseType?: string; search?: string;
  assignedToId?: number; from?: Date; to?: Date; limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conds: any[] = [];
  if (filters?.status) conds.push(eq(intakeLeads.status, filters.status as any));
  if (filters?.tier) conds.push(eq(intakeLeads.qualificationTier, filters.tier as any));
  if (filters?.caseType) conds.push(eq(intakeLeads.caseType, filters.caseType));
  if (filters?.assignedToId) conds.push(eq(intakeLeads.assignedToId, filters.assignedToId));
  if (filters?.from) conds.push(gte(intakeLeads.createdAt, filters.from));
  if (filters?.to) conds.push(lte(intakeLeads.createdAt, filters.to));
  if (filters?.search) {
    const s = `%${filters.search.toLowerCase()}%`;
    conds.push(sql`(LOWER(CONCAT_WS(' ', ${intakeLeads.firstName}, ${intakeLeads.lastName})) LIKE ${s} OR ${intakeLeads.phone} LIKE ${s} OR LOWER(${intakeLeads.incidentDescription}) LIKE ${s})`);
  }
  let q = db.select().from(intakeLeads);
  if (conds.length) q = q.where(and(...conds)) as any;
  return (q as any).orderBy(desc(intakeLeads.createdAt)).limit(filters?.limit ?? 500);
}

/** Find the open lead a new call from this number belongs to (last-10-digit match). */
export async function findOpenLeadByPhone(rawPhone: string): Promise<IntakeLead | null> {
  const target = last10(rawPhone);
  if (!target || target.length < 7) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(intakeLeads)
    .where(inArray(intakeLeads.status, OPEN_STATUSES as any))
    .orderBy(desc(intakeLeads.createdAt))
    .limit(400);
  return rows.find((l) => last10(l.phone) === target) ?? null;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function addLeadEvent(data: InsertIntakeLeadEvent) {
  const db = await getDb();
  if (!db) return;
  try { await db.insert(intakeLeadEvents).values(data); } catch (e) { console.warn("[intakeDb] addLeadEvent failed:", e); }
}

export async function listLeadEvents(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(intakeLeadEvents).where(eq(intakeLeadEvents.leadId, leadId)).orderBy(desc(intakeLeadEvents.createdAt)).limit(200);
}

// ─── AI analysis ⇄ lead merging ──────────────────────────────────────────────

const UNKNOWNISH = new Set(["unknown", "", null, undefined] as any[]);

/** Lead columns the AI may write. A field a human has edited (tracked in
 *  aiAnalysis.humanEdited) is never overwritten by the AI again. */
const AI_FIELDS = [
  "firstName", "lastName", "phone", "email", "preferredLanguage", "callerName", "callerRelationship",
  "clientLocation", "caseType", "incidentLocation", "incidentDescription", "injuries", "injurySeverity",
  "treatmentStatus", "treatmentDetails", "liabilityAssessment", "liabilityNotes", "policeReport",
  "defendantInsurer", "clientInsurer", "umCoverage", "healthInsurance", "propertyDamage", "lostWages",
  "priorAttorney", "governmentEntity", "referredBy",
] as const;

/** Rebuild an extraction view from the lead's CURRENT columns (the source of
 *  truth once humans edit) so re-scoring always reflects what's on screen. */
export function extractionViewFromLead(lead: IntakeLead): IntakeExtraction {
  const stored = ((lead.aiAnalysis as any)?.extraction ?? {}) as Partial<IntakeExtraction>;
  return {
    ...stored,
    isPotentialClient: true,
    callPurpose: (stored.callPurpose as any) ?? "new_case",
    subject: (stored.subject as any) ?? "",
    injuryFlags: (stored.injuryFlags as any) ?? {
      fracture: "no_indication", headInjury: "no_indication", lossOfConsciousness: "unknown",
      surgery: "no_indication", scarring: "no_indication", permanentImpairment: "no_indication",
      priorInjurySameRegion: "unknown",
    },
    employment: (stored.employment as any) ?? "unknown",
    firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone, email: lead.email,
    preferredLanguage: lead.preferredLanguage, callerName: lead.callerName,
    callerRelationship: lead.callerRelationship, clientLocation: lead.clientLocation,
    caseType: (lead.caseType as any) ?? null,
    incidentDate: lead.incidentDate ? lead.incidentDate.toISOString().slice(0, 10) : null,
    incidentLocation: lead.incidentLocation, incidentDescription: lead.incidentDescription,
    injuries: lead.injuries,
    injurySeverity: (lead.injurySeverity as any) ?? "unknown",
    treatmentStatus: (lead.treatmentStatus as any) ?? "unknown",
    treatmentDetails: lead.treatmentDetails,
    treatmentGap: (stored.treatmentGap as any) ?? "unknown",
    liabilityAssessment: (lead.liabilityAssessment as any) ?? "unknown",
    liabilityNotes: lead.liabilityNotes,
    policeReport: (lead.policeReport as any) ?? "unknown",
    defendantInsured: (stored.defendantInsured as any) ?? (lead.defendantInsurer ? "yes" : "unknown"),
    defendantInsurer: lead.defendantInsurer, clientInsurer: lead.clientInsurer,
    umCoverage: (lead.umCoverage as any) ?? "unknown",
    healthInsurance: lead.healthInsurance, propertyDamage: lead.propertyDamage,
    lostWages: (lead.lostWages as any) ?? "unknown",
    priorAttorney: (lead.priorAttorney as any) ?? "unknown",
    governmentEntity: (lead.governmentEntity as any) ?? "unknown",
    referredBy: lead.referredBy,
    clientFactorScore: typeof stored.clientFactorScore === "number" ? stored.clientFactorScore : 5,
    summary: lead.aiSummary ?? "",
    keyPoints: stored.keyPoints ?? [], redFlags: stored.redFlags ?? [],
    missingInfo: stored.missingInfo ?? [], suggestedQuestions: stored.suggestedQuestions ?? [],
    recommendation: lead.aiRecommendation ?? "",
  };
}

/** Recompute SOL + qualification from the lead's current columns and persist. */
export async function rescoreLead(leadId: number): Promise<IntakeLead | null> {
  const lead = await getIntakeLead(leadId);
  if (!lead) return null;
  const view = extractionViewFromLead(lead);
  const { solDate, solRisk } = computeSol(view.caseType, lead.incidentDate ?? null, view.governmentEntity);
  const { rubric, tier } = scoreLead(view, solRisk);
  const firmCriteria = evaluateFirmCriteria(view);
  const aiAnalysis = { ...((lead.aiAnalysis as any) ?? {}), extraction: view, rubric, firmCriteria };
  await updateIntakeLead(leadId, {
    solDate, solRisk,
    qualificationScore: rubric.total, qualificationTier: tier,
    aiAnalysis,
  });
  return getIntakeLead(leadId);
}

/**
 * Merge a fresh call analysis into a lead: newer extracted facts overwrite
 * older AI values, but never a human edit; SOL + score recomputed from the
 * merged state. Returns the updated lead.
 */
export async function applyAnalysisToLead(leadId: number, analysis: IntakeAnalysis): Promise<IntakeLead | null> {
  const lead = await getIntakeLead(leadId);
  if (!lead) return null;
  const x = analysis.extraction;
  const humanEdited: string[] = ((lead.aiAnalysis as any)?.humanEdited ?? []) as string[];

  const set: Record<string, any> = {};
  for (const f of AI_FIELDS) {
    if (humanEdited.includes(f)) continue;
    const next = (x as any)[f];
    if (UNKNOWNISH.has(next)) continue;                 // new call didn't learn this
    if ((lead as any)[f] !== next) set[f] = next;       // newer info wins over older AI fill
  }
  if (!humanEdited.includes("incidentDate") && x.incidentDate && /^\d{4}-\d{2}-\d{2}$/.test(x.incidentDate)) {
    const d = fromZonedTime(`${x.incidentDate}T12:00:00`, "America/Los_Angeles");
    if (!Number.isNaN(d.getTime())) set.incidentDate = d;
  }

  const mergedAnalysis = {
    ...((lead.aiAnalysis as any) ?? {}),
    extraction: { ...((lead.aiAnalysis as any)?.extraction ?? {}), ...x },
    rubric: analysis.rubric,
    firmCriteria: analysis.firmCriteria,
    humanEdited,
    lastAnalyzedAt: new Date().toISOString(),
  };
  await updateIntakeLead(leadId, {
    ...set,
    aiSummary: x.summary || lead.aiSummary,
    aiRecommendation: x.recommendation || lead.aiRecommendation,
    aiAnalysis: mergedAnalysis,
  });
  // Rescore from the merged columns so human edits + new facts both count.
  return rescoreLead(leadId);
}

/** Create a brand-new lead from a call analysis. Returns the new lead id. */
export async function createLeadFromAnalysis(
  analysis: IntakeAnalysis,
  opts: { phone?: string | null; source?: "phone" | "web" | "referral" | "walk_in" | "manual"; createdById?: number },
): Promise<number> {
  const x = analysis.extraction;
  const incidentDate = x.incidentDate && /^\d{4}-\d{2}-\d{2}$/.test(x.incidentDate)
    ? fromZonedTime(`${x.incidentDate}T12:00:00`, "America/Los_Angeles") : null;
  const id = await createIntakeLead({
    status: "new",
    source: opts.source ?? "phone",
    firstName: x.firstName, lastName: x.lastName,
    phone: x.phone || opts.phone || null,
    email: x.email, preferredLanguage: x.preferredLanguage,
    callerName: x.callerName, callerRelationship: x.callerRelationship, clientLocation: x.clientLocation,
    caseType: x.caseType, incidentDate,
    incidentLocation: x.incidentLocation, incidentDescription: x.incidentDescription,
    injuries: x.injuries, injurySeverity: x.injurySeverity as any,
    treatmentStatus: x.treatmentStatus as any, treatmentDetails: x.treatmentDetails,
    liabilityAssessment: x.liabilityAssessment as any, liabilityNotes: x.liabilityNotes,
    policeReport: x.policeReport as any,
    defendantInsurer: x.defendantInsurer, clientInsurer: x.clientInsurer,
    umCoverage: x.umCoverage as any, healthInsurance: x.healthInsurance,
    propertyDamage: x.propertyDamage, lostWages: x.lostWages as any,
    priorAttorney: x.priorAttorney as any, governmentEntity: x.governmentEntity as any,
    referredBy: x.referredBy,
    solDate: analysis.solDate, solRisk: analysis.solRisk as any,
    qualificationScore: analysis.rubric.total, qualificationTier: analysis.tier as any,
    aiSummary: x.summary,
    aiAnalysis: { extraction: x, rubric: analysis.rubric, firmCriteria: analysis.firmCriteria, humanEdited: [], lastAnalyzedAt: new Date().toISOString() },
    aiRecommendation: x.recommendation,
    createdById: opts.createdById,
  });
  return id;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getIntakeDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  // "Today" = the California calendar day, consistent with the rest of the CRM.
  const dayStart = fromZonedTime(`${formatInTimeZone(now, "America/Los_Angeles", "yyyy-MM-dd")}T00:00:00`, "America/Los_Angeles");
  const weekStart = new Date(now.getTime() - 7 * 86400000);

  const leads = await db.select().from(intakeLeads).orderBy(desc(intakeLeads.createdAt)).limit(1000);
  const todayCalls = await db
    .select({ purpose: intakeCalls.callPurpose, rec: intakeCalls.hasRecording, dur: intakeCalls.durationSeconds })
    .from(intakeCalls)
    .where(gte(intakeCalls.callDate, dayStart));
  const callsWeek = await db.select({ n: sql<number>`COUNT(*)` }).from(intakeCalls).where(gte(intakeCalls.callDate, weekStart));

  // Triage: what happened to today's calls — so "17 calls, 0 leads" reads as
  // "screened out", not "broken".
  const triageToday = { potentialClients: 0, existingClients: 0, adjustersVendors: 0, wrongNumberOther: 0, noRecording: 0 };
  for (const c of todayCalls) {
    if (c.purpose === "new_case" || c.purpose === "follow_up") triageToday.potentialClients++;
    else if (c.purpose === "existing_client") triageToday.existingClients++;
    else if (c.purpose === "adjuster" || c.purpose === "solicitation") triageToday.adjustersVendors++;
    else if (c.purpose === "wrong_number" || c.purpose === "internal" || c.purpose === "other") triageToday.wrongNumberOther++;
    else triageToday.noRecording++; // not analyzed — no recording / too short
  }

  const by = (f: (l: IntakeLead) => boolean) => leads.filter(f).length;
  const decided = leads.filter((l) => ["qualified", "signed", "unqualified", "referred_out", "lost"].includes(l.status));
  const qualifiedish = decided.filter((l) => ["qualified", "signed"].includes(l.status)).length;

  return {
    newToday: by((l) => l.createdAt >= dayStart),
    newThisWeek: by((l) => l.createdAt >= weekStart),
    pendingReview: by((l) => l.status === "new" || l.status === "reviewing"),
    hotLeads: by((l) => l.qualificationTier === "hot" && !["signed", "lost", "unqualified", "referred_out", "duplicate"].includes(l.status)),
    signed: by((l) => l.status === "signed"),
    qualifiedRate: decided.length ? Math.round((qualifiedish / decided.length) * 100) : 0,
    solUrgent: by((l) => (l.solRisk === "urgent" || l.solRisk === "expired") && !["signed", "lost", "unqualified", "referred_out", "duplicate"].includes(l.status)),
    callsToday: todayCalls.length,
    callsThisWeek: Number(callsWeek[0]?.n ?? 0),
    triageToday,
    tierBreakdown: {
      hot: by((l) => l.qualificationTier === "hot"),
      qualified: by((l) => l.qualificationTier === "qualified"),
      review: by((l) => l.qualificationTier === "review"),
      unqualified: by((l) => l.qualificationTier === "unqualified"),
      unscored: by((l) => !l.qualificationTier),
    },
    statusBreakdown: leads.reduce<Record<string, number>>((acc, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {}),
    recentLeads: leads.slice(0, 8),
  };
}
