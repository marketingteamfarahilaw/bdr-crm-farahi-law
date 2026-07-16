/**
 * CRM tRPC Router — Facility Partner CRM
 * All procedures for facilities, contact logs, tasks, leads sent, and management dashboard.
 */

import { TRPCError } from "@trpc/server";
import axios from "axios";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { seesAllData, canManage, isIntakeOnly } from "@shared/permissions";
import { transcribeAudio } from "./_core/voiceTranscription";
import { invokeLLM } from "./_core/llm";
import { syncRecentCalls, analyzeCallTranscript, maybeCreateVisitFromCall } from "./rcSync";
import { syncRcMeetings } from "./rcMeetingSync";
import { syncIntakeCalls } from "./intakeSync";
import { sendCallRecapToWebhook } from "./filevineHook";
import { uberConfigured, importOrderReceipt, matchFacilityByAddress } from "./uber";
import { frExpenses } from "../drizzle/schema";
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
  getUserRingcentralToken,
  upsertUserRingcentralToken,
  deleteUserRingcentralToken,
  listAgentsWithRcStatus,
  setUserRcLastSync,
  deleteTask,
  getAllFacilitiesForMap,
  getDashboardStats,
  getRecentActivity,
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
  listAllTasks,
  setTaskStatus,
  getReferralCountsMap,
  getCheckinMatrix,
  getVisitMatrix,
  listExpensesByFacility,
  createFacilityExpense,
  setExpenseReimbursement,
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
  getNotificationsForUser,
  getExistingRcCallIds,
  getExistingRcSessionIds,
} from "./crmDb";
import { getDb } from "./db";
import { facilities, uberReceipts, users, leadIntake, contactLogs, facilityTasks, facilityReferrals, facilityLeads, facilityGratitude } from "../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
const RC_BASE = "https://platform.ringcentral.com";

/** Facility-CRM procedure — BD/FR (+ super admin) only. The Intake team is
 *  hard-walled from facility data; their world is intakeRouter. The generic
 *  RingCentral CONNECTION procedures below stay on protectedProcedure because
 *  intake members link their own RingCentral through the same flow. */
const crmProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  }
  return next();
});

async function refreshRCToken(refreshToken: string, clientId: string, clientSecret: string) {
  const resp = await axios.post(
    `${RC_BASE}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

// Mint a brand-new access token from the long-lived RINGCENTRAL_JWT.
// This is the reliable fallback when no stored token exists or the stored
// refresh token has gone stale (e.g. after a migration / long idle period).
async function mintRCTokenFromJwt(clientId: string, clientSecret: string): Promise<string> {
  const jwt = process.env.RINGCENTRAL_JWT ?? "";
  if (!jwt) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral not connected and no RINGCENTRAL_JWT is configured." });
  }
  const tokenResp = await axios.post(
    `${RC_BASE}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const { access_token, refresh_token, expires_in } = tokenResp.data;
  // Look up account/owner so the stored row matches OAuth-created ones (same unique accountId).
  let accountId = "default";
  let ownerName: string | undefined;
  let ownerExtensionId: string | undefined;
  try {
    const meResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    accountId = meResp.data.account?.id?.toString() ?? "default";
    ownerName = meResp.data.name ?? undefined;
    ownerExtensionId = meResp.data.id?.toString();
  } catch {
    /* non-fatal — store the token even if the owner lookup fails */
  }
  await upsertRingcentralToken({
    accountId,
    accessToken: access_token,
    refreshToken: refresh_token ?? "",
    tokenExpiry: new Date(Date.now() + (expires_in ?? 3600) * 1000),
    ownerName,
    ownerExtensionId,
  });
  return access_token;
}

export async function getValidRCToken(): Promise<string> {
  const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral credentials not configured." });
  }

  const stored = await getRingcentralToken();

  // Fast path: stored token still has more than 5 minutes of life.
  if (stored && stored.tokenExpiry.getTime() - Date.now() >= 5 * 60 * 1000) {
    return stored.accessToken;
  }

  // Near expiry / present: try the refresh_token grant first.
  if (stored?.refreshToken) {
    try {
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
    } catch (err: any) {
      // RC returns 400 invalid_grant once a refresh token goes stale (common
      // after a migration). Fall back to the long-lived JWT below.
      console.warn("[RingCentral] refresh_token failed, minting from JWT:", err?.response?.status ?? err?.message ?? err);
    }
  }

  // Robust fallback: mint a fresh token from the long-lived RINGCENTRAL_JWT.
  return mintRCTokenFromJwt(clientId, clientSecret);
}

/**
 * Per-AGENT token. Returns a valid access token for the agent's OWN RingCentral
 * connection, refreshing it if near expiry. Returns null if the agent hasn't
 * connected — deliberately with NO fallback to the account JWT, because that's
 * a different RingCentral identity and using it would re-attribute the agent's
 * calls to the JWT owner (the exact bug we're fixing).
 */
export async function getValidRCTokenForUser(userId: number): Promise<string | null> {
  const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return null;

  const stored = await getUserRingcentralToken(userId);
  if (!stored) return null;

  // Fast path: more than 5 minutes of life left.
  if (stored.tokenExpiry.getTime() - Date.now() >= 5 * 60 * 1000) return stored.accessToken;

  if (stored.refreshToken) {
    try {
      const refreshed = await refreshRCToken(stored.refreshToken, clientId, clientSecret);
      await upsertUserRingcentralToken({
        userId,
        accountId: stored.accountId ?? undefined,
        extensionId: stored.extensionId ?? undefined,
        ownerName: stored.ownerName ?? undefined,
        ownerEmail: stored.ownerEmail ?? undefined,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
      });
      return refreshed.access_token;
    } catch (err: any) {
      console.warn(`[RingCentral] per-user refresh failed for user ${userId} — they must reconnect:`, err?.response?.status ?? err?.message ?? err);
      return null;
    }
  }
  return null;
}

/**
 * Pick the right RingCentral token for an authenticated request:
 *  - the agent's own connection (preferred — calls attribute to them), else
 *  - for managers, the company/admin JWT connection as a fallback, else
 *  - throw, prompting the agent to connect their own account.
 */
async function resolveRCToken(user: { id: number; role: any; name?: string | null; email?: string | null }): Promise<{
  token: string;
  attribution?: { repId: number; repName: string };
}> {
  const own = await getValidRCTokenForUser(user.id);
  if (own) return { token: own, attribution: { repId: user.id, repName: String(user.name ?? user.email ?? "Unknown") } };
  if (seesAllData(user.role)) {
    const account = await getValidRCToken();
    return { token: account };
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Connect your RingCentral account first — open the RingCentral page and click “Connect my RingCentral”.",
  });
}

/**
 * Defense-in-depth: the OAuth redirect must point at THIS app's own callback
 * path. RingCentral also enforces its registered-URI allowlist, but we don't
 * rely solely on RC-side config. An explicit RC_REDIRECT_ORIGINS env (comma-
 * separated) can pin exact origins; otherwise any https origin ending in the
 * callback path is accepted (covers bdcrm.farahilaw.com + localhost dev).
 */
function assertRcRedirectUri(redirectUri: string): void {
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid redirect URI." });
  }
  if (u.pathname !== "/ringcentral-callback") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Redirect URI is not allowed." });
  }
  const allow = (process.env.RC_REDIRECT_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length > 0) {
    if (!allow.includes(u.origin)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Redirect URI origin is not allowed." });
    }
    return;
  }
  // No explicit allowlist configured — require https (allow http only for localhost dev).
  const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !isLocalhost) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Redirect URI must use HTTPS." });
  }
}

/** Name candidates a facility might be assigned under for an agent — their agent
 *  name, full name, and first names — used for owner-by-name facility scoping. */
function ownerNameCandidates(user: { name?: string | null; agentName?: string | null }): string[] {
  const out = new Set<string>();
  const add = (s?: string | null) => {
    if (!s) return;
    const t = String(s).trim();
    if (!t) return;
    out.add(t);
    const first = t.split(/\s+/)[0];
    if (first) out.add(first);
  };
  add(user.agentName);
  add(user.name);
  return Array.from(out);
}

/** Throws unless the user is a manager or owns the facility (by id or name).
 *  When `includeActivity` is set (read-only endpoints), also grants access if
 *  the user has personally contacted the facility — so an agent can open a
 *  partner from their own call log even when it's assigned to a teammate
 *  (covering calls, transfers, shared lines). Write endpoints keep the strict
 *  owner-only check (includeActivity stays false). */
async function assertFacilityAccess(
  user: { id: number; role: any; name?: string | null; agentName?: string | null },
  facilityId: number,
  includeActivity = false,
): Promise<void> {
  if (seesAllData(user.role)) return;
  const f = await getFacilityById(facilityId);
  if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Facility not found" });
  const cands = ownerNameCandidates(user).map((s) => s.toLowerCase());
  const ownById = f.assignedRepId != null && f.assignedRepId === user.id;
  const ownByName = !!f.assignedRepName && cands.includes(String(f.assignedRepName).toLowerCase());
  if (ownById || ownByName) return;
  if (includeActivity) {
    const db = await getDb();
    if (db) {
      const logs = await db.select({ repId: contactLogs.repId, repName: contactLogs.repName })
        .from(contactLogs).where(eq(contactLogs.facilityId, facilityId)).limit(300);
      const hasActivity = logs.some((l) => l.repId === user.id || (l.repName && cands.includes(String(l.repName).toLowerCase())));
      if (hasActivity) return;
    }
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this facility." });
}

/** Throws unless the user is a manager or owns the facility the row belongs to. */
async function assertRowFacilityAccess(user: { id: number; role: any; name?: string | null; agentName?: string | null }, table: any, id: number): Promise<void> {
  if (seesAllData(user.role)) return;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [row] = await db.select({ fid: table.facilityId }).from(table).where(eq(table.id, id)).limit(1);
  const fid = (row?.fid as number | null | undefined) ?? null;
  if (fid == null) throw new TRPCError({ code: "FORBIDDEN", message: "Not permitted." });
  await assertFacilityAccess(user, fid);
}

function requireManager(user: { role: any }): void {
  if (!seesAllData(user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
}

const PARTNER_STATUSES = ["prospect", "active_partner", "priority_partner", "needs_follow_up", "dormant", "do_not_use"] as const;

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
    list: crmProcedure
      .input(
        z.object({
          search: z.string().optional(),
          status: z.string().optional(),
          partnerStatus: z.string().optional(),
          category: z.string().optional(),
          managementFlag: z.boolean().optional(),
          sortBy: z.enum(["name", "updatedAt", "createdAt"]).optional(),
          sortDir: z.enum(["asc", "desc"]).optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        // Agents see only their assigned facilities; managers/super admin see all.
        // Facilities are mostly assigned by NAME (e.g. "Grace"), rarely by id, so
        // scope an agent by their id AND their name candidates (full + first name).
        const scoped = seesAllData(ctx.user.role)
          ? (input ?? {})
          : { ...(input ?? {}), assignedRepId: ctx.user.id, assignedRepNames: ownerNameCandidates(ctx.user) };
        const rows = await listFacilities(scoped);
        // Enrich with last contact, total leads sent, and referral counts (sent/received).
        const refMap = await getReferralCountsMap();
        const enriched = await Promise.all(
          rows.map(async (f: typeof rows[number]) => {
            const lastContact = await getLastContactLog(f.id);
            const totalLeadsSent = await getTotalLeadsSent(f.id);
            const ref = refMap.get(f.id) ?? { sent: 0, received: 0 };
            return { ...f, lastContact, totalLeadsSent, referralsSent: ref.sent, referralsReceived: ref.received };
          })
        );
        return enriched;
      }),

    get: crmProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        await assertFacilityAccess(ctx.user, input.id, true);
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

    create: crmProcedure
      .input(
        z.object({
          name: z.string().min(1),
          category: z.enum(CATEGORIES),
          address: z.string().optional(),
          city: z.string().optional(),
          phone: z.string().optional(),
          phone2: z.string().optional(),
          phone3: z.string().optional(),
          website: z.string().optional(),
          contactName: z.string().optional(),
          contactTitle: z.string().optional(),
          contactPhone: z.string().optional(),
          contactEmail: z.string().optional(),
          relationshipStatus: z.enum(RELATIONSHIP_STATUSES).default("warm_lead"),
          partnerStatus: z.enum(PARTNER_STATUSES).optional(),
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

    update: crmProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          category: z.enum(CATEGORIES).optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          phone: z.string().optional(),
          phone2: z.string().optional(),
          phone3: z.string().optional(),
          website: z.string().optional(),
          contactName: z.string().optional(),
          contactTitle: z.string().optional(),
          contactPhone: z.string().optional(),
          contactEmail: z.string().optional(),
          relationshipStatus: z.enum(RELATIONSHIP_STATUSES).optional(),
          partnerStatus: z.enum(PARTNER_STATUSES).optional(),
          assignedRepId: z.number().optional(),
          assignedRepName: z.string().optional(),
          notes: z.string().optional(),
          managementFlag: z.boolean().optional(),
          managementNote: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, managementFlag, ...rest } = input;
        // Non-managers may only edit facilities they own, and may NOT reassign
        // ownership (that would let an agent steal/orphan another's partner).
        if (!seesAllData(ctx.user.role)) {
          await assertFacilityAccess(ctx.user, id);
          delete (rest as any).assignedRepId;
          delete (rest as any).assignedRepName;
          delete (rest as any).managementNote;
        }
        await updateFacility(id, {
          ...rest,
          ...(managementFlag !== undefined && seesAllData(ctx.user.role) ? { managementFlag: managementFlag ? 1 : 0 } : {}),
        });
        return { success: true };
      }),

    bulkUpdate: crmProcedure
      .input(z.object({
        ids: z.array(z.number()).min(1),
        partnerStatus: z.enum(PARTNER_STATUSES).optional(),
        assignedRepName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireManager(ctx.user); // bulk status/reassignment is a manager action
        const { ids, ...changes } = input;
        for (const id of ids) await updateFacility(id, changes);
        return { success: true, updated: ids.length };
      }),

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can delete facilities." });
        }
        await deleteFacility(input.id);
        return { success: true };
      }),

    bulkCreate: crmProcedure
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

    promoteFromScraper: crmProcedure
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
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listContactLogs(input.facilityId); }),

    create: crmProcedure
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

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, contactLogs, input.id);
        await deleteContactLog(input.id);
        return { success: true };
      }),
  }),

  // ─── Tasks ───────────────────────────────────────────────────────────────────

  tasks: router({
    listByFacility: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listTasksByFacility(input.facilityId); }),

    listMine: crmProcedure
      .input(z.object({ status: z.enum(["open", "completed"]).optional() }))
      .query(async ({ ctx, input }) => listTasksByUser(ctx.user.id, input.status)),

    listOverdue: crmProcedure.query(async () => listOverdueTasks()),

    // Global task board — managers see all, agents see their own.
    listAll: crmProcedure.query(({ ctx }) => listAllTasks(seesAllData(ctx.user.role) ? { all: true } : { userId: ctx.user.id })),

    setStatus: crmProcedure
      .input(z.object({ id: z.number(), status: z.enum(["open", "in_progress", "completed"]) }))
      .mutation(async ({ ctx, input }) => { await assertRowFacilityAccess(ctx.user, facilityTasks, input.id); await setTaskStatus(input.id, input.status); return { success: true }; }),

    create: crmProcedure
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

    complete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityTasks, input.id);
        await completeTask(input.id);
        return { success: true };
      }),

    reopen: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityTasks, input.id);
        await reopenTask(input.id);
        return { success: true };
      }),

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityTasks, input.id);
        await deleteTask(input.id);
        return { success: true };
      }),
  }),

  // ─── Per-facility Expenses (partner profile Expenses tab) ──────────────────────
  expenses: router({
    byFacility: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listExpensesByFacility(input.facilityId); }),

    create: crmProcedure
      .input(z.object({
        facilityId: z.number(), facilityName: z.string().optional(), expenseDate: z.string(),
        store: z.string().optional(), reason: z.string().optional(), amount: z.string().default("0.00"),
        cardType: z.enum(["Personal", "Company"]).default("Company"), receiptUrl: z.string().optional(), notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await assertFacilityAccess(ctx.user, input.facilityId);
        await createFacilityExpense({ ...input, expenseDate: new Date(input.expenseDate), agentName: ctx.user.agentName ?? ctx.user.name ?? ctx.user.email ?? "Unknown" });
        return { success: true };
      }),

    setReimbursement: crmProcedure
      .input(z.object({ kind: z.enum(["FR", "BDR"]), id: z.number(), status: z.enum(["pending", "submitted", "approved"]) }))
      .mutation(async ({ input }) => { await setExpenseReimbursement(input.kind, input.id, input.status); return { success: true }; }),
  }),

  // ─── Leads Sent ──────────────────────────────────────────────────────────────

  leadsSent: router({
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listLeadsSent(input.facilityId); }),

    upsert: crmProcedure
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
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listReferrals(input.facilityId); }),

    create: crmProcedure
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

    update: crmProcedure
      .input(z.object({
        id: z.number(),
        referralDate: z.string().optional(),
        clientName: z.string().optional(),
        caseValue: z.enum(["rank_x", "high", "medium", "low", "na"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityReferrals, input.id);
        const { id, referralDate, ...rest } = input;
        await updateReferral(id, {
          ...rest,
          ...(referralDate ? { referralDate: new Date(referralDate) } : {}),
        });
        return { success: true };
      }),

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityReferrals, input.id);
        await deleteReferral(input.id);
        return { success: true };
      }),
  }),

  // ─── RingCentral Integration ──────────────────────────────────────────────────

  ringcentral: router({
    // Per-agent connection status for the logged-in user, plus whether the
    // company/admin (JWT) connection exists (managers can fall back to it).
    status: protectedProcedure.query(async ({ ctx }) => {
      const mine = await getUserRingcentralToken(ctx.user.id);
      const account = await getRingcentralToken();
      return {
        connected: !!mine,
        ownerName: mine?.ownerName ?? null,
        ownerEmail: mine?.ownerEmail ?? null,
        tokenExpiry: mine?.tokenExpiry ?? null,
        lastSyncAt: mine?.lastSyncAt ?? null,
        accountConnected: !!account,
        accountOwnerName: account?.ownerName ?? null,
        canManage: seesAllData(ctx.user.role),
      };
    }),

    // Build the RingCentral hosted-login URL. The agent's browser navigates here
    // (full page), signs into THEIR OWN RingCentral, and is redirected back to
    // /ringcentral-callback with an auth code.
    getAuthorizeUrl: protectedProcedure
      .input(z.object({ redirectUri: z.string().url(), state: z.string().min(1).max(200) }))
      .query(async ({ input }) => {
        const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
        if (!clientId) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral is not configured on the server." });
        }
        assertRcRedirectUri(input.redirectUri);
        const u = new URL(`${RC_BASE}/restapi/oauth/authorize`);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("client_id", clientId);
        u.searchParams.set("redirect_uri", input.redirectUri);
        u.searchParams.set("state", input.state);
        return { url: u.toString() };
      }),

    // Exchange the auth code for tokens and store them for THIS agent.
    connect: protectedProcedure
      .input(z.object({ code: z.string(), redirectUri: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
        const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
        if (!clientId || !clientSecret) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "RingCentral credentials not configured on the server." });
        }
        assertRcRedirectUri(input.redirectUri);
        const tokenResp = await axios.post(
          `${RC_BASE}/restapi/oauth/token`,
          new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri }),
          { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        const { access_token, refresh_token, expires_in } = tokenResp.data;
        const meResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~`, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const accountId = meResp.data.account?.id?.toString() ?? undefined;
        const ownerName = meResp.data.name ?? undefined;
        const ownerEmail = meResp.data.contact?.email ?? undefined;
        const extensionId = meResp.data.id?.toString() ?? undefined;
        await upsertUserRingcentralToken({
          userId: ctx.user.id,
          accountId,
          extensionId,
          ownerName,
          ownerEmail,
          accessToken: access_token,
          refreshToken: refresh_token ?? "",
          tokenExpiry: new Date(Date.now() + (expires_in ?? 3600) * 1000),
        });
        return { success: true, ownerName: ownerName ?? "your RingCentral account", ownerEmail: ownerEmail ?? null };
      }),

    // Manager overview: every user and whether they've connected RingCentral.
    connectedAgents: protectedProcedure.query(async ({ ctx }) => {
      if (!seesAllData(ctx.user.role)) return [];
      return listAgentsWithRcStatus();
    }),

    connectJwt: crmProcedure
      .input(z.object({ jwt: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // This sets the COMPANY-WIDE admin connection — managers only, never a
        // regular agent (who could otherwise overwrite the shared credential).
        if (!seesAllData(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can set the company RingCentral connection." });
        }
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

    // Disconnect THIS agent's RingCentral (leaves the company/admin connection).
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      await deleteUserRingcentralToken(ctx.user.id);
      return { success: true };
    }),

    // (Removed getAccessToken — it returned a live RingCentral OAuth token to the
    // browser. All RC calls are proxied server-side; the token never leaves here.)

    getWidgetConfig: crmProcedure.query(async () => {
      // Only non-sensitive config. The client secret and the company JWT are
      // NEVER sent to the browser — agents authenticate via the per-agent OAuth
      // flow (getAuthorizeUrl → connect), not a shared JWT. (Previously this
      // leaked clientSecret + RINGCENTRAL_JWT to every logged-in user, which
      // could be used to mint the admin account token — removed.)
      const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
      return { clientId, configured: !!clientId };
    }),

    transcribeCall: crmProcedure
      .input(z.object({
        facilityId: z.number(),
        callId: z.string(),
        callDate: z.string(),
        callDuration: z.string().optional(),
        phoneNumber: z.string().optional(),
        repName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { token: accessToken } = await resolveRCToken(ctx.user);
        // Fetch call recording
        const recResp = await axios.get(
          `${RC_BASE}/restapi/v1.0/account/~/recording/${input.callId}/content`,
          { headers: { Authorization: `Bearer ${accessToken}` }, responseType: "arraybuffer" }
        ).catch(() => null);

        // Also try fetching via call-log to get recording URI
        let recordingUrl: string | null = null;
        try {
          const callResp = await axios.get(
            `${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log/${input.callId}`,
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
    logFacilityCall: crmProcedure
      .input(z.object({
        phone: z.string(),
        facilityId: z.number().optional(),
        callId: z.string().optional(),
        direction: z.string().optional(),
        result: z.string().optional(),
        duration: z.number().optional(),
        durationStr: z.string().optional(),
        // Browser-mode RC widget sends startTime as a Unix-timestamp number; accept both.
        startTime: z.union([z.string(), z.number()]).optional(),
        agentName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1. Match facility — prefer facilityId (from click-to-call) over phone matching
        let facility: any = null;
        if (input.facilityId) {
          const db = await getDb();
          if (db) {
            const [row] = await db.select().from(facilities).where(eq(facilities.id, input.facilityId)).limit(1);
            facility = row ?? null;
          }
        }
        if (!facility) {
          facility = await findFacilityByPhone(input.phone);
        }
        const agentName = input.agentName ?? ctx.user.name ?? ctx.user.email ?? "Unknown";
        const callDate = input.startTime ? new Date(input.startTime) : new Date();
        const durationStr = input.durationStr ?? (input.duration ? `${Math.floor(input.duration / 60)}:${(input.duration % 60).toString().padStart(2, "0")}` : "0:00");
        console.log(`[logFacilityCall] call=${input.callId ?? "?"} phone=${input.phone} dur=${durationStr} → facility ${facility?.id ?? "NONE"} (${facility?.name ?? ""})`);

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
        try { accessToken = (await resolveRCToken(ctx.user)).token; } catch (e) { console.warn("[logFacilityCall] no RC token:", (e as any)?.message ?? e); }

        // Only connected calls (duration > 0) can have a recording. Skip the
        // whole fetch for unanswered / 0:00 calls so they log instantly.
        const connected = (input.duration ?? 0) > 0;
        if (accessToken && input.callId && connected) {
          console.log(`[logFacilityCall] looking for recording of call ${input.callId}…`);
          let noRecordingStreak = 0;
          // RC needs a little time to attach a recording — retry up to ~30s,
          // but bail early once we know the call simply wasn't recorded.
          for (let attempt = 1; attempt <= 6 && !transcriptText; attempt++) {
            await new Promise((r) => setTimeout(r, 5000));
            try {
              let record: any = null;
              // Browser calls: look up the call-log record by telephony session id.
              try {
                const bySession = await axios.get(
                  `${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log`,
                  { headers: { Authorization: `Bearer ${accessToken}` }, params: { telephonySessionId: input.callId, view: "Detailed", perPage: 5 } }
                );
                record = bySession.data?.records?.[0] ?? null;
              } catch { /* fall through to direct id lookup */ }
              if (!record) {
                const byId = await axios.get(
                  `${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log/${input.callId}`,
                  { headers: { Authorization: `Bearer ${accessToken}` } }
                ).catch(() => null);
                record = byId?.data ?? null;
              }
              const recordingUrl: string | null = record?.recording?.contentUri ?? null;
              if (recordingUrl) {
                console.log(`[logFacilityCall] recording ready (attempt ${attempt}); transcribing…`);
                const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
                const result = await transcribeAudio({ audioUrl: authedUrl });
                if (!('error' in result)) {
                  transcriptText = result.text ?? "";
                  console.log(`[logFacilityCall] transcript: ${transcriptText.length} chars`);
                } else {
                  console.warn("[logFacilityCall] transcription error:", result.error, result.details ?? "");
                  break;
                }
              } else if (record) {
                // Call is in the log but no recording attached — if that holds for
                // ~10s, the call wasn't recorded, so stop waiting.
                if (++noRecordingStreak >= 2) {
                  console.log("[logFacilityCall] call logged but not recorded — stopping.");
                  break;
                }
                console.log(`[logFacilityCall] recording not attached yet (attempt ${attempt}/6)`);
              } else {
                console.log(`[logFacilityCall] call not in call-log yet (attempt ${attempt}/6)`);
              }
            } catch (e: any) {
              console.warn(`[logFacilityCall] recording attempt ${attempt} failed:`, e?.response?.status ?? e?.message);
            }
          }
          if (!transcriptText) console.log("[logFacilityCall] no transcript (call not recorded or recording unavailable).");
        } else if (!connected) {
          console.log("[logFacilityCall] call did not connect (0:00) — skipping recording/transcription.");
        }

        // 4. Generate structured AI analysis if we have a transcript
        let actionItems: string[] = [];
        let followUpTasks: Array<{ title: string; priority: "high" | "medium" | "low"; dueInDays?: number }> = [];
        let extractedData: Record<string, unknown> = {};

        if (transcriptText) {
          try {
            console.log("[logFacilityCall] generating AI summary from transcript…");
            // Shared analyzer (same one the account-wide sync uses) — includes
            // planned-visit extraction with the call date for relative dates.
            const analysis = await analyzeCallTranscript(transcriptText, callDate);
            aiSummary = analysis.summary ?? "";
            console.log("[logFacilityCall] AI summary:", JSON.stringify(aiSummary).slice(0, 120));
            actionItems = analysis.actionItems ?? [];
            followUpTasks = analysis.followUpTasks ?? [];
            extractedData = analysis.extractedData ?? {};
            // Visit arranged on the call → put it on the books automatically.
            if (facility) {
              try {
                await maybeCreateVisitFromCall(
                  { id: facility.id, name: facility.name, assignedRepName: (facility as any).assignedRepName ?? null },
                  analysis,
                  callDate,
                  ctx.user.agentName ?? ctx.user.name ?? ctx.user.email ?? null
                );
              } catch (e: any) {
                console.warn("[logFacilityCall] auto-visit creation failed:", e?.message ?? e);
              }
            }
          } catch (e) {
            // LLM unavailable or JSON parse error — skip structured analysis
            console.warn("[logFacilityCall] LLM analysis failed:", e);
          }
        }

        // 5. Save the transcript + AI summary as a "Call Recap" — ONLY when we
        // actually have a transcript. Don't create empty recap cards for
        // unanswered / 0:00 / unrecorded calls (they still log as a touchpoint
        // in the Contact Log).
        if (facility && transcriptText) {
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
          // Push the finished recap out to Filevine (via the Zapier/n8n webhook).
          await sendCallRecapToWebhook({
            event: "call_recap",
            facilityId: facility.id,
            facilityName: facility.name,
            agent: agentName,
            callTime: callDate.toISOString(),
            callTimeLocal: callDate.toLocaleString(),
            durationStr,
            durationSeconds: input.duration ?? null,
            callResult: input.result ?? null,
            direction: input.direction ?? null,
            summary: aiSummary || transcriptText.slice(0, 300),
            keyPoints: (extractedData.keyPoints as string[]) ?? [],
            sentiment: (extractedData.sentiment as string) ?? null,
            interestLevel: (extractedData.interestLevel as string) ?? null,
            tasks: followUpTasks,
            transcript: transcriptText,
            source: "bdcrm",
          });
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

    syncCalls: crmProcedure
      .input(z.object({ facilityId: z.number(), daysBack: z.number().min(1).max(90).default(30) }))
      .mutation(async ({ input, ctx }) => {
        const { token: accessToken, attribution } = await resolveRCToken(ctx.user);
        const facility = await getFacilityById(input.facilityId);
        if (!facility) throw new TRPCError({ code: "NOT_FOUND" });
        const phones = [facility.phone, facility.phone2, facility.phone3, facility.contactPhone]
          .filter(Boolean).map((p) => p!.replace(/\D/g, ""));
        if (phones.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No phone numbers on this facility." });
        const dateFrom = new Date(Date.now() - input.daysBack * 24 * 60 * 60 * 1000).toISOString();
        const callLogResp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { dateFrom, perPage: 250, view: "Detailed" },
        });
        const records: any[] = callLogResp.data.records ?? [];
        // Dedup against already-logged calls (and within this batch) by per-extension
        // call id AND by stable cross-extension telephonySessionId, and stamp both so
        // the auto-poller never re-logs these rows — and one physical call that lands
        // in two agents' extension logs isn't logged twice.
        const existing = await getExistingRcCallIds(records.map((r) => String(r.id)).filter(Boolean));
        const existingSessions = await getExistingRcSessionIds(
          records.map((r) => String(r.telephonySessionId ?? r.sessionId ?? "")).filter(Boolean)
        );
        // Attribute to the connected agent (their own token), not the call's RC
        // display name. Manager JWT-fallback (no attribution) → the acting user.
        const repId = attribution?.repId ?? ctx.user.id;
        const repName = attribution?.repName ?? ctx.user.name ?? ctx.user.email ?? "Unknown";
        let synced = 0;
        for (const record of records) {
          const rcCallId = String(record.id ?? "");
          const rcSessionId = String(record.telephonySessionId ?? record.sessionId ?? "");
          if (rcCallId && existing.has(rcCallId)) continue;
          if (rcSessionId && existingSessions.has(rcSessionId)) continue;
          const fromNum = (record.from?.phoneNumber ?? "").replace(/\D/g, "");
          const toNum = (record.to?.phoneNumber ?? "").replace(/\D/g, "");
          const matched = phones.some((p) => {
            if (p.length < 7) return false; // ignore junk/short numbers
            const matchFrom = fromNum.length >= 7 && (fromNum.endsWith(p) || p.endsWith(fromNum));
            const matchTo = toNum.length >= 7 && (toNum.endsWith(p) || p.endsWith(toNum));
            return matchFrom || matchTo;
          });
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
            repId,
            repName,
            fromRingCentral: 1,
            rcCallId: rcCallId || undefined,
            rcSessionId: rcSessionId || undefined,
          });
          if (rcCallId) existing.add(rcCallId);
          if (rcSessionId) existingSessions.add(rcSessionId);
          synced++;
        }
        return { success: true, synced };
      }),

    // Account-wide sync: pull recent calls from RingCentral (placed on the desk
    // phone / desktop app / mobile), match them to facilities, and transcribe +
    // summarize + auto-task the new recorded ones. Deduped by call id.
    syncRecent: protectedProcedure
      .input(z.object({ lookbackMinutes: z.number().min(5).max(43200).optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        const lookbackMinutes = input?.lookbackMinutes ?? 1440;
        // Intake team members sync into the Intake Case Desk, never the facility CRM.
        if (isIntakeOnly(ctx.user.role)) {
          const { getSetting } = await import("./db");
          if ((await getSetting("intake_automation")) === "paused") {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Intake automation is paused by management — call processing is temporarily off." });
          }
          const ownTok = await getValidRCTokenForUser(ctx.user.id);
          if (!ownTok) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect your RingCentral account first — open the RingCentral page and click “Connect my RingCentral”." });
          }
          const r = await syncIntakeCalls(ownTok, {
            agent: { id: ctx.user.id, name: String(ctx.user.name ?? ctx.user.email ?? "Unknown") },
            lookbackMinutes,
          });
          await setUserRcLastSync(ctx.user.id, new Date());
          return { success: true as const, scanned: r.scanned, matched: r.leadsCreated + r.leadsUpdated, logged: r.logged, transcribed: r.transcribed, skippedRecent: r.skippedRecent };
        }
        // Prefer the agent's OWN RingCentral — pulls their extension's calls and
        // attributes every one to them.
        const own = await getValidRCTokenForUser(ctx.user.id);
        if (own) {
          const res = await syncRecentCalls(own, {
            lookbackMinutes,
            attribution: { repId: ctx.user.id, repName: String(ctx.user.name ?? ctx.user.email ?? "Unknown") },
          });
          await setUserRcLastSync(ctx.user.id, new Date());
          return { success: true as const, ...res };
        }
        // Managers without their own connection can still pull the company/admin log.
        if (seesAllData(ctx.user.role)) {
          const res = await syncRecentCalls(await getValidRCToken(), { lookbackMinutes });
          return { success: true as const, ...res };
        }
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Connect your RingCentral account first — open the RingCentral page and click “Connect my RingCentral”.",
        });
      }),

    // Pull the caller's RingCentral Video meeting history into the Daily Log.
    syncMeetings: crmProcedure.mutation(async ({ ctx }) => {
      const own = await getValidRCTokenForUser(ctx.user.id);
      const token = own ?? (seesAllData(ctx.user.role) ? await getValidRCToken() : null);
      if (!token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect your RingCentral account first." });
      const res = await syncRcMeetings(token, { pages: 3 });
      return { success: true as const, ...res };
    }),

    // ─── Click-to-call via RingOut ────────────────────────────────────────────
    // Reliable in-CRM calling WITHOUT the browser widget. RingCentral rings the
    // agent's own phone (their saved callback number) first, then bridges it to
    // the facility. The recorded call is then picked up by the call sync →
    // transcript + recap, exactly like a desk-phone call. No mic, no WebRTC.
    getMyCallback: crmProcedure.query(async ({ ctx }) => {
      return { number: (ctx.user as any).ringoutMyLocation ?? null };
    }),

    setMyCallback: crmProcedure
      .input(z.object({ number: z.string().max(30) }))
      .mutation(async ({ ctx, input }) => {
        const n = input.number.replace(/[^\d+]/g, "").slice(0, 30);
        const db = await getDb();
        if (db) await db.update(users).set({ ringoutMyLocation: n || null }).where(eq(users.id, ctx.user.id));
        return { success: true as const, number: n || null };
      }),

    ringOut: crmProcedure
      .input(z.object({ toNumber: z.string().min(7), facilityId: z.number().optional(), fromNumber: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const from = (input.fromNumber?.trim() || (ctx.user as any).ringoutMyLocation || "").trim();
        if (!from) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Set your callback number first — that's the phone RingCentral will ring." });
        }
        const { token: accessToken } = await resolveRCToken(ctx.user);
        try {
          const resp = await axios.post(
            `${RC_BASE}/restapi/v1.0/account/~/extension/~/ring-out`,
            { from: { phoneNumber: from }, to: { phoneNumber: input.toNumber }, playPrompt: false },
            { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
          );
          return { success: true as const, id: String(resp.data?.id ?? ""), status: resp.data?.status?.callStatus ?? "InProgress", from, to: input.toNumber };
        } catch (e: any) {
          const code = e?.response?.status;
          if (code === 403) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Your RingCentral app is missing the 'RingOut' permission. Add it in the RingCentral developer console (Auth & Permissions → RingOut), then try again." });
          }
          const detail = e?.response?.data?.message ?? e?.response?.data?.error_description ?? e?.message ?? "unknown error";
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `RingOut failed: ${detail}` });
        }
      }),

    ringOutStatus: crmProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input, ctx }) => {
        if (!input.id) return { status: "Unknown", caller: null as string | null, callee: null as string | null };
        const { token: accessToken } = await resolveRCToken(ctx.user);
        const resp = await axios
          .get(`${RC_BASE}/restapi/v1.0/account/~/extension/~/ring-out/${input.id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
          .catch(() => null);
        return {
          status: resp?.data?.status?.callStatus ?? "Unknown",
          caller: resp?.data?.status?.callerStatus ?? null,
          callee: resp?.data?.status?.calleeStatus ?? null,
        };
      }),
  }),

  // ─── Facility Leads V3 ─────────────────────────────────────────────────────

  // ─── Uber Eats (Uber for Business Receipt API) ──────────────────────────────
  uber: router({
    status: crmProcedure.query(async () => {
      const db = await getDb();
      let imported = 0;
      let lastAt: Date | null = null;
      if (db) {
        const all = await db.select({ id: uberReceipts.id, createdAt: uberReceipts.createdAt }).from(uberReceipts).orderBy(desc(uberReceipts.createdAt));
        imported = all.length;
        lastAt = all[0]?.createdAt ?? null;
      }
      return { configured: uberConfigured(), webhookPath: "/api/uber/webhook", imported, lastAt };
    }),
    recent: crmProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(uberReceipts).orderBy(desc(uberReceipts.createdAt)).limit(50);
    }),
    // Import Uber Eats expenses from a parsed CSV export (client parses + maps;
    // server matches each to a facility by delivery address and files it).
    importExpenses: crmProcedure
      .input(z.object({
        rows: z.array(z.object({
          date: z.string().optional(),
          amount: z.number(),
          restaurant: z.string().optional(),
          address: z.string().optional(),
          requester: z.string().optional(),
        })).max(5000),
        cardType: z.enum(["Company", "Personal"]).default("Company"),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database unavailable." });
        let inserted = 0, matched = 0;
        for (const r of input.rows) {
          const fac = r.address ? await matchFacilityByAddress(r.address, "") : null;
          if (fac) matched++;
          const d = r.date ? new Date(r.date) : null;
          await db.insert(frExpenses).values({
            expenseDate: d && !isNaN(+d) ? d : new Date(),
            agentName: (r.requester || "Uber Eats").slice(0, 255),
            facilityId: fac?.id ?? null,
            facilityName: fac?.name ?? null,
            store: "Uber Eats",
            reason: (r.restaurant ? `Partner meal — ${r.restaurant}` : "Partner meal (Uber Eats)").slice(0, 500),
            amount: Math.max(0, Math.min(99999999.99, r.amount)).toFixed(2),
            cardType: input.cardType,
            notes: r.address ? r.address.slice(0, 4000) : null,
          });
          inserted++;
        }
        return { inserted, matched };
      }),

    // Manual fetch+import of one order (for testing / backfilling a missed order).
    importOrder: crmProcedure
      .input(z.object({ orderId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        if (!uberConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Uber credentials are not configured on the server." });
        return importOrderReceipt(input.orderId.trim());
      }),
  }),

  facilityLeads: router({
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listFacilityLeads(input.facilityId); }),

    create: crmProcedure
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

    update: crmProcedure
      .input(z.object({
        id: z.number(),
        outcome: z.enum(["pending", "signed", "not_signed", "not_qualified", "duplicate", "unknown"]).optional(),
        signedCase: z.number().int().min(0).max(1).optional(),
        signedDate: z.string().optional(),
        notes: z.string().optional(),
        contactPerson: z.string().optional(),
        clientArea: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityLeads, input.id);
        const { id, signedDate, ...rest } = input;
        await updateFacilityLead(id, {
          ...rest,
          ...(signedDate ? { signedDate: new Date(signedDate) } : {}),
        });
        return { success: true };
      }),

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityLeads, input.id);
        await deleteFacilityLead(input.id);
        return { success: true };
      }),
  }),

  // ─── Gratitude Actions V3 ─────────────────────────────────────────────────────

  gratitude: router({
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listGratitudeActions(input.facilityId); }),

    create: crmProcedure
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

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await assertRowFacilityAccess(ctx.user, facilityGratitude, input.id);
        await deleteGratitudeAction(input.id);
        return { success: true };
      }),
  }),

  // ─── Facility Updates / Transcripts V3 ───────────────────────────────────────

  updates: router({
    list: crmProcedure
      .input(z.object({ facilityId: z.number() }))
      .query(async ({ ctx, input }) => { await assertFacilityAccess(ctx.user, input.facilityId, true); return listFacilityUpdates(input.facilityId); }),

    create: crmProcedure
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

    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Agents cannot remove call recaps / transcripts — managers only.
        if (!seesAllData(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can delete call recaps." });
        }
        await deleteFacilityUpdate(input.id);
        return { success: true };
      }),
  }),

  // ─── Notifications ────────────────────────────────────────────────────────────

  notifications: router({
    list: crmProcedure.query(async ({ ctx }) =>
      getNotificationsForUser(ctx.user.id, seesAllData(ctx.user.role)),
    ),
  }),

  // ─── Map View ─────────────────────────────────────────────────────────────────

  map: router({
    allFacilities: crmProcedure.query(async () => getAllFacilitiesForMap()),
    relationshipBalance: crmProcedure.query(async () => getRelationshipBalance()),
  }),

  // ─── BDR Reports ─────────────────────────────────────────────────────────────
  bdrReports: router({
    callActivity: crmProcedure
      .input(z.object({ repName: z.string().optional(), month: z.string().optional() }))
      .query(async ({ input }) => getBdrCallActivity(input)),

    partnerCheckins: crmProcedure
      .input(z.object({ repName: z.string().optional() }))
      .query(async ({ input }) => getBdrPartnerCheckins(input)),

    topFacilities: crmProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => getBdrTopFacilities(input.limit)),

    // MTD Check-In matrix — per rep, one row per facility (or phone when the
    // call never matched), each distinct day = a check-in with its call count.
    checkinMatrix: crmProcedure
      .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), agent: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        if (seesAllData(ctx.user.role)) return getCheckinMatrix(input.month, input.agent ? [input.agent] : null);
        return getCheckinMatrix(input.month, ownerNameCandidates(ctx.user));
      }),

    // MTD FR Visit matrix — same shape, per FR: facilities visited, each
    // distinct day = a visit (field-visit log + visit-type contact logs).
    visitMatrix: crmProcedure
      .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), agent: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        if (seesAllData(ctx.user.role)) return getVisitMatrix(input.month, input.agent ? [input.agent] : null);
        return getVisitMatrix(input.month, ownerNameCandidates(ctx.user));
      }),
  }),

  // ─── Cross-facility activity feed ───────────────────────────────────────────
  activity: router({
    recent: crmProcedure.query(async () => getRecentActivity(18)),
  }),

  // ─── Management Dashboard ────────────────────────────────────────────────────
  management: router({
    dashboard: crmProcedure.query(async ({ ctx }) => {
      if (!canManage(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Manager access required." });
      }
      return getDashboardStats();
    }),

    flaggedFacilities: crmProcedure.query(async ({ ctx }) => {
      if (!canManage(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Manager access required." });
      }
      return listFacilities({ managementFlag: true, sortBy: "updatedAt", sortDir: "desc" });
    }),
  }),

  // ─── Lead Capture / Intake ───────────────────────────────────────────────────
  leadIntake: router({
    list: crmProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(leadIntake).orderBy(desc(leadIntake.createdAt));
      if (seesAllData(ctx.user.role)) return rows;
      const mine = (ctx.user.name ?? "").toLowerCase().trim();
      return rows.filter((r) => r.createdById === ctx.user.id || (r.member ?? "").toLowerCase().trim() === mine);
    }),
    create: crmProcedure
      .input(z.object({
        leadName: z.string().min(1),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        leadDate: z.string().optional(),
        role: z.string().optional(),
        member: z.string().optional(),
        value: z.string().optional(),
        outcome: z.string().optional(),
        classification: z.string().optional(),
        sud: z.string().optional(),
        liability: z.string().optional(),
        disposition: z.string().optional(),
        facility: z.string().optional(),
        typeOfFacility: z.string().optional(),
        clientLocation: z.string().optional(),
        fvDocumentation: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { leadDate, ...rest } = input;
        await db.insert(leadIntake).values({
          ...rest,
          leadDate: leadDate ? new Date(leadDate) : null,
          member: input.member || ctx.user.name || ctx.user.email || undefined,
          createdById: ctx.user.id,
        });
        return { success: true as const };
      }),
    delete: crmProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { success: true as const };
        // Non-managers may only delete intake rows they created / are the member of.
        if (!seesAllData(ctx.user.role)) {
          const [row] = await db.select({ createdById: leadIntake.createdById, member: leadIntake.member }).from(leadIntake).where(eq(leadIntake.id, input.id)).limit(1);
          const mine = (ctx.user.name ?? "").toLowerCase().trim();
          const owns = row && (row.createdById === ctx.user.id || (row.member ?? "").toLowerCase().trim() === mine);
          if (!owns) throw new TRPCError({ code: "FORBIDDEN", message: "Not your lead." });
        }
        await db.delete(leadIntake).where(eq(leadIntake.id, input.id));
        return { success: true as const };
      }),
  }),
});
