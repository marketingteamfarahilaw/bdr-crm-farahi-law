/**
 * CRM tRPC Router — Facility Partner CRM
 * All procedures for facilities, contact logs, tasks, leads sent, and management dashboard.
 */

import { TRPCError } from "@trpc/server";
import axios from "axios";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import {
  completeTask,
  createContactLog,
  createFacility,
  createReferral,
  createTask,
  deleteFacility,
  deleteContactLog,
  deleteReferral,
  deleteRingcentralToken,
  deleteTask,
  getDashboardStats,
  getFacilityById,
  getLastContactLog,
  getRingcentralToken,
  getTotalLeadsSent,
  getTotalReferrals,
  listContactLogs,
  listFacilities,
  listLeadsSent,
  listOverdueTasks,
  listReferrals,
  listTasksByFacility,
  listTasksByUser,
  reopenTask,
  updateFacility,
  updateReferral,
  upsertLeadsSent,
  upsertRingcentralToken,
} from "./crmDb";

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
    const refreshed = await refreshRCToken(stored.refreshToken, clientId, clientSecret);
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

    disconnect: protectedProcedure.mutation(async () => {
      await deleteRingcentralToken();
      return { success: true };
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
