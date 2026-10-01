import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./_core/sdk";
import { hashPassword, verifyPassword } from "./_core/password";
import { nanoid } from "nanoid";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { searchGooglePlaces } from "./googleMaps";
import { calculateScore } from "./scoring";
import { crmRouter, ownerNameCandidates } from "./crmRouter";
import { partnershipRouter } from "./partnershipRouter";
import { dailyLogRouter } from "./dailyLogRouter";
import { dailyWorkRouter } from "./dailyWorkRouter";
import { pdRouter } from "./pdRouter";
import { territoriesRouter } from "./territoriesRouter";
import { triviaRouter } from "./triviaRouter";
import axios from "axios";
import { rcCallTranscript } from "./_core/callTranscript";
import { getRingcentralToken, listFacilities } from "./crmDb";
import {
  getSavedLeads,
  getSavedLeadByPlaceId,
  insertSavedLead,
  deleteSavedLead,
  updateSavedLeadAnnotation,
  updateSavedLeadAgent,
  getAllAgentZones,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  upsertAgentZone,
  getSavedSearches,
  insertSavedSearch,
  deleteSavedSearch,
  getAllPiClients,
  getPiClientById,
  createPiClient,
  updatePiClient,
  deletePiClient,
  getFilevineSettings,
  upsertFilevineSettings,
  createPiClientCallLog,
  getPiClientCallLogs,
  findPiClientByPhone,
  getAllFieldVisits,
  createFieldVisit,
  updateFieldVisit,
  deleteFieldVisit,
  getAllFrExpenses,
  getAllBdrExpenses,
  getAllReferralRewards,
  createReferralReward,
  updateReferralReward,
  deleteReferralReward,
  getAllFrErrands,
  createFrErrand,
  updateFrErrand,
  deleteFrErrand,
  getAllReferralTracker,
  createReferralTracker,
  updateReferralTracker,
  deleteReferralTracker,
  searchLeadsByName,
  getLeadName,
  searchFacilitiesByName,
  getFacilityName,
  getAgentDashboardKpis,
  getAllOutboundReferrals,
  createOutboundReferral,
  updateOutboundReferral,
  deleteOutboundReferral,
  getAllInboundLeads,
  createInboundLead,
  updateInboundLead,
  deleteInboundLead,
  getReferralStats,
  listUsers,
  setUserRole,
  getUserByEmail,
  setUserPassword,
  setUserAgentName,
  createUserAccount,
  getBranding,
  getSetting,
  setSetting,
  setUserPhoto,
} from "./db";
import { canManage, canAssignRoles, seesAllData, isIntakeOnly, canSeeMarketing, canEditMarketingSpend, marketingCaseFacts } from "@shared/permissions";
import { getStatus as getSyncStatus, startJob as startSyncJob, SYNC_INTERVAL_MS } from "./dataSync";
import { checkSheets } from "./googleSheets";
import { intakeRouter } from "./intakeRouter";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { REFERRAL_STATUSES } from "@shared/referralTracker";

/** Interpret a "YYYY-MM-DDTHH:mm:ss" report-range boundary as California
 *  (Pacific) local time, returning the matching UTC instant for DB comparison. */
const laDate = (s: string) => fromZonedTime(s, "America/Los_Angeles");
/** A plain "YYYY-MM-DD" end date means the whole of that day in LA. Reading it
 *  as the day's first instant silently dropped the last day of every period on
 *  Representative Performance, Call Analytics, Call Logs and the Reports Center. */
const laEnd = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? laDate(`${s}T23:59:59.999`) : laDate(s));

/** The Referral-Friendly List's picked day ("YYYY-MM-DD") as the row's date —
 *  Pacific noon, as the sheet import stored its dates — and its month label
 *  ("September 2026"), which the Admin Overview counts by. */
const referralDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const referralDateFields = (d: string) => {
  const at = laDate(`${d}T12:00:00`);
  return { createdAt: at, month: formatInTimeZone(at, "America/Los_Angeles", "MMMM yyyy") };
};
import { getAgentReport, getCallAnalytics, getReportAgents, getCallLogs, getAgentPerformanceData, generateAgentPerformanceReview } from "./reports";
import { getCheckinVisitReport, getSignupReport, getNewFacilitiesReport, getCallActivityReport, getLeadsTargetReport } from "./teamReports";
import { getSignupsDashboard, getPartnerOptions, linkLeadToPartner } from "./signupsReport";
import { getSignupsTrends } from "./signupsTrends";
import { getSignupsMonthly } from "./signupsMonthly";
import { getAdminOverview } from "./adminOverview";
import { getExpensesView } from "./expensesView";
import { getFilevineComparison, importFilevineExpenses } from "./filevineExpenses";
import { getRepActivity, getRepReview } from "./repProfile";
import { claudeStatus, saveClaudeKey, testClaude } from "./_core/claude";
import { filevineStatus, saveFilevine, testFilevine, disconnectFilevine } from "./filevine";
import { timeeroStatus, saveTimeeroKey, testTimeero, importTimeero, newTimeeroSecret, timeeroSample, getFieldTime, getFieldToday } from "./timeero";
import { getPartnerReferralsReport } from "./partnerReferralsReport";
import { getSystemHealth } from "./systemHealth";
import { addPartnerForWords, answerWords, dismissDuplicate, forgetWords, getDataCheck, repNameFor, repOfLead } from "./dataCheck";
import { getRepPhotos } from "./repPhotos";
import { getFacilityLogos } from "./facilityLogos";
import { getMarketingDashboard, listMarketingSpend } from "./marketingReport";
import { REASON_KEYS, TZ as MARKETING_TZ } from "./marketing/common";
import { getMarketingLeads, exportMarketingLeads } from "./marketing/leadFilter";
import { DM_BUCKETS, DM_OUTCOMES } from "./marketing/digital";
import { getDigitalMarketingReport } from "./digitalMarketing";
import { getDigitalAudit, getSourceDirectory } from "./digitalAudit";
import { listSourceNames, setSpendOne, setSpendMany, copySpend } from "./marketing/spend";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

/** For non-managers, force the agent filter to themselves so BDR/FR list
 *  endpoints never leak the whole team's financial/operational rows. Managers
 *  keep the optional client-supplied filter. */
function scopeAgentFilter<T extends { agent?: string }>(
  ctx: { user: { role: any; agentName?: string | null; name?: string | null } },
  input: T | undefined,
): T {
  const base = { ...(input ?? {}) } as T;
  if (seesAllData(ctx.user.role)) return base;
  (base as any).agent = ctx.user.agentName ?? ctx.user.name ?? "__none__";
  return base;
}

/** Managers only — used to gate BDR/FR financial row edits/deletes. */
function mgrOnly(ctx: { user: { role: any } }): void {
  if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
}

function superOnly(ctx: { user: { role: any } }): void {
  if (!canAssignRoles(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Super admins only." });
}

/** BD/FR-side procedure — the Intake team is walled off from the lead scraper,
 *  facility CRM, BD/FR reports and expenses (and vice versa via intakeRouter). */
const bdProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  }
  return next();
});

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserByEmail(input.email.toLowerCase().trim());
        if (!user || !verifyPassword(input.password, user.passwordHash)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
        }
        const token = await sdk.createSessionToken(user.openId, {
          name: user.name || user.email || "User",
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        const { passwordHash: _pw, ...safeUser } = user;
        return { success: true as const, user: safeUser };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updatePhoto: protectedProcedure
      .input(z.object({ photoUrl: z.string().max(8_000_000).nullable() }))
      .mutation(async ({ ctx, input }) => {
        await setUserPhoto(ctx.user.id, input.photoUrl);
        return { success: true };
      }),
  }),

  team: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
      const all = await listUsers();
      // Never expose password hashes to the client — just whether one is set.
      return all.map(({ passwordHash, ...u }) => ({ ...u, hasPassword: Boolean(passwordHash) }));
    }),
    setRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["super_admin", "bdr_manager", "fr_manager", "bdr_agent", "fr_agent", "intake_manager", "intake_agent", "intake_frontline"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!canAssignRoles(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the super admin can assign roles." });
        if (input.userId === ctx.user.id && input.role !== "super_admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove your own super-admin access." });
        }
        await setUserRole(input.userId, input.role);
        return { success: true };
      }),
    setPassword: protectedProcedure
      .input(z.object({ userId: z.number(), password: z.string().min(6) }))
      .mutation(async ({ ctx, input }) => {
        if (!canAssignRoles(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the super admin can set passwords." });
        await setUserPassword(input.userId, hashPassword(input.password));
        return { success: true };
      }),
    setAgentName: protectedProcedure
      .input(z.object({ userId: z.number(), agentName: z.string().max(80) }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await setUserAgentName(input.userId, input.agentName.trim() || null);
        return { success: true };
      }),
    createUser: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(["super_admin", "bdr_manager", "fr_manager", "bdr_agent", "fr_agent", "intake_manager", "intake_agent", "intake_frontline"]),
        password: z.string().min(6),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canAssignRoles(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the super admin can add users." });
        const email = input.email.toLowerCase().trim();
        if (await getUserByEmail(email)) throw new TRPCError({ code: "BAD_REQUEST", message: "A user with that email already exists." });
        await createUserAccount({ openId: `local_${nanoid()}`, name: input.name, email, role: input.role, passwordHash: hashPassword(input.password) });
        return { success: true };
      }),
  }),

  // Lead Docket + Google Sheets syncs. Managers only: a sync rewrites team data.
  dataSync: router({
    status: bdProcedure.query(async ({ ctx }) => {
      mgrOnly(ctx);
      const [leaddocket, leaddocket_history, sheets, sheetAccess] = await Promise.all([
        getSyncStatus("leaddocket"), getSyncStatus("leaddocket_history"), getSyncStatus("sheets"), checkSheets(),
      ]);
      return { leaddocket, leaddocket_history, sheets, sheetAccess, intervalHours: SYNC_INTERVAL_MS / 3_600_000, leadDocketConfigured: !!process.env.LEADDOCKET_API_KEY };
    }),
    run: bdProcedure
      .input(z.object({ job: z.enum(["leaddocket", "leaddocket_history", "sheets"]) }))
      .mutation(async ({ ctx, input }) => {
        mgrOnly(ctx);
        if (input.job !== "sheets" && !process.env.LEADDOCKET_API_KEY) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Lead Docket is not configured on the server." });
        }
        const started = await startSyncJob(input.job, "manual");
        return { started, alreadyRunning: !started };
      }),
  }),

  settings: router({
    // Public so the login screen can show the branded logo before sign-in.
    getBranding: publicProcedure.query(async () => getBranding()),
    updateBranding: protectedProcedure
      .input(z.object({
        // data URL string to set, null to clear (reset to default), undefined to leave unchanged
        logoDark: z.string().max(8_000_000).nullable().optional(),
        logoLight: z.string().max(8_000_000).nullable().optional(),
        slogan: z.string().max(200).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        if (input.logoDark !== undefined) await setSetting("logo_dark", input.logoDark);
        if (input.logoLight !== undefined) await setSetting("logo_light", input.logoLight);
        if (input.slogan !== undefined) await setSetting("brand_slogan", input.slogan);
        return { success: true };
      }),
    // Claude (Anthropic) writes the AI performance review once a key is connected
    // (server/_core/claude.ts). Super admins only; the key never comes back out.
    claudeStatus: protectedProcedure.query(({ ctx }) => { superOnly(ctx); return claudeStatus(); }),
    // Timeero (the FRs' GPS time tracking): super admin only — the status carries the webhook secret.
    timeeroStatus: protectedProcedure.query(({ ctx }) => { superOnly(ctx); return timeeroStatus(); }),
    saveTimeeroKey: protectedProcedure
      .input(z.object({ key: z.string().max(400).nullable() }))
      .mutation(({ ctx, input }) => { superOnly(ctx); return saveTimeeroKey(input.key); }),
    testTimeero: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return testTimeero(); }),
    // Filevine API (service account): super admin only; secrets never come back out.
    filevineStatus: protectedProcedure.query(({ ctx }) => { superOnly(ctx); return filevineStatus(); }),
    saveFilevine: protectedProcedure
      .input(z.object({
        pat: z.string().max(400).nullish(), clientId: z.string().max(400).nullish(), clientSecret: z.string().max(400).nullish(),
        orgId: z.string().max(20).nullish(), userId: z.string().max(20).nullish(), account: z.string().max(200).nullish(),
      }))
      .mutation(({ ctx, input }) => { superOnly(ctx); return saveFilevine(input); }),
    testFilevine: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return testFilevine(); }),
    disconnectFilevine: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return disconnectFilevine(); }),
    importTimeero: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return importTimeero(); }),
    newTimeeroSecret: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return newTimeeroSecret(); }),
    timeeroSample: protectedProcedure
      .input(z.object({ kind: z.enum(["users", "groups", "jobs", "tasks", "timesheets", "schedules"]) }))
      .mutation(({ ctx, input }) => { superOnly(ctx); return timeeroSample(input.kind); }),
    saveClaudeKey: protectedProcedure
      .input(z.object({ key: z.string().max(400).nullable() }))
      .mutation(({ ctx, input }) => { superOnly(ctx); return saveClaudeKey(input.key); }),
    testClaude: protectedProcedure.mutation(({ ctx }) => { superOnly(ctx); return testClaude(); }),
    // Is every background job the reports depend on working? (server/systemHealth.ts)
    systemHealth: protectedProcedure.query(({ ctx }) => { superOnly(ctx); return getSystemHealth(); }),
  }),

  leads: router({
    search: bdProcedure
      .input(
        z.object({
          category: z.enum([
            "body_shop",
            "chiropractor",
            "physical_therapist",
            "medical_clinic",
            "orthopedic_doctor",
            "imaging_center",
          ]),
          location: z.string().min(2),
          lat: z.number().optional(),
          lng: z.number().optional(),
          radiusMiles: z.number().min(1).max(50).default(10),
          maxResults: z.number().min(1).max(100).default(20),
        })
      )
      .query(async ({ input }) => {
        if (!GOOGLE_MAPS_API_KEY) {
          throw new Error("Google Maps API key is not configured.");
        }
        const places = await searchGooglePlaces({
          category: input.category,
          location: input.location,
          lat: input.lat,
          lng: input.lng,
          radiusMiles: input.radiusMiles,
          apiKey: GOOGLE_MAPS_API_KEY,
          maxResults: input.maxResults,
        });
        const leads = places.map((place) => {
          const breakdown = calculateScore({
            rating: place.rating,
            reviewCount: place.reviewCount,
            distanceMiles: place.distanceMiles,
            category: place.category,
            lienTexts: place.lienTexts,
          });
          return {
            ...place,
            email: null as string | null,
            qualificationScore: breakdown.total,
            scoreTier: breakdown.tier,
            scoreBreakdown: breakdown,
            lienFriendly: breakdown.lienFriendly,
            lienSignals: breakdown.lienSignals,
          };
        });
        leads.sort((a, b) => b.qualificationScore - a.qualificationScore);
        return leads;
      }),
  }),

  savedLeads: router({
    list: bdProcedure.query(async ({ ctx }) => {
      return getSavedLeads(ctx.user.id);
    }),

    save: bdProcedure
      .input(
        z.object({
          placeId: z.string(),
          source: z.literal("google"),
          name: z.string(),
          address: z.string().nullable(),
          phone: z.string().nullable(),
          website: z.string().nullable(),
          email: z.string().nullable(),
          category: z.string().nullable(),
          rating: z.number().nullable(),
          reviewCount: z.number().nullable(),
          latitude: z.number().nullable(),
          longitude: z.number().nullable(),
          qualificationScore: z.number().nullable(),
          scoreTier: z.enum(["hot", "warm", "cold"]).nullable(),
          scoreBreakdown: z.any().nullable(),
          annotation: z.string().optional(),
          lienFriendly: z.boolean().optional(),
          lienSignals: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await getSavedLeadByPlaceId(ctx.user.id, input.placeId);
        if (existing) return { saved: true, alreadyExisted: true };
        await insertSavedLead({
          userId: ctx.user.id,
          placeId: input.placeId,
          source: input.source,
          name: input.name,
          address: input.address ?? undefined,
          phone: input.phone ?? undefined,
          website: input.website ?? undefined,
          email: input.email ?? undefined,
          category: input.category ?? undefined,
          rating: input.rating ?? undefined,
          reviewCount: input.reviewCount ?? undefined,
          latitude: input.latitude ?? undefined,
          longitude: input.longitude ?? undefined,
          qualificationScore: input.qualificationScore ?? undefined,
          scoreTier: input.scoreTier ?? undefined,
          scoreBreakdown: input.scoreBreakdown ?? undefined,
          annotation: input.annotation ?? undefined,
          lienFriendly: input.lienFriendly ?? false,
          lienSignals: input.lienSignals ? JSON.stringify(input.lienSignals) : undefined,
        });
        return { saved: true, alreadyExisted: false };
      }),

    unsave: bdProcedure
      .input(z.object({ placeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSavedLead(ctx.user.id, input.placeId);
        return { success: true };
      }),

    annotate: bdProcedure
      .input(z.object({ placeId: z.string(), annotation: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await updateSavedLeadAnnotation(ctx.user.id, input.placeId, input.annotation);
        return { success: true };
      }),

    isSaved: bdProcedure
      .input(z.object({ placeId: z.string() }))
      .query(async ({ ctx, input }) => {
        const lead = await getSavedLeadByPlaceId(ctx.user.id, input.placeId);
        return { saved: !!lead };
      }),
  }),

  agentZones: router({
    list: bdProcedure.query(async () => {
      return getAllAgentZones();
    }),
    get: bdProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getAgentById(input.id);
      }),
    create: bdProcedure
      .input(z.object({
        agentName: z.string().min(1),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        employer: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        title: z.string().optional(),
        notes: z.string().optional(),
        color: z.string().default('#94a3b8'),
        cities: z.array(z.string()).default([]),
        active: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await createAgent({
          agentName: input.agentName,
          firstName: input.firstName,
          lastName: input.lastName,
          employer: input.employer,
          phone: input.phone,
          email: input.email,
          title: input.title,
          notes: input.notes,
          color: input.color,
          cities: input.cities,
          active: input.active,
        });
        return { success: true };
      }),
    update: bdProcedure
      .input(z.object({
        id: z.number(),
        agentName: z.string().min(1).optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        employer: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        title: z.string().optional(),
        notes: z.string().optional(),
        color: z.string().optional(),
        cities: z.array(z.string()).optional(),
        active: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        const { id, ...data } = input;
        await updateAgent(id, data);
        return { success: true };
      }),
    delete: bdProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await deleteAgent(input.id);
        return { success: true };
      }),
    upsert: bdProcedure
      .input(z.object({
        agentName: z.string(),
        color: z.string(),
        cities: z.array(z.string()),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await upsertAgentZone(input.agentName, input.color, input.cities);
        return { success: true };
      }),
    assignLead: bdProcedure
      .input(z.object({
        placeId: z.string(),
        assignedAgent: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await updateSavedLeadAgent(input.placeId, input.assignedAgent);
        return { success: true };
      }),
  }),

  piClients: router({
    list: bdProcedure.query(async ({ ctx }) => {
      const all = await getAllPiClients();
      if (seesAllData(ctx.user.role)) return all;
      return (all as any[]).filter((c) => c.assignedAgentId === ctx.user.id);
    }),
    get: bdProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const c = await getPiClientById(input.id);
        if (c && !seesAllData(ctx.user.role) && (c as any).assignedAgentId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your client." });
        }
        return c;
      }),
    create: bdProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        incidentDate: z.string().optional(),
        incidentType: z.string().optional(),
        caseStatus: z.enum(['intake','active','settled','closed','lost']).default('intake'),
        address: z.string().optional(),
        city: z.string().optional(),
        zipCode: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        filevineCaseId: z.string().optional(),
        filevineProjectId: z.string().optional(),
        assignedAgentId: z.number().optional(),
        assignedAgentName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await createPiClient({
          ...input,
          incidentDate: input.incidentDate ? new Date(input.incidentDate) : undefined,
        });
        return { success: true };
      }),
    update: bdProcedure
      .input(z.object({
        id: z.number(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        incidentDate: z.string().optional(),
        incidentType: z.string().optional(),
        caseStatus: z.enum(['intake','active','settled','closed','lost']).optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        zipCode: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        filevineCaseId: z.string().optional(),
        filevineProjectId: z.string().optional(),
        assignedAgentId: z.number().optional(),
        assignedAgentName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        const { id, ...data } = input;
        await updatePiClient(id, {
          ...data,
          incidentDate: data.incidentDate ? new Date(data.incidentDate) : undefined,
        });
        return { success: true };
      }),
    delete: bdProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
        await deletePiClient(input.id);
        return { success: true };
      }),
    logCall: bdProcedure
      .input(z.object({
        piClientId: z.number(),
        callId: z.string().optional(),
        phoneNumber: z.string().optional(),
        direction: z.string().optional(),
        result: z.string().optional(),
        duration: z.number().optional(),
        durationStr: z.string().optional(),
        startTime: z.string().optional(),
        transcript: z.string().optional(),
        agentName: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await createPiClientCallLog(input);
        return { success: true };
      }),
    getCallLogs: bdProcedure
      .input(z.object({ piClientId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (!seesAllData(ctx.user.role)) {
          const c = await getPiClientById(input.piClientId);
          if (c && (c as any).assignedAgentId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Not your client." });
        }
        return getPiClientCallLogs(input.piClientId);
      }),
    findByPhone: bdProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ ctx, input }) => {
        const c = findPiClientByPhone(input.phone) ?? null;
        const resolved = await c;
        if (resolved && !seesAllData(ctx.user.role) && (resolved as any).assignedAgentId !== ctx.user.id) return null;
        return resolved;
      }),
    logCallByPhone: bdProcedure
      .input(z.object({
        phone: z.string(),
        callId: z.string().optional(),
        direction: z.string().optional(),
        result: z.string().optional(),
        duration: z.number().optional(),
        durationStr: z.string().optional(),
        startTime: z.string().optional(),
        transcript: z.string().optional(),
        agentName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const client = await findPiClientByPhone(input.phone);
        if (!client) return { success: false as const, reason: 'no_match', piClientId: null, clientName: null };
        await createPiClientCallLog({ ...input, piClientId: client.id, phoneNumber: input.phone });
        return { success: true as const, piClientId: client.id, clientName: (client.firstName ?? '') + ' ' + (client.lastName ?? '') };
      }),

    /**
     * transcribeAndLog — called after a RingCentral call ends.
     * 1. Looks up the PI client by phone number.
     * 2. Fetches the call recording from RingCentral (via callId).
     * 3. Transcribes the recording with Whisper.
     * 4. Saves the full call log + transcript to pi_client_call_logs.
     */
    transcribeAndLog: bdProcedure
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
        const RC_BASE = "https://platform.ringcentral.com";

        // 1. Match PI client by phone
        const client = await findPiClientByPhone(input.phone);
        const clientName = client ? ((client.firstName ?? '') + ' ' + (client.lastName ?? '')).trim() : null;

        // 2. Get a valid RingCentral access token (reuse existing stored token)
        let accessToken: string | null = null;
        try {
          const stored = await getRingcentralToken();
          if (stored) {
            const now = Date.now();
            if (stored.tokenExpiry.getTime() - now < 5 * 60 * 1000) {
              // Refresh token
              const clientId = process.env.RINGCENTRAL_CLIENT_ID ?? "";
              const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET ?? "";
              const resp = await axios.post(
                `${RC_BASE}/restapi/oauth/token`,
                new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken }),
                { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
              );
              accessToken = resp.data.access_token;
            } else {
              accessToken = stored.accessToken;
            }
          }
        } catch { /* no token stored — proceed without transcription */ }

        // 3. Fetch recording URL from RingCentral call-log
        let transcriptText = "";
        if (accessToken && input.callId) {
          try {
            const callResp = await axios.get(
              `${RC_BASE}/restapi/v1.0/account/~/call-log/${input.callId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const recordingUrl: string | null = callResp.data?.recording?.contentUri ?? null;
            if (recordingUrl) {
              // 4. RingCentral's own transcript (AI Notes, RingSense), else OpenAI's from the recording
              const tr = await rcCallTranscript({ telephonySessionId: callResp.data?.telephonySessionId, recordingUri: recordingUrl }, accessToken);
              if (tr.ok) transcriptText = tr.text;
            }
          } catch { /* recording not yet available — save log without transcript */ }
        }

        // 5. Save call log (with or without transcript)
        const logData = {
          phone: input.phone,
          callId: input.callId,
          direction: input.direction,
          result: input.result,
          duration: input.duration,
          durationStr: input.durationStr,
          startTime: input.startTime,
          transcript: transcriptText || undefined,
          agentName: input.agentName ?? ctx.user.name ?? ctx.user.email ?? undefined,
        };

        if (client) {
          await createPiClientCallLog({ ...logData, piClientId: client.id, phoneNumber: input.phone });
        }

        return {
          success: true as const,
          piClientId: client?.id ?? null,
          clientName,
          hasTranscript: !!transcriptText,
          transcriptText: transcriptText || null,
        };
      }),
  }),

  filevine: router({
    getSettings: bdProcedure.query(async ({ ctx }) => {
      const settings = await getFilevineSettings(ctx.user.id);
      // Never expose raw keys to frontend — just return connection status
      if (!settings) return { connected: false, orgId: null, baseUrl: 'https://api.filevine.io', lastSyncAt: null };
      return {
        connected: settings.connected,
        orgId: settings.orgId,
        baseUrl: settings.baseUrl,
        lastSyncAt: settings.lastSyncAt,
      };
    }),
    saveSettings: bdProcedure
      .input(z.object({
        apiKey: z.string().min(1),
        apiSecret: z.string().min(1),
        orgId: z.string().optional(),
        baseUrl: z.string().url().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertFilevineSettings({
          userId: ctx.user.id,
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          orgId: input.orgId,
          baseUrl: input.baseUrl ?? 'https://api.filevine.io',
          connected: true,
        });
        return { success: true };
      }),
    disconnect: bdProcedure.mutation(async ({ ctx }) => {
      await upsertFilevineSettings({
        userId: ctx.user.id,
        apiKey: '',
        apiSecret: '',
        connected: false,
      });
      return { success: true };
    }),

    // ─── Filevine via Zapier/n8n webhook ──────────────────────────────────────
    // One org-wide webhook URL; every call recap is POSTed to it so a Zapier/n8n
    // automation can create a Filevine task. Managers only.
    getWebhook: bdProcedure.query(async ({ ctx }) => {
      if (!seesAllData(ctx.user.role)) return { url: null, canEdit: false };
      const url = await getSetting('filevine_webhook_url');
      return { url: url ?? null, canEdit: true };
    }),
    setWebhook: bdProcedure
      .input(z.object({ url: z.string().max(2000) }))
      .mutation(async ({ ctx, input }) => {
        if (!seesAllData(ctx.user.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only managers can set the Filevine webhook.' });
        }
        const url = input.url.trim();
        if (url && !/^https?:\/\//i.test(url)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Webhook URL must start with http:// or https://' });
        }
        await setSetting('filevine_webhook_url', url || null);
        return { success: true as const };
      }),
  }),

  crm: crmRouter,

  // FR/BDR Dual Partnership Model — pods, shared quota, coordinated loop, visit
  // briefings, QA coach, health, bonus pool, leadership reporting.
  partnership: partnershipRouter,

  // Daily Activity Log — archived by-person + by-facility breakdown of each day.
  dailyLog: dailyLogRouter,

  // Daily Work View — "what to work on now" + integration health.
  dailyWork: dailyWorkRouter,

  // PD Car Referral Tracker — body-shop pipeline + leadership dashboard.
  pd: pdRouter,

  // Territories admin — ownership (shared with agent_zones / the CA map) + cleanup.
  territories: territoriesRouter,

  // Team Trivia — live multiplayer quiz for team hangouts (/trivia).
  trivia: triviaRouter,

  // Intake — AI Case Desk (separate world from the BD/FR CRM; see intakeRouter)
  intake: intakeRouter,

  // Reps' RingCentral profile pictures by name key (server/repPhotos.ts), for avatars.
  repPhotos: bdProcedure.query(() => getRepPhotos()),
  // The top partners' logos by facility id (server/facilityLogos.ts).
  facilityLogos: bdProcedure.query(() => getFacilityLogos()),

  // Marketing Report — every Lead Docket lead by marketing source. The whole
  // BD/FR team (canSeeMarketing); spend is entered by managers only; why leads
  // didn't sign is an intake case fact, so it goes only to marketingCaseFacts
  // (the super admin) — the hard wall.
  marketing: (() => {
    const marketingProcedure = protectedProcedure.use(({ ctx, next }) => {
      if (!canSeeMarketing(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "The Marketing Report is for the BD/FR team." });
      return next();
    });
    const spendProcedure = marketingProcedure.use(({ ctx, next }) => {
      if (!canEditMarketingSpend(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can enter marketing spend." });
      return next();
    });
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const month = z.string().regex(/^\d{4}-\d{2}$/);
    const range = z.object({ from: day, to: day });
    const toRange = (i: { from: string; to: string }) => ({ from: laDate(`${i.from}T00:00:00`), to: laDate(`${i.to}T23:59:59.999`) });
    // Which leads a clicked number stands for (DrillScope); '' in a list means NULL or empty.
    const leadScope = range.extend({
      source: z.string().max(255).optional(),
      sources: z.array(z.string().max(255)).max(500).optional(),
      contactSources: z.array(z.string().max(255)).max(200).optional(),
      month: month.optional(),
      bucket: z.enum(["open", "rejected", "referredOut", "notInterested", "signedReferred", "signedInHouse"]).optional(),
      reasons: z.array(z.enum(REASON_KEYS)).max(9).optional(),
      subStatus: z.string().max(200).optional(),
      caseTypes: z.array(z.string().max(120)).max(50).optional(),
      notCaseTypes: z.array(z.string().max(120)).max(50).optional(),
      campaigns: z.array(z.string().max(255)).max(50).optional(),
      status: z.enum(["all", "signed", "open"]).default("all"),
      search: z.string().max(100).optional(),
      digital: z.boolean().optional(),
      dmBucket: z.enum(DM_BUCKETS).optional(),
      dmOutcome: z.enum(DM_OUTCOMES).optional(),
    });
    // Who changed the spend, as setSpend has always recorded it.
    const byOf = (u: { name?: string | null; email?: string | null; id: unknown }) => String(u.name || u.email || `user ${u.id}`);
    return router({
      dashboard: marketingProcedure
        .input(range.extend({
          group: z.enum(["channel", "source"]).default("channel"),
          compare: z.enum(["prev", "yoy", "off"]).default("prev"),
          digital: z.boolean().optional(),
        }))
        // "today" is the server's Pacific date: pace and "still in progress" are judged against it.
        .query(({ ctx, input }) => getMarketingDashboard(toRange(input), {
          group: input.group, from: input.from, to: input.to, compare: input.compare,
          today: formatInTimeZone(new Date(), MARKETING_TZ, "yyyy-MM-dd"),
          caseFacts: marketingCaseFacts(ctx.user.role), digital: input.digital,
        })),
      leads: marketingProcedure
        .input(leadScope.extend({
          limit: z.number().int().min(1).max(500).default(50),
          withWhy: z.boolean().optional(),
        }))
        .query(({ ctx, input }) => getMarketingLeads({ ...input, ...toRange(input), caseFacts: marketingCaseFacts(ctx.user.role) })),
      exportLeads: marketingProcedure
        .input(leadScope)
        .query(({ ctx, input }) => exportMarketingLeads({ ...input, ...toRange(input), caseFacts: marketingCaseFacts(ctx.user.role) })),
      // Digital Marketing Report — the digital team's MTD summary, from the same leads.
      digital: marketingProcedure
        .input(range)
        .query(({ input }) => getDigitalMarketingReport({ ...toRange(input), fromDay: input.from, toDay: input.to },
          formatInTimeZone(new Date(), MARKETING_TZ, "yyyy-MM-dd"))),
      // Its Audit tab: leads Lead Docket may have credited to the wrong source, and source-name hygiene.
      digitalAudit: marketingProcedure
        .input(range.extend({ scope: z.enum(["period", "12m", "all"]).default("period") }))
        .query(({ input }) => getDigitalAudit({ ...toRange(input), fromDay: input.from, toDay: input.to }, input.scope)),
      // Every Marketing Source, Contact Source and Campaign in Lead Docket, all time — the shareable directory.
      sourceDirectory: marketingProcedure.query(() => getSourceDirectory()),
      spend: marketingProcedure.input(z.object({ months: z.array(month).max(240) })).query(({ input }) => listMarketingSpend(input.months)),
      sourceNames: marketingProcedure.query(() => listSourceNames()),
      setSpend: spendProcedure
        .input(z.object({ month, source: z.string().min(1).max(255), amount: z.number().min(0).max(10_000_000).nullable() }))
        .mutation(({ ctx, input }) => setSpendOne(input.month, input.source, input.amount, byOf(ctx.user))),
      setSpendMany: spendProcedure
        .input(z.object({
          month,
          rows: z.array(z.object({ source: z.string().min(1).max(255), amount: z.number().min(0).max(10_000_000).nullable() })).max(300),
        }))
        .mutation(({ ctx, input }) => setSpendMany(input.month, input.rows, byOf(ctx.user))),
      copySpend: spendProcedure
        .input(z.object({ from: month, to: month, overwrite: z.boolean().default(false) }))
        .mutation(({ ctx, input }) => copySpend(input.from, input.to, input.overwrite, byOf(ctx.user))),
    });
  })(),

  // Team Reports — live replacements for the BDR/FR Excel report workbooks.
  teamReports: (() => {
    const range = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const toRange = (i: { from: string; to: string }) => ({
      from: laDate(`${i.from}T00:00:00`),
      to: laDate(`${i.to}T23:59:59`),
    });
    return router({
      checkinsVisits: bdProcedure.input(range).query(async ({ ctx, input }) => { mgrOnly(ctx); return getCheckinVisitReport(toRange(input)); }),
      signups: bdProcedure.input(range).query(async ({ ctx, input }) => { mgrOnly(ctx); return getSignupReport(toRange(input)); }),
      newFacilities: bdProcedure.input(range).query(async ({ ctx, input }) => { mgrOnly(ctx); return getNewFacilitiesReport(toRange(input)); }),
      callActivity: bdProcedure.input(range).query(async ({ ctx, input }) => { mgrOnly(ctx); return getCallActivityReport(toRange(input)); }),
      leadsTargets: bdProcedure.input(range).query(async ({ ctx, input }) => { mgrOnly(ctx); return getLeadsTargetReport(toRange(input)); }),
      // Executive sign-ups dashboard: volume by facility type and territory.
      signupsDashboard: bdProcedure
        .input(range.extend({ role: z.enum(["BDR", "FR", "Intake"]).optional(), team: z.enum(["current", "all"]).optional(), member: z.string().max(120).optional() }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getSignupsDashboard(toRange(input), { role: input.role, team: input.team, member: input.member }); }),
      // Sign-ups by week, month and year with a forecast — whatever the report's dates.
      signupsTrends: bdProcedure
        .input(z.object({ role: z.enum(["BDR", "FR", "Intake"]).optional(), team: z.enum(["current", "all"]).optional(), member: z.string().max(120).optional() }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getSignupsTrends({ role: input.role, team: input.team, member: input.member }); }),
      // The team sheet's monthly leads summary, per role (or one rep), from Lead Docket.
      signupsMonthly: bdProcedure
        .input(z.object({ year: z.number().int().min(2019).max(2100).optional(), role: z.enum(["BDR", "FR", "Intake"]).optional(), team: z.enum(["current", "all"]).optional(), member: z.string().max(120).optional() }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getSignupsMonthly(input.year, { role: input.role, team: input.team, member: input.member }); }),
      // A representative's profile: their calls, recaps, visits, errands, expenses and partners.
      repActivity: bdProcedure
        .input(range.extend({ member: z.string().min(1).max(120) }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getRepActivity(input.member, toRange(input)); }),
      // The AI performance review for the profile's rep and dates (kept a few hours; fresh on Regenerate).
      repReview: bdProcedure
        .input(range.extend({ member: z.string().min(1).max(120), fresh: z.boolean().optional() }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getRepReview(input.member, toRange(input), input.fresh); }),
      // The FRs' Timeero timesheets for the dates picked: hours, miles, where they clocked in and out.
      fieldTime: bdProcedure
        .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), member: z.string().max(120).optional() }))
        .query(async ({ ctx, input }) => { mgrOnly(ctx); return getFieldTime(input.from, input.to, input.member); }),
      // Today's (Pacific) Timeero shifts for the map: who is clocked in and
      // where each shift was clocked in / out. Not live GPS.
      fieldToday: bdProcedure.query(async ({ ctx }) => { mgrOnly(ctx); return getFieldToday(); }),
      // Pick a lead's referring partner by hand from the report's lead lists.
      partnerOptions: bdProcedure.query(async ({ ctx }) => { mgrOnly(ctx); return getPartnerOptions(); }),
      linkLeadPartner: bdProcedure
        .input(z.object({ leadId: z.number().int(), facilityId: z.number().int().nullable() }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          return linkLeadToPartner(input.leadId, input.facilityId, String(ctx.user.name || ctx.user.email || `user ${ctx.user.id}`));
        }),
    });
  })(),

  // Data Check (server/dataCheck.ts): the team's Lead Docket leads that need an
  // answer — a partner, "none", or a second look. Managers see and answer for
  // everyone; a rep for their own leads, and for words their own leads say.
  dataCheck: (() => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const byOf = (u: { name?: string | null; email?: string | null; id: number }) => String(u.name || u.email || `user ${u.id}`);
    const whoOf = async (u: { role: any; name?: string | null; agentName?: string | null }) =>
      ({ manager: canManage(u.role), rep: await repNameFor([u.name, u.agentName]) });
    const key = z.string().min(1).max(255);
    return router({
      get: bdProcedure
        .input(z.object({ from: day, to: day, rep: z.string().max(120).optional(), team: z.enum(["all", "current"]).optional() }))
        .query(async ({ ctx, input }) => {
          const who = await whoOf(ctx.user);
          // A rep sees their own leads only; someone Lead Docket credits with none sees nothing.
          const rep = who.manager ? input.rep || null : who.rep ?? "\u0000none";
          const data = await getDataCheck({ from: laDate(`${input.from}T00:00:00`), to: laDate(`${input.to}T23:59:59.999`) }, { rep, team: input.team });
          return data && { ...data, me: who };
        }),
      // Who is looking: a manager, and the rep Lead Docket credits them as (their own leads open first).
      me: bdProcedure.query(({ ctx }) => whoOf(ctx.user)),
      partners: bdProcedure.query(async ({ ctx }) => {
        if (seesAllData(ctx.user.role)) return getPartnerOptions();
        // A rep picks from their own partners, as the Facilities page shows them.
        const own = await listFacilities({ assignedRepId: ctx.user.id, assignedRepNames: ownerNameCandidates(ctx.user) });
        type Option = { id: number; name: string; territory: string | null };
        return (own as Option[]).map((f): Option => ({ id: f.id, name: f.name, territory: f.territory }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }),
      linkLead: bdProcedure
        .input(z.object({ leadId: z.number().int(), facilityId: z.number().int().nullable() }))
        .mutation(async ({ ctx, input }) => {
          const who = await whoOf(ctx.user);
          if (!who.manager && (!who.rep || (await repOfLead(input.leadId)) !== who.rep)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager or the lead's rep can change its partner." });
          }
          return linkLeadToPartner(input.leadId, input.facilityId, byOf(ctx.user));
        }),
      // alsoKeys: other spellings of the same business, answered the same way.
      answerWords: bdProcedure
        .input(z.object({ key, facilityId: z.number().int().nullable(), alsoKeys: z.array(key).max(25).optional() }))
        .mutation(async ({ ctx, input }) => answerWords(input.key, input.facilityId, byOf(ctx.user), await whoOf(ctx.user), input.alsoKeys ?? [])),
      addPartner: bdProcedure
        .input(z.object({
          key,
          name: z.string().trim().min(2).max(255),
          category: z.enum(["body_shop", "chiropractor", "physical_therapist", "medical_clinic", "orthopedic_doctor", "imaging_center", "other"]),
          city: z.string().trim().max(120).optional(),
          alsoKeys: z.array(key).max(25).optional(),
        }))
        .mutation(async ({ ctx, input }) =>
          addPartnerForWords(input.key, { name: input.name, category: input.category, city: input.city }, { id: ctx.user.id, name: byOf(ctx.user) },
            await whoOf(ctx.user), input.alsoKeys ?? [])),
      forgetWords: bdProcedure
        .input(z.object({ key }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await forgetWords(input.key); return { ok: true }; }),
      dismissDuplicate: bdProcedure
        .input(z.object({ lds: z.array(z.string().min(1).max(64)).min(2).max(30) }))
        .mutation(async ({ ctx, input }) => { await dismissDuplicate(input.lds, byOf(ctx.user), await whoOf(ctx.user)); return { ok: true }; }),
    });
  })(),

  reports: router({
    // Agents available to report on: agents see only themselves; managers see all.
    agents: bdProcedure.query(async ({ ctx }) => {
      if (!seesAllData(ctx.user.role)) {
        const self = String(ctx.user.agentName || ctx.user.name || "Me");
        return [{ name: self, self: true }];
      }
      const names = await getReportAgents();
      return names.map((name) => ({ name, self: false }));
    }),
    agentReport: bdProcedure
      .input(z.object({
        agentName: z.string().optional(), // manager-selected name, or "__all__" / empty for everyone
        from: z.string(),
        to: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const from = laDate(input.from);
        const to = laEnd(input.to);
        const seesAll = seesAllData(ctx.user.role);
        let names: string[] | undefined;
        if (!seesAll) {
          names = [ctx.user.agentName, ctx.user.name].filter((x): x is string => !!x);
          if (!names.length) names = ["__none__"];
        } else if (input.agentName && input.agentName !== "__all__") {
          names = [input.agentName];
        } else {
          names = undefined; // all agents
        }
        return getAgentReport({ names, from, to });
      }),
    callAnalytics: bdProcedure
      .input(z.object({ agentName: z.string().optional(), from: z.string(), to: z.string() }))
      .query(async ({ ctx, input }) => {
        const from = laDate(input.from);
        const to = laEnd(input.to);
        const seesAll = seesAllData(ctx.user.role);
        let names: string[] | undefined;
        if (!seesAll) {
          names = [ctx.user.agentName, ctx.user.name].filter((x): x is string => !!x);
          if (!names.length) names = ["__none__"];
        } else if (input.agentName && input.agentName !== "__all__") {
          names = [input.agentName];
        } else {
          names = undefined;
        }
        return getCallAnalytics({ names, from, to });
      }),
    callLogs: bdProcedure
      .input(z.object({ agentName: z.string().optional(), from: z.string(), to: z.string() }))
      .query(async ({ ctx, input }) => {
        const from = laDate(input.from);
        const to = laEnd(input.to);
        const seesAll = seesAllData(ctx.user.role);
        let names: string[] | undefined;
        if (!seesAll) {
          names = [ctx.user.agentName, ctx.user.name].filter((x): x is string => !!x);
          if (!names.length) names = ["__none__"];
        } else if (input.agentName && input.agentName !== "__all__") {
          names = [input.agentName];
        } else {
          names = undefined;
        }
        return getCallLogs({ names, from, to });
      }),
    agentPerformance: bdProcedure
      .input(z.object({ agentName: z.string().optional(), from: z.string(), to: z.string() }))
      .query(async ({ ctx, input }) => {
        const from = laDate(input.from);
        const to = laEnd(input.to);
        const seesAll = seesAllData(ctx.user.role);
        let names: string[] | undefined;
        if (!seesAll) {
          names = [ctx.user.agentName, ctx.user.name].filter((x): x is string => !!x);
          if (!names.length) names = ["__none__"];
        } else if (input.agentName && input.agentName !== "__all__") {
          names = [input.agentName];
        } else {
          names = undefined;
        }
        return getAgentPerformanceData({ names, from, to });
      }),
    agentPerformanceReview: bdProcedure
      .input(z.object({ agentName: z.string().optional(), from: z.string(), to: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const from = laDate(input.from);
        const to = laEnd(input.to);
        const seesAll = seesAllData(ctx.user.role);
        let names: string[] | undefined;
        let agentLabel: string | undefined;
        if (!seesAll) {
          names = [ctx.user.agentName, ctx.user.name].filter((x): x is string => !!x);
          if (!names.length) names = ["__none__"];
          agentLabel = ctx.user.name ?? ctx.user.agentName ?? "you";
        } else if (input.agentName && input.agentName !== "__all__") {
          names = [input.agentName];
          agentLabel = input.agentName;
        } else {
          names = undefined;
          agentLabel = "the whole team";
        }
        return generateAgentPerformanceReview({ names, from, to, agentLabel });
      }),
  }),

  bdr: router({
    dashboardKpis: bdProcedure.query(async () => getAgentDashboardKpis()),
    // Admin Overview (/bdr/admin): the sheet's activity for today's team, for a date range (all time without one).
    adminDashboard: bdProcedure
      .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).nullish())
      .query(async ({ ctx, input }) => {
        if (!canManage(ctx.user.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Managers only' });
        return getAdminOverview(input ?? null);
      }),

    fieldVisits: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          month: z.string().optional(),
          year: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllFieldVisits(scopeAgentFilter(ctx, input))),
      create: bdProcedure
        .input(z.object({
          visitDate: z.string(),
          agentName: z.string().min(1),
          facilityCount: z.number().int().min(0).default(0),
          hoursWorked: z.string().optional(),
          facilityNames: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createFieldVisit({
            visitDate: new Date(input.visitDate),
            agentName: input.agentName,
            facilityCount: input.facilityCount,
            hoursWorked: input.hoursWorked,
            notes: input.notes,
            facilitiesVisited: input.facilityNames ? input.facilityNames.split('\n').map(n => ({ name: n.trim() })) : [],
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          visitDate: z.string().optional(),
          agentName: z.string().optional(),
          facilityCount: z.number().int().optional(),
          hoursWorked: z.string().optional(),
          facilityNames: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, visitDate, facilityNames, ...rest } = input;
          await updateFieldVisit(id, {
            ...rest,
            ...(visitDate ? { visitDate: new Date(visitDate) } : {}),
            ...(facilityNames !== undefined ? { facilitiesVisited: facilityNames.split('\n').map(n => ({ name: n.trim() })) } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteFieldVisit(input.id); return { success: true }; }),
    }),

    // Expenses page. Read-only: the Centralized sheet is where expenses are
    // entered, and the 8-hourly sheets sync replaces both tables from it, so a
    // CRM edit would be lost (server/expensesView.ts). A rep sees only their own.
    expenses: bdProcedure
      .input(z.object({
        ledger: z.enum(["fr", "bdr"]),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        rep: z.string().max(100).optional(),
        card: z.enum(["Company", "Personal"]).optional(),
        search: z.string().max(100).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const { ledger, ...filters } = input;
        const onlyRep = seesAllData(ctx.user.role) ? null : (ctx.user.agentName ?? ctx.user.name ?? "__none__");
        return getExpensesView(ledger, filters, onlyRep);
      }),

    // FR expenses as Filevine has them, beside the sheet's (server/filevineExpenses.ts).
    // Managers only: it spans every rep.
    filevineExpenses: router({
      compare: bdProcedure
        .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
        .query(({ ctx, input }) => { mgrOnly(ctx); return getFilevineComparison(input); }),
      import: bdProcedure
        .input(z.object({
          rows: z.array(z.object({
            itemId: z.string().min(1).max(64), projectId: z.number().int(), rep: z.string().min(1).max(120),
            day: z.string().max(10).nullable(), entered: z.string().max(10).nullable(),
            type: z.string().max(255).nullable(), store: z.string().max(255).nullable(), amount: z.number(),
            payment: z.string().max(60).nullable(), requestedBy: z.string().max(120).nullable(), enteredBy: z.string().max(120).nullable(),
          })).max(10000),
        }))
        .mutation(({ ctx, input }) => { mgrOnly(ctx); return importFilevineExpenses(input.rows); }),
    }),

    frExpenses: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          year: z.string().optional(),
          status: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllFrExpenses(scopeAgentFilter(ctx, input))),
    }),

    bdrExpenses: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          month: z.string().optional(),
          year: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllBdrExpenses(scopeAgentFilter(ctx, input))),
    }),

    referralRewards: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          year: z.string().optional(),
          status: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllReferralRewards(scopeAgentFilter(ctx, input))),
      create: bdProcedure
        .input(z.object({
          agentName: z.string().min(1),
          sudName: z.string().optional(),
          referralType: z.enum(["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"]).optional(),
          facilityName: z.string().optional(),
          clientName: z.string().optional(),
          tier: z.enum(["Medium", "High", "Rank X", "Standard"]).optional(),
          payoutAmount: z.string().optional(),
          status: z.enum(["Accepted", "Pending", "Denied"]).optional(),
          caseNumber: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createReferralReward({
            agentName: input.agentName,
            sud: input.sudName,
            referralType: input.referralType ?? "Other",
            facilityName: input.facilityName,
            clientName: input.clientName,
            clientTier: input.tier ?? "Standard",
            payoutAmount: input.payoutAmount,
            status: input.status ?? "Pending",
            caseNumber: input.caseNumber,
            notes: input.notes,
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          agentName: z.string().optional(),
          sudName: z.string().optional(),
          referralType: z.enum(["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"]).optional(),
          facilityName: z.string().optional(),
          clientName: z.string().optional(),
          tier: z.enum(["Medium", "High", "Rank X", "Standard"]).optional(),
          payoutAmount: z.string().optional(),
          status: z.enum(["Accepted", "Pending", "Denied"]).optional(),
          caseNumber: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, sudName, referralType, tier, payoutAmount, ...rest } = input;
          await updateReferralReward(id, {
            ...rest,
            ...(sudName !== undefined ? { sud: sudName } : {}),
            ...(referralType !== undefined ? { referralType } : {}),
            ...(tier !== undefined ? { clientTier: tier } : {}),
            ...(payoutAmount !== undefined ? { payoutAmount } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteReferralReward(input.id); return { success: true }; }),
    }),

    frErrands: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          year: z.string().optional(),
          status: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllFrErrands(scopeAgentFilter(ctx, input))),
      create: bdProcedure
        .input(z.object({
          errandDate: z.string(),
          clientName: z.string().optional(),
          tier: z.enum(["Medium", "High", "Rank X", "Standard"]).optional(),
          taskType: z.string().optional(),
          agentName: z.string().optional(),
          status: z.enum(["Completed", "Not Completed", "In Progress"]).optional(),
          notes: z.string().optional(),
          address: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createFrErrand({
            errandDate: new Date(input.errandDate),
            clientName: input.clientName ?? "",
            clientTier: input.tier ?? "Standard",
            taskType: input.taskType ?? "",
            agentName: input.agentName,
            status: input.status ?? "In Progress",
            notes: input.notes,
            address: input.address,
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          errandDate: z.string().optional(),
          clientName: z.string().optional(),
          tier: z.enum(["Medium", "High", "Rank X", "Standard"]).optional(),
          taskType: z.string().optional(),
          agentName: z.string().optional(),
          status: z.enum(["Completed", "Not Completed", "In Progress"]).optional(),
          notes: z.string().optional(),
          address: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, errandDate, tier, ...rest } = input;
          await updateFrErrand(id, {
            ...rest,
            ...(errandDate ? { errandDate: new Date(errandDate) } : {}),
            ...(tier !== undefined ? { clientTier: tier } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteFrErrand(input.id); return { success: true }; }),
    }),

    referralTracker: router({
      list: bdProcedure
        .input(z.object({
          agent: z.string().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
          month: z.string().optional(),
          year: z.string().optional(),
          status: z.string().optional(),
          search: z.string().optional(),
        }).optional())
        .query(async ({ ctx, input }) => getAllReferralTracker(scopeAgentFilter(ctx, input))),
      // The client and facility come only from the pickers: the ids are sent and
      // the names read back here, so a row always names a real lead and facility.
      create: bdProcedure
        .input(z.object({
          referralDate: referralDay,
          leadId: z.number().int(),
          facilityId: z.number().int(),
          pdCoordinator: z.string().max(255).optional(),
          facilityType: z.string().max(100).optional(),
          bdrAgent: z.string().max(255).optional(),
          status: z.enum(REFERRAL_STATUSES).optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          const [clientName, facilityName] = await Promise.all([getLeadName(input.leadId), getFacilityName(input.facilityId)]);
          if (!clientName) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the client from the lead suggestions." });
          if (!facilityName) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the facility from the suggestions." });
          await createReferralTracker({
            ...referralDateFields(input.referralDate),
            leadId: input.leadId,
            clientName,
            pdCoordinator: input.pdCoordinator,
            facilityId: input.facilityId,
            facilityName,
            facilityType: input.facilityType,
            bdrAssigned: input.bdrAgent,
            status: input.status ?? "Pending",
            notes: input.notes,
          });
          return { success: true };
        }),
      // Sheet-era rows have no lead and maybe no facility id; they can still be
      // edited without re-picking them, so the ids are optional here.
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          referralDate: referralDay.optional(),
          leadId: z.number().int().optional(),
          facilityId: z.number().int().optional(),
          pdCoordinator: z.string().max(255).optional(),
          facilityType: z.string().max(100).optional(),
          bdrAgent: z.string().max(255).optional(),
          status: z.enum(REFERRAL_STATUSES).optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, referralDate, leadId, facilityId, bdrAgent, ...rest } = input;
          const clientName = leadId !== undefined ? await getLeadName(leadId) : undefined;
          if (clientName === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the client from the lead suggestions." });
          const facilityName = facilityId !== undefined ? await getFacilityName(facilityId) : undefined;
          if (facilityName === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the facility from the suggestions." });
          await updateReferralTracker(id, {
            ...rest,
            ...(referralDate ? referralDateFields(referralDate) : {}),
            ...(clientName !== undefined ? { leadId, clientName } : {}),
            ...(facilityName !== undefined ? { facilityId, facilityName } : {}),
            ...(bdrAgent !== undefined ? { bdrAssigned: bdrAgent } : {}),
          });
          return { success: true };
        }),
      // Suggestions for the entry form's pickers: names and a hint to tell them
      // apart, nothing more (no contact details or case facts).
      searchLeads: bdProcedure
        .input(z.object({ q: z.string().trim().min(2).max(100) }))
        .query(async ({ input }) => (await searchLeadsByName(input.q, 10)).map((l) => ({
          id: l.id,
          name: l.name,
          subtitle: [l.caseType?.trim(), l.leadDate ? formatInTimeZone(l.leadDate, "America/Los_Angeles", "MMM d, yyyy") : null].filter(Boolean).join(" · "),
        }))),
      searchFacilities: bdProcedure
        .input(z.object({ q: z.string().trim().min(2).max(100) }))
        .query(async ({ input }) => searchFacilitiesByName(input.q, 10)),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteReferralTracker(input.id); return { success: true }; }),
    }),
  }),

  savedSearches: router({
    list: bdProcedure.query(async ({ ctx }) => {
      return getSavedSearches(ctx.user.id);
    }),

    save: bdProcedure
      .input(
        z.object({
          name: z.string().min(1),
          category: z.string(),
          location: z.string(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          radiusMiles: z.number().default(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await insertSavedSearch({
          userId: ctx.user.id,
          name: input.name,
          category: input.category,
          location: input.location,
          source: "google",
          radiusMiles: input.radiusMiles,
          lat: input.lat,
          lng: input.lng,
        });
        return { success: true };
      }),

    delete: bdProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSavedSearch(ctx.user.id, input.id);
        return { success: true };
      }),
  }),

  referralWorkflow: router({
    // Outbound referrals (leads sent to facilities)
    outbound: router({
      list: bdProcedure.query(async () => getAllOutboundReferrals()),
      create: bdProcedure
        .input(z.object({
          clientName: z.string().min(1),
          filevineLinkOrRef: z.string().optional(),
          clientAddress: z.string().optional(),
          clientCity: z.string().optional(),
          clientZip: z.string().optional(),
          dateSigned: z.string().optional(),
          referralNeeded: z.boolean().optional(),
          referralType: z.string().optional(),
          assignedAgent: z.string().optional(),
          recommendedFacility: z.string().optional(),
          facilityOwner: z.string().optional(),
          distanceTravelTime: z.string().optional(),
          reasonForSelection: z.string().optional(),
          referralSentDate: z.string().optional(),
          status: z.enum([
            "Pending Review", "Assigned to Agent", "Facility Selected",
            "Referral Sent", "Facility Confirmed", "Client Scheduled",
            "Client Attended", "Issue / Needs Follow-Up", "Completed", "Not Referred",
          ]).optional(),
          followUpDate: z.string().optional(),
          facilityConfirmed: z.boolean().optional(),
          clientScheduled: z.boolean().optional(),
          clientAttended: z.boolean().optional(),
          facilityHadSentLeads: z.boolean().optional(),
          notes: z.string().optional(),
          lastUpdatedBy: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          const { dateSigned, referralSentDate, followUpDate, ...rest } = input;
          await createOutboundReferral({
            ...rest,
            ...(dateSigned ? { dateSigned: new Date(dateSigned) } : {}),
            ...(referralSentDate ? { referralSentDate: new Date(referralSentDate) } : {}),
            ...(followUpDate ? { followUpDate: new Date(followUpDate) } : {}),
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          clientName: z.string().optional(),
          filevineLinkOrRef: z.string().optional(),
          clientAddress: z.string().optional(),
          clientCity: z.string().optional(),
          clientZip: z.string().optional(),
          dateSigned: z.string().optional(),
          referralNeeded: z.boolean().optional(),
          referralType: z.string().optional(),
          assignedAgent: z.string().optional(),
          recommendedFacility: z.string().optional(),
          facilityOwner: z.string().optional(),
          distanceTravelTime: z.string().optional(),
          reasonForSelection: z.string().optional(),
          referralSentDate: z.string().optional(),
          status: z.enum([
            "Pending Review", "Assigned to Agent", "Facility Selected",
            "Referral Sent", "Facility Confirmed", "Client Scheduled",
            "Client Attended", "Issue / Needs Follow-Up", "Completed", "Not Referred",
          ]).optional(),
          followUpDate: z.string().optional(),
          facilityConfirmed: z.boolean().optional(),
          clientScheduled: z.boolean().optional(),
          clientAttended: z.boolean().optional(),
          facilityHadSentLeads: z.boolean().optional(),
          notes: z.string().optional(),
          lastUpdatedBy: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, dateSigned, referralSentDate, followUpDate, ...rest } = input;
          await updateOutboundReferral(id, {
            ...rest,
            ...(dateSigned ? { dateSigned: new Date(dateSigned) } : {}),
            ...(referralSentDate ? { referralSentDate: new Date(referralSentDate) } : {}),
            ...(followUpDate ? { followUpDate: new Date(followUpDate) } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteOutboundReferral(input.id); return { success: true }; }),
    }),

    // Inbound leads (received from facilities)
    inbound: router({
      list: bdProcedure.query(async () => getAllInboundLeads()),
      create: bdProcedure
        .input(z.object({
          leadName: z.string().min(1),
          dateReceived: z.string().optional(),
          referringFacility: z.string().optional(),
          facilityContact: z.string().optional(),
          assignedAgent: z.string().optional(),
          caseType: z.string().optional(),
          signed: z.boolean().optional(),
          signedDate: z.string().optional(),
          notSignedReason: z.string().optional(),
          countsTowardPartnerActivity: z.boolean().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          const { dateReceived, signedDate, ...rest } = input;
          await createInboundLead({
            ...rest,
            ...(dateReceived ? { dateReceived: new Date(dateReceived) } : {}),
            ...(signedDate ? { signedDate: new Date(signedDate) } : {}),
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          leadName: z.string().optional(),
          dateReceived: z.string().optional(),
          referringFacility: z.string().optional(),
          facilityContact: z.string().optional(),
          assignedAgent: z.string().optional(),
          caseType: z.string().optional(),
          signed: z.boolean().optional(),
          signedDate: z.string().optional(),
          notSignedReason: z.string().optional(),
          countsTowardPartnerActivity: z.boolean().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, dateReceived, signedDate, ...rest } = input;
          await updateInboundLead(id, {
            ...rest,
            ...(dateReceived ? { dateReceived: new Date(dateReceived) } : {}),
            ...(signedDate ? { signedDate: new Date(signedDate) } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteInboundLead(input.id); return { success: true }; }),
    }),

    // Reporting aggregates
    stats: bdProcedure.query(async () => getReferralStats()),
    // Partner Referrals Report: sent / received / signed for the dates picked.
    // Agents get only their own referrals; managers everyone's (or one rep's).
    report: bdProcedure
      .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rep: z.string().max(120).optional() }))
      .query(async ({ ctx, input }) => {
        const range = { from: laDate(`${input.from}T00:00:00`), to: laEnd(input.to) };
        if (!seesAllData(ctx.user.role)) return getPartnerReferralsReport(range, ownerNameCandidates(ctx.user));
        return getPartnerReferralsReport(range, input.rep ? [input.rep] : null);
      }),
  }),
});

export type AppRouter = typeof appRouter;

