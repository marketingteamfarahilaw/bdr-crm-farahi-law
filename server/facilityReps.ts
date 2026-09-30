/**
 * facilities.frRepName — the Field Rep responsible for a partner, beside the
 * BDR in assignedRepName.
 *
 * Deploys run no migrations, so the column is added here at runtime, once,
 * idempotently. Until it exists every `select().from(facilities)` in the app
 * fails (drizzle names the column), which is why server startup awaits
 * ensureFrRepColumn() before it listens, and the facilities procedures await it
 * again in case startup couldn't reach the database.
 *
 * Then, once, frRepName is filled for facilities that have none: the current
 * FR who visited the facility on the most days. It never overwrites a value.
 */

import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { contactLogs, facilities, fieldVisits } from "../drizzle/schema";
import { CURRENT_TEAM } from "@shared/team";
import { getDb, getSetting, setSetting } from "./db";
import { fieldVisitFacilityIds, getFacilityNameIndex } from "./crmDb";

const BACKFILL_SETTING = "facilities_fr_rep_backfill_v1";

let columnReady: Promise<void> | null = null;

export function ensureFrRepColumn() {
  columnReady ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const [rows] = (await db.execute(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facilities' AND COLUMN_NAME = 'frRepName'`)) as any;
    if (Number(rows?.[0]?.n ?? 0) === 0) {
      await db.execute(sql`ALTER TABLE facilities ADD COLUMN frRepName VARCHAR(255) NULL`);
      console.log("[facilityReps] added facilities.frRepName");
    }
  })().catch((e) => { columnReady = null; throw e; });
  return columnReady;
}

// Visit logs write the FR as they typed it ("Lupe" or "Lupe Campos"): match on first name.
const firstName = (s: unknown) => String(s ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
const FR_BY_FIRST = new Map(CURRENT_TEAM.FR.map((n) => [firstName(n), n] as const));
const LA = "America/Los_Angeles";

let backfillRun: Promise<void> | null = null;

/** Fill empty frRepName values from visit history, once ever (recorded in app_settings). */
export function backfillFrRepsOnce() {
  backfillRun ??= (async () => {
    await ensureFrRepColumn();
    if (await getSetting(BACKFILL_SETTING)) return;
    const db = await getDb();
    if (!db) return;

    // Visits counted as distinct Pacific days per (facility, FR): a visit logged
    // both as a contact log and on the field-visit sheet is one visit.
    const days = new Map<number, Map<string, Set<string>>>();
    const add = (facilityId: number, rep: unknown, when: Date | null | undefined) => {
      const fr = FR_BY_FIRST.get(firstName(rep));
      if (!fr || !when || !facilityId) return;
      const d = new Date(when);
      if (isNaN(d.getTime())) return;
      if (!days.has(facilityId)) days.set(facilityId, new Map());
      const perRep = days.get(facilityId)!;
      if (!perRep.has(fr)) perRep.set(fr, new Set());
      perRep.get(fr)!.add(formatInTimeZone(d, LA, "yyyy-MM-dd"));
    };

    const [logs, visits, idByName] = await Promise.all([
      db.select({ facilityId: contactLogs.facilityId, repName: contactLogs.repName, contactDate: contactLogs.contactDate })
        .from(contactLogs).where(sql`${contactLogs.contactType} = 'visit'`),
      db.select({ agentName: fieldVisits.agentName, visitDate: fieldVisits.visitDate, facilitiesVisited: fieldVisits.facilitiesVisited }).from(fieldVisits),
      getFacilityNameIndex(),
    ]);
    for (const l of logs) add(l.facilityId, l.repName, l.contactDate as Date);
    for (const v of visits) for (const id of fieldVisitFacilityIds(v.facilitiesVisited, idByName)) add(id, v.agentName, v.visitDate as Date);

    let filled = 0;
    for (const [facilityId, perRep] of Array.from(days.entries())) {
      const ranked = Array.from(perRep.entries()).map(([fr, set]) => [fr, set.size] as const).sort((a, b) => b[1] - a[1]);
      // A tie for first means no one clearly owns the relationship: leave it for a manager.
      if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) continue;
      // IS NULL in the WHERE: never overwrite a value someone set meanwhile.
      const [res] = (await db.execute(sql`UPDATE ${facilities} SET frRepName = ${ranked[0][0]} WHERE id = ${facilityId} AND frRepName IS NULL`)) as any;
      filled += Number(res?.affectedRows ?? 0);
    }
    await setSetting(BACKFILL_SETTING, new Date().toISOString());
    console.log(`[facilityReps] FR rep backfill: ${filled} facilities filled from visit history.`);
  })().catch((e) => { backfillRun = null; console.warn("[facilityReps] FR rep backfill failed:", e?.message ?? e); });
  return backfillRun;
}
