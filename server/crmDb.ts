/**
 * CRM database helpers — Facility Partner CRM V3
 */

import { and, desc, eq, like, or, sql, asc, inArray, gte, lte, isNotNull } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  contactLogs,
  facilities,
  facilityLeadsSent,
  facilityReferrals,
  facilityTasks,
  facilityLeads,
  facilityGratitude,
  facilityUpdates,
  fieldVisits,
  frExpenses,
  bdrExpenses,
  ringcentralTokens,
  userRingcentralTokens,
  rcUnmatchedCalls,
  users,
  type InsertContactLog,
  type InsertFacility,
  type InsertFacilityLeadsSent,
  type InsertFacilityReferral,
  type InsertFacilityTask,
  type InsertFacilityLead,
  type InsertFacilityGratitude,
  type InsertFacilityUpdate,
  type InsertRingcentralToken,
  type InsertUserRingcentralToken,
} from "../drizzle/schema";
import { getDb } from "./db";

// ─── Facilities ───────────────────────────────────────────────────────────────

export async function listFacilities(filters?: {
  search?: string;
  status?: string;
  partnerStatus?: string;
  category?: string;
  assignedRepId?: number;
  assignedRepNames?: string[];
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
    // Case-insensitive search (TiDB's default collation is case-sensitive).
    const s = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      or(
        sql`LOWER(${facilities.name}) LIKE ${s}`,
        sql`LOWER(${facilities.address}) LIKE ${s}`,
        sql`LOWER(${facilities.contactName}) LIKE ${s}`,
        sql`LOWER(${facilities.city}) LIKE ${s}`
      )
    );
  }
  if (filters?.status) conditions.push(eq(facilities.relationshipStatus, filters.status as any));
  if (filters?.partnerStatus) conditions.push(eq(facilities.partnerStatus, filters.partnerStatus as any));
  if (filters?.category) conditions.push(eq(facilities.category, filters.category));
  // Ownership scope: a facility belongs to an agent by id OR by name (most are
  // assigned by name — e.g. "Grace" — and have no id), so match either.
  if (filters?.assignedRepId || filters?.assignedRepNames?.length) {
    const ors: any[] = [];
    if (filters.assignedRepId) ors.push(eq(facilities.assignedRepId, filters.assignedRepId));
    if (filters.assignedRepNames?.length) {
      const lowered = filters.assignedRepNames.map((n) => n.toLowerCase());
      ors.push(sql`LOWER(${facilities.assignedRepName}) IN (${sql.join(lowered.map((n) => sql`${n}`), sql`, `)})`);
    }
    conditions.push(ors.length === 1 ? ors[0] : or(...ors));
  }
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
      placeId: facilities.placeId,
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

/**
 * Find a facility by any of its phone numbers.
 * Normalises both sides to digits-only before comparing.
 */
export async function findFacilityByPhone(rawPhone: string) {
  const db = await getDb();
  if (!db) return null;
  // Compare on the last 10 digits (US), and PREFER the facility where the number
  // is the primary phone over one that only carries it as a secondary line —
  // otherwise a call lands on a facility that wrongly holds another's number.
  const t = rawPhone.replace(/\D/g, "");
  const t10 = t.length >= 10 ? t.slice(-10) : "";
  if (!t10) return null;
  const rows = await db.select().from(facilities);
  let secondary: typeof rows[number] | null = null;
  for (const f of rows) {
    const p = (f.phone || "").replace(/\D/g, "");
    const p10 = p.length >= 10 ? p.slice(-10) : "";
    if (p10 && p10 === t10) return f; // primary match wins
    if (!secondary) {
      const others = [f.phone2, f.phone3, f.contactPhone]
        .map((x) => (x || "").replace(/\D/g, ""))
        .map((d) => (d.length >= 10 ? d.slice(-10) : ""));
      if (others.some((o) => o && o === t10)) secondary = f;
    }
  }
  return secondary;
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

// Which of these RingCentral call-log ids are already logged — used to dedupe
// the account-wide auto-sync so a call is never processed twice.
export async function getExistingRcCallIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (!db || ids.length === 0) return new Set();
  const rows = await db
    .select({ rcCallId: contactLogs.rcCallId })
    .from(contactLogs)
    .where(inArray(contactLogs.rcCallId, ids));
  return new Set(rows.map((r) => r.rcCallId).filter((x): x is string => !!x));
}

// Which of these RingCentral telephonySessionIds are already logged. Unlike the
// per-extension rcCallId, a sessionId is stable across extensions — so a call
// that lands in two connected agents' extension logs (ring group, shared line,
// or transferred inbound) is logged only once, not twice.
export async function getExistingRcSessionIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (!db || ids.length === 0) return new Set();
  const rows = await db
    .select({ rcSessionId: contactLogs.rcSessionId })
    .from(contactLogs)
    .where(inArray(contactLogs.rcSessionId, ids));
  return new Set(rows.map((r) => r.rcSessionId).filter((x): x is string => !!x));
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
    .select({
      id: facilityTasks.id,
      facilityId: facilityTasks.facilityId,
      facilityName: facilities.name,
      title: facilityTasks.title,
      description: facilityTasks.description,
      dueDate: facilityTasks.dueDate,
      status: facilityTasks.status,
      priority: facilityTasks.priority,
      assignedToName: facilityTasks.assignedToName,
    })
    .from(facilityTasks)
    .leftJoin(facilities, eq(facilityTasks.facilityId, facilities.id))
    .where(and(...conditions))
    .orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt));
}

export async function listOverdueTasks() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: facilityTasks.id,
      facilityId: facilityTasks.facilityId,
      facilityName: facilities.name,
      title: facilityTasks.title,
      dueDate: facilityTasks.dueDate,
      status: facilityTasks.status,
      priority: facilityTasks.priority,
      assignedToName: facilityTasks.assignedToName,
    })
    .from(facilityTasks)
    .leftJoin(facilities, eq(facilityTasks.facilityId, facilities.id))
    .where(and(eq(facilityTasks.status, "open"), sql`${facilityTasks.dueDate} < NOW()`))
    .orderBy(asc(facilityTasks.dueDate));
}

/** All tasks across all facilities (global board). Managers: all; agents: own. */
export async function listAllTasks(opts: { all?: boolean; userId?: number } = {}) {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select({
      id: facilityTasks.id, facilityId: facilityTasks.facilityId, facilityName: facilities.name,
      title: facilityTasks.title, description: facilityTasks.description, dueDate: facilityTasks.dueDate,
      status: facilityTasks.status, priority: facilityTasks.priority, followUpReason: facilityTasks.followUpReason,
      assignedToId: facilityTasks.assignedToId, assignedToName: facilityTasks.assignedToName,
    })
    .from(facilityTasks)
    .leftJoin(facilities, eq(facilityTasks.facilityId, facilities.id));
  if (!opts.all) q.where(eq(facilityTasks.assignedToId, opts.userId ?? -1));
  return q.orderBy(asc(facilityTasks.dueDate), desc(facilityTasks.createdAt)).limit(3000);
}

// Referral counts (sent / received) per facility — ONE grouped query for the hub list.
export async function getReferralCountsMap(): Promise<Map<number, { sent: number; received: number }>> {
  const db = await getDb();
  const map = new Map<number, { sent: number; received: number }>();
  if (!db) return map;
  const rows = await db.select({ facilityId: facilityLeads.facilityId, direction: facilityLeads.direction, n: sql<number>`COUNT(*)` })
    .from(facilityLeads).groupBy(facilityLeads.facilityId, facilityLeads.direction);
  for (const r of rows) {
    const e = map.get(r.facilityId) ?? { sent: 0, received: 0 };
    if (r.direction === "sent_to_facility") e.sent = Number(r.n); else e.received = Number(r.n);
    map.set(r.facilityId, e);
  }
  return map;
}

// ── Per-facility expenses (FR + BDR combined) for the partner profile Expenses tab ──
export async function listExpensesByFacility(facilityId: number) {
  const db = await getDb();
  if (!db) return [];
  const fr = await db.select().from(frExpenses).where(eq(frExpenses.facilityId, facilityId));
  const bdr = await db.select().from(bdrExpenses).where(eq(bdrExpenses.facilityId, facilityId));
  const rows = [
    ...fr.map((e) => ({ id: e.id, kind: "FR" as const, date: e.expenseDate, agentName: e.agentName, store: e.store, reason: e.reason, amount: e.amount, reimbursementStatus: e.reimbursementStatus, receiptUrl: e.receiptUrl, notes: e.notes })),
    ...bdr.map((e) => ({ id: e.id, kind: "BDR" as const, date: e.expenseDate, agentName: e.agentName, store: e.store, reason: e.reason, amount: e.amount, reimbursementStatus: e.reimbursementStatus, receiptUrl: null, notes: e.notes })),
  ];
  return rows.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
}

export async function createFacilityExpense(data: { facilityId: number; facilityName?: string | null; agentName: string; expenseDate: Date; store?: string | null; reason?: string | null; amount: string; cardType?: "Personal" | "Company"; receiptUrl?: string | null; notes?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(frExpenses).values({
    facilityId: data.facilityId, facilityName: data.facilityName ?? null, agentName: data.agentName,
    expenseDate: data.expenseDate, store: data.store ?? null, reason: data.reason ?? null,
    amount: data.amount, cardType: data.cardType ?? "Company", receiptUrl: data.receiptUrl ?? null, notes: data.notes ?? null,
  } as any);
}

export async function setExpenseReimbursement(kind: "FR" | "BDR", id: number, status: "pending" | "submitted" | "approved") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (kind === "FR") await db.update(frExpenses).set({ reimbursementStatus: status }).where(eq(frExpenses.id, id));
  else await db.update(bdrExpenses).set({ reimbursementStatus: status }).where(eq(bdrExpenses.id, id));
}

// ── BDR Check-In matrix (replicates the MTD CHECK-IN sheet) ───────────────────
// One row per facility called in the month (or per phone number when the call
// never matched a facility). Each distinct DAY is a check-in column with the
// number of calls placed that day; TOTAL sums the month.
export async function getCheckinMatrix(month: string, agentNames?: string[] | null) {
  const db = await getDb();
  if (!db) return [];
  const LA = "America/Los_Angeles";
  const [y, m] = month.split("-").map(Number);
  const start = fromZonedTime(`${month}-01 00:00:00`, LA);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const end = fromZonedTime(`${next} 00:00:00`, LA);
  const dayOf = (d: Date) => formatInTimeZone(d, LA, "yyyy-MM-dd");
  const last10 = (s?: string | null) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d; };

  // Matched calls → facility rows
  const calls = await db.select({
    facilityId: contactLogs.facilityId, contactDate: contactLogs.contactDate, repName: contactLogs.repName,
    facilityName: facilities.name,
  }).from(contactLogs).leftJoin(facilities, eq(contactLogs.facilityId, facilities.id))
    .where(and(eq(contactLogs.contactType, "call"), gte(contactLogs.contactDate, start), lte(contactLogs.contactDate, end)));

  // Unmatched calls → phone-number rows (only still-unassigned; assigned ones already live in contact_logs)
  const unmatched = await db.select().from(rcUnmatchedCalls)
    .where(and(eq(rcUnmatchedCalls.status, "unassigned"), gte(rcUnmatchedCalls.startTime, start), lte(rcUnmatchedCalls.startTime, end)));

  type Row = { key: string; label: string; facilityId: number | null; days: Map<string, number> };
  const reps = new Map<string, Map<string, Row>>();
  const bucket = (rep: string, key: string, label: string, facilityId: number | null, day: string) => {
    if (!reps.has(rep)) reps.set(rep, new Map());
    const rows = reps.get(rep)!;
    if (!rows.has(key)) rows.set(key, { key, label, facilityId, days: new Map() });
    const r = rows.get(key)!;
    r.days.set(day, (r.days.get(day) ?? 0) + 1);
  };
  for (const c of calls) {
    if (!c.contactDate) continue;
    const rep = (c.repName ?? "(unknown)").trim() || "(unknown)";
    bucket(rep, `f:${c.facilityId}`, c.facilityName ?? `Facility #${c.facilityId}`, c.facilityId, dayOf(c.contactDate as Date));
  }
  for (const u of unmatched) {
    if (!u.startTime) continue;
    const rep = (u.agentName ?? "(unknown)").trim() || "(unknown)";
    const external = u.direction === "Inbound" ? u.fromNumber : u.toNumber;
    const p = last10(external);
    if (!p) continue;
    bucket(rep, `p:${p}`, external ?? p, null, dayOf(u.startTime as Date));
  }

  // Agent scoping: match rep blocks by full name or first name (case-insensitive)
  const norm = (s: string) => s.toLowerCase().trim();
  const first = (s: string) => norm(s).split(/\s+/)[0] ?? "";
  const wanted = agentNames?.map(norm).filter(Boolean) ?? null;
  const repMatches = (rep: string) => !wanted || wanted.some((w) => norm(rep) === w || first(rep) === first(w));

  const out = [];
  for (const [rep, rows] of Array.from(reps.entries())) {
    if (!repMatches(rep)) continue;
    const list = Array.from(rows.values()).map((r) => {
      const checkIns = Array.from(r.days.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? -1 : 1));
      return { label: r.label, facilityId: r.facilityId, isPhoneOnly: r.facilityId == null, checkIns, total: checkIns.reduce((s, c) => s + c.count, 0) };
    }).sort((a, b) => (a.checkIns[0]?.date ?? "").localeCompare(b.checkIns[0]?.date ?? "") || b.total - a.total);
    out.push({ rep, rows: list, totals: { facilities: list.length, calls: list.reduce((s, r) => s + r.total, 0) } });
  }
  return out.sort((a, b) => b.totals.calls - a.totals.calls);
}

// ── FR Visit matrix (the sheet's FIELD REPRESENTATIVES side) ─────────────────
// One row per facility visited in the month per FR. Each distinct DAY is a
// visit column; sources are visit-type contact logs + the FR field-visit log
// (facilitiesVisited JSON). Merged by max per day so a visit logged in both
// places isn't double-counted.
export async function getVisitMatrix(month: string, agentNames?: string[] | null) {
  const db = await getDb();
  if (!db) return [];
  const LA = "America/Los_Angeles";
  const [y, m] = month.split("-").map(Number);
  const start = fromZonedTime(`${month}-01 00:00:00`, LA);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const end = fromZonedTime(`${next} 00:00:00`, LA);
  const dayOf = (d: Date) => formatInTimeZone(d, LA, "yyyy-MM-dd");
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  type Row = { key: string; label: string; facilityId: number | null; days: Map<string, number> };
  const reps = new Map<string, Map<string, Row>>();
  const bucket = (rep: string, key: string, label: string, facilityId: number | null, day: string, mode: "add" | "max") => {
    if (!reps.has(rep)) reps.set(rep, new Map());
    const rows = reps.get(rep)!;
    if (!rows.has(key)) rows.set(key, { key, label, facilityId, days: new Map() });
    const r = rows.get(key)!;
    r.days.set(day, mode === "add" ? (r.days.get(day) ?? 0) + 1 : Math.max(r.days.get(day) ?? 0, 1));
  };

  // 1) Visit-type contact logs (additive — each is one logged visit)
  const visitLogs = await db.select({ facilityId: contactLogs.facilityId, contactDate: contactLogs.contactDate, repName: contactLogs.repName, facilityName: facilities.name })
    .from(contactLogs).leftJoin(facilities, eq(contactLogs.facilityId, facilities.id))
    .where(and(eq(contactLogs.contactType, "visit"), gte(contactLogs.contactDate, start), lte(contactLogs.contactDate, end)));
  for (const v of visitLogs) {
    if (!v.contactDate) continue;
    const rep = (v.repName ?? "(unknown)").trim() || "(unknown)";
    bucket(rep, `f:${v.facilityId}`, v.facilityName ?? `Facility #${v.facilityId}`, v.facilityId, dayOf(v.contactDate as Date), "add");
  }
  // 2) FR field-visit log (presence per day — avoids double counting with #1)
  const fvRows = await db.select().from(fieldVisits).where(and(gte(fieldVisits.visitDate, start), lte(fieldVisits.visitDate, end)));
  for (const fv of fvRows) {
    if (!fv.visitDate) continue;
    const rep = (fv.agentName ?? "(unknown)").trim() || "(unknown)";
    const day = dayOf(fv.visitDate as Date);
    const items: any[] = Array.isArray(fv.facilitiesVisited) ? (fv.facilitiesVisited as any[]) : [];
    for (const it of items) {
      const fid = it?.id ?? it?.facilityId ?? null;
      const name = String(it?.name ?? it?.facilityName ?? "").trim();
      if (!fid && !name) continue;
      if (/^no visits?\b/i.test(name)) continue; // historical "No visits" placeholder rows
      bucket(rep, fid ? `f:${fid}` : `n:${normName(name)}`, name || `Facility #${fid}`, fid ?? null, day, "max");
    }
  }

  const norm = (s: string) => s.toLowerCase().trim();
  const first = (s: string) => norm(s).split(/\s+/)[0] ?? "";
  const wanted = agentNames?.map(norm).filter(Boolean) ?? null;
  const repMatches = (rep: string) => !wanted || wanted.some((w) => norm(rep) === w || first(rep) === first(w));

  const out = [];
  for (const [rep, rows] of Array.from(reps.entries())) {
    if (!repMatches(rep)) continue;
    const list = Array.from(rows.values()).map((r) => {
      const checkIns = Array.from(r.days.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? -1 : 1));
      return { label: r.label, facilityId: r.facilityId, isPhoneOnly: false, checkIns, total: checkIns.reduce((s, c) => s + c.count, 0) };
    }).sort((a, b) => (a.checkIns[0]?.date ?? "").localeCompare(b.checkIns[0]?.date ?? "") || b.total - a.total);
    out.push({ rep, rows: list, totals: { facilities: list.length, calls: list.reduce((s, r) => s + r.total, 0) } });
  }
  return out.sort((a, b) => b.totals.calls - a.totals.calls);
}

// Record a RingCentral call that didn't match a facility (deduped by call id).
export async function recordUnmatchedCall(data: {
  rcCallId: string; rcSessionId?: string | null; direction?: string | null;
  fromNumber?: string | null; toNumber?: string | null; fromName?: string | null; toName?: string | null;
  startTime?: Date | null; durationSeconds?: number; callResult?: string | null; recordingUrl?: string | null; agentName?: string | null;
}) {
  const db = await getDb();
  if (!db || !data.rcCallId) return;
  await db.insert(rcUnmatchedCalls).values(data as any).onDuplicateKeyUpdate({ set: { rcSessionId: data.rcSessionId ?? null } });
}
export async function listUnmatchedCalls(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rcUnmatchedCalls).where(eq(rcUnmatchedCalls.status, "unassigned")).orderBy(desc(rcUnmatchedCalls.startTime)).limit(limit);
}
export async function setUnmatchedCallStatus(id: number, status: "unassigned" | "assigned" | "dismissed") {
  const db = await getDb();
  if (!db) return;
  await db.update(rcUnmatchedCalls).set({ status }).where(eq(rcUnmatchedCalls.id, id));
}

export async function setTaskStatus(id: number, status: "open" | "in_progress" | "completed") {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(facilityTasks).set({ status, completedAt: status === "completed" ? new Date() : null }).where(eq(facilityTasks.id, id));
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

// ─── Per-agent RingCentral Tokens ─────────────────────────────────────────────
// Each agent connects their OWN RingCentral account so calls attribute to them.

export async function getUserRingcentralToken(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userRingcentralTokens).where(eq(userRingcentralTokens.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUserRingcentralToken(data: InsertUserRingcentralToken) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .insert(userRingcentralTokens)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiry: data.tokenExpiry,
        accountId: data.accountId,
        extensionId: data.extensionId,
        ownerName: data.ownerName,
        ownerEmail: data.ownerEmail,
        ...(data.lastSyncAt !== undefined ? { lastSyncAt: data.lastSyncAt } : {}),
      },
    });
}

export async function setUserRcLastSync(userId: number, at: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(userRingcentralTokens).set({ lastSyncAt: at }).where(eq(userRingcentralTokens.userId, userId));
}

export async function deleteUserRingcentralToken(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userRingcentralTokens).where(eq(userRingcentralTokens.userId, userId));
}

/** All connected agents' tokens — used by the auto-sync poller to pull each
 *  agent's own call log with their own token. */
export async function listConnectedRcUsers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      userId: userRingcentralTokens.userId,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      ownerName: userRingcentralTokens.ownerName,
      ownerEmail: userRingcentralTokens.ownerEmail,
      extensionId: userRingcentralTokens.extensionId,
      tokenExpiry: userRingcentralTokens.tokenExpiry,
      lastSyncAt: userRingcentralTokens.lastSyncAt,
    })
    .from(userRingcentralTokens)
    .leftJoin(users, eq(users.id, userRingcentralTokens.userId));
}

/** Every user + whether they've connected their RingCentral — for the manager
 *  overview on the RingCentral settings page. */
export async function listAgentsWithRcStatus() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      agentName: users.agentName,
      role: users.role,
      ownerName: userRingcentralTokens.ownerName,
      ownerEmail: userRingcentralTokens.ownerEmail,
      tokenExpiry: userRingcentralTokens.tokenExpiry,
      lastSyncAt: userRingcentralTokens.lastSyncAt,
    })
    .from(users)
    .leftJoin(userRingcentralTokens, eq(userRingcentralTokens.userId, users.id))
    // Show real people: an agent/manager role, OR anyone with an agent name
    // (real agents are often created with the default "user" role), OR anyone
    // who has actually connected RingCentral. Don't hide a connected agent.
    .where(
      or(
        inArray(users.role, ["admin", "super_admin", "bdr_manager", "fr_manager", "bdr_agent", "fr_agent"]),
        isNotNull(users.agentName),
        isNotNull(userRingcentralTokens.userId),
      ),
    )
    .orderBy(asc(users.name));
  return rows.map((r) => ({ ...r, connected: !!r.ownerName || !!r.ownerEmail || !!r.tokenExpiry }));
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

export async function getRecentActivity(limit = 18) {
  const db = await getDb();
  if (!db) return [];
  const per = Math.max(limit, 12);
  const [calls, updates, referrals] = await Promise.all([
    db.select({
      id: contactLogs.id, facilityId: contactLogs.facilityId, facilityName: facilities.name,
      date: contactLogs.contactDate, summary: contactLogs.summary, callResult: contactLogs.callResult,
      contactType: contactLogs.contactType, repName: contactLogs.repName,
    }).from(contactLogs).leftJoin(facilities, eq(contactLogs.facilityId, facilities.id))
      .orderBy(desc(contactLogs.contactDate)).limit(per),
    db.select({
      id: facilityUpdates.id, facilityId: facilityUpdates.facilityId, facilityName: facilities.name,
      date: facilityUpdates.updateDate, summary: facilityUpdates.summary, updateType: facilityUpdates.updateType,
      repName: facilityUpdates.repName,
    }).from(facilityUpdates).leftJoin(facilities, eq(facilityUpdates.facilityId, facilities.id))
      .orderBy(desc(facilityUpdates.updateDate)).limit(per),
    db.select({
      id: facilityReferrals.id, facilityId: facilityReferrals.facilityId, facilityName: facilities.name,
      date: facilityReferrals.referralDate, clientName: facilityReferrals.clientName,
      caseValue: facilityReferrals.caseValue, repName: facilityReferrals.repName,
    }).from(facilityReferrals).leftJoin(facilities, eq(facilityReferrals.facilityId, facilities.id))
      .orderBy(desc(facilityReferrals.referralDate)).limit(per),
  ]);
  const items = [
    ...calls.map((c) => ({ kind: "call" as const, id: `c${c.id}`, facilityId: c.facilityId, facilityName: c.facilityName, date: c.date, title: c.summary || `${c.contactType} call${c.callResult ? ` — ${c.callResult}` : ""}`, repName: c.repName, tag: c.callResult ?? c.contactType })),
    ...updates.map((u) => ({ kind: "update" as const, id: `u${u.id}`, facilityId: u.facilityId, facilityName: u.facilityName, date: u.date, title: u.summary || "Note added", repName: u.repName, tag: u.updateType })),
    ...referrals.map((r) => ({ kind: "referral" as const, id: `r${r.id}`, facilityId: r.facilityId, facilityName: r.facilityName, date: r.date, title: `Referral — ${r.clientName}`, repName: r.repName, tag: r.caseValue })),
  ];
  items.sort((a, b) => new Date(b.date as any).getTime() - new Date(a.date as any).getTime());
  return items.slice(0, limit);
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

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationItem = {
  id: string;
  type: "followup" | "recap" | "lead" | "imbalance";
  title: string;
  description: string;
  timestamp: string | null;
  facilityId: number | null;
  link: string;
};

/**
 * Aggregates the in-app notification feed for a single user from existing data:
 *   1. Follow-ups due today / overdue (the user's own open tasks)
 *   2. New call recaps + activity notes (recent facility_updates)
 *   3. New referrals received from partners (recent inbound facility_leads)
 *   4. Referral imbalance flags (sent vs received gap on the user's facilities)
 * Managers (seesAll) see these across all reps; everyone else sees only their own.
 * Each source is isolated in try/catch so one failure can't break the bell.
 */
export async function getNotificationsForUser(
  userId: number,
  seesAll: boolean,
): Promise<NotificationItem[]> {
  const db = await getDb();
  if (!db) return [];
  const items: NotificationItem[] = [];
  const now = new Date();
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

  // 1) Follow-ups due today or overdue
  try {
    const tasks = await db
      .select({
        id: facilityTasks.id,
        facilityId: facilityTasks.facilityId,
        facilityName: facilities.name,
        title: facilityTasks.title,
        dueDate: facilityTasks.dueDate,
      })
      .from(facilityTasks)
      .leftJoin(facilities, eq(facilityTasks.facilityId, facilities.id))
      .where(and(
        eq(facilityTasks.assignedToId, userId),
        eq(facilityTasks.status, "open"),
        lte(facilityTasks.dueDate, endOfToday),
      ))
      .orderBy(asc(facilityTasks.dueDate))
      .limit(25);
    for (const t of tasks) {
      const overdue = t.dueDate ? new Date(t.dueDate) < startOfToday : false;
      items.push({
        id: `followup-${t.id}`,
        type: "followup",
        title: overdue ? "Follow-up overdue" : "Follow-up due today",
        description: `${t.title}${t.facilityName ? ` · ${t.facilityName}` : ""}`,
        timestamp: iso(t.dueDate),
        facilityId: t.facilityId,
        link: t.facilityId ? `/crm/facilities/${t.facilityId}` : "/",
      });
    }
  } catch (e) { console.warn("[notifications] follow-ups failed:", e); }

  // 2) New call recaps / activity notes
  try {
    const conds: any[] = [gte(facilityUpdates.createdAt, since)];
    if (!seesAll) conds.push(eq(facilityUpdates.repId, userId));
    const recaps = await db
      .select({
        id: facilityUpdates.id,
        facilityId: facilityUpdates.facilityId,
        facilityName: facilities.name,
        summary: facilityUpdates.summary,
        updateType: facilityUpdates.updateType,
        createdAt: facilityUpdates.createdAt,
      })
      .from(facilityUpdates)
      .leftJoin(facilities, eq(facilityUpdates.facilityId, facilities.id))
      .where(and(...conds))
      .orderBy(desc(facilityUpdates.createdAt))
      .limit(25);
    for (const r of recaps) {
      items.push({
        id: `recap-${r.id}`,
        type: "recap",
        title: r.updateType === "transcript" ? "New call recap" : "New activity note",
        description: `${r.summary || "Update added"}${r.facilityName ? ` · ${r.facilityName}` : ""}`,
        timestamp: iso(r.createdAt),
        facilityId: r.facilityId,
        link: r.facilityId ? `/crm/facilities/${r.facilityId}` : "/",
      });
    }
  } catch (e) { console.warn("[notifications] recaps failed:", e); }

  // 3) New referrals received from partners (inbound leads)
  try {
    const conds: any[] = [
      gte(facilityLeads.createdAt, since),
      eq(facilityLeads.direction, "received_from_facility"),
    ];
    if (!seesAll) conds.push(eq(facilityLeads.repId, userId));
    const leads = await db
      .select({
        id: facilityLeads.id,
        facilityId: facilityLeads.facilityId,
        facilityName: facilities.name,
        contactPerson: facilityLeads.contactPerson,
        createdAt: facilityLeads.createdAt,
      })
      .from(facilityLeads)
      .leftJoin(facilities, eq(facilityLeads.facilityId, facilities.id))
      .where(and(...conds))
      .orderBy(desc(facilityLeads.createdAt))
      .limit(25);
    for (const l of leads) {
      items.push({
        id: `lead-${l.id}`,
        type: "lead",
        title: "New referral received",
        description: `${l.facilityName || "A partner"} sent a lead${l.contactPerson ? ` · ${l.contactPerson}` : ""}`,
        timestamp: iso(l.createdAt),
        facilityId: l.facilityId,
        link: l.facilityId ? `/crm/facilities/${l.facilityId}` : "/crm/leads",
      });
    }
  } catch (e) { console.warn("[notifications] leads failed:", e); }

  // 4) Referral imbalance flags
  try {
    const conds: any[] = [
      sql`abs(coalesce(${facilities.totalLeadsReceived}, 0) - coalesce(${facilities.totalLeadsSent}, 0)) >= 3`,
    ];
    if (!seesAll) conds.push(eq(facilities.assignedRepId, userId));
    const facs = await db
      .select({
        id: facilities.id,
        name: facilities.name,
        sent: facilities.totalLeadsSent,
        received: facilities.totalLeadsReceived,
      })
      .from(facilities)
      .where(and(...conds))
      .limit(15);
    for (const f of facs) {
      const sent = f.sent ?? 0;
      const received = f.received ?? 0;
      const owedToUs = received - sent;
      items.push({
        id: `imbalance-${f.id}`,
        type: "imbalance",
        title: "Referral imbalance",
        description: owedToUs > 0
          ? `${f.name}: ${received} received vs ${sent} sent — reciprocate to keep the partner warm`
          : `${f.name}: ${sent} sent vs ${received} received — partner isn't reciprocating yet`,
        timestamp: null,
        facilityId: f.id,
        link: `/crm/facilities/${f.id}`,
      });
    }
  } catch (e) { console.warn("[notifications] imbalance failed:", e); }

  items.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  return items.slice(0, 50);
}

// ─── BDR Reports ─────────────────────────────────────────────────────────────

/** Call activity summary grouped by rep and month from contact_logs */
export async function getBdrCallActivity(filters?: { repName?: string; month?: string }) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [eq(contactLogs.contactType, "call")];
  if (filters?.repName) conditions.push(eq(contactLogs.repName, filters.repName));

  const rows = await db
    .select({
      repName: contactLogs.repName,
      callType: contactLogs.callType,
      callResult: contactLogs.callResult,
      contactDate: contactLogs.contactDate,
    })
    .from(contactLogs)
    .where(and(...conditions))
    .orderBy(desc(contactLogs.contactDate));

  // Aggregate in JS for flexibility
  const byRepMonth: Record<string, Record<string, {
    total: number; connected: number; voicemail: number; noAnswer: number;
    partnerCheckin: number; bdrCheckin: number; frCheckin: number; internal: number; potentialLead: number;
  }>> = {};

  for (const row of rows) {
    const rep = row.repName ?? "Unknown";
    const d = row.contactDate ? new Date(row.contactDate) : new Date();
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (filters?.month && monthKey !== filters.month) continue;

    if (!byRepMonth[rep]) byRepMonth[rep] = {};
    if (!byRepMonth[rep][monthKey]) byRepMonth[rep][monthKey] = {
      total: 0, connected: 0, voicemail: 0, noAnswer: 0,
      partnerCheckin: 0, bdrCheckin: 0, frCheckin: 0, internal: 0, potentialLead: 0,
    };
    const cell = byRepMonth[rep][monthKey];
    cell.total++;
    if (row.callResult === "connected") cell.connected++;
    if (row.callResult === "voicemail") cell.voicemail++;
    if (row.callResult === "no_answer") cell.noAnswer++;
    if (row.callType === "partner_checkin") cell.partnerCheckin++;
    if (row.callType === "bdr_checkin") cell.bdrCheckin++;
    if (row.callType === "fr_checkin") cell.frCheckin++;
    if (row.callType === "internal") cell.internal++;
    if (row.callType === "potential_lead") cell.potentialLead++;
  }

  const result: Array<{
    repName: string; month: string; total: number; connected: number; voicemail: number; noAnswer: number;
    partnerCheckin: number; bdrCheckin: number; frCheckin: number; internal: number; potentialLead: number;
  }> = [];
  for (const [rep, months] of Object.entries(byRepMonth)) {
    for (const [month, stats] of Object.entries(months)) {
      result.push({ repName: rep, month, ...stats });
    }
  }
  return result.sort((a, b) => b.month.localeCompare(a.month) || a.repName.localeCompare(b.repName));
}

/** Partner check-in summary per rep: target vs actual */
export async function getBdrPartnerCheckins(filters?: { repName?: string }) {
  const db = await getDb();
  if (!db) return [];

  // Count facilities per rep (active partners)
  const allFacilities = await db
    .select({
      assignedRepName: facilities.assignedRepName,
      id: facilities.id,
      name: facilities.name,
      category: facilities.category,
      partnerStatus: facilities.partnerStatus,
      lastContactDate: facilities.lastContactDate,
    })
    .from(facilities)
    .where(sql`${facilities.partnerStatus} IN ('active_partner', 'priority_partner')`);

  // Count check-in calls per rep from contact_logs
  const checkinLogs = await db
    .select({
      repName: contactLogs.repName,
      facilityId: contactLogs.facilityId,
      contactDate: contactLogs.contactDate,
    })
    .from(contactLogs)
    .where(eq(contactLogs.callType, "partner_checkin"));

  const repStats: Record<string, {
    repName: string; totalPartners: number; checkinsThisMonth: number;
    checkinsLast30Days: number; facilitiesNeedingCheckin: number;
  }> = {};

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const f of allFacilities) {
    const rep = f.assignedRepName ?? "Unassigned";
    if (filters?.repName && rep !== filters.repName) continue;
    if (!repStats[rep]) repStats[rep] = { repName: rep, totalPartners: 0, checkinsThisMonth: 0, checkinsLast30Days: 0, facilitiesNeedingCheckin: 0 };
    repStats[rep].totalPartners++;
    const lastContact = f.lastContactDate ? new Date(f.lastContactDate) : null;
    if (!lastContact || lastContact < thirtyDaysAgo) repStats[rep].facilitiesNeedingCheckin++;
  }

  for (const log of checkinLogs) {
    const rep = log.repName ?? "Unknown";
    if (filters?.repName && rep !== filters.repName) continue;
    if (!repStats[rep]) continue;
    const d = log.contactDate ? new Date(log.contactDate) : null;
    if (!d) continue;
    if (d >= thisMonthStart) repStats[rep].checkinsThisMonth++;
    if (d >= thirtyDaysAgo) repStats[rep].checkinsLast30Days++;
  }

  return Object.values(repStats).sort((a, b) => b.totalPartners - a.totalPartners);
}

/** Top facilities by contact frequency */
export async function getBdrTopFacilities(limit = 20) {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      facilityId: contactLogs.facilityId,
      repName: contactLogs.repName,
    })
    .from(contactLogs)
    .where(eq(contactLogs.contactType, "call"));

  const counts: Record<number, { count: number; reps: Set<string> }> = {};
  for (const row of rows) {
    if (!counts[row.facilityId]) counts[row.facilityId] = { count: 0, reps: new Set() };
    counts[row.facilityId].count++;
    if (row.repName) counts[row.facilityId].reps.add(row.repName);
  }

  const sorted = Object.entries(counts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, limit);

  const facilityIds = sorted.map(([id]) => Number(id));
  if (facilityIds.length === 0) return [];

  const facilityRows = await db.select().from(facilities).where(
    sql`${facilities.id} IN (${sql.join(facilityIds.map((id) => sql`${id}`), sql`, `)})`
  );

  const facilityMap = new Map(facilityRows.map((f) => [f.id, f]));
  return sorted.map(([id, stats]) => {
    const f = facilityMap.get(Number(id));
    return {
      facilityId: Number(id),
      name: f?.name ?? "Unknown",
      category: f?.category ?? "other",
      city: f?.city ?? "",
      assignedRepName: f?.assignedRepName ?? "",
      callCount: stats.count,
      reps: Array.from(stats.reps).join(", "),
    };
  });
}
