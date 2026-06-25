/**
 * PD (property-damage) car referral pipeline — data layer.
 * Import auto/driver cases (from the Filevine export), work each car's status,
 * and roll up the body-shop referral dashboard (referral rate vs target,
 * reconciliation, status + team-working breakdowns).
 */
import { and, desc, eq, like, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { pdReferrals, facilities, type InsertPdReferral } from "../drizzle/schema";

// Statuses that take a car OUT of the eligible-to-refer pool.
const INELIGIBLE = ["total_loss", "cant_refer", "drop_case"] as const;
const REFERRED = ["bdr_shop", "pl_shop", "refer_by_fbs"] as const;
const REFERRAL_TARGET = 0.7;

export async function listPdReferrals(filters: { status?: string; search?: string; driverOnly?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (filters.status) conds.push(eq(pdReferrals.status, filters.status as any));
  if (filters.driverOnly) conds.push(eq(pdReferrals.isDriver, 1));
  if (filters.search) conds.push(sql`(${pdReferrals.clientName} LIKE ${"%" + filters.search + "%"} OR ${pdReferrals.caseNumber} LIKE ${"%" + filters.search + "%"} OR ${pdReferrals.facilityName} LIKE ${"%" + filters.search + "%"})`);
  const q = db.select().from(pdReferrals);
  if (conds.length) q.where(and(...conds));
  return q.orderBy(desc(pdReferrals.updatedAt)).limit(3000);
}

export async function createPdReferral(data: InsertPdReferral) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const r: any = await db.insert(pdReferrals).values(data);
  return r?.[0]?.insertId ?? r?.insertId ?? null;
}

export async function updatePdReferral(id: number, data: Partial<InsertPdReferral>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pdReferrals).set({ ...data, updatedAt: new Date() }).where(eq(pdReferrals.id, id));
}

export async function deletePdReferral(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(pdReferrals).where(eq(pdReferrals.id, id));
}

/**
 * Import rows from a Filevine/CSV export. New cases are inserted; cases already
 * present (matched by Filevine project id, else case#+client) are SKIPPED so
 * Miguel's hand-worked statuses are never overwritten.
 */
export async function bulkImportPd(rows: Array<Partial<InsertPdReferral>>, batch: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await db.select({ caseNumber: pdReferrals.caseNumber, filevineProjectId: pdReferrals.filevineProjectId, clientName: pdReferrals.clientName }).from(pdReferrals);
  const seenFv = new Set(existing.map((e) => (e.filevineProjectId || "").trim()).filter(Boolean));
  const seenCase = new Set(existing.map((e) => `${(e.caseNumber || "").trim()}|${(e.clientName || "").trim().toLowerCase()}`));
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const fv = (r.filevineProjectId || "").toString().trim();
    const caseKey = `${(r.caseNumber || "").toString().trim()}|${(r.clientName || "").toString().trim().toLowerCase()}`;
    if ((fv && seenFv.has(fv)) || (r.caseNumber && seenCase.has(caseKey))) { skipped++; continue; }
    await db.insert(pdReferrals).values({ ...r, importBatch: batch, status: (r.status as any) || "new_case" } as any);
    if (fv) seenFv.add(fv);
    if (r.caseNumber) seenCase.add(caseKey);
    inserted++;
  }
  return { inserted, skipped, total: rows.length };
}

export async function getPdDashboard() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ status: pdReferrals.status, isDriver: pdReferrals.isDriver, assignedRepName: pdReferrals.assignedRepName }).from(pdReferrals);

  const total = rows.length;
  const driver = rows.filter((r) => r.isDriver === 1);
  const driverCount = driver.length;
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const ineligible = driver.filter((r) => (INELIGIBLE as readonly string[]).includes(r.status)).length;
  const eligible = driverCount - ineligible;
  const bdrShop = byStatus["bdr_shop"] || 0;
  const referredTotal = driver.filter((r) => (REFERRED as readonly string[]).includes(r.status)).length;
  const referralRate = eligible > 0 ? bdrShop / eligible : 0;

  // Team-working breakdown by rep
  const teamWorking: Record<string, number> = {};
  for (const r of rows) if (r.status === "team_working") teamWorking[r.assignedRepName || "Unassigned"] = (teamWorking[r.assignedRepName || "Unassigned"] || 0) + 1;

  // Reconciliation waterfall (driver cars)
  const reconciliation = [
    { label: "Driver cars", value: driverCount },
    { label: "− Total loss", value: -(byStatus["total_loss"] || 0) },
    { label: "− Can't refer", value: -(byStatus["cant_refer"] || 0) },
    { label: "− Dropped", value: -(byStatus["drop_case"] || 0) },
    { label: "Eligible", value: eligible },
    { label: "BDR shop", value: bdrShop },
  ];

  return {
    total, driverCount, eligible, bdrShop, referredTotal,
    referralRate, target: REFERRAL_TARGET,
    byStatus, teamWorking, reconciliation,
    waitingLiability: byStatus["waiting_liability"] || 0,
    newCases: byStatus["new_case"] || 0,
  };
}

/** Body-shop facilities for the "refer to" picker. */
export async function listBodyShops() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: facilities.id, name: facilities.name, city: facilities.city })
    .from(facilities).where(eq(facilities.category, "body_shop")).orderBy(facilities.name).limit(2000);
}
