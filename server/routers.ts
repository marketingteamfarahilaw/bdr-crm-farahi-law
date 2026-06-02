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

  bdr: router({
    dashboardKpis: protectedProcedure.query(async () => getAgentDashboardKpis()),

    fieldVisits: router({
      list: protectedProcedure.query(async () => getAllFieldVisits()),
      create: protectedProcedure
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
      update: protectedProcedure
        .input(z.object({
          id: z.number(),
          visitDate: z.string().optional(),
          agentName: z.string().optional(),
          facilityCount: z.number().int().optional(),
          hoursWorked: z.string().optional(),
          facilityNames: z.string().optional(),
          notes: z.string().optional(),
        }))
        .mutation(async ({ input }) => {
          const { id, visitDate, facilityNames, ...rest } = input;
          await updateFieldVisit(id, {
            ...rest,
            ...(visitDate ? { visitDate: new Date(visitDate) } : {}),
            ...(facilityNames !== undefined ? { facilitiesVisited: facilityNames.split('\n').map(n => ({ name: n.trim() })) } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteFieldVisit(input.id); return { success: true }; }),
    }),

    frExpenses: router({
      list: protectedProcedure.query(async () => getAllFrExpenses()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, expenseDate, storeName, ...rest } = input;
          await updateFrExpense(id, {
            ...rest,
            ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
            ...(storeName !== undefined ? { store: storeName } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteFrExpense(input.id); return { success: true }; }),
    }),

    bdrExpenses: router({
      list: protectedProcedure.query(async () => getAllBdrExpenses()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, expenseDate, reportMonth, storeName, ...rest } = input;
          await updateBdrExpense(id, {
            ...rest,
            ...(expenseDate ? { expenseDate: new Date(expenseDate) } : {}),
            ...(reportMonth !== undefined ? { month: reportMonth } : {}),
            ...(storeName !== undefined ? { store: storeName } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteBdrExpense(input.id); return { success: true }; }),
    }),

    referralRewards: router({
      list: protectedProcedure.query(async () => getAllReferralRewards()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
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
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteReferralReward(input.id); return { success: true }; }),
    }),

    frErrands: router({
      list: protectedProcedure.query(async () => getAllFrErrands()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, errandDate, tier, ...rest } = input;
          await updateFrErrand(id, {
            ...rest,
            ...(errandDate ? { errandDate: new Date(errandDate) } : {}),
            ...(tier !== undefined ? { clientTier: tier } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteFrErrand(input.id); return { success: true }; }),
    }),

    referralTracker: router({
      list: protectedProcedure.query(async () => getAllReferralTracker()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, reportMonth, bdrAgent, ...rest } = input;
          await updateReferralTracker(id, {
            ...rest,
            ...(reportMonth !== undefined ? { month: reportMonth } : {}),
            ...(bdrAgent !== undefined ? { bdrAssigned: bdrAgent } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteReferralTracker(input.id); return { success: true }; }),
    }),
  }),

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

  referralWorkflow: router({
    // Outbound referrals (leads sent to facilities)
    outbound: router({
      list: protectedProcedure.query(async () => getAllOutboundReferrals()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, dateSigned, referralSentDate, followUpDate, ...rest } = input;
          await updateOutboundReferral(id, {
            ...rest,
            ...(dateSigned ? { dateSigned: new Date(dateSigned) } : {}),
            ...(referralSentDate ? { referralSentDate: new Date(referralSentDate) } : {}),
            ...(followUpDate ? { followUpDate: new Date(followUpDate) } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteOutboundReferral(input.id); return { success: true }; }),
    }),

    // Inbound leads (received from facilities)
    inbound: router({
      list: protectedProcedure.query(async () => getAllInboundLeads()),
      create: protectedProcedure
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
      update: protectedProcedure
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
        .mutation(async ({ input }) => {
          const { id, dateReceived, signedDate, ...rest } = input;
          await updateInboundLead(id, {
            ...rest,
            ...(dateReceived ? { dateReceived: new Date(dateReceived) } : {}),
            ...(signedDate ? { signedDate: new Date(signedDate) } : {}),
          });
          return { success: true };
        }),
      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input }) => { await deleteInboundLead(input.id); return { success: true }; }),
    }),

    // Reporting aggregates
    stats: protectedProcedure.query(async () => getReferralStats()),
  }),
});

export type AppRouter = typeof appRouter;

