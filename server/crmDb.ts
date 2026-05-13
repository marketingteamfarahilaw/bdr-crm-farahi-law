/**
 * CRM database helpers — Facility Partner CRM V3
 */

import { and, desc, eq, like, or, sql, asc } from "drizzle-orm";
import {
  contactLogs,
  facilities,
  facilityLeadsSent,
  facilityReferrals,
  facilityTasks,
  facilityLeads,
  facilityGratitude,
  facilityUpdates,
  ringcentralTokens,
  type InsertContactLog,
  type InsertFacility,
  type InsertFacilityLeadsSent,
  type InsertFacilityReferral,
  type InsertFacilityTask,
  type InsertFacilityLead,
  type InsertFacilityGratitude,
  type InsertFacilityUpdate,
  type InsertRingcentralToken,
} from "../drizzle/schema";
import { getDb } from "./db";

// ─── Facilities ───────────────────────────────────────────────────────────────

export async function listFacilities(filters?: {
  search?: string;
  status?: string;
  partnerStatus?: string;
  category?: string;
  assignedRepId?: number;
  managementFlag?: boolean;
  priorityPartner?: boolean;
  followUpDue?: boolean;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(facilities);
  const conditions: any[] = [];

  if (filters?.search) {
    conditions.push(
      or(
        like(facilities.name, `%${filters.search}%`),
        like(facilities.address, `%${filters.search}%`),
        like(facilities.contactName, `%${filters.search}%`),
        like(facilities.city, `%${filters.search}%`)
      )
    );
  }
  if (filters?.status) conditions.push(eq(facilities.relationshipStatus, filters.status as any));
  if (filters?.partnerStatus) conditions.push(eq(facilities.partnerStatus, filters.partnerStatus as any));
  if (filters?.category) conditions.push(eq(facilities.category, filters.category));
  if (filters?.assignedRepId) conditions.push(eq(facilities.assignedRepId, filters.assignedRepId));
  if (filters?.managementFlag) conditions.push(eq(facilities.managementFlag, 1));
  if (filters?.priorityPartner) conditions.push(eq(facilities.priorityPartner, 1));

  if (conditions.length > 0) query = query.where(and(...conditions)) as any;

  const sortDir = filters?.sortDir === "asc" ? asc : desc;
  const sortColMap: Record<string, any> = {
    name: facilities.name,
    createdAt: facilities.createdAt,
    updatedAt: facilities.updatedAt,
    totalSignedCases: facilities.totalSignedCases,
    totalLeadsReceived: facilities.totalLeadsReceived,
    lastContactDate: facilities.lastContactDate,
    nextFollowUpDate: facilities.nextFollowUpDate,
  };
  const sortCol = sortColMap[filters?.sortBy ?? "updatedAt"] ?? facilities.updatedAt;

  let rows = await (query as any).orderBy(sortDir(sortCol));

  if (filters?.followUpDue) {
    const now = new Date();
    rows = rows.filter((f: any) => f.nextFollowUpDate && new Date(f.nextFollowUpDate) <= now);
  }

  return rows;
}

export async function getFacilityById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(facilities).where(eq(facilities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAllFacilitiesForMap() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: facilities.id,
      name: facilities.name,
      category: facilities.category,
      partnerStatus: facilities.partnerStatus,
      relationshipStrength: facilities.relationshipStrength,
      priorityPartner: facilities.priorityPartner,
      latitude: facilities.latitude,
      longitude: facilities.longitude,
      city: facilities.city,
      zipCode: facilities.zipCode,
      phone: facilities.phone,
      contactName: facilities.contactName,
      assignedRepName: facilities.assignedRepName,
      totalSignedCases: facilities.totalSignedCases,
      totalLeadsSent: facilities.totalLeadsSent,
      totalLeadsReceived: facilities.totalLeadsReceived,
      lastContactDate: facilities.lastContactDate,
      nextFollowUpDate: facilities.nextFollowUpDate,
      notes: facilities.notes,
    })
    .from(facilities);
}

export async function createFacility(data: InsertFacility) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(facilities).values({
    ...data,
    managementFlag: data.managementFlag ?? 0,
    priorityPartner: data.priorityPartner ?? 0,
    followUpWindowDays: data.followUpWindowDays ?? 7,
    totalSignedCases: data.totalSignedCases ?? 0,
    totalLeadsSent: data.totalLeadsSent ?? 0,
    totalLeadsReceived: data.totalLeadsReceived ?? 0,
    totalCalls: data.totalCalls ?? 0,
  });
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
  return db
    .select()
    .from(contactLogs)
    .where(eq(contactLogs.facilityId, facilityId))
    .orderBy(desc(contactLogs.contactDate));
}

export async function createContactLog(data: InsertContactLog) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const result = await db.insert(contactLogs).values(data);
  await db
    .update(facilities)
    .set({
      lastContactDate: data.contactDate as Date,
      lastCheckInDate: data.contactDate as Date,
      totalCalls: sql`${facilities.totalCalls} + 1`,
      updatedAt: new Date(),
    })
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

// ─── Facility Leads V3 ────────────────────────────────────────────────────────

export async function listFacilityLeads(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityLeads)
    .where(eq(facilityLeads.facilityId, facilityId))
    .orderBy(desc(facilityLeads.leadDate));
}

export async function createFacilityLead(data: InsertFacilityLead) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(facilityLeads).values(data);
  // Update denormalized counters
  if (data.direction === "sent_to_facility") {
    await db
      .update(facilities)
      .set({ totalLeadsSent: sql`${facilities.totalLeadsSent} + 1` })
      .where(eq(facilities.id, data.facilityId));
  } else {
    await db
      .update(facilities)
      .set({ totalLeadsReceived: sql`${facilities.totalLeadsReceived} + 1` })
      .where(eq(facilities.id, data.facilityId));
  }
  if (data.signedCase === 1) {
    await db
      .update(facilities)
      .set({
        totalSignedCases: sql`${facilities.totalSignedCases} + 1`,
        lastSignedCaseDate: (data.signedDate ?? new Date()) as Date,
      })
      .where(eq(facilities.id, data.facilityId));
  }
}

export async function updateFacilityLead(id: number, data: Partial<InsertFacilityLead>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // If marking as signed for the first time, increment counter
  if (data.signedCase === 1) {
    const existing = await db.select().from(facilityLeads).where(eq(facilityLeads.id, id)).limit(1);
    if (existing[0] && existing[0].signedCase !== 1) {
      await db
        .update(facilities)
        .set({
          totalSignedCases: sql`${facilities.totalSignedCases} + 1`,
          lastSignedCaseDate: (data.signedDate ?? new Date()) as Date,
        })
        .where(eq(facilities.id, existing[0].facilityId));
    }
  }
  await db.update(facilityLeads).set(data).where(eq(facilityLeads.id, id));
}

export async function deleteFacilityLead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilityLeads).where(eq(facilityLeads.id, id));
}

// ─── Gratitude Actions V3 ─────────────────────────────────────────────────────

export async function listGratitudeActions(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityGratitude)
    .where(eq(facilityGratitude.facilityId, facilityId))
    .orderBy(desc(facilityGratitude.actionDate));
}

export async function createGratitudeAction(data: InsertFacilityGratitude) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(facilityGratitude).values(data);
  const updates: Record<string, any> = {};
  if (data.amount) {
    updates.moneyInvested = sql`${facilities.moneyInvested} + ${data.amount}`;
  }
  if (data.actionType === "meal_delivery" || data.actionType === "gift") {
    updates.lastPackageDate = data.actionDate;
  }
  if (Object.keys(updates).length > 0) {
    await db.update(facilities).set(updates).where(eq(facilities.id, data.facilityId));
  }
}

export async function deleteGratitudeAction(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilityGratitude).where(eq(facilityGratitude.id, id));
}

// ─── Facility Updates / Transcripts V3 ───────────────────────────────────────

export async function listFacilityUpdates(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityUpdates)
    .where(eq(facilityUpdates.facilityId, facilityId))
    .orderBy(desc(facilityUpdates.updateDate));
}

export async function createFacilityUpdate(data: InsertFacilityUpdate) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(facilityUpdates).values(data);
}

export async function deleteFacilityUpdate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(facilityUpdates).where(eq(facilityUpdates.id, id));
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function listTasksByFacility(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityTasks)
    .where(eq(facilityTasks.facilityId, facilityId))
    .orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt));
}

export async function listTasksByUser(userId: number, statusFilter?: "open" | "completed") {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [eq(facilityTasks.assignedToId, userId)];
  if (statusFilter) conditions.push(eq(facilityTasks.status, statusFilter));
  return db
    .select()
    .from(facilityTasks)
    .where(and(...conditions))
    .orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt));
}

export async function listOverdueTasks() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(facilityTasks)
    .where(and(eq(facilityTasks.status, "open"), sql`${facilityTasks.dueDate} < NOW()`))
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

// ─── Leads Sent (legacy monthly) ─────────────────────────────────────────────

export async function listLeadsSent(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
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

// ─── Referrals (legacy) ───────────────────────────────────────────────────────

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

  const allFacilities = await db.select().from(facilities);
  const now = new Date();

  const overdueTasks = await db
    .select()
    .from(facilityTasks)
    .where(and(eq(facilityTasks.status, "open"), sql`${facilityTasks.dueDate} < NOW()`));

  const openTasks = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityTasks)
    .where(eq(facilityTasks.status, "open"));

  const totalReferralsRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(facilityReferrals);

  const totalLeadsSentRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${facilityLeadsSent.count}), 0)` })
    .from(facilityLeadsSent);

  const totalContactLogsRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contactLogs);

  const flagged = allFacilities.filter((f) => f.managementFlag === 1);
  const followUpDue = allFacilities.filter(
    (f) => f.nextFollowUpDate && new Date(f.nextFollowUpDate) <= now
  );

  const totalSignedCases = allFacilities.reduce((s, f) => s + (f.totalSignedCases ?? 0), 0);
  const totalLeadsReceived = allFacilities.reduce((s, f) => s + (f.totalLeadsReceived ?? 0), 0);

  const topReferrers = [...allFacilities]
    .sort((a, b) => (b.totalSignedCases ?? 0) - (a.totalSignedCases ?? 0))
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      city: f.city,
      partnerStatus: f.partnerStatus,
      totalSignedCases: f.totalSignedCases ?? 0,
      totalLeadsReceived: f.totalLeadsReceived ?? 0,
      totalLeadsSent: f.totalLeadsSent ?? 0,
    }));

  const statusBreakdown: Record<string, number> = {};
  for (const f of allFacilities) {
    const s = f.partnerStatus ?? "prospect";
    statusBreakdown[s] = (statusBreakdown[s] ?? 0) + 1;
  }

  const lowReciprocity = allFacilities
    .filter((f) => (f.totalLeadsSent ?? 0) - (f.totalLeadsReceived ?? 0) >= 3)
    .map((f) => ({
      id: f.id,
      name: f.name,
      totalLeadsSent: f.totalLeadsSent ?? 0,
      totalLeadsReceived: f.totalLeadsReceived ?? 0,
    }));

  return {
    totalFacilities: allFacilities.length,
    activePartners: allFacilities.filter((f) => f.partnerStatus === "active_partner").length,
    priorityPartners: allFacilities.filter((f) => f.priorityPartner === 1).length,
    warmLeads: allFacilities.filter((f) => f.partnerStatus === "prospect").length,
    openTasks: Number(openTasks[0]?.count ?? 0),
    overdueTasks: overdueTasks.length,
    followUpDue: followUpDue.length,
    flaggedCount: flagged.length,
    flaggedFacilities: flagged.map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      city: f.city,
      managementNote: f.managementNote,
      partnerStatus: f.partnerStatus,
    })),
    topReferrers,
    statusBreakdown,
    totalSignedCases,
    totalLeadsSent: Number(totalLeadsSentRow[0]?.total ?? 0),
    totalLeadsReceived,
    totalReferrals: Number(totalReferralsRow[0]?.count ?? 0),
    totalContactLogs: Number(totalContactLogsRow[0]?.count ?? 0),
    lowReciprocity,
  };
}

export async function getRelationshipBalance() {
  const db = await getDb();
  if (!db) return [];
  const allFacilities = await db.select().from(facilities);
  return allFacilities.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    city: f.city,
    partnerStatus: f.partnerStatus,
    totalLeadsSent: f.totalLeadsSent ?? 0,
    totalLeadsReceived: f.totalLeadsReceived ?? 0,
    totalSignedCases: f.totalSignedCases ?? 0,
    balance: (f.totalLeadsReceived ?? 0) - (f.totalLeadsSent ?? 0),
    conversionRate:
      (f.totalLeadsReceived ?? 0) > 0
        ? Math.round(((f.totalSignedCases ?? 0) / (f.totalLeadsReceived ?? 0)) * 100)
        : 0,
  }));
}
