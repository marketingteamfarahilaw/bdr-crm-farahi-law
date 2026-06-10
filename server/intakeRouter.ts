/**
 * Intake (AI Case Desk) tRPC router.
 *
 * Every procedure is gated to the intake team (+ super admin) — BD/FR roles
 * get FORBIDDEN. The mirror-image gate (intake denied on BD/FR procedures)
 * lives in crmRouter / routers via crmProcedure / bdProcedure, so the two
 * sides of the firm share one app but never see each other's data.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { protectedProcedure, router } from "./_core/trpc";
import { canSeeIntake, canManageIntake } from "@shared/permissions";
import { getDb, getSetting, setSetting } from "./db";
import { intakeLeads, piClients, users } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import {
  addLeadEvent,
  applyAnalysisToLead,
  createIntakeLead,
  createLeadFromAnalysis,
  deleteIntakeLead,
  getIntakeCall,
  getIntakeDashboardStats,
  getIntakeLead,
  linkCallToLead,
  listIntakeCalls,
  listIntakeLeads,
  listLeadEvents,
  rescoreLead,
  updateIntakeLead,
} from "./intakeDb";
import { analyzeIntakeTranscript, INTAKE_CASE_TYPES } from "./intakeAI";
import { syncIntakeCalls } from "./intakeSync";
import { getValidRCTokenForUser } from "./crmRouter";
import { sendIntakeLeadToWebhook, getIntakeWebhookUrl, type IntakeLeadPayload } from "./filevineHook";

const LA_TZ = "America/Los_Angeles";
const laDay = (s: string, end = false) => fromZonedTime(`${s}T${end ? "23:59:59" : "00:00:00"}`, LA_TZ);

/** Intake team + super admin only. */
const intakeProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!canSeeIntake(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Intake team only." });
  }
  return next();
});

/** Intake manager (or super admin) only. */
const intakeManagerProcedure = intakeProcedure.use(({ ctx, next }) => {
  if (!canManageIntake(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Intake managers only." });
  }
  return next();
});

const LEAD_STATUSES = ["new", "reviewing", "qualified", "unqualified", "referred_out", "signed", "lost", "duplicate"] as const;
const YNU = z.enum(["yes", "no", "unknown"]);

/** Build the Filevine webhook payload from a lead row. */
function leadToWebhookPayload(lead: any, trigger: IntakeLeadPayload["trigger"], agent: string | null): IntakeLeadPayload {
  const redFlags: string[] = ((lead.aiAnalysis as any)?.extraction?.redFlags ?? []) as string[];
  return {
    event: "intake_lead",
    trigger,
    leadId: lead.id,
    status: lead.status,
    qualificationScore: lead.qualificationScore,
    qualificationTier: lead.qualificationTier,
    client: {
      firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone, email: lead.email,
      preferredLanguage: lead.preferredLanguage, location: lead.clientLocation,
    },
    caseFacts: {
      caseType: lead.caseType,
      incidentDate: lead.incidentDate ? new Date(lead.incidentDate).toISOString() : null,
      incidentLocation: lead.incidentLocation, incidentDescription: lead.incidentDescription,
      injuries: lead.injuries, injurySeverity: lead.injurySeverity,
      treatmentStatus: lead.treatmentStatus, treatmentDetails: lead.treatmentDetails,
      liabilityAssessment: lead.liabilityAssessment, liabilityNotes: lead.liabilityNotes,
      policeReport: lead.policeReport, defendantInsurer: lead.defendantInsurer,
      clientInsurer: lead.clientInsurer, umCoverage: lead.umCoverage,
      healthInsurance: lead.healthInsurance, propertyDamage: lead.propertyDamage,
      lostWages: lead.lostWages, priorAttorney: lead.priorAttorney,
      governmentEntity: lead.governmentEntity, referredBy: lead.referredBy,
      solDate: lead.solDate ? new Date(lead.solDate).toISOString() : null,
      solRisk: lead.solRisk,
    },
    aiSummary: lead.aiSummary,
    aiRecommendation: lead.aiRecommendation,
    redFlags,
    agent,
    source: "bdcrm-intake",
  };
}

async function pushLeadToFilevine(leadId: number, trigger: IntakeLeadPayload["trigger"], actor: { id: number; name: string }): Promise<boolean> {
  const lead = await getIntakeLead(leadId);
  if (!lead) return false;
  const ok = await sendIntakeLeadToWebhook(leadToWebhookPayload(lead, trigger, actor.name));
  if (ok) {
    await updateIntakeLead(leadId, { filevineSyncedAt: new Date() });
    await addLeadEvent({
      leadId, eventType: "filevine_push",
      title: `Sent to Filevine (${trigger})`,
      actorId: actor.id, actorName: actor.name,
    });
  }
  return ok;
}

export const intakeRouter = router({
  // ─── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: router({
    stats: intakeProcedure.query(async () => {
      return (await getIntakeDashboardStats()) ?? null;
    }),
  }),

  // ─── Leads (the queue) ──────────────────────────────────────────────────────
  leads: router({
    list: intakeProcedure
      .input(z.object({
        status: z.enum(LEAD_STATUSES).optional(),
        tier: z.enum(["hot", "qualified", "review", "unqualified"]).optional(),
        caseType: z.string().max(60).optional(),
        search: z.string().max(200).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }).optional())
      .query(async ({ input }) => {
        return listIntakeLeads({
          status: input?.status, tier: input?.tier,
          caseType: input?.caseType || undefined,
          search: input?.search || undefined,
          from: input?.from ? laDay(input.from) : undefined,
          to: input?.to ? laDay(input.to, true) : undefined,
        });
      }),

    get: intakeProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
        const [calls, events] = await Promise.all([
          listIntakeCalls({ leadId: input.id }),
          listLeadEvents(input.id),
        ]);
        return { lead, calls, events };
      }),

    create: intakeProcedure
      .input(z.object({
        firstName: z.string().max(120).optional(),
        lastName: z.string().max(120).optional(),
        phone: z.string().max(60).optional(),
        email: z.string().max(320).optional(),
        caseType: z.enum(INTAKE_CASE_TYPES).optional(),
        incidentDescription: z.string().max(8000).optional(),
        source: z.enum(["phone", "web", "referral", "walk_in", "manual"]).default("manual"),
        notes: z.string().max(8000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.firstName && !input.lastName && !input.phone) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Give at least a name or a phone number." });
        }
        const id = await createIntakeLead({
          status: "new", source: input.source,
          firstName: input.firstName || null, lastName: input.lastName || null,
          phone: input.phone || null, email: input.email || null,
          caseType: input.caseType ?? null,
          incidentDescription: input.incidentDescription || null,
          notes: input.notes || null,
          createdById: ctx.user.id,
        });
        await addLeadEvent({
          leadId: id, eventType: "created", title: "Lead created manually",
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { id };
      }),

    /** Edit case facts. Edited fields are remembered so the AI never overwrites
     *  a human correction; SOL + score recompute from the new state. */
    update: intakeProcedure
      .input(z.object({
        id: z.number(),
        patch: z.object({
          firstName: z.string().max(120).nullable().optional(),
          lastName: z.string().max(120).nullable().optional(),
          phone: z.string().max(60).nullable().optional(),
          email: z.string().max(320).nullable().optional(),
          preferredLanguage: z.string().max(40).nullable().optional(),
          callerName: z.string().max(255).nullable().optional(),
          callerRelationship: z.string().max(120).nullable().optional(),
          clientLocation: z.string().max(255).nullable().optional(),
          caseType: z.enum(INTAKE_CASE_TYPES).nullable().optional(),
          incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
          incidentLocation: z.string().max(255).nullable().optional(),
          incidentDescription: z.string().max(16000).nullable().optional(),
          injuries: z.string().max(8000).nullable().optional(),
          injurySeverity: z.enum(["none", "minor", "moderate", "severe", "catastrophic", "unknown"]).optional(),
          treatmentStatus: z.enum(["none", "er_visit", "hospitalized", "ongoing", "completed", "unknown"]).optional(),
          treatmentDetails: z.string().max(8000).nullable().optional(),
          liabilityAssessment: z.enum(["clear_other_party", "mostly_other_party", "shared", "unclear", "client_at_fault", "unknown"]).optional(),
          liabilityNotes: z.string().max(8000).nullable().optional(),
          policeReport: YNU.optional(),
          defendantInsurer: z.string().max(255).nullable().optional(),
          clientInsurer: z.string().max(255).nullable().optional(),
          umCoverage: YNU.optional(),
          healthInsurance: z.string().max(255).nullable().optional(),
          propertyDamage: z.string().max(8000).nullable().optional(),
          lostWages: YNU.optional(),
          priorAttorney: YNU.optional(),
          governmentEntity: YNU.optional(),
          referredBy: z.string().max(255).nullable().optional(),
          notes: z.string().max(16000).nullable().optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });

        const { incidentDate, ...rest } = input.patch;
        const set: Record<string, any> = { ...rest };
        if (incidentDate !== undefined) {
          set.incidentDate = incidentDate ? fromZonedTime(`${incidentDate}T12:00:00`, LA_TZ) : null;
        }
        const editedKeys = Object.keys(input.patch).filter((k) => k !== "notes");
        const humanEdited: string[] = Array.from(new Set([
          ...(((lead.aiAnalysis as any)?.humanEdited ?? []) as string[]),
          ...editedKeys,
        ]));
        set.aiAnalysis = { ...((lead.aiAnalysis as any) ?? {}), humanEdited };

        await updateIntakeLead(input.id, set);
        const updated = await rescoreLead(input.id);
        if (editedKeys.length) {
          await addLeadEvent({
            leadId: input.id, eventType: "edited",
            title: `Case facts updated (${editedKeys.slice(0, 6).join(", ")}${editedKeys.length > 6 ? "…" : ""})`,
            actorId: ctx.user.id, actorName: ctx.user.name ?? "",
          });
        }
        return { lead: updated };
      }),

    updateStatus: intakeProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(LEAD_STATUSES),
        note: z.string().max(4000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
        if (lead.status === input.status) return { lead };

        const terminal = ["qualified", "unqualified", "referred_out", "signed", "lost", "duplicate"];
        const set: Record<string, any> = { status: input.status };
        if (terminal.includes(input.status)) {
          set.reviewedById = ctx.user.id;
          set.reviewedAt = new Date();
          set.reviewOutcome = input.status;
          if (input.note) set.reviewNotes = input.note;
        }

        // "Signed" → create the PI client record (the case lives on in pi_clients / Filevine).
        if (input.status === "signed" && !lead.piClientId) {
          const db = await getDb();
          if (db) {
            const res = await db.insert(piClients).values({
              firstName: lead.firstName || lead.callerName || "Unknown",
              lastName: lead.lastName || "",
              phone: lead.phone, email: lead.email,
              incidentDate: lead.incidentDate,
              incidentType: lead.caseType,
              caseStatus: "intake",
              address: lead.clientLocation,
              assignedAgentId: lead.assignedToId ?? ctx.user.id,
              assignedAgentName: lead.assignedToName ?? ctx.user.name ?? null,
              notes: lead.aiSummary,
            });
            set.piClientId = (res[0] as any)?.insertId ?? null;
          }
        }

        await updateIntakeLead(input.id, set);
        await addLeadEvent({
          leadId: input.id, eventType: input.status === "signed" ? "signed" : "status_change",
          title: `Status: ${lead.status} → ${input.status}`,
          detail: input.note || null,
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });

        // Eve-style hand-off: qualified + signed leads flow to Filevine automatically.
        if (input.status === "qualified" || input.status === "signed") {
          await pushLeadToFilevine(input.id, input.status === "signed" ? "signed" : "qualified", { id: ctx.user.id, name: ctx.user.name ?? "" });
        }
        return { lead: await getIntakeLead(input.id) };
      }),

    assign: intakeManagerProcedure
      .input(z.object({ id: z.number(), userId: z.number().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
        let name: string | null = null;
        if (input.userId) {
          const db = await getDb();
          const row = db ? (await db.select({ name: users.name }).from(users).where(eq(users.id, input.userId)).limit(1))[0] : null;
          name = row?.name ?? null;
        }
        await updateIntakeLead(input.id, { assignedToId: input.userId, assignedToName: name });
        await addLeadEvent({
          leadId: input.id, eventType: "assigned",
          title: input.userId ? `Assigned to ${name ?? "specialist"}` : "Unassigned",
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { success: true as const };
      }),

    addNote: intakeProcedure
      .input(z.object({ id: z.number(), note: z.string().min(1).max(8000) }))
      .mutation(async ({ ctx, input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
        await addLeadEvent({
          leadId: input.id, eventType: "note", title: "Note", detail: input.note,
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { success: true as const };
      }),

    /** Re-run the AI over the lead's call transcripts (newest first). */
    reanalyze: intakeProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const lead = await getIntakeLead(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
        const calls = await listIntakeCalls({ leadId: input.id });
        const transcripts = calls.filter((c: any) => c.transcript).slice(0, 3)
          .map((c: any, i: number) => `--- Call ${i + 1} (${c.callDate ? new Date(c.callDate).toISOString() : "unknown date"}) ---\n${c.transcript}`);
        const text = transcripts.join("\n\n").slice(0, 48000) || [lead.incidentDescription, lead.notes].filter(Boolean).join("\n\n");
        if (!text.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "No transcripts or description to analyze yet." });

        const analysis = await analyzeIntakeTranscript(text, { callDate: new Date() });
        if (!analysis) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI analysis failed — try again." });
        const updated = await applyAnalysisToLead(input.id, analysis);
        await addLeadEvent({
          leadId: input.id, eventType: "ai_analysis",
          title: `AI re-analysis — score ${analysis.rubric.total}, ${analysis.tier}`,
          detail: analysis.extraction.summary,
          payload: { rubric: analysis.rubric },
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { lead: updated };
      }),

    /** Analyze pasted text (web-form message, email, manual transcript). */
    analyzeText: intakeProcedure
      .input(z.object({ leadId: z.number().optional(), text: z.string().min(20).max(48000) }))
      .mutation(async ({ ctx, input }) => {
        const analysis = await analyzeIntakeTranscript(input.text, { callDate: new Date() });
        if (!analysis) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI analysis failed — try again." });
        if (input.leadId) {
          const updated = await applyAnalysisToLead(input.leadId, analysis);
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
          await addLeadEvent({
            leadId: input.leadId, eventType: "ai_analysis",
            title: `AI analysis of pasted text — score ${analysis.rubric.total}, ${analysis.tier}`,
            detail: analysis.extraction.summary,
            actorId: ctx.user.id, actorName: ctx.user.name ?? "",
          });
          return { id: input.leadId };
        }
        const id = await createLeadFromAnalysis(analysis, { source: "manual", createdById: ctx.user.id });
        await addLeadEvent({
          leadId: id, eventType: "created", title: "Lead created from pasted text (AI)",
          detail: analysis.extraction.summary,
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { id };
      }),

    sendToFilevine: intakeProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const url = await getIntakeWebhookUrl();
        if (!url) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No Filevine webhook configured — set it in Intake Settings." });
        const ok = await pushLeadToFilevine(input.id, "manual", { id: ctx.user.id, name: ctx.user.name ?? "" });
        if (!ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Webhook delivery failed — check the URL." });
        return { success: true as const };
      }),

    delete: intakeManagerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteIntakeLead(input.id);
        return { success: true as const };
      }),
  }),

  // ─── Calls ──────────────────────────────────────────────────────────────────
  calls: router({
    list: intakeProcedure
      .input(z.object({
        unlinkedOnly: z.boolean().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }).optional())
      .query(async ({ input }) => {
        return listIntakeCalls({
          unlinkedOnly: input?.unlinkedOnly,
          from: input?.from ? laDay(input.from) : undefined,
          to: input?.to ? laDay(input.to, true) : undefined,
        });
      }),

    linkToLead: intakeProcedure
      .input(z.object({ callId: z.number(), leadId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const [call, lead] = await Promise.all([getIntakeCall(input.callId), getIntakeLead(input.leadId)]);
        if (!call || !lead) throw new TRPCError({ code: "NOT_FOUND", message: "Call or lead not found." });
        await linkCallToLead(input.callId, input.leadId);
        await addLeadEvent({
          leadId: input.leadId, eventType: "call_linked",
          title: "Call linked manually",
          payload: { callId: input.callId },
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { success: true as const };
      }),

    createLeadFromCall: intakeProcedure
      .input(z.object({ callId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const call = await getIntakeCall(input.callId);
        if (!call) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
        if (call.leadId) return { id: call.leadId };

        const callerNumber = call.direction === "Inbound" ? call.fromNumber : call.toNumber;
        let id: number;
        if (call.transcript) {
          const analysis = await analyzeIntakeTranscript(call.transcript, {
            direction: call.direction, callerNumber, agentName: call.agentName, callDate: call.callDate,
          });
          if (analysis) {
            id = await createLeadFromAnalysis(analysis, { phone: callerNumber, source: "phone", createdById: ctx.user.id });
          } else {
            id = await createIntakeLead({ status: "new", source: "phone", phone: callerNumber, callerName: call.callerName, createdById: ctx.user.id });
          }
        } else {
          id = await createIntakeLead({ status: "new", source: "phone", phone: callerNumber, callerName: call.callerName, createdById: ctx.user.id });
        }
        await linkCallToLead(input.callId, id);
        await addLeadEvent({
          leadId: id, eventType: "created", title: "Lead created from call",
          payload: { callId: input.callId },
          actorId: ctx.user.id, actorName: ctx.user.name ?? "",
        });
        return { id };
      }),

    /** Pull + process the current user's recent RingCentral calls right now. */
    syncNow: intakeProcedure
      .input(z.object({ lookbackMinutes: z.number().min(5).max(43200).optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const token = await getValidRCTokenForUser(ctx.user.id);
        if (!token) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect your RingCentral first (Intake → RingCentral)." });
        }
        const res = await syncIntakeCalls(token, {
          agent: { id: ctx.user.id, name: String(ctx.user.name ?? ctx.user.email ?? "Unknown") },
          lookbackMinutes: input?.lookbackMinutes ?? 1440,
        });
        return { success: true as const, ...res };
      }),
  }),

  // ─── Team + settings ────────────────────────────────────────────────────────
  team: router({
    /** Intake members — for the assignment dropdown. */
    list: intakeProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(inArray(users.role, ["intake_manager", "intake_agent"]));
    }),
  }),

  settings: router({
    get: intakeManagerProcedure.query(async () => {
      const url = await getSetting("intake_filevine_webhook_url");
      const effective = await getIntakeWebhookUrl();
      return { webhookUrl: url ?? "", effectiveUrl: effective || null };
    }),
    set: intakeManagerProcedure
      .input(z.object({ webhookUrl: z.string().max(2000) }))
      .mutation(async ({ input }) => {
        const v = input.webhookUrl.trim();
        if (v && !/^https:\/\//i.test(v)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Webhook URL must start with https://" });
        }
        await setSetting("intake_filevine_webhook_url", v || null);
        return { success: true as const };
      }),
  }),
});
