/**
 * Territories — the admin surface behind the free-text `facilities.territory`
 * field.
 *
 * Two things live here:
 *
 *  1. OWNERSHIP. A territory belongs to a team member. Ownership is stored in
 *     the EXISTING `agent_zones` table (agentName + cities[] + colour), which
 *     already drives the California map — so assigning a territory here also
 *     colours it on the map, and drawing a zone on the map shows up here. One
 *     source of truth, two ways to edit it.
 *
 *  2. CLEANUP. Free text drifts: "LA" and "Los Angeles" become separate
 *     territories, and facilities with no city never get one at all. Rename,
 *     merge, clear and autofill keep the list honest.
 *
 * Every mutation is managers-only — a rename here rewrites every matching
 * facility, and assignment changes who owns a book of business.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, or, isNull, inArray, sql } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { canManage, isIntakeOnly } from "@shared/permissions";
import { getDb } from "./db";
import { facilities, agentZones } from "../drizzle/schema";

const crmProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (isIntakeOnly(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This area is for the BD/FR team." });
  }
  return next();
});

const managerOnly = crmProcedure.use(({ ctx, next }) => {
  if (!canManage(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Managers only." });
  return next();
});

const db_ = async () => {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database unavailable." });
  return db;
};

/** Rows written by drizzle report affectedRows in one of two shapes. */
const affected = (res: any) => Number(res?.[0]?.affectedRows ?? res?.affectedRows ?? 0);

const cityList = (zone: { cities: unknown }): string[] => {
  const raw = zone.cities;
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
};

const norm = (s: string) => s.trim().toLowerCase();

export const territoriesRouter = router({
  /**
   * The main list: every territory, how many facilities it holds, and who owns
   * it. Also reports the unassigned backlog so the page can offer to fix it.
   */
  list: crmProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { territories: [], unassigned: 0, assignable: { byCity: 0, byZip: 0 }, owners: [] };

    const grouped = await db
      .select({ territory: facilities.territory, n: sql<number>`COUNT(*)` })
      .from(facilities)
      .groupBy(facilities.territory);

    const zones = await db.select().from(agentZones);
    // territory (lowercased) → owner
    const ownerOf = new Map<string, { agentName: string; color: string; active: boolean }>();
    for (const z of zones) {
      for (const city of cityList(z)) {
        ownerOf.set(norm(city), { agentName: z.agentName, color: z.color, active: !!z.active });
      }
    }

    const territories = grouped
      .filter((r) => !!r.territory && !!r.territory.trim())
      .map((r) => {
        const name = r.territory as string;
        const owner = ownerOf.get(norm(name)) ?? null;
        return {
          name,
          facilities: Number(r.n ?? 0),
          owner: owner?.agentName ?? null,
          ownerColor: owner?.color ?? null,
          ownerActive: owner?.active ?? null,
        };
      })
      .sort((a, b) => b.facilities - a.facilities || a.name.localeCompare(b.name));

    const blank = await db
      .select({ city: facilities.city, zipCode: facilities.zipCode })
      .from(facilities)
      .where(or(isNull(facilities.territory), eq(facilities.territory, "")));
    const byCity = blank.filter((f) => !!f.city && !!f.city.trim()).length;
    const byZip = blank.filter((f) => (!f.city || !f.city.trim()) && !!f.zipCode && !!f.zipCode.trim()).length;

    const owners = zones
      .map((z) => ({ agentName: z.agentName, color: z.color, active: !!z.active, territories: cityList(z).length }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));

    return { territories, unassigned: blank.length, assignable: { byCity, byZip }, owners };
  }),

  /** Facilities inside one territory — the drill-down behind a row. */
  facilities: crmProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: facilities.id, name: facilities.name, category: facilities.category,
          city: facilities.city, zipCode: facilities.zipCode,
          assignedRepName: facilities.assignedRepName, managedBy: facilities.managedBy,
        })
        .from(facilities)
        .where(eq(facilities.territory, input.name))
        .orderBy(facilities.name);
    }),

  /** Facilities with no territory, showing the city/ZIP one could come from. */
  unassigned: crmProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        id: facilities.id, name: facilities.name, city: facilities.city,
        zipCode: facilities.zipCode, assignedRepName: facilities.assignedRepName,
      })
      .from(facilities)
      .where(or(isNull(facilities.territory), eq(facilities.territory, "")))
      .orderBy(facilities.name);
  }),

  /**
   * Give a territory to a team member (or pass null to leave it unowned).
   * Writes to agent_zones so the California map stays in step. Optionally
   * reassigns the territory's facilities to that person as well — ownership of
   * an area and ownership of its partners are usually the same decision, but
   * not always, so it is a flag rather than a side effect.
   */
  setOwner: managerOnly
    .input(z.object({
      territory: z.string().min(1),
      agentName: z.string().min(1).nullable(),
      reassignFacilities: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const territory = input.territory.trim();
      const zones = await db.select().from(agentZones);

      // Drop the territory from whoever holds it now (a territory has one owner).
      for (const z of zones) {
        const cities = cityList(z);
        if (!cities.some((c) => norm(c) === norm(territory))) continue;
        if (input.agentName && norm(z.agentName) === norm(input.agentName)) continue;
        await db.update(agentZones)
          .set({ cities: cities.filter((c) => norm(c) !== norm(territory)) })
          .where(eq(agentZones.id, z.id));
      }

      let createdZone = false;
      if (input.agentName) {
        const target = zones.find((z) => norm(z.agentName) === norm(input.agentName!));
        if (target) {
          const cities = cityList(target);
          if (!cities.some((c) => norm(c) === norm(territory))) {
            await db.update(agentZones)
              .set({ cities: [...cities, territory] })
              .where(eq(agentZones.id, target.id));
          }
        } else {
          // First territory for this person — give them a zone with a colour.
          const palette = ["#4ECDC4", "#FF6B35", "#A855F7", "#F59E0B", "#22C55E", "#3B82F6", "#EC4899", "#14B8A6"];
          const color = palette[zones.length % palette.length];
          await db.insert(agentZones).values({
            agentName: input.agentName, color, cities: [territory], active: true,
          } as any);
          createdZone = true;
        }
      }

      let reassigned = 0;
      if (input.reassignFacilities && input.agentName) {
        const res = await db.update(facilities)
          .set({ assignedRepName: input.agentName })
          .where(eq(facilities.territory, territory));
        reassigned = affected(res);
      }
      return { owner: input.agentName, createdZone, reassigned };
    }),

  /** Rename a territory across every facility that uses it, and on its zone. */
  rename: managerOnly
    .input(z.object({ from: z.string().min(1), to: z.string().min(1).max(120) }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const to = input.to.trim();
      if (!to) throw new TRPCError({ code: "BAD_REQUEST", message: "New name cannot be empty." });
      const res = await db.update(facilities).set({ territory: to }).where(eq(facilities.territory, input.from));
      for (const z of await db.select().from(agentZones)) {
        const cities = cityList(z);
        if (!cities.some((c) => norm(c) === norm(input.from))) continue;
        const next = Array.from(new Set(cities.map((c) => (norm(c) === norm(input.from) ? to : c))));
        await db.update(agentZones).set({ cities: next }).where(eq(agentZones.id, z.id));
      }
      return { updated: affected(res), to };
    }),

  /** Fold duplicates together ("LA" + "L.A." → "Los Angeles"). */
  merge: managerOnly
    .input(z.object({ from: z.array(z.string().min(1)).min(1).max(50), to: z.string().min(1).max(120) }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const to = input.to.trim();
      if (!to) throw new TRPCError({ code: "BAD_REQUEST", message: "Target name cannot be empty." });
      const sources = input.from.filter((s) => norm(s) !== norm(to));
      if (!sources.length) return { updated: 0, to };
      const res = await db.update(facilities).set({ territory: to }).where(inArray(facilities.territory, sources));
      const dropped = new Set(sources.map(norm));
      for (const z of await db.select().from(agentZones)) {
        const cities = cityList(z);
        if (!cities.some((c) => dropped.has(norm(c)))) continue;
        const next = Array.from(new Set(cities.map((c) => (dropped.has(norm(c)) ? to : c))));
        await db.update(agentZones).set({ cities: next }).where(eq(agentZones.id, z.id));
      }
      return { updated: affected(res), to };
    }),

  /** Clear a territory — its facilities go back to unassigned, nothing is deleted. */
  clear: managerOnly
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const res = await db.update(facilities).set({ territory: null }).where(eq(facilities.territory, input.name));
      for (const z of await db.select().from(agentZones)) {
        const cities = cityList(z);
        if (!cities.some((c) => norm(c) === norm(input.name))) continue;
        await db.update(agentZones)
          .set({ cities: cities.filter((c) => norm(c) !== norm(input.name)) })
          .where(eq(agentZones.id, z.id));
      }
      return { cleared: affected(res) };
    }),

  /** Set a territory on specific facilities (used from the unassigned list). */
  assign: managerOnly
    .input(z.object({ facilityIds: z.array(z.number()).min(1).max(2000), territory: z.string().min(1).max(120) }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const t = input.territory.trim();
      if (!t) throw new TRPCError({ code: "BAD_REQUEST", message: "Territory cannot be empty." });
      let updated = 0;
      for (let i = 0; i < input.facilityIds.length; i += 500) {
        const chunk = input.facilityIds.slice(i, i + 500);
        const res = await db.update(facilities).set({ territory: t }).where(inArray(facilities.id, chunk));
        updated += affected(res) || chunk.length;
      }
      return { updated };
    }),

  /**
   * Fill blank territories from each facility's own city, falling back to
   * "ZIP xxxxx" where there is no city — the rule the column was seeded with.
   */
  autofill: managerOnly
    .input(z.object({ source: z.enum(["city", "zip", "both"]).default("both"), dryRun: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const db = await db_();
      const blank = await db
        .select({ id: facilities.id, city: facilities.city, zipCode: facilities.zipCode })
        .from(facilities)
        .where(or(isNull(facilities.territory), eq(facilities.territory, "")));

      const byTerritory = new Map<string, number[]>();
      for (const f of blank) {
        const city = (f.city ?? "").trim();
        const zip = (f.zipCode ?? "").trim();
        const target = city && input.source !== "zip" ? city
          : !city && zip && input.source !== "city" ? `ZIP ${zip}`
          : null;
        if (!target) continue;
        const list = byTerritory.get(target) ?? [];
        list.push(f.id);
        byTerritory.set(target, list);
      }

      const planned = Array.from(byTerritory.values()).reduce((s, ids) => s + ids.length, 0);
      if (input.dryRun) return { updated: planned, territories: byTerritory.size, dryRun: true as const };

      let updated = 0;
      for (const [territory, ids] of Array.from(byTerritory.entries())) {
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          await db.update(facilities).set({ territory }).where(inArray(facilities.id, chunk));
          updated += chunk.length;
        }
      }
      return { updated, territories: byTerritory.size, dryRun: false as const };
    }),
});
