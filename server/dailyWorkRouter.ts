/**
 * Daily Work View + Integration Health router. BD/FR only; agents see their own
 * book, managers see everything.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { canManage, isIntakeOnly } from "@shared/permissions";
import { getDb } from "./db";
import { rcUnmatchedCalls } from "../drizzle/schema";
import { getDailyWork, getIntegrationHealth } from "./dailyWorkDb";
import { listAgentsWithRcStatus, createContactLog, setUnmatchedCallStatus } from "./crmDb";

const dwProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  return next();
});
const myNames = (ctx: any): string[] => [ctx.user.agentName, ctx.user.name].filter((x: any): x is string => !!x && !!String(x).trim());
const scopeFor = (ctx: any) => (canManage(ctx.user.role) ? { all: true } : { agentNames: myNames(ctx) });

export const dailyWorkRouter = router({
  summary: dwProcedure.query(({ ctx }) => getDailyWork(scopeFor(ctx))),

  integrations: dwProcedure.query(async () => {
    const agents = await listAgentsWithRcStatus();
    return getIntegrationHealth(agents as any);
  }),

  // Assign an unmatched RingCentral call to a facility → logs it as a contact.
  assignCall: dwProcedure
    .input(z.object({ id: z.number(), facilityId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select().from(rcUnmatchedCalls).where(eq(rcUnmatchedCalls.id, input.id)).limit(1);
      const call = rows[0];
      if (!call) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found" });
      const dur = call.durationSeconds ?? 0;
      const result = (call.callResult || "").toLowerCase();
      const callResult = result.includes("connect") || result.includes("accept") ? "connected" : result.includes("voicemail") ? "voicemail" : result.includes("answer") || result.includes("miss") ? "no_answer" : "other";
      await createContactLog({
        facilityId: input.facilityId, contactType: "call", contactDate: call.startTime ?? new Date(),
        callResult: callResult as any, callDuration: `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}`,
        callType: "partner_checkin",
        summary: `[Assigned from unmatched] ${call.direction ?? ""} call — ${call.fromNumber ?? "?"} → ${call.toNumber ?? "?"}`,
        repId: ctx.user.id, repName: call.agentName ?? ctx.user.name ?? ctx.user.email ?? undefined,
        direction: call.direction ?? undefined, fromRingCentral: 1, rcCallId: call.rcCallId, rcSessionId: call.rcSessionId ?? undefined,
      } as any);
      await setUnmatchedCallStatus(input.id, "assigned");
      return { success: true };
    }),

  dismissCall: dwProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => setUnmatchedCallStatus(input.id, "dismissed")),
});
