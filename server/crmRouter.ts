/**
 * CRM tRPC Router — Facility Partner CRM
 * All procedures for facilities, contact logs, tasks, leads sent, and management dashboard.
 */

import { TRPCError } from "@trpc/server";
import axios from "axios";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import {
  completeTask,
  createContactLog,
  createFacility,
  createFacilityLead,
  createGratitudeAction,
  createFacilityUpdate,
  createReferral,
  createTask,
  deleteFacility,
  deleteContactLog,
  deleteFacilityLead,
  deleteGratitudeAction,
  deleteFacilityUpdate,
  deleteReferral,
  deleteRingcentralToken,
  deleteTask,
  getAllFacilitiesForMap,
  getDashboardStats,
  getRelationshipBalance,
  getFacilityById,
  getLastContactLog,
  getRingcentralToken,
  getTotalLeadsSent,
  getTotalReferrals,
  listContactLogs,
  listFacilities,
  listFacilityLeads,
  listGratitudeActions,
  listFacilityUpdates,
  listLeadsSent,
  listOverdueTasks,
  listReferrals,
  listTasksByFacility,
  listTasksByUser,
  reopenTask,
  updateFacility,
  updateFacilityLead,
  updateReferral,
  upsertLeadsSent,
  upsertRingcentralToken,
  getBdrCallActivity,
  getBdrPartnerCheckins,
  getBdrTopFacilities,
  findFacilityByPhone,
  getDailyFacilityCallsKPI,
  getMonthlyFacilitiesCalledKPI,
} from "./crmDb";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const RC_BASE = "https://platform.ringcentral.com";

async function refreshRCToken(refreshToken: string, clientId: string, clientSecret: string) {
  const resp = await axios.post(
    `${RC_BASE}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

async function getValidRCToken(): Promise<string> {
  const stored = await getRingcentralToken();
  if (!stored) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral not connected" });
  const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
  if (stored.tokenExpiry.getTime() - Date.now() < 5 * 60 * 1000) {
    let refreshed: { access_token: string; refresh_token: string; expires_in: number };
    try {
      refreshed = await refreshRCToken(stored.refreshToken, clientId, clientSecret);
    } catch (err: any) {
      // 400/401 from RC means the refresh token is expired or revoked — user must re-connect
      const status = err?.response?.status;
      if (status === 400 || status === 401) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "RingCentral session expired. Please go to RingCentral Settings and reconnect your account.",
        });
      }
      throw err;
    }
    await upsertRingcentralToken({
      accountId: stored.accountId,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
      ownerExtensionId: stored.ownerExtensionId ?? undefined,
      ownerName: stored.ownerName ?? undefined,
    });
    return refreshed.access_token;
  }
  return stored.accessToken;
}

const RELATIONSHIP_STATUSES = [
  "active_partner",
  "warm_lead",
  "cold",
  "churned",
  "do_not_contact",
  "needs_agent",
] as const;

const CATEGORIES = [
  "body_shop",
  "chiropractor",
  "physical_therapist",
  "medical_clinic",
  "orthopedic_doctor",
  "imaging_center",
  "other",
] as const;

const CONTACT_TYPES = ["call", "visit", "email", "text", "meeting", "other"] as const;
const TASK_PRIORITIES = ["high", "medium", "low"] as const;

export const crmRouter = router({
  // ─── Facilities ─────────────────────────────────────────────────────────────

  facilities: router({
    list: protectedProcedure
      .input(
        z.object({
          search: z.string().optional(),
          status: z.string().optional(),
          category: z.string().optional(),
          managementFlag: z.boolean().optional(),
          sortBy: z.enum(["name", "updatedAt", "createdAt"]).optional(),
          sortDir: z.enum(["asc", "desc"]).optional(),
        }).optional()
      )
      .query(async ({ input }) => {
        const rows = await listFacilities(input ?? {});
        // Enrich with last contact and total leads sent
        const enriched = await Promise.all(
          rows.map(async (f: typeof rows[number]) => {
            const lastContact = await getLastContactLog(f.id);
            const totalLeadsSent = await getTotalLeadsSent(f.id);
            return { ...f, lastContact, totalLeadsSent };
          })
        );
        return enriched;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const facility = await getFacilityById(input.id);
        if (!facility) throw new TRPCError({ code: "NOT_FOUND", message: "Facility not found" });
        const [contactHistory, tasks, leadsSent, totalLeads, referrals] = await Promise.all([
          listContactLogs(input.id),
          listTasksByFacility(input.id),
          listLeadsSent(input.id),
          getTotalLeadsSent(input.id),
          listReferrals(input.id),
        ]);
        const totalReferrals = referrals.length;
        return { ...facility, contactHistory, tasks, leadsSent, totalLeads, referrals, totalReferrals };
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          category: z.enum(CATEGORIES),
          address: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          contactName: z.string().optional(),
          contactTitle: z.string().optional(),
          contactPhone: z.string().optional(),
          contactEmail: z.string().optional(),
          relationshipStatus: z.enum(RELATIONSHIP_STATUSES).default("warm_lead"),
          notes: z.string().optional(),
          placeId: z.string().optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createFacility({
          ...input,
          assignedRepId: ctx.user.id,
          assignedRepName: ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          category: z.enum(CATEGORIES).optional(),
          address: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          contactName: z.string().optional(),
          contactTitle: z.string().optional(),
          contactPhone: z.string().optional(),
          contactEmail: z.string().optional(),
          relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional(),
          assignedRepId: z.number().optional(),
          assignedRepName: z.string().optional(),
          notes: z.string().optional(),
          managementFlag: z.boolean().optional(),
          managementNote: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, managementFlag, ...rest } = input;
        await updateFacility(id, {
          ...rest,
          ...(managementFlag !== undefined ? { managementFlag: managementFlag ? 1 : 0 } : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can delete facilities." });
        }
        await deleteFacility(input.id);
        return { success: true };
      }),

    bulkCreate: protectedProcedure
      .input(
        z.object({
          facilities: z.array(
            z.object({
              name: z.string().min(1),
              category: z.enum(CATEGORIES).default("other"),
              address: z.string().optional(),
              city: z.string().optional(),
              phone: z.string().optional(),
              phone2: z.string().optional(),
              website: z.string().optional(),
              contactName: z.string().optional(),
              contactTitle: z.string().optional(),
              contactPhone: z.string().optional(),
              contactEmail: z.string().optional(),
              assignedRepName: z.string().optional(),
              relationshipStatus: z.enum(RELATIONSHIP_STATUSES).default("warm_lead"),
              notes: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let created = 0;
        let skipped = 0;
        for (const f of input.facilities) {
          try {
            await createFacility({
              ...f,
              assignedRepId: ctx.user.id,
              assignedRepName: f.assignedRepName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
            });
            created++;
          } catch {
            skipped++;
          }
        }
        return { created, skipped };
      }),

    promoteFromScraper: protectedProcedure
      .input(
        z.object({
          name: z.string(),
          category: z.string(),
          address: z.string().nullable(),
          phone: z.string().nullable(),
          website: z.string().nullable(),
          placeId: z.string().optional(),
          latitude: z.number().nullable(),
          longitude: z.number().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const cat = CATEGORIES.includes(input.category as any)
          ? (input.category as (typeof CATEGORIES)[number])
          : "other";
        await createFacility({
          name: input.name,
          category: cat,
          address: input.address ?? undefined,
          phone: input.phone ?? undefined,
          website: input.website ?? undefined,
          placeId: input.placeId,
          latitude: input.latitude ?? undefined,
          longitude: input.longitude ?? undefined,
          relationshipStatus: "warm_lead",
          assignedRepId: ctx.user.id,
          assignedRepName: ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),
  }),

  // ─── Contact Logs ────────────────────────────────────────────────────────────

  contactLogs: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listContactLogs(input.facilityId)),

    create: protectedProcedure
      .input(
        z.object({
          facilityId: z.number(),
          contactType: z.enum(CONTACT_TYPES),
          contactDate: z.string(), // ISO string
          callResult: z.enum(["connected", "voicemail", "no_answer", "busy", "other"]).optional(),
          callDuration: z.string().optional(),
          callType: z.enum(["partner_checkin", "bdr_checkin", "fr_checkin", "internal", "potential_lead", "other"]).optional(),
          fieldHours: z.string().optional(),
          summary: z.string().optional(),
          repName: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createContactLog({
          facilityId: input.facilityId,
          contactType: input.contactType,
          contactDate: new Date(input.contactDate),
          callResult: input.callResult,
          callDuration: input.callDuration,
          callType: input.callType,
          fieldHours: input.fieldHours,
          summary: input.summary,
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteContactLog(input.id);
        return { success: true };
      }),
  }),

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  tasks: router({
    listByFacility: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listTasksByFacility(input.facilityId)),

    listMine: protectedProcedure
      .input(z.object({ status: z.enum(["open", "completed"]).optional() }))
      .query(async ({ ctx, input }) => listTasksByUser(ctx.user.id, input.status)),

    listOverdue: protectedProcedure.query(async () => listOverdueTasks()),

    create: protectedProcedure
      .input(
        z.object({
          facilityId: z.number(),
          title: z.string().min(1),
          description: z.string().optional(),
          dueDate: z.string().optional(), // ISO string
          priority: z.enum(TASK_PRIORITIES).default("medium"),
          assignToSelf: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createTask({
          facilityId: input.facilityId,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          priority: input.priority,
          assignedToId: input.assignToSelf ? ctx.user.id : ctx.user.id,
          assignedToName: ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    complete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await completeTask(input.id);
        return { success: true };
      }),

    reopen: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await reopenTask(input.id);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteTask(input.id);
        return { success: true };
      }),
  }),

  // ─── Leads Sent ──────────────────────────────────────────────────────────────

  leadsSent: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listLeadsSent(input.facilityId)),

    upsert: protectedProcedure
      .input(
        z.object({
          facilityId: z.number(),
          year: z.number().int().min(2020).max(2100),
          month: z.number().int().min(1).max(12),
          count: z.number().int().min(0),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await upsertLeadsSent(input);
        return { success: true };
      }),
  }),

  // ─── Referrals ────────────────────────────────────────────────────────────────

  referrals: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listReferrals(input.facilityId)),

    create: protectedProcedure
      .input(z.object({
        facilityId: z.number(),
        referralDate: z.string(),
        clientName: z.string().min(1),
        caseValue: z.enum(["rank_x", "high", "medium", "low", "na"]).default("medium"),
        repName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await createReferral({
          ...input,
          referralDate: new Date(input.referralDate),
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        referralDate: z.string().optional(),
        clientName: z.string().optional(),
        caseValue: z.enum(["rank_x", "high", "medium", "low", "na"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, referralDate, ...rest } = input;
        await updateReferral(id, {
          ...rest,
          ...(referralDate ? { referralDate: new Date(referralDate) } : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteReferral(input.id);
        return { success: true };
      }),
  }),

  // ─── RingCentral Integration ──────────────────────────────────────────────────

  ringcentral: router({
    status: protectedProcedure.query(async () => {
      const token = await getRingcentralToken();
      return { connected: !!token, ownerName: token?.ownerName ?? null, tokenExpiry: token?.tokenExpiry ?? null };
    }),

    connect: protectedProcedure
      .input(z.object({ code: z.string(), redirectUri: z.string() }))
      .mutation(async ({ input }) => {
        const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
        const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
        if (!clientId || !clientSecret) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral credentials not configured. Add RINGCENTRAL_CLIENT_ID and RINGCENTRAL_CLIENT_SECRET in Settings." });
        }
        const tokenResp = await axios.post(
          `${RC_BASE}/restapi/oauth/token`,
          new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri }),
          { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        const { access_token, refresh_token, expires_in } = tokenResp.data;
        const meResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const accountId = meResp.data.account?.id?.toString() ?? "default";
        const ownerName = meResp.data.name ?? "Unknown";
        await upsertRingcentralToken({
          accountId,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiry: new Date(Date.now() + expires_in * 1000),
          ownerName,
          ownerExtensionId: meResp.data.id?.toString(),
        });
        return { success: true, ownerName };
      }),

    connectJwt: protectedProcedure
      .input(z.object({ jwt: z.string() }))
      .mutation(async ({ input }) => {
        const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
        const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
        if (!clientId || !clientSecret) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral credentials not configured." });
        }
        const tokenResp = await axios.post(
          `${RC_BASE}/restapi/oauth/token`,
          new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: input.jwt }),
          { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        const { access_token, refresh_token, expires_in } = tokenResp.data;
        const meResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const accountId = meResp.data.account?.id?.toString() ?? "default";
        const ownerName = meResp.data.name ?? "Unknown";
        await upsertRingcentralToken({
          accountId,
          accessToken: access_token,
          refreshToken: refresh_token ?? "",
          tokenExpiry: new Date(Date.now() + (expires_in ?? 3600) * 1000),
          ownerName,
          ownerExtensionId: meResp.data.id?.toString(),
        });
        return { success: true, ownerName };
      }),

    disconnect: protectedProcedure.mutation(async () => {
      await deleteRingcentralToken();
      return { success: true };
    }),

    getAccessToken: protectedProcedure.query(async () => {
      try {
        const accessToken = await getValidRCToken();
        return { accessToken };
      } catch {
        return { accessToken: null };
      }
    }),

    getWidgetConfig: protectedProcedure.query(async ({ ctx }) => {
      const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
      const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
      const jwt = process.env.RINGCENTRAL_JWT ?? "";
      // Fetch the user's RingOut myLocation number from DB
      const db = await getDb();
      const userRow = db ? await db.select({ ringoutMyLocation: users.ringoutMyLocation })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .then((r: { ringoutMyLocation: string | null }[]) => r[0] ?? null) : null;
      return {
        clientId,
        clientSecret,
        jwt,
        configured: !!clientId && !!clientSecret,
        myLocation: userRow?.ringoutMyLocation ?? "",
      };
    }),

    setMyLocation: protectedProcedure
      .input(z.object({ myLocation: z.string().max(30) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        await db.update(users)
          .set({ ringoutMyLocation: input.myLocation || null })
          .where(eq(users.id, ctx.user.id));
        return { success: true };
      }),

    transcribeCall: protectedProcedure
      .input(z.object({
        facilityId: z.number(),
        callId: z.string(),
        callDate: z.string(),
        callDuration: z.string().optional(),
        phoneNumber: z.string().optional(),
        repName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const accessToken = await getValidRCToken();
        // Fetch call recording
        const recResp = await axios.get(
          `${RC_BASE}/restapi/v1.0/account/~/recording/${input.callId}/content`,
          { headers: { Authorization: `Bearer ${accessToken}` }, responseType: "arraybuffer" }
        ).catch(() => null);

        // Also try fetching via call-log to get recording URI
        let recordingUrl: string | null = null;
        try {
          const callResp = await axios.get(
            `${RC_BASE}/restapi/v1.0/account/~/call-log/${input.callId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          recordingUrl = callResp.data?.recording?.contentUri ?? null;
        } catch { /* ignore */ }

        let transcriptText = "";
        let transcriptSummary = "";

        if (recordingUrl) {
          // Append access token to recording URL for auth
          const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
          const result = await transcribeAudio({ audioUrl: authedUrl });
          if (!('error' in result)) {
            transcriptText = result.text ?? "";
          }
        }

        // Save to facility_updates as transcript
        await createFacilityUpdate({
          facilityId: input.facilityId,
          updateDate: new Date(input.callDate),
          rawText: transcriptText || `[Call on ${input.callDate}${input.phoneNumber ? ` to ${input.phoneNumber}` : ""}${input.callDuration ? `, duration: ${input.callDuration}` : ""}]`,
          summary: transcriptSummary || (transcriptText ? transcriptText.slice(0, 200) : "Call recorded — no transcript available"),
          updateType: "transcript",
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });

        return { success: true, hasTranscript: !!transcriptText, transcriptText };
      }),

    /**
     * logFacilityCall — called automatically when a RingCentral call ends.
     * 1. Matches the phone number to a facility.
     * 2. Creates a contact log entry.
     * 3. Fetches the call recording (if available).
     * 4. Transcribes with Whisper.
     * 5. Generates an AI summary.
     * 6. Saves transcript + summary to facility_updates.
     */
    logFacilityCall: protectedProcedure
      .input(z.object({
        phone: z.string(),
        callId: z.string().optional(),
        direction: z.string().optional(),
        result: z.string().optional(),
        duration: z.number().optional(),
        durationStr: z.string().optional(),
        startTime: z.string().optional(),
        agentName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Match facility by phone number
        const facility = await findFacilityByPhone(input.phone);
        const agentName = input.agentName ?? ctx.user.name ?? ctx.user.email ?? "Unknown";
        const callDate = input.startTime ? new Date(input.startTime) : new Date();
        const durationStr = input.durationStr ?? (input.duration ? `${Math.floor(input.duration / 60)}:${(input.duration % 60).toString().padStart(2, "0")}` : "0:00");

        // 2. Create a contact log entry (always, even without a match)
        if (facility) {
          const callResult = (input.result ?? "").toLowerCase().includes("connected") ? "connected"
            : (input.result ?? "").toLowerCase().includes("voicemail") ? "voicemail"
            : (input.result ?? "").toLowerCase().includes("no answer") ? "no_answer"
            : (input.result ?? "").toLowerCase().includes("busy") ? "busy" : "other";
          await createContactLog({
            facilityId: facility.id,
            contactType: "call",
            contactDate: callDate,
            callResult,
            callDuration: durationStr,
            callType: "partner_checkin",
            summary: `${input.direction ?? "Outbound"} call to ${input.phone} — ${input.result ?? ""} (${durationStr})`,
            repId: ctx.user.id,
            repName: agentName,
            fromRingCentral: 1,
          });
        }

        // 3. Attempt to fetch recording and transcribe
        let transcriptText = "";
        let aiSummary = "";

        let accessToken: string | null = null;
        try { accessToken = await getValidRCToken(); } catch { /* no stored token */ }

        if (accessToken && input.callId) {
          try {
            // Wait a few seconds for recording to be available
            await new Promise((r) => setTimeout(r, 5000));
            const callResp = await axios.get(
              `${RC_BASE}/restapi/v1.0/account/~/call-log/${input.callId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const recordingUrl: string | null = callResp.data?.recording?.contentUri ?? null;
            if (recordingUrl) {
              const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
              const result = await transcribeAudio({ audioUrl: authedUrl });
              if (!('error' in result)) {
                transcriptText = result.text ?? "";
              }
            }
          } catch { /* recording not yet available */ }
        }

        // 4. Generate structured AI analysis if we have a transcript
        let actionItems: string[] = [];
        let followUpTasks: Array<{ title: string; priority: "high" | "medium" | "low"; dueInDays?: number }> = [];
        let extractedData: Record<string, unknown> = {};

        if (transcriptText) {
          try {
            const llmResp = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `You are a business development assistant for a personal injury law firm. Analyze this phone call transcript between a BD rep and a facility partner (chiropractor, body shop, physical therapist, etc.).

Return a JSON object with EXACTLY these fields:
{
  "summary": "2-3 sentence summary of what was discussed, tone of the conversation, and outcome",
  "actionItems": ["string", ...],
  "followUpTasks": [
    { "title": "string", "priority": "high|medium|low", "dueInDays": number }
  ],
  "contactPerson": "name of person spoken to if mentioned, else null",
  "relationshipTone": "warm|neutral|cold|hostile",
  "leadsDiscussed": true or false,
  "commitmentMade": "brief description of any commitment made, else null"
}

For actionItems: list concrete things the BD rep needs to do (e.g. "Send referral package to Dr. Smith", "Follow up on 3 pending cases").
For followUpTasks: list tasks that should be scheduled (e.g. check-in calls, sending materials, visiting the facility). Set dueInDays based on urgency (1-3 for urgent, 7 for this week, 14 for next 2 weeks, 30 for next month).
Be specific and actionable. If nothing was discussed, return empty arrays.`,
                },
                { role: "user", content: transcriptText },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "call_analysis",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      summary: { type: "string" },
                      actionItems: { type: "array", items: { type: "string" } },
                      followUpTasks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            priority: { type: "string", enum: ["high", "medium", "low"] },
                            dueInDays: { type: "number" },
                          },
                          required: ["title", "priority", "dueInDays"],
                          additionalProperties: false,
                        },
                      },
                      contactPerson: { type: ["string", "null"] },
                      relationshipTone: { type: "string", enum: ["warm", "neutral", "cold", "hostile"] },
                      leadsDiscussed: { type: "boolean" },
                      commitmentMade: { type: ["string", "null"] },
                    },
                    required: ["summary", "actionItems", "followUpTasks", "contactPerson", "relationshipTone", "leadsDiscussed", "commitmentMade"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const raw = llmResp.choices[0]?.message?.content as string;
            const parsed = JSON.parse(raw);
            aiSummary = parsed.summary ?? "";
            actionItems = parsed.actionItems ?? [];
            followUpTasks = parsed.followUpTasks ?? [];
            extractedData = {
              contactPerson: parsed.contactPerson,
              relationshipTone: parsed.relationshipTone,
              leadsDiscussed: parsed.leadsDiscussed,
              commitmentMade: parsed.commitmentMade,
              actionItems,
              followUpTasks,
            };
          } catch (e) {
            // LLM unavailable or JSON parse error — skip structured analysis
            console.warn("[logFacilityCall] LLM analysis failed:", e);
          }
        }

        // 5. Save to facility_updates and auto-create follow-up tasks
        if (facility) {
          const rawText = transcriptText || `[Call on ${callDate.toISOString()}${input.phone ? ` to ${input.phone}` : ""}${durationStr ? `, duration: ${durationStr}` : ""}]`;
          const summary = aiSummary || (transcriptText ? transcriptText.slice(0, 300) : `${input.direction ?? "Outbound"} call — ${input.result ?? ""} (${durationStr})`);
          await createFacilityUpdate({
            facilityId: facility.id,
            updateDate: callDate,
            rawText,
            summary,
            updateType: "transcript",
            repId: ctx.user.id,
            repName: agentName,
            extractedData: Object.keys(extractedData).length > 0 ? extractedData : null,
          });

          // Auto-create follow-up tasks extracted from the call
          for (const task of followUpTasks) {
            const dueDate = new Date(callDate);
            dueDate.setDate(dueDate.getDate() + (task.dueInDays ?? 7));
            await createTask({
              facilityId: facility.id,
              title: task.title,
              description: `Auto-created from call on ${callDate.toLocaleDateString()} with ${agentName}`,
              dueDate,
              priority: task.priority,
              assignedToId: ctx.user.id,
              assignedToName: agentName,
              status: "open",
            });
          }
        }

        return {
          success: true as const,
          facilityId: facility?.id ?? null,
          facilityName: facility?.name ?? null,
          hasTranscript: !!transcriptText,
          hasAiSummary: !!aiSummary,
          transcriptText: transcriptText || null,
          aiSummary: aiSummary || null,
          actionItemsCount: actionItems.length,
          followUpTasksCreated: followUpTasks.length,
        };
      }),

    syncCalls: protectedProcedure
      .input(z.object({ facilityId: z.number(), daysBack: z.number().min(1).max(90).default(30) }))
      .mutation(async ({ input, ctx }) => {
        const accessToken = await getValidRCToken();
        const facility = await getFacilityById(input.facilityId);
        if (!facility) throw new TRPCError({ code: "NOT_FOUND" });
        const phones = [facility.phone, facility.phone2, facility.phone3, facility.contactPhone]
          .filter(Boolean).map((p) => p!.replace(/\D/g, ""));
        if (phones.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No phone numbers on this facility." });
        const dateFrom = new Date(Date.now() - input.daysBack * 24 * 60 * 60 * 1000).toISOString();
        const callLogResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/call-log`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { dateFrom, perPage: 250, view: "Detailed" },
        });
        const records: any[] = callLogResp.data.records ?? [];
        let synced = 0;
        for (const record of records) {
          const fromNum = (record.from?.phoneNumber ?? "").replace(/\D/g, "");
          const toNum = (record.to?.phoneNumber ?? "").replace(/\D/g, "");
          const matched = phones.some((p) => fromNum.endsWith(p) || toNum.endsWith(p) || p.endsWith(fromNum) || p.endsWith(toNum));
          if (!matched) continue;
          const durationSecs = record.duration ?? 0;
          const durationStr = `${Math.floor(durationSecs / 60)}:${(durationSecs % 60).toString().padStart(2, "0")}`;
          const callResult = record.result === "Call connected" ? "connected" : record.result === "Voicemail" ? "voicemail" : record.result === "No Answer" ? "no_answer" : record.result === "Busy" ? "busy" : "other";
          await createContactLog({
            facilityId: input.facilityId,
            contactType: "call",
            contactDate: new Date(record.startTime),
            callResult,
            callDuration: durationStr,
            callType: "partner_checkin",
            summary: `[RingCentral] ${record.direction} call — ${record.result ?? ""}. ${record.from?.name ?? record.from?.phoneNumber ?? "?"} → ${record.to?.name ?? record.to?.phoneNumber ?? "?"}`,
            repName: record.from?.name ?? ctx.user.name ?? undefined,
          });
          synced++;
        }
        return { success: true, synced };
      }),
  }),

  // ─── Facility Leads V3 ─────────────────────────────────────────────────────

  facilityLeads: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listFacilityLeads(input.facilityId)),

    create: protectedProcedure
      .input(z.object({
        facilityId: z.number(),
        direction: z.enum(["sent_to_facility", "received_from_facility"]),
        leadDate: z.string(),
        method: z.enum(["phone_call", "sms", "direct_contact", "email", "in_person", "other"]).default("phone_call"),
        contactPerson: z.string().optional(),
        clientArea: z.string().optional(),
        outcome: z.enum(["pending", "signed", "not_signed", "not_qualified", "duplicate", "unknown"]).default("pending"),
        signedCase: z.number().int().min(0).max(1).default(0),
        signedDate: z.string().optional(),
        notes: z.string().optional(),
        repName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await createFacilityLead({
          ...input,
          leadDate: new Date(input.leadDate),
          signedDate: input.signedDate ? new Date(input.signedDate) : undefined,
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        outcome: z.enum(["pending", "signed", "not_signed", "not_qualified", "duplicate", "unknown"]).optional(),
        signedCase: z.number().int().min(0).max(1).optional(),
        signedDate: z.string().optional(),
        notes: z.string().optional(),
        contactPerson: z.string().optional(),
        clientArea: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, signedDate, ...rest } = input;
        await updateFacilityLead(id, {
          ...rest,
          ...(signedDate ? { signedDate: new Date(signedDate) } : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteFacilityLead(input.id);
        return { success: true };
      }),
  }),

  // ─── Gratitude Actions V3 ─────────────────────────────────────────────────────

  gratitude: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listGratitudeActions(input.facilityId)),

    create: protectedProcedure
      .input(z.object({
        facilityId: z.number(),
        actionDate: z.string(),
        actionType: z.enum(["thank_you_call", "thank_you_sms", "visit", "meal_delivery", "gift", "other"]),
        amount: z.string().optional(),
        notes: z.string().optional(),
        repName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await createGratitudeAction({
          ...input,
          actionDate: new Date(input.actionDate),
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteGratitudeAction(input.id);
        return { success: true };
      }),
  }),

  // ─── Facility Updates / Transcripts V3 ───────────────────────────────────────

  updates: router({
    list: protectedProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ input }) => listFacilityUpdates(input.facilityId)),

    create: protectedProcedure
      .input(z.object({
        facilityId: z.number(),
        updateDate: z.string(),
        rawText: z.string().optional(),
        summary: z.string().optional(),
        updateType: z.enum(["transcript", "sms", "manual_note", "visit_note", "other"]).default("manual_note"),
        repName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await createFacilityUpdate({
          ...input,
          updateDate: new Date(input.updateDate),
          repId: ctx.user.id,
          repName: input.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown",
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteFacilityUpdate(input.id);
        return { success: true };
      }),
  }),

  // ─── Map View ─────────────────────────────────────────────────────────────────

  map: router({
    allFacilities: protectedProcedure.query(async () => getAllFacilitiesForMap()),
    relationshipBalance: protectedProcedure.query(async () => getRelationshipBalance()),
  }),

  // ─── BDR Reports ─────────────────────────────────────────────────────────────
  bdrReports: router({
    callActivity: protectedProcedure
      .input(z.object({ repName: z.string().optional(), month: z.string().optional() }))
      .query(async ({ input }) => getBdrCallActivity(input)),

    partnerCheckins: protectedProcedure
      .input(z.object({ repName: z.string().optional() }))
      .query(async ({ input }) => getBdrPartnerCheckins(input)),

    topFacilities: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => getBdrTopFacilities(input.limit)),

    /** Daily calls to facilities per agent. Goal: > 15 calls/day. */
    dailyFacilityCalls: protectedProcedure
      .input(z.object({ repName: z.string().optional() }))
      .query(async ({ input }) => getDailyFacilityCallsKPI(input)),

    /** Unique facilities called per agent per month. Goal: > 4 facilities/month. */
    monthlyFacilitiesCalled: protectedProcedure
      .input(z.object({ repName: z.string().optional() }))
      .query(async ({ input }) => getMonthlyFacilitiesCalledKPI(input)),
  }),

  // ─── Management Dashboard ────────────────────────────────────────────────────
  management: router({
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
      }
      return getDashboardStats();
    }),

    flaggedFacilities: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
      }
      return listFacilities({ managementFlag: true, sortBy: "updatedAt", sortDir: "desc" });
    }),
  }),
});
