import { eq, and, desc, sql, gte, lte, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, appSettings, savedLeads, savedSearches, InsertSavedLead, InsertSavedSearch, agentZones, InsertAgentZone, piClients, InsertPiClient, filevineSettings, InsertFilevineSettings, piClientCallLogs, InsertPiClientCallLog, fieldVisits, InsertFieldVisit, frExpenses, InsertFrExpense, bdrExpenses, InsertBdrExpense, referralRewards, InsertReferralReward, frErrands, InsertFrErrand, referralTracker, InsertReferralTracker, outboundReferrals, InsertOutboundReferral, inboundLeads, InsertInboundLead } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  // If duplicate rows share an email, prefer the one that has a password set
  // (the account an admin configured for login), then the most recent row.
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .orderBy(sql`(${users.passwordHash} is not null) desc`, desc(users.id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── App settings (key-value) ────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const r = await db.select().from(appSettings).where(eq(appSettings.settingKey, key)).limit(1);
    return r.length ? (r[0].settingValue ?? null) : null;
  } catch (e) {
    console.warn("[Database] getSetting failed:", e);
    return null;
  }
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(appSettings)
    .values({ settingKey: key, settingValue: value })
    .onDuplicateKeyUpdate({ set: { settingValue: value } });
}

/** Branding logos (small resized data URLs) for light + dark mode. */
export async function getBranding(): Promise<{ logoLight: string | null; logoDark: string | null; slogan: string | null }> {
  const [logoLight, logoDark, slogan] = await Promise.all([
    getSetting("logo_light"),
    getSetting("logo_dark"),
    getSetting("brand_slogan"),
  ]);
  return { logoLight, logoDark, slogan };
}

export async function setUserPhoto(userId: number, photoUrl: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(users).set({ photoUrl }).where(eq(users.id, userId));
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(users.name);
}

export async function setUserRole(id: number, role: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ role: role as any }).where(eq(users.id, id));
}

export async function setUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export async function setUserAgentName(id: number, agentName: string | null) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(users).set({ agentName: agentName || null }).where(eq(users.id, id));
}

export async function createUserAccount(data: { openId: string; name: string; email: string; role: string; passwordHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(users).values({
    openId: data.openId,
    name: data.name,
    email: data.email,
    role: data.role as any,
    passwordHash: data.passwordHash,
  });
}

export async function mergeUserByEmail(openId: string, email: string): Promise<void> {
  // When a pre-registered agent row exists (keyed by email with a placeholder openId),
  // update it with the real openId so all their BDR data links correctly.
  const db = await getDb();
  if (!db) return;
  await db.update(users)
    .set({ openId })
    .where(and(eq(users.email, email), sql`openId LIKE 'pending_%'`));
}

// ─── Saved Leads ─────────────────────────────────────────────────────────────

export async function getSavedLeads(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(savedLeads).where(eq(savedLeads.userId, userId)).orderBy(desc(savedLeads.createdAt));
}

export async function getSavedLeadByPlaceId(userId: number, placeId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(savedLeads)
    .where(and(eq(savedLeads.userId, userId), eq(savedLeads.placeId, placeId)))
    .limit(1);
  return result[0] ?? undefined;
}

export async function insertSavedLead(lead: InsertSavedLead) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(savedLeads).values(lead);
}

export async function deleteSavedLead(userId: number, placeId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(savedLeads).where(and(eq(savedLeads.userId, userId), eq(savedLeads.placeId, placeId)));
}

export async function updateSavedLeadAnnotation(userId: number, placeId: string, annotation: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(savedLeads).set({ annotation }).where(and(eq(savedLeads.userId, userId), eq(savedLeads.placeId, placeId)));
}

export async function updateSavedLeadAgent(placeId: string, assignedAgent: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(savedLeads).set({ assignedAgent }).where(eq(savedLeads.placeId, placeId));
}

// ─── Agent Zones / Agent Management ─────────────────────────────────────────

export async function getAllAgentZones() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agentZones).orderBy(agentZones.agentName);
}

export async function getAgentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(agentZones).where(eq(agentZones.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function createAgent(data: InsertAgentZone) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(agentZones).values(data);
}

export async function updateAgent(id: number, data: Partial<InsertAgentZone>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(agentZones).set(data).where(eq(agentZones.id, id));
}

export async function deleteAgent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(agentZones).where(eq(agentZones.id, id));
}

export async function upsertAgentZone(agentName: string, color: string, cities: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(agentZones).where(eq(agentZones.agentName, agentName)).limit(1);
  if (existing.length > 0) {
    await db.update(agentZones).set({ color, cities }).where(eq(agentZones.agentName, agentName));
  } else {
    await db.insert(agentZones).values({ agentName, color, cities });
  }
}

// ─── PI Clients ──────────────────────────────────────────────────────────────

export async function getAllPiClients() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(piClients).orderBy(desc(piClients.createdAt));
}

export async function getPiClientById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(piClients).where(eq(piClients.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function createPiClient(data: InsertPiClient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(piClients).values(data);
  return result;
}

export async function updatePiClient(id: number, data: Partial<InsertPiClient>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(piClients).set(data).where(eq(piClients.id, id));
}

export async function deletePiClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(piClients).where(eq(piClients.id, id));
}

// ─── Filevine Settings ───────────────────────────────────────────────────────

export async function getFilevineSettings(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(filevineSettings).where(eq(filevineSettings.userId, userId)).limit(1);
  return result[0] ?? undefined;
}

export async function upsertFilevineSettings(data: InsertFilevineSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(filevineSettings).where(eq(filevineSettings.userId, data.userId)).limit(1);
  if (existing.length > 0) {
    await db.update(filevineSettings).set(data).where(eq(filevineSettings.userId, data.userId));
  } else {
    await db.insert(filevineSettings).values(data);
  }
}

// ─── Saved Searches ──────────────────────────────────────────────────────────

export async function getSavedSearches(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(savedSearches).where(eq(savedSearches.userId, userId)).orderBy(desc(savedSearches.createdAt));
}

export async function insertSavedSearch(search: InsertSavedSearch) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(savedSearches).values(search);
}

export async function deleteSavedSearch(userId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(savedSearches).where(and(eq(savedSearches.userId, userId), eq(savedSearches.id, id)));
}

// ─── PI Client Call Logs ─────────────────────────────────────────────────────

export async function createPiClientCallLog(data: InsertPiClientCallLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(piClientCallLogs).values(data);
}

export async function getPiClientCallLogs(piClientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(piClientCallLogs)
    .where(eq(piClientCallLogs.piClientId, piClientId))
    .orderBy(desc(piClientCallLogs.createdAt));
}

/** Find a PI client whose phone number matches (strips non-digits for comparison) */
export async function findPiClientByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  // Normalise: keep digits only
  const digits = phone.replace(/\D/g, "");
  if (!digits) return undefined;
  const all = await db.select().from(piClients);
  return all.find((c) => c.phone && c.phone.replace(/\D/g, "") === digits);
}

export async function updatePiClientCallLogTranscript(id: number, transcript: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(piClientCallLogs).set({ transcript }).where(eq(piClientCallLogs.id, id));
}

// ─── Field Visits ─────────────────────────────────────────────────────────────

export interface BdrFilters {
  agent?: string;
  dateFrom?: string;  // ISO date string YYYY-MM-DD
  dateTo?: string;
  month?: string;     // e.g. "January"
  year?: string;      // e.g. "2026"
  status?: string;
  search?: string;    // free-text search on client/facility name
}

export async function getAllFieldVisits(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(fieldVisits.agentName, filters.agent));
  if (filters.dateFrom) conditions.push(gte(fieldVisits.visitDate, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(fieldVisits.visitDate, to));
  }
  if (filters.year) {
    conditions.push(gte(fieldVisits.visitDate, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(fieldVisits.visitDate, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  if (filters.search) conditions.push(like(fieldVisits.notes, `%${filters.search}%`));
  const q = db.select().from(fieldVisits);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(fieldVisits.visitDate));
}

export async function createFieldVisit(data: InsertFieldVisit) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(fieldVisits).values(data);
}

export async function updateFieldVisit(id: number, data: Partial<InsertFieldVisit>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(fieldVisits).set(data).where(eq(fieldVisits.id, id));
}

export async function deleteFieldVisit(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(fieldVisits).where(eq(fieldVisits.id, id));
}

// ─── FR Expenses ─────────────────────────────────────────────────────────────

export async function getAllFrExpenses(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(frExpenses.agentName, filters.agent));
  if (filters.dateFrom) conditions.push(gte(frExpenses.expenseDate, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(frExpenses.expenseDate, to));
  }
  if (filters.year) {
    conditions.push(gte(frExpenses.expenseDate, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(frExpenses.expenseDate, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  if (filters.status) conditions.push(eq(frExpenses.cardType, filters.status as "Personal" | "Company"));
  if (filters.search) conditions.push(like(frExpenses.facilityName, `%${filters.search}%`));
  const q = db.select().from(frExpenses);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(frExpenses.expenseDate));
}

export async function createFrExpense(data: InsertFrExpense) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(frExpenses).values(data);
}

export async function updateFrExpense(id: number, data: Partial<InsertFrExpense>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(frExpenses).set(data).where(eq(frExpenses.id, id));
}

export async function deleteFrExpense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(frExpenses).where(eq(frExpenses.id, id));
}

// ─── BDR Expenses ─────────────────────────────────────────────────────────────

export async function getAllBdrExpenses(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(bdrExpenses.agentName, filters.agent));
  if (filters.dateFrom) conditions.push(gte(bdrExpenses.expenseDate, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(bdrExpenses.expenseDate, to));
  }
  if (filters.month) conditions.push(like(bdrExpenses.month, `%${filters.month}%`));
  if (filters.year) {
    conditions.push(gte(bdrExpenses.expenseDate, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(bdrExpenses.expenseDate, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  if (filters.search) conditions.push(like(bdrExpenses.facilityName, `%${filters.search}%`));
  const q = db.select().from(bdrExpenses);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(bdrExpenses.expenseDate));
}

export async function createBdrExpense(data: InsertBdrExpense) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(bdrExpenses).values(data);
}

export async function updateBdrExpense(id: number, data: Partial<InsertBdrExpense>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bdrExpenses).set(data).where(eq(bdrExpenses.id, id));
}

export async function deleteBdrExpense(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(bdrExpenses).where(eq(bdrExpenses.id, id));
}

// ─── Referral Rewards ─────────────────────────────────────────────────────────

export async function getAllReferralRewards(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(referralRewards.agentName, filters.agent));
  if (filters.status) conditions.push(eq(referralRewards.status, filters.status as "Accepted" | "Pending" | "Denied"));
  if (filters.search) conditions.push(like(referralRewards.clientName, `%${filters.search}%`));
  if (filters.dateFrom) conditions.push(gte(referralRewards.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(referralRewards.createdAt, to));
  }
  if (filters.year) {
    conditions.push(gte(referralRewards.createdAt, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(referralRewards.createdAt, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  const q = db.select().from(referralRewards);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(referralRewards.createdAt));
}

export async function createReferralReward(data: InsertReferralReward) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(referralRewards).values(data);
}

export async function updateReferralReward(id: number, data: Partial<InsertReferralReward>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referralRewards).set(data).where(eq(referralRewards.id, id));
}

export async function deleteReferralReward(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(referralRewards).where(eq(referralRewards.id, id));
}

// ─── FR Errands ───────────────────────────────────────────────────────────────

export async function getAllFrErrands(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(frErrands.agentName, filters.agent));
  if (filters.status) conditions.push(eq(frErrands.status, filters.status as "Completed" | "Not Completed" | "In Progress"));
  if (filters.dateFrom) conditions.push(gte(frErrands.errandDate, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(frErrands.errandDate, to));
  }
  if (filters.year) {
    conditions.push(gte(frErrands.errandDate, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(frErrands.errandDate, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  if (filters.search) conditions.push(like(frErrands.clientName, `%${filters.search}%`));
  const q = db.select().from(frErrands);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(frErrands.errandDate));
}

export async function createFrErrand(data: InsertFrErrand) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(frErrands).values(data);
}

export async function updateFrErrand(id: number, data: Partial<InsertFrErrand>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(frErrands).set(data).where(eq(frErrands.id, id));
}

export async function deleteFrErrand(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(frErrands).where(eq(frErrands.id, id));
}

// ─── Referral Tracker ─────────────────────────────────────────────────────────

export async function getAllReferralTracker(filters: BdrFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.agent) conditions.push(eq(referralTracker.bdrAssigned, filters.agent));
  if (filters.status) conditions.push(eq(referralTracker.status, filters.status as "Successful Sent" | "Demo Sent" | "Pending" | "Unsuccessful" | "In Progress"));
  if (filters.month) conditions.push(like(referralTracker.month, `%${filters.month}%`));
  if (filters.search) conditions.push(like(referralTracker.clientName, `%${filters.search}%`));
  if (filters.dateFrom) conditions.push(gte(referralTracker.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo) {
    const to = new Date(filters.dateTo); to.setHours(23,59,59,999);
    conditions.push(lte(referralTracker.createdAt, to));
  }
  if (filters.year) {
    conditions.push(gte(referralTracker.createdAt, new Date(`${filters.year}-01-01`)));
    conditions.push(lte(referralTracker.createdAt, new Date(`${filters.year}-12-31T23:59:59`)));
  }
  const q = db.select().from(referralTracker);
  if (conditions.length) q.where(and(...conditions));
  return q.orderBy(desc(referralTracker.createdAt));
}

export async function createReferralTracker(data: InsertReferralTracker) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(referralTracker).values(data);
}

export async function updateReferralTracker(id: number, data: Partial<InsertReferralTracker>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referralTracker).set(data).where(eq(referralTracker.id, id));
}

export async function deleteReferralTracker(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(referralTracker).where(eq(referralTracker.id, id));
}

// ─── Agent Dashboard KPIs ─────────────────────────────────────────────────────

export async function getAgentDashboardKpis() {
  const db = await getDb();
  if (!db) return [];

  // Aggregate per agent: visits, FR expenses, BDR expenses, referral rewards, errands
  const [visits, frExp, bdrExp, rewards, errands] = await Promise.all([
    db.select().from(fieldVisits),
    db.select().from(frExpenses),
    db.select().from(bdrExpenses),
    db.select().from(referralRewards),
    db.select().from(frErrands),
  ]);

  // Build a map of agentName -> KPIs
  const agentMap: Record<string, {
    agentName: string;
    totalVisits: number;
    totalFacilitiesVisited: number;
    totalHoursWorked: number;
    totalFrExpenses: number;
    totalBdrExpenses: number;
    totalReferralRewards: number;
    acceptedRewards: number;
    pendingRewards: number;
    totalErrands: number;
    completedErrands: number;
  }> = {};

  const ensure = (name: string) => {
    if (!agentMap[name]) {
      agentMap[name] = {
        agentName: name,
        totalVisits: 0,
        totalFacilitiesVisited: 0,
        totalHoursWorked: 0,
        totalFrExpenses: 0,
        totalBdrExpenses: 0,
        totalReferralRewards: 0,
        acceptedRewards: 0,
        pendingRewards: 0,
        totalErrands: 0,
        completedErrands: 0,
      };
    }
    return agentMap[name];
  };

  for (const v of visits) {
    const kpi = ensure(v.agentName);
    kpi.totalVisits++;
    kpi.totalFacilitiesVisited += v.facilityCount ?? 0;
    if (v.hoursWorked) {
      const h = parseFloat(v.hoursWorked);
      if (!isNaN(h)) kpi.totalHoursWorked += h;
    }
  }

  for (const e of frExp) {
    const kpi = ensure(e.agentName);
    kpi.totalFrExpenses += parseFloat(String(e.amount ?? 0));
  }

  for (const e of bdrExp) {
    const kpi = ensure(e.agentName);
    kpi.totalBdrExpenses += parseFloat(String(e.amount ?? 0));
  }

  for (const r of rewards) {
    const kpi = ensure(r.agentName);
    kpi.totalReferralRewards += parseFloat(String(r.payoutAmount ?? 0));
    if (r.status === "Accepted") kpi.acceptedRewards++;
    if (r.status === "Pending") kpi.pendingRewards++;
  }

  for (const e of errands) {
    if (!e.agentName) continue;
    const kpi = ensure(e.agentName);
    kpi.totalErrands++;
    if (e.status === "Completed") kpi.completedErrands++;
  }

  return Object.values(agentMap).sort((a, b) => a.agentName.localeCompare(b.agentName));
}

// ─── Outbound Referrals ────────────────────────────────────────────────────────

export async function getAllOutboundReferrals() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(outboundReferrals).orderBy(desc(outboundReferrals.createdAt));
}

export async function createOutboundReferral(data: Omit<InsertOutboundReferral, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(outboundReferrals).values(data);
}

export async function updateOutboundReferral(id: number, data: Partial<Omit<InsertOutboundReferral, "id" | "createdAt" | "updatedAt">>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(outboundReferrals).set(data).where(eq(outboundReferrals.id, id));
}

export async function deleteOutboundReferral(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(outboundReferrals).where(eq(outboundReferrals.id, id));
}

// ─── Inbound Leads ────────────────────────────────────────────────────────────

export async function getAllInboundLeads() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inboundLeads).orderBy(desc(inboundLeads.createdAt));
}

export async function createInboundLead(data: Omit<InsertInboundLead, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(inboundLeads).values(data);
}

export async function updateInboundLead(id: number, data: Partial<Omit<InsertInboundLead, "id" | "createdAt" | "updatedAt">>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(inboundLeads).set(data).where(eq(inboundLeads.id, id));
}

export async function deleteInboundLead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(inboundLeads).where(eq(inboundLeads.id, id));
}

// ─── Referral Reporting Aggregates ───────────────────────────────────────────

export async function getReferralStats() {
  const db = await getDb();
  if (!db) return { outbound: [], inbound: [], summary: { totalOutbound: 0, totalInbound: 0, totalSigned: 0 } };

  const outboundRows = await db.select().from(outboundReferrals).orderBy(desc(outboundReferrals.createdAt));
  const inboundRows = await db.select().from(inboundLeads).orderBy(desc(inboundLeads.createdAt));

  // Per-facility aggregates
  const facilityMap: Record<string, { sent: number; received: number; signed: number }> = {};

  for (const r of outboundRows) {
    const key = r.recommendedFacility ?? "Unknown";
    if (!facilityMap[key]) facilityMap[key] = { sent: 0, received: 0, signed: 0 };
    facilityMap[key].sent++;
  }
  for (const l of inboundRows) {
    const key = l.referringFacility ?? "Unknown";
    if (!facilityMap[key]) facilityMap[key] = { sent: 0, received: 0, signed: 0 };
    facilityMap[key].received++;
    if (l.signed) facilityMap[key].signed++;
  }

  const byFacility = Object.entries(facilityMap).map(([facility, counts]) => ({ facility, ...counts }));

  // Per-agent aggregates
  const agentMap: Record<string, { sent: number; received: number }> = {};
  for (const r of outboundRows) {
    const key = r.assignedAgent ?? "Unassigned";
    if (!agentMap[key]) agentMap[key] = { sent: 0, received: 0 };
    agentMap[key].sent++;
  }
  for (const l of inboundRows) {
    const key = l.assignedAgent ?? "Unassigned";
    if (!agentMap[key]) agentMap[key] = { sent: 0, received: 0 };
    agentMap[key].received++;
  }
  const byAgent = Object.entries(agentMap).map(([agent, counts]) => ({ agent, ...counts }));

  return {
    outbound: outboundRows,
    inbound: inboundRows,
    byFacility,
    byAgent,
    summary: {
      totalOutbound: outboundRows.length,
      totalInbound: inboundRows.length,
      totalSigned: inboundRows.filter(l => l.signed).length,
    },
  };
}

// ─── Admin BDR Summary Dashboard ──────────────────────────────────────────────

export async function getBdrAdminDashboard() {
  const db = await getDb();
  if (!db) return null;

  const [visits, frExp, bdrExp, rewards, errands, trackers, inboundLeadsRows] = await Promise.all([
    db.select().from(fieldVisits),
    db.select().from(frExpenses),
    db.select().from(bdrExpenses),
    db.select().from(referralRewards),
    db.select().from(frErrands),
    db.select().from(referralTracker),
    db.select().from(inboundLeads),
  ]);

  const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];

  // ── Per-agent totals ──────────────────────────────────────────────────────
  const agentMap: Record<string, {
    visits: number; facilities: number; hours: number;
    frExpenses: number; bdrExpenses: number; totalExpenses: number;
    rewards: number; rewardsPaid: number;
    errands: number; errandsCompleted: number;
    referrals: number; referralsSuccessful: number;
  }> = {};

  const ensureAgent = (name: string) => {
    if (!agentMap[name]) agentMap[name] = {
      visits: 0, facilities: 0, hours: 0,
      frExpenses: 0, bdrExpenses: 0, totalExpenses: 0,
      rewards: 0, rewardsPaid: 0,
      errands: 0, errandsCompleted: 0,
      referrals: 0, referralsSuccessful: 0,
    };
    return agentMap[name];
  };

  for (const v of visits) {
    const a = ensureAgent(v.agentName);
    a.visits++;
    a.facilities += v.facilityCount ?? 0;
    if (v.hoursWorked) { const h = parseFloat(v.hoursWorked); if (!isNaN(h)) a.hours += h; }
  }
  for (const e of frExp) {
    const a = ensureAgent(e.agentName);
    const amt = parseFloat(String(e.amount ?? 0));
    a.frExpenses += amt; a.totalExpenses += amt;
  }
  for (const e of bdrExp) {
    const a = ensureAgent(e.agentName);
    const amt = parseFloat(String(e.amount ?? 0));
    a.bdrExpenses += amt; a.totalExpenses += amt;
  }
  for (const r of rewards) {
    const a = ensureAgent(r.agentName);
    a.rewards++;
    a.rewardsPaid += parseFloat(String(r.payoutAmount ?? 0));
  }
  for (const e of errands) {
    if (!e.agentName) continue;
    const a = ensureAgent(e.agentName);
    a.errands++;
    if (e.status === "Completed") a.errandsCompleted++;
  }
  for (const t of trackers) {
    if (!t.bdrAssigned) continue;
    const a = ensureAgent(t.bdrAssigned);
    a.referrals++;
    if (t.status === "Successful Sent") a.referralsSuccessful++;
  }

  const byAgent = AGENTS.map(name => ({ agent: name, ...(agentMap[name] ?? {
    visits: 0, facilities: 0, hours: 0,
    frExpenses: 0, bdrExpenses: 0, totalExpenses: 0,
    rewards: 0, rewardsPaid: 0,
    errands: 0, errandsCompleted: 0,
    referrals: 0, referralsSuccessful: 0,
  }) }));

  // ── Monthly trends (visits + expenses) ───────────────────────────────────
  const monthMap: Record<string, { month: string; visits: number; expenses: number; rewards: number }> = {};
  const ensureMonth = (m: string) => {
    if (!monthMap[m]) monthMap[m] = { month: m, visits: 0, expenses: 0, rewards: 0 };
    return monthMap[m];
  };
  for (const v of visits) {
    if (!v.visitDate) continue;
    const d = new Date(v.visitDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ensureMonth(key).visits++;
  }
  for (const e of frExp) {
    if (!e.expenseDate) continue;
    const d = new Date(e.expenseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ensureMonth(key).expenses += parseFloat(String(e.amount ?? 0));
  }
  for (const e of bdrExp) {
    if (!e.expenseDate) continue;
    const d = new Date(e.expenseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ensureMonth(key).expenses += parseFloat(String(e.amount ?? 0));
  }
  for (const r of rewards) {
    if (!r.createdAt) continue;
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ensureMonth(key).rewards += parseFloat(String(r.payoutAmount ?? 0));
  }
  const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

  // ── Errand type breakdown ─────────────────────────────────────────────────
  const errandTypeMap: Record<string, number> = {};
  for (const e of errands) {
    const t = e.taskType ?? "Other";
    errandTypeMap[t] = (errandTypeMap[t] ?? 0) + 1;
  }
  const byErrandType = Object.entries(errandTypeMap).map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // ── Referral status breakdown ─────────────────────────────────────────────
  const refStatusMap: Record<string, number> = {};
  for (const t of trackers) {
    refStatusMap[t.status] = (refStatusMap[t.status] ?? 0) + 1;
  }
  const byReferralStatus = Object.entries(refStatusMap).map(([status, count]) => ({ status, count }));

  // ── Reward type breakdown (by referralType) ──────────────────────────────
  const rewardTierMap: Record<string, { count: number; total: number }> = {};
  for (const r of rewards) {
    const tier = r.referralType ?? "Other";
    if (!rewardTierMap[tier]) rewardTierMap[tier] = { count: 0, total: 0 };
    rewardTierMap[tier].count++;
    rewardTierMap[tier].total += parseFloat(String(r.payoutAmount ?? 0));
  }
  const byRewardTier = Object.entries(rewardTierMap).map(([tier, d]) => ({ tier, ...d }));

  // ── Top-level KPIs ────────────────────────────────────────────────────────
  const totalExpenses = frExp.reduce((s, e) => s + parseFloat(String(e.amount ?? 0)), 0)
    + bdrExp.reduce((s, e) => s + parseFloat(String(e.amount ?? 0)), 0);
  const totalRewardsPaid = rewards.reduce((s, r) => s + parseFloat(String(r.payoutAmount ?? 0)), 0);

  return {
    kpis: {
      totalVisits: visits.length,
      totalFacilities: visits.reduce((s, v) => s + (v.facilityCount ?? 0), 0),
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalRewardsPaid: Math.round(totalRewardsPaid * 100) / 100,
      totalErrands: errands.length,
      completedErrands: errands.filter(e => e.status === "Completed").length,
      totalReferrals: trackers.length,
      successfulReferrals: trackers.filter(t => t.status === "Successful Sent").length,
      totalLeadsReceived: inboundLeadsRows.length,
    },
    byAgent,
    byMonth,
    byErrandType,
    byReferralStatus,
    byRewardTier,
  };
}
