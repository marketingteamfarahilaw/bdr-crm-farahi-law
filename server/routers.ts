import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
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
} from "./db";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  leads: router({
    search: protectedProcedure
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
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSavedLeads(ctx.user.id);
    }),

    save: protectedProcedure
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

    unsave: protectedProcedure
      .input(z.object({ placeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSavedLead(ctx.user.id, input.placeId);
        return { success: true };
      }),

    annotate: protectedProcedure
      .input(z.object({ placeId: z.string(), annotation: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await updateSavedLeadAnnotation(ctx.user.id, input.placeId, input.annotation);
        return { success: true };
      }),

    isSaved: protectedProcedure
      .input(z.object({ placeId: z.string() }))
      .query(async ({ ctx, input }) => {
        const lead = await getSavedLeadByPlaceId(ctx.user.id, input.placeId);
        return { saved: !!lead };
      }),
  }),

  agentZones: router({
    list: protectedProcedure.query(async () => {
      return getAllAgentZones();
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getAgentById(input.id);
      }),
    create: protectedProcedure
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
      .mutation(async ({ input }) => {
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
    update: protectedProcedure
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
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateAgent(id, data);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteAgent(input.id);
        return { success: true };
      }),
    upsert: protectedProcedure
      .input(z.object({
        agentName: z.string(),
        color: z.string(),
        cities: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        await upsertAgentZone(input.agentName, input.color, input.cities);
        return { success: true };
      }),
    assignLead: protectedProcedure
      .input(z.object({
        placeId: z.string(),
        assignedAgent: z.string().nullable(),
      }))
      .mutation(async ({ input }) => {
        await updateSavedLeadAgent(input.placeId, input.assignedAgent);
        return { success: true };
      }),
  }),

  piClients: router({
    list: protectedProcedure.query(async () => {
      return getAllPiClients();
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getPiClientById(input.id);
      }),
    create: protectedProcedure
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
    update: protectedProcedure
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
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updatePiClient(id, {
          ...data,
          incidentDate: data.incidentDate ? new Date(data.incidentDate) : undefined,
        });
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePiClient(input.id);
        return { success: true };
      }),
    logCall: protectedProcedure
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
    getCallLogs: protectedProcedure
      .input(z.object({ piClientId: z.number() }))
      .query(async ({ input }) => {
        return getPiClientCallLogs(input.piClientId);
      }),
    findByPhone: protectedProcedure
      .input(z.object({ phone: z.string() }))
      .query(async ({ input }) => {
        return findPiClientByPhone(input.phone) ?? null;
      }),
    logCallByPhone: protectedProcedure
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
    transcribeAndLog: protectedProcedure
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
    getSettings: protectedProcedure.query(async ({ ctx }) => {
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
    saveSettings: protectedProcedure
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
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      await upsertFilevineSettings({
        userId: ctx.user.id,
        apiKey: '',
        apiSecret: '',
        connected: false,
      });
      return { success: true };
    }),
  }),

  crm: crmRouter,

  savedSearches: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSavedSearches(ctx.user.id);
    }),

    save: protectedProcedure
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

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSavedSearch(ctx.user.id, input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
