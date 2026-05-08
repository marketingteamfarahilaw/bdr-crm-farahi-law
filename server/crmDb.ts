/**
 * CRM database helpers — Facility Partner CRM
 * All queries for facilities, contact logs, tasks, and leads sent.
 */

import { and, desc, eq, like, or, sql, asc } from "drizzle-orm";
import {
  contactLogs,
  facilities,
  facilityLeadsSent,
  facilityReferrals,
  facilityTasks,
  ringcentralTokens,
  type InsertContactLog,
  type InsertFacility,
  type InsertFacilityLeadsSent,
  type InsertFacilityReferral,
  type InsertFacilityTask,
  type InsertRingcentralToken,
} from "../drizzle/schema";
import { getDb } from "./db";

// ─── Facilities ───────────────────────────────────────────────────────────────

export async function listFacilities(filters?: {
  search?: string;
  status?: string;
  category?: string;
  assignedRepId?: number;
  managementFlag?: boolean;
  sortBy?: "name" | "updatedAt" | "createdAt" | "totalLeadsSent";
  sortDir?: "asc" | "desc";
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(facilities);
  const conditions = [];

  if (filters?.search) {
    conditions.push(
      or(
        like(facilities.name, `%${filters.search}%`),
        like(facilities.address, `%${filters.search}%`),
        like(facilities.contactName, `%${filters.search}%`)
      )
    );
  }
  if (filters?.status) {
    conditions.push(eq(facilities.relationshipStatus, filters.status as any));
  }
  if (filters?.category) {
    conditions.push(eq(facilities.category, filters.category));
  }
  if (filters?.assignedRepId) {
    conditions.push(eq(facilities.assignedRepId, filters.assignedRepId));
  }
  if (filters?.managementFlag) {
    conditions.push(eq(facilities.managementFlag, 1));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const sortDir = filters?.sortDir === "asc" ? asc : desc;
  const sortCol =
    filters?.sortBy === "name"
      ? facilities.name
      : filters?.sortBy === "createdAt"
      ? facilities.createdAt
      : facilities.updatedAt;

  return await (query as any).orderBy(sortDir(sortCol));
}

export async function getFacilityById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(facilities).where(eq(facilities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createFacility(data: InsertFacility) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(facilities).values(data);
  return result[0];
}

export async function updateFacility(id: number, data: Partial<InsertFacility>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(facilities).set(data).where(eq(facilities.id, id));
}

export async function deleteFacility(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilities).where(eq(facilities.id, id));
}

// ─── Contact Logs ─────────────────────────────────────────────────────────────

export async function listContactLogs(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(contactLogs)
    .where(eq(contactLogs.facilityId, facilityId))
    .orderBy(desc(contactLogs.contactDate));
}

export async function createContactLog(data: InsertContactLog) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(contactLogs).values(data);
  // Update facility updatedAt so it surfaces in recency sorting
  await db
    .update(facilities)
    .set({ updatedAt: new Date() })
    .where(eq(facilities.id, data.facilityId));
  return result[0];
}

export async function deleteContactLog(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(contactLogs).where(eq(contactLogs.id, id));
}

export async function getLastContactLog(facilityId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(contactLogs)
    .where(eq(contactLogs.facilityId, facilityId))
    .orderBy(desc(contactLogs.contactDate))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function listTasksByFacility(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(facilityTasks)
    .where(eq(facilityTasks.facilityId, facilityId))
    .orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt));
}

export async function listTasksByUser(userId: number, statusFilter?: "open" | "completed") {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(facilityTasks.assignedToId, userId)];
  if (statusFilter) conditions.push(eq(facilityTasks.status, statusFilter));
  return await db
    .select()
    .from(facilityTasks)
    .where(and(...conditions))
    .orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt));
}

export async function listOverdueTasks() {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(facilityTasks)
    .where(
      and(
        eq(facilityTasks.status, "open"),
        sql`${facilityTasks.dueDate} < NOW()`
      )
    )
    .orderBy(asc(facilityTasks.dueDate));
}

export async function createTask(data: InsertFacilityTask) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(facilityTasks).values(data);
  return result[0];
}

export async function completeTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(facilityTasks)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(facilityTasks.id, id));
}

export async function reopenTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .update(facilityTasks)
    .set({ status: "open", completedAt: null })
    .where(eq(facilityTasks.id, id));
}

export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilityTasks).where(eq(facilityTasks.id, id));
}

// ─── Leads Sent ───────────────────────────────────────────────────────────────

export async function listLeadsSent(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(facilityLeadsSent)
    .where(eq(facilityLeadsSent.facilityId, facilityId))
    .orderBy(desc(facilityLeadsSent.year), desc(facilityLeadsSent.month));
}

export async function upsertLeadsSent(data: InsertFacilityLeadsSent) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(facilityLeadsSent)
    .values(data)
    .onDuplicateKeyUpdate({
      set: { count: data.count, notes: data.notes, updatedAt: new Date() },
    });
}

export async function getTotalLeadsSent(facilityId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ total: sql<number>`SUM(${facilityLeadsSent.count})` })
    .from(facilityLeadsSent)
    .where(eq(facilityLeadsSent.facilityId, facilityId));
  return rows[0]?.total ?? 0;
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export async function listReferrals(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityReferrals)
    .where(eq(facilityReferrals.facilityId, facilityId))
    .orderBy(desc(facilityReferrals.referralDate));
}

export async function createReferral(data: InsertFacilityReferral) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(facilityReferrals).values(data);
}

export async function updateReferral(id: number, data: Partial<InsertFacilityReferral>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(facilityReferrals).set(data).where(eq(facilityReferrals.id, id));
}

export async function deleteReferral(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilityReferrals).where(eq(facilityReferrals.id, id));
}

export async function getTotalReferrals(facilityId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityReferrals)
    .where(eq(facilityReferrals.facilityId, facilityId));
  return Number(rows[0]?.count ?? 0);
}

// ─── RingCentral Tokens ───────────────────────────────────────────────────────

export async function getRingcentralToken() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(ringcentralTokens).limit(1);
  return rows[0] ?? null;
}

export async function upsertRingcentralToken(data: InsertRingcentralToken) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(ringcentralTokens)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiry: data.tokenExpiry,
        ownerExtensionId: data.ownerExtensionId,
        ownerName: data.ownerName,
      },
    });
}

export async function deleteRingcentralToken() {
  const db = await getDb();
  if (!db) return;
  await db.delete(ringcentralTokens);
}

// ─── Management Dashboard ─────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;

  const [totalFacilities] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilities);

  const [activePartners] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilities)
    .where(eq(facilities.relationshipStatus, "active_partner"));

  const [flagged] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilities)
    .where(eq(facilities.managementFlag, 1));

  const [openTasks] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityTasks)
    .where(eq(facilityTasks.status, "open"));

  const [overdueTasks] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityTasks)
    .where(and(eq(facilityTasks.status, "open"), sql`${facilityTasks.dueDate} < NOW()`));

  const [warmLeads] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilities)
    .where(eq(facilities.relationshipStatus, "warm_lead"));

  const [totalReferrals] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityReferrals);

  const [totalLeadsSentRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${facilityLeadsSent.count}), 0)` })
    .from(facilityLeadsSent);

  const [totalContactLogs] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contactLogs);

  // Top 10 facilities by referrals received
  const topReferrers = await db
    .select({
      facilityId: facilityReferrals.facilityId,
      totalReferrals: sql<number>`COUNT(*)`,
    })
    .from(facilityReferrals)
    .groupBy(facilityReferrals.facilityId)
    .orderBy(desc(sql`COUNT(*)`))    
    .limit(10);

  // Enrich top referrers with facility name
  const topReferrersEnriched = await Promise.all(
    topReferrers.map(async (r) => {
      const [fac] = await db.select({ id: facilities.id, name: facilities.name, city: facilities.city })
        .from(facilities).where(eq(facilities.id, r.facilityId)).limit(1);
      return { ...r, id: fac?.id ?? r.facilityId, name: fac?.name ?? "Unknown", city: fac?.city ?? null };
    })
  );

  // Status breakdown
  const statusRows = await db
    .select({ status: facilities.relationshipStatus, count: sql<number>`COUNT(*)` })
    .from(facilities)
    .groupBy(facilities.relationshipStatus);
  const statusBreakdown: Record<string, number> = {};
  for (const row of statusRows) {
    statusBreakdown[row.status] = Number(row.count);
  }

  return {
    totalFacilities: Number(totalFacilities?.count ?? 0),
    activePartners: Number(activePartners?.count ?? 0),
    warmLeads: Number(warmLeads?.count ?? 0),
    flaggedCount: Number(flagged?.count ?? 0),
    openTasks: Number(openTasks?.count ?? 0),
    overdueTasks: Number(overdueTasks?.count ?? 0),
    totalReferrals: Number(totalReferrals?.count ?? 0),
    totalLeadsSent: Number(totalLeadsSentRow?.total ?? 0),
    totalContactLogs: Number(totalContactLogs?.count ?? 0),
    topReferrers: topReferrersEnriched,
    statusBreakdown,
  };
}
