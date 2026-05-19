import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { searchGooglePlaces } from "./googleMaps";
import { calculateScore } from "./scoring";
import { crmRouter } from "./crmRouter";
import {
  getSavedLeads,
  getSavedLeadByPlaceId,
  insertSavedLead,
  deleteSavedLead,
  updateSavedLeadAnnotation,
  updateSavedLeadAgent,
  getAllAgentZones,
  upsertAgentZone,
  getSavedSearches,
  insertSavedSearch,
  deleteSavedSearch,
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
          });
          return {
            ...place,
            email: null as string | null,
            qualificationScore: breakdown.total,
            scoreTier: breakdown.tier,
            scoreBreakdown: breakdown,
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
