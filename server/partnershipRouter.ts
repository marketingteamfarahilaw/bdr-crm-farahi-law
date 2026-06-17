/**
 * FR/BDR Dual Partnership Model — tRPC router.
 * Pods, shared quota, the coordinated loop board, scheduled visits + briefings,
 * the QA Coach desk, partnership health, the bonus pool, leadership reporting,
 * partner visit requests, and the pod coordination feed.
 *
 * Scoping: managers/super-admin see all pods; agents see only the pod they
 * belong to (matched by their agentName). Pod management, the QA desk, and the
 * leadership rollup are manager-only.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { canManage, isIntakeOnly } from "@shared/permissions";
import {
  listPods, getPod, getPodForAgent, createPod, updatePod, deletePod,
  listAppointments, createAppointment, updateAppointment,
  listQaReviews, createQaReview, recentCallsForReview,
  getLoopBoard, setLoopStage, setVisitRequested, listVisitRequests,
  getQuotaSummary, getPodHealth, getLeadershipSummary, getPodFeed,
} from "./partnershipDb";

const partnershipProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  }
  return next();
});
const managerProcedure = partnershipProcedure.use(({ ctx, next }) => {
  if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers / QA Coach only." });
  return next();
});

const myAgentNames = (ctx: any): string[] =>
  [ctx.user.agentName, ctx.user.name].filter((x: any): x is string => !!x && !!String(x).trim());

export const partnershipRouter = router({
  // ── Pods ──
  pods: router({
    list: partnershipProcedure.query(() => listPods()),
    mine: partnershipProcedure.query(({ ctx }) =>
      canManage(ctx.user.role) ? null : getPodForAgent(ctx.user.agentName ?? ctx.user.name)
    ),
    create: managerProcedure
      .input(z.object({
        name: z.string().min(1), region: z.string().optional(),
        frName: z.string().optional(), bdrName: z.string().optional(), qaCoachName: z.string().optional(),
        monthlyTarget: z.number().int().min(0).default(12),
        notes: z.string().optional(),
      }))
      .mutation(({ input }) => createPod(input as any)),
    update: managerProcedure
      .input(z.object({
        id: z.number(), name: z.string().optional(), region: z.string().optional(),
        frName: z.string().optional(), bdrName: z.string().optional(), qaCoachName: z.string().optional(),
        monthlyTarget: z.number().int().min(0).optional(),
        active: z.number().int().optional(), notes: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const { id, ...rest } = input;
        return updatePod(id, rest as any);
      }),
    delete: managerProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => deletePod(input.id)),
  }),

  // ── Shared quota + bonus pool ──
  quota: partnershipProcedure
    .input(z.object({ month: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const summary = await getQuotaSummary(input?.month);
      if (canManage(ctx.user.role)) return summary;
      const mine = await getPodForAgent(ctx.user.agentName ?? ctx.user.name);
      return { ...summary, pods: summary.pods.filter((p) => p.podId === mine?.id) };
    }),

  // ── Coordinated loop board ──
  loop: router({
    board: partnershipProcedure.query(({ ctx }) =>
      getLoopBoard(canManage(ctx.user.role) ? { all: true } : { agentNames: myAgentNames(ctx) })
    ),
    setStage: partnershipProcedure
      .input(z.object({ facilityId: z.number(), stage: z.enum(["research", "first_contact", "appointment_set", "visited", "post_visit", "nurture"]) }))
      .mutation(({ input }) => setLoopStage(input.facilityId, input.stage)),
  }),

  // ── Visits + briefings ──
  visits: router({
    list: partnershipProcedure
      .input(z.object({ podId: z.number().optional(), upcomingOnly: z.boolean().optional() }).optional())
      .query(({ ctx, input }) =>
        listAppointments({
          podId: input?.podId,
          upcomingOnly: input?.upcomingOnly,
          frNames: canManage(ctx.user.role) ? undefined : myAgentNames(ctx),
        })
      ),
    create: partnershipProcedure
      .input(z.object({
        podId: z.number().optional(), facilityId: z.number().optional(), facilityName: z.string().optional(),
        scheduledFor: z.string(), type: z.enum(["visit", "lunch", "drop_in", "meeting", "other"]).default("visit"),
        frName: z.string().optional(), bdrName: z.string().optional(), briefing: z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        createAppointment({
          ...input, scheduledFor: new Date(input.scheduledFor),
          bdrName: input.bdrName ?? ctx.user.agentName ?? ctx.user.name ?? undefined,
          createdById: ctx.user.id, createdByName: ctx.user.name ?? ctx.user.email ?? undefined,
        } as any)
      ),
    update: partnershipProcedure
      .input(z.object({
        id: z.number(), status: z.enum(["scheduled", "attended", "no_show", "cancelled", "rescheduled"]).optional(),
        outcome: z.string().optional(), briefing: z.string().optional(), scheduledFor: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const { id, scheduledFor, ...rest } = input;
        return updateAppointment(id, { ...rest, ...(scheduledFor ? { scheduledFor: new Date(scheduledFor) } : {}) } as any);
      }),
  }),

  // ── Partner visit requests (§4) ──
  requests: router({
    list: partnershipProcedure.query(({ ctx }) =>
      listVisitRequests(canManage(ctx.user.role) ? { all: true } : { agentNames: myAgentNames(ctx) })
    ),
    set: partnershipProcedure
      .input(z.object({ facilityId: z.number(), requested: z.boolean() }))
      .mutation(({ input }) => setVisitRequested(input.facilityId, input.requested)),
  }),

  // ── QA Coach desk (manager-only) ──
  qa: router({
    recentCalls: managerProcedure
      .input(z.object({ podId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        let repNames: string[] | undefined;
        if (input?.podId) {
          const p = await getPod(input.podId);
          repNames = [p?.frName, p?.bdrName].filter((x): x is string => !!x);
        }
        return recentCallsForReview({ repNames });
      }),
    reviews: managerProcedure.input(z.object({ podId: z.number().optional() }).optional()).query(({ input }) => listQaReviews({ podId: input?.podId })),
    createReview: managerProcedure
      .input(z.object({
        podId: z.number().optional(), subjectType: z.enum(["call", "visit", "coaching"]).default("call"),
        refId: z.number().optional(), facilityId: z.number().optional(), facilityName: z.string().optional(),
        subjectName: z.string().optional(),
        score: z.number().int().min(1).max(5).optional(),
        toneScore: z.number().int().min(1).max(5).optional(),
        messagingScore: z.number().int().min(1).max(5).optional(),
        objectionScore: z.number().int().min(1).max(5).optional(),
        flag: z.enum(["none", "coaching_needed", "breakdown", "kudos"]).default("none"),
        notes: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => createQaReview({ ...input, reviewerId: ctx.user.id, reviewerName: ctx.user.name ?? ctx.user.email ?? undefined } as any)),
  }),

  // ── Health, leadership, feed ──
  health: partnershipProcedure
    .input(z.object({ podId: z.number(), month: z.string().optional() }))
    .query(({ input }) => getPodHealth(input.podId, input.month)),

  leadership: managerProcedure
    .input(z.object({ month: z.string().optional() }).optional())
    .query(({ input }) => getLeadershipSummary(input?.month)),

  feed: partnershipProcedure
    .input(z.object({ podId: z.number(), limit: z.number().optional() }))
    .query(({ input }) => getPodFeed(input.podId, input.limit ?? 60)),
});
