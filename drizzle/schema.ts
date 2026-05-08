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
