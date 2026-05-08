import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Saved searches for re-running prospecting queries
export const savedSearches = mysqlTable("saved_searches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  source: mysqlEnum("source", ["google", "yelp", "both"]).default("both").notNull(),
  radiusMiles: int("radiusMiles").default(10).notNull(),
  lat: float("lat"),
  lng: float("lng"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SavedSearch = typeof savedSearches.$inferSelect;
export type InsertSavedSearch = typeof savedSearches.$inferInsert;

// Saved / bookmarked leads with optional annotation
export const savedLeads = mysqlTable("saved_leads", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Denormalized lead data so it persists even if not re-scraped
  placeId: varchar("placeId", { length: 255 }).notNull(),
  source: mysqlEnum("source", ["google", "yelp"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 500 }),
  email: varchar("email", { length: 320 }),
  category: varchar("category", { length: 100 }),
  rating: float("rating"),
  reviewCount: int("reviewCount"),
  latitude: float("latitude"),
  longitude: float("longitude"),
  // Qualification score fields
  qualificationScore: float("qualificationScore"),
  scoreTier: mysqlEnum("scoreTier", ["hot", "warm", "cold"]),
  scoreBreakdown: json("scoreBreakdown"),
  annotation: text("annotation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SavedLead = typeof savedLeads.$inferSelect;
export type InsertSavedLead = typeof savedLeads.$inferInsert;

// ─── Facility Partner CRM ────────────────────────────────────────────────────

/** Core facility / referral partner profile */
export const facilities = mysqlTable("facilities", {
  id: int("id").autoincrement().primaryKey(),
  // Identity
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  phone2: varchar("phone2", { length: 50 }),
  phone3: varchar("phone3", { length: 50 }),
  website: varchar("website", { length: 500 }),
  // Primary contact at the facility
  contactName: varchar("contactName", { length: 255 }),
  contactTitle: varchar("contactTitle", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  // Relationship
  relationshipStatus: mysqlEnum("relationshipStatus", [
    "active_partner",
    "warm_lead",
    "cold",
    "churned",
    "do_not_contact",
    "needs_agent",
  ])
    .default("warm_lead")
    .notNull(),
  assignedRepId: int("assignedRepId"), // FK → users.id
  assignedRepName: varchar("assignedRepName", { length: 255 }),
  // Google Maps link (from scraper)
  placeId: varchar("placeId", { length: 255 }),
  latitude: float("latitude"),
  longitude: float("longitude"),
  // Management
  managementFlag: int("managementFlag").default(0).notNull(), // 0 = no flag, 1 = flagged
  managementNote: text("managementNote"),
  // Internal notes
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Facility = typeof facilities.$inferSelect;
export type InsertFacility = typeof facilities.$inferInsert;

/** Log of every contact attempt / touchpoint with a facility */
export const contactLogs = mysqlTable("contact_logs", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  contactType: mysqlEnum("contactType", ["call", "visit", "email", "text", "meeting", "other"])
    .default("call")
    .notNull(),
  contactDate: timestamp("contactDate").notNull(),
  // Call-specific fields (from 2.RC sheet)
  callResult: mysqlEnum("callResult", ["connected", "voicemail", "no_answer", "busy", "other"]),
  callDuration: varchar("callDuration", { length: 20 }), // HH:MM:SS format
  callType: mysqlEnum("callType", [
    "partner_checkin",
    "bdr_checkin",
    "fr_checkin",
    "internal",
    "potential_lead",
    "other",
  ]),
  // Visit-specific fields (from 2.Visits sheet)
  fieldHours: varchar("fieldHours", { length: 20 }), // HH:MM:SS format
  // General
  summary: text("summary"),
  repId: int("repId"), // FK → users.id
  repName: varchar("repName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContactLog = typeof contactLogs.$inferSelect;
export type InsertContactLog = typeof contactLogs.$inferInsert;

/** Follow-up tasks associated with a facility */
export const facilityTasks = mysqlTable("facility_tasks", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  dueDate: timestamp("dueDate"),
  assignedToId: int("assignedToId"), // FK → users.id
  assignedToName: varchar("assignedToName", { length: 255 }),
  status: mysqlEnum("status", ["open", "completed"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["high", "medium", "low"]).default("medium").notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityTask = typeof facilityTasks.$inferSelect;
export type InsertFacilityTask = typeof facilityTasks.$inferInsert;

/** Monthly referral lead count sent by a facility */
export const facilityLeadsSent = mysqlTable("facility_leads_sent", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(), // 1-12
  count: int("count").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityLeadsSent = typeof facilityLeadsSent.$inferSelect;
export type InsertFacilityLeadsSent = typeof facilityLeadsSent.$inferInsert;

/**
 * Actual referrals received from a facility (from 2.Rfral Rewrd sheet)
 * Each row = one real client referred by this facility
 */
export const facilityReferrals = mysqlTable("facility_referrals", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  referralDate: timestamp("referralDate").notNull(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  caseValue: mysqlEnum("caseValue", ["rank_x", "high", "medium", "low", "na"])
    .default("medium")
    .notNull(),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityReferral = typeof facilityReferrals.$inferSelect;
export type InsertFacilityReferral = typeof facilityReferrals.$inferInsert;

/**
 * RingCentral OAuth tokens stored per-account (one row for the whole org)
 * Allows the app to sync call logs automatically from RingCentral
 */
export const ringcentralTokens = mysqlTable("ringcentral_tokens", {
  id: int("id").autoincrement().primaryKey(),
  accountId: varchar("accountId", { length: 128 }).notNull().unique(), // RC account ID
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  tokenExpiry: timestamp("tokenExpiry").notNull(),
  ownerExtensionId: varchar("ownerExtensionId", { length: 64 }),
  ownerName: varchar("ownerName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RingcentralToken = typeof ringcentralTokens.$inferSelect;
export type InsertRingcentralToken = typeof ringcentralTokens.$inferInsert;
