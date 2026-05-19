import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, savedLeads, savedSearches, InsertSavedLead, InsertSavedSearch, agentZones } from "../drizzle/schema";
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

// ─── Agent Zones ─────────────────────────────────────────────────────────────

export async function getAllAgentZones() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agentZones);
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
