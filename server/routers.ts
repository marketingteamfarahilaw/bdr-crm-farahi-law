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
import { crmRouter } from "./crmRouter";
import axios from "axios";
import { transcribeAudio } from "./_core/voiceTranscription";
import { getRingcentralToken } from "./crmDb";
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
  createFrExpense,
  updateFrExpense,
  deleteFrExpense,
  getAllBdrExpenses,
  createBdrExpense,
  updateBdrExpense,
  deleteBdrExpense,
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
  getBdrAdminDashboard,
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
import { canManage, canAssignRoles, seesAllData, isIntakeOnly } from "@shared/permissions";
import { intakeRouter } from "./intakeRouter";
import { fromZonedTime } from "date-fns-tz";

/** Interpret a "YYYY-MM-DDTHH:mm:ss" report-range boundary as California
 *  (Pacific) local time, returning the matching UTC instant for DB comparison. */
const laDate = (s: string) => fromZonedTime(s, "America/Los_Angeles");
import { getAgentReport, getCallAnalytics, getReportAgents, getCallLogs, getAgentPerformanceData, generateAgentPerformanceReview } from "./reports";

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
              // 4. Transcribe the recording
              const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
              const result = await transcribeAudio({ audioUrl: authedUrl });
              if (!('error' in result)) {
                transcriptText = result.text ?? "";
              }
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

  // Intake — AI Case Desk (separate world from the BD/FR CRM; see intakeRouter)
  intake: intakeRouter,

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
        const to = laDate(input.to);
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
        const to = laDate(input.to);
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
        const to = laDate(input.to);
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
        const to = laDate(input.to);
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
        const to = laDate(input.to);
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
    adminDashboard: bdProcedure.query(async ({ ctx }) => {
      if (!canManage(ctx.user.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Managers only' });
      return getBdrAdminDashboard();
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
      create: bdProcedure
        .input(z.object({
          expenseDate: z.string(),
          agentName: z.string().min(1),
          facilityName: z.string().optional(),
          storeName: z.string().optional(),
          reason: z.string().optional(),
          amount: z.string().default("0.00"),
          cardType: z.enum(["Personal", "Company"]).default("Company"),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createFrExpense({
            expenseDate: new Date(input.expenseDate),
            agentName: input.agentName,
            facilityName: input.facilityName,
            store: input.storeName,
            reason: input.reason,
            amount: input.amount,
            cardType: input.cardType,
            notes: input.notes,
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          expenseDate: z.string().optional(),
          agentName: z.string().optional(),
          facilityName: z.string().optional(),
          storeName: z.string().optional(),
          reason: z.string().optional(),
          amount: z.string().optional(),
          cardType: z.enum(["Personal", "Company"]).optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, expenseDate, storeName, ...rest } = input;
          await updateFrExpense(id, {
            ...rest,
            ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
            ...(storeName !== undefined ? { store: storeName } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteFrExpense(input.id); return { success: true }; }),
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
      create: bdProcedure
        .input(z.object({
          expenseDate: z.string(),
          reportMonth: z.string().optional(),
          agentName: z.string().min(1),
          facilityName: z.string().optional(),
          facilityPhone: z.string().optional(),
          storeName: z.string().optional(),
          reason: z.string().optional(),
          amount: z.string().default("0.00"),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createBdrExpense({
            expenseDate: new Date(input.expenseDate),
            month: input.reportMonth,
            agentName: input.agentName,
            facilityName: input.facilityName,
            facilityPhone: input.facilityPhone,
            store: input.storeName,
            reason: input.reason,
            amount: input.amount,
            notes: input.notes,
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          expenseDate: z.string().optional(),
          reportMonth: z.string().optional(),
          agentName: z.string().optional(),
          facilityName: z.string().optional(),
          facilityPhone: z.string().optional(),
          storeName: z.string().optional(),
          reason: z.string().optional(),
          amount: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, expenseDate, reportMonth, storeName, ...rest } = input;
          await updateBdrExpense(id, {
            ...rest,
            ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
            ...(reportMonth !== undefined ? { month: reportMonth } : {}),
            ...(storeName !== undefined ? { store: storeName } : {}),
          });
          return { success: true };
        }),
      delete: bdProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => { mgrOnly(ctx); await deleteBdrExpense(input.id); return { success: true }; }),
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
      create: bdProcedure
        .input(z.object({
          reportMonth: z.string().optional(),
          clientName: z.string().optional(),
          pdCoordinator: z.string().optional(),
          partnerStatus: z.string().optional(),
          facilityName: z.string().optional(),
          bdrAgent: z.string().optional(),
          status: z.enum(["Successful Sent", "Demo Sent", "Pending", "Unsuccessful", "In Progress"]).optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          await createReferralTracker({
            month: input.reportMonth,
            clientName: input.clientName ?? "",
            pdCoordinator: input.pdCoordinator,
            partnerStatus: input.partnerStatus,
            facilityName: input.facilityName,
            bdrAssigned: input.bdrAgent,
            status: input.status ?? "Pending",
            notes: input.notes,
          });
          return { success: true };
        }),
      update: bdProcedure
        .input(z.object({
          id: z.number(),
          reportMonth: z.string().optional(),
          clientName: z.string().optional(),
          pdCoordinator: z.string().optional(),
          partnerStatus: z.string().optional(),
          facilityName: z.string().optional(),
          bdrAgent: z.string().optional(),
          status: z.enum(["Successful Sent", "Demo Sent", "Pending", "Unsuccessful", "In Progress"]).optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          mgrOnly(ctx);
          const { id, reportMonth, bdrAgent, ...rest } = input;
          await updateReferralTracker(id, {
            ...rest,
            ...(reportMonth !== undefined ? { month: reportMonth } : {}),
            ...(bdrAgent !== undefined ? { bdrAssigned: bdrAgent } : {}),
          });
          return { success: true };
        }),
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
  }),
});

export type AppRouter = typeof appRouter;

