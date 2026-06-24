/**
 * Daily Activity Log router. Read-only day rollups (by person + by facility),
 * an archive date list, and an on-demand AI narrative that turns a person's day
 * into plain-English bullets + carry-over — the format leadership can read.
 * Scoped: agents see their own activity; managers/super-admin see everyone.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { canManage, isIntakeOnly } from "@shared/permissions";
import { invokeLLM } from "./_core/llm";
import { getDailyLog, getActiveDates, todayLA } from "./dailyLogDb";

const dailyProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  return next();
});
const myNames = (ctx: any): string[] => [ctx.user.agentName, ctx.user.name].filter((x: any): x is string => !!x && !!String(x).trim());
const scopeFor = (ctx: any, agent?: string) => {
  if (canManage(ctx.user.role)) return agent ? { agentNames: [agent] } : { all: true };
  return { agentNames: myNames(ctx) };
};

export const dailyLogRouter = router({
  dates: dailyProcedure
    .input(z.object({ agent: z.string().optional() }).optional())
    .query(({ ctx, input }) => getActiveDates(scopeFor(ctx, input?.agent))),

  day: dailyProcedure
    .input(z.object({ date: z.string().optional(), agent: z.string().optional() }).optional())
    .query(({ ctx, input }) => getDailyLog(input?.date || todayLA(), scopeFor(ctx, input?.agent))),

  // On-demand AI narrative for one person's day (the bullet-point report style).
  narrative: dailyProcedure
    .input(z.object({ date: z.string(), person: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const log = await getDailyLog(input.date, canManage(ctx.user.role) ? { agentNames: [input.person] } : { agentNames: myNames(ctx) });
      const p = log.byPerson.find((x: any) => x.person === input.person);
      if (!p || !p.events.length) return { bullets: [], pending: [] };
      const lines = p.events.map((e: any) => `- [${e.kind}] ${e.facilityName ? e.facilityName + ": " : ""}${e.detail}`).join("\n");
      try {
        const resp = await invokeLLM({
          messages: [
            { role: "system", content: `You write a concise end-of-day activity recap for a law-firm business-development rep, for leadership. Turn the raw activity log into clean, specific past-tense bullets (one per meaningful action; merge trivial duplicates). Then list any pending/carry-over follow-ups. Be factual — only use what's in the log. Return JSON: {"bullets": string[], "pending": string[]}.` },
            { role: "user", content: `Rep: ${input.person}\nDate: ${input.date}\nOpen follow-ups still pending: ${p.pendingFollowUps}\n\nActivity log:\n${lines}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "daily_recap", strict: true, schema: { type: "object", properties: { bullets: { type: "array", items: { type: "string" } }, pending: { type: "array", items: { type: "string" } } }, required: ["bullets", "pending"], additionalProperties: false } },
          },
        });
        const parsed = JSON.parse(resp.choices[0]?.message?.content as string);
        return { bullets: parsed.bullets ?? [], pending: parsed.pending ?? [] };
      } catch {
        // LLM unavailable — fall back to the raw bullets
        return { bullets: p.events.map((e: any) => `${e.facilityName ? e.facilityName + " — " : ""}${e.detail}`), pending: [] };
      }
    }),
});
