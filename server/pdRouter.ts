/**
 * PD Car Referral Tracker (body-shop pipeline) router. BD/FR only.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { isIntakeOnly } from "@shared/permissions";
import { listPdReferrals, createPdReferral, updatePdReferral, deletePdReferral, bulkImportPd, getPdDashboard, listBodyShops } from "./pdDb";

const pdProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  return next();
});

const STATUS = ["new_case", "waiting_liability", "waiting_dec_page", "waiting_pl", "team_working", "bdr_shop", "pl_shop", "refer_by_fbs", "total_loss", "cant_refer", "check", "drop_case"] as const;

export const pdRouter = router({
  list: pdProcedure
    .input(z.object({ status: z.enum(STATUS).optional(), search: z.string().optional(), driverOnly: z.boolean().optional() }).optional())
    .query(({ input }) => listPdReferrals(input ?? {})),

  dashboard: pdProcedure.query(() => getPdDashboard()),
  bodyShops: pdProcedure.query(() => listBodyShops()),

  create: pdProcedure
    .input(z.object({
      clientName: z.string().optional(), caseNumber: z.string().optional(), filevineProjectId: z.string().optional(),
      caseType: z.string().optional(), isDriver: z.number().int().optional(), vehicleInfo: z.string().optional(),
      facilityId: z.number().optional(), facilityName: z.string().optional(),
      status: z.enum(STATUS).optional(), assignedRepName: z.string().optional(), notes: z.string().optional(),
    }))
    .mutation(({ input }) => createPdReferral(input as any)),

  update: pdProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(STATUS).optional(), facilityId: z.number().nullable().optional(), facilityName: z.string().nullable().optional(),
      assignedRepName: z.string().optional(), notes: z.string().optional(), vehicleInfo: z.string().optional(),
      dateReferred: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, dateReferred, ...rest } = input;
      return updatePdReferral(id, { ...rest, ...(dateReferred ? { dateReferred: new Date(dateReferred) } : {}) } as any);
    }),

  delete: pdProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => deletePdReferral(input.id)),

  bulkImport: pdProcedure
    .input(z.object({
      batch: z.string(),
      rows: z.array(z.object({
        clientName: z.string().optional(), caseNumber: z.string().optional(), filevineProjectId: z.string().optional(),
        caseType: z.string().optional(), isDriver: z.number().int().optional(), vehicleInfo: z.string().optional(),
        status: z.enum(STATUS).optional(), assignedRepName: z.string().optional(), notes: z.string().optional(),
      })).max(5000),
    }))
    .mutation(({ input }) => bulkImportPd(input.rows as any, input.batch)),
});
