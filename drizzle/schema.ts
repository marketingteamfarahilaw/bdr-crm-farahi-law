import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  json,
  boolean,
  decimal,
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
  qualificationScore: float("qualificationScore"),
  scoreTier: mysqlEnum("scoreTier", ["hot", "warm", "cold"]),
  scoreBreakdown: json("scoreBreakdown"),
  annotation: text("annotation"),
  assignedAgent: varchar("assignedAgent", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SavedLead = typeof savedLeads.$inferSelect;
export type InsertSavedLead = typeof savedLeads.$inferInsert;

/**
 * Agent zones — California territory assignments per BD rep
 * Extended with full agent profile fields
 */
export const agentZones = mysqlTable("agent_zones", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 100 }).notNull().unique(),
  // Profile fields
  firstName: varchar("firstName", { length: 100 }),
  lastName: varchar("lastName", { length: 100 }),
  employer: varchar("employer", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  title: varchar("title", { length: 255 }),
  notes: text("notes"),
  // Territory
  color: varchar("color", { length: 20 }).notNull(),
  cities: json("cities").notNull(), // string[] of city names in this zone
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AgentZone = typeof agentZones.$inferSelect;
export type InsertAgentZone = typeof agentZones.$inferInsert;

/**
 * PI Clients — personal injury clients added by BD team
 * Used to surface nearby partner facilities on the map
 */
export const piClients = mysqlTable("pi_clients", {
  id: int("id").autoincrement().primaryKey(),
  // Identity
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  // Incident / case
  incidentDate: timestamp("incidentDate"),
  incidentType: varchar("incidentType", { length: 100 }),
  caseStatus: mysqlEnum("caseStatus", ["intake", "active", "settled", "closed", "lost"]).default("intake").notNull(),
  // Location (where client is / incident happened)
  address: text("address"),
  city: varchar("city", { length: 100 }),
  zipCode: varchar("zipCode", { length: 20 }),
  latitude: float("latitude"),
  longitude: float("longitude"),
  // Filevine integration
  filevineCaseId: varchar("filevineCaseId", { length: 100 }),
  filevineProjectId: varchar("filevineProjectId", { length: 100 }),
  // Assignment
  assignedAgentId: int("assignedAgentId"),
  assignedAgentName: varchar("assignedAgentName", { length: 255 }),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PiClient = typeof piClients.$inferSelect;
export type InsertPiClient = typeof piClients.$inferInsert;

/**
 * Filevine integration settings (per-user API credentials)
 */
export const filevineSettings = mysqlTable("filevine_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  apiKey: text("apiKey"),
  apiSecret: text("apiSecret"),
  orgId: varchar("orgId", { length: 100 }),
  baseUrl: varchar("baseUrl", { length: 500 }).default("https://api.filevine.io"),
  connected: boolean("connected").default(false).notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FilevineSettings = typeof filevineSettings.$inferSelect;
export type InsertFilevineSettings = typeof filevineSettings.$inferInsert;

/**
 * Call logs for PI clients — auto-created when a RingCentral call ends
 * and the phone number matches a PI client record.
 */
export const piClientCallLogs = mysqlTable("pi_client_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  piClientId: int("piClientId").notNull(),
  // RingCentral call metadata
  callId: varchar("callId", { length: 255 }),
  phoneNumber: varchar("phoneNumber", { length: 50 }),
  direction: varchar("direction", { length: 20 }), // 'Inbound' | 'Outbound'
  result: varchar("result", { length: 50 }),        // 'Call connected' | 'No Answer' etc.
  duration: int("duration"),                        // seconds
  durationStr: varchar("durationStr", { length: 20 }),
  startTime: varchar("startTime", { length: 100 }),
  // Transcript (from Whisper via RingCentral recording)
  transcript: text("transcript"),
  // Who made the call
  agentName: varchar("agentName", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PiClientCallLog = typeof piClientCallLogs.$inferSelect;
export type InsertPiClientCallLog = typeof piClientCallLogs.$inferInsert;

// ─── Facility Partner CRM ────────────────────────────────────────────────────

/** V3 partner status options (from brief section 11) */
export const PARTNER_STATUSES = [
  "prospect",
  "active_partner",
  "priority_partner",
  "needs_follow_up",
  "dormant",
  "do_not_use",
] as const;

/** V3 relationship strength options */
export const RELATIONSHIP_STRENGTHS = ["new", "warm", "strong", "at_risk", "unknown"] as const;

/** Core facility / referral partner profile — upgraded for V3 */
export const facilities = mysqlTable("facilities", {
  id: int("id").autoincrement().primaryKey(),
  // Identity
  name: varchar("name", { length: 255 }).notNull(),
  /** V3: only "chiropractor" and "body_shop" in V1 */
  category: varchar("category", { length: 100 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 255 }),
  zipCode: varchar("zipCode", { length: 20 }),
  serviceArea: varchar("serviceArea", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  phone2: varchar("phone2", { length: 50 }),
  phone3: varchar("phone3", { length: 50 }),
  website: varchar("website", { length: 500 }),
  // Primary contact at the facility
  contactName: varchar("contactName", { length: 255 }),
  contactTitle: varchar("contactTitle", { length: 255 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  preferredContactMethod: mysqlEnum("preferredContactMethod", [
    "phone", "sms", "email", "in_person", "other",
  ]),
  // Relationship — V3 fields
  relationshipStatus: mysqlEnum("relationshipStatus", [
    "active_partner", "warm_lead", "cold", "churned", "do_not_contact", "needs_agent",
  ]).default("warm_lead").notNull(),
  partnerStatus: mysqlEnum("partnerStatus", [
    "prospect", "active_partner", "priority_partner", "needs_follow_up", "dormant", "do_not_use",
  ]).default("prospect").notNull(),
  relationshipStrength: mysqlEnum("relationshipStrength", [
    "new", "warm", "strong", "at_risk", "unknown",
  ]).default("new").notNull(),
  priorityPartner: int("priorityPartner").default(0).notNull(), // 0 = no, 1 = yes
  // Follow-up
  followUpWindowDays: int("followUpWindowDays").default(7).notNull(), // 5-15 days
  lastContactDate: timestamp("lastContactDate"),
  nextFollowUpDate: timestamp("nextFollowUpDate"),
  lastCheckInDate: timestamp("lastCheckInDate"),
  // Performance metrics (denormalized for fast dashboard queries)
  totalSignedCases: int("totalSignedCases").default(0).notNull(),
  totalLeadsSent: int("totalLeadsSent").default(0).notNull(),    // leads we sent TO facility
  totalLeadsReceived: int("totalLeadsReceived").default(0).notNull(), // leads we got FROM facility
  totalCalls: int("totalCalls").default(0).notNull(),
  lastSignedCaseDate: timestamp("lastSignedCaseDate"),
  // Financial tracking (from spreadsheet: Money invested, Last package)
  moneyInvested: decimal("moneyInvested", { precision: 10, scale: 2 }).default("0.00"),
  lastPackageDate: timestamp("lastPackageDate"),
  lastPartnerInFLF: varchar("lastPartnerInFLF", { length: 255 }),
  // Assigned BD rep
  assignedRepId: int("assignedRepId"),
  assignedRepName: varchar("assignedRepName", { length: 255 }),
  // Google Maps link (from scraper)
  placeId: varchar("placeId", { length: 255 }),
  latitude: float("latitude"),
  longitude: float("longitude"),
  // Management
  managementFlag: int("managementFlag").default(0).notNull(),
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
    .default("call").notNull(),
  contactDate: timestamp("contactDate").notNull(),
  callResult: mysqlEnum("callResult", ["connected", "voicemail", "no_answer", "busy", "other"]),
  callDuration: varchar("callDuration", { length: 20 }),
  callType: mysqlEnum("callType", [
    "partner_checkin", "bdr_checkin", "fr_checkin", "internal", "potential_lead", "other",
  ]),
  fieldHours: varchar("fieldHours", { length: 20 }),
  summary: text("summary"),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  // V3: RingCentral sync flag
  fromRingCentral: int("fromRingCentral").default(0).notNull(),
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
  assignedToId: int("assignedToId"),
  assignedToName: varchar("assignedToName", { length: 255 }),
  status: mysqlEnum("status", ["open", "completed"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["high", "medium", "low"]).default("medium").notNull(),
  // V3: follow-up reason
  followUpReason: mysqlEnum("followUpReason", [
    "thank_you", "send_lead", "ask_for_referral", "request_update",
    "check_relationship", "reconnect", "other",
  ]),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityTask = typeof facilityTasks.$inferSelect;
export type InsertFacilityTask = typeof facilityTasks.$inferInsert;

/** Monthly referral lead count sent by a facility (legacy — kept for backward compat) */
export const facilityLeadsSent = mysqlTable("facility_leads_sent", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  year: int("year").notNull(),
  month: int("month").notNull(),
  count: int("count").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityLeadsSent = typeof facilityLeadsSent.$inferSelect;
export type InsertFacilityLeadsSent = typeof facilityLeadsSent.$inferInsert;

/**
 * V3: Individual lead entries — tracks each lead sent to or received from a facility.
 * This replaces the monthly count model with per-lead tracking.
 */
export const facilityLeads = mysqlTable("facility_leads", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  // Direction: did we send this lead to the facility, or did they send it to us?
  direction: mysqlEnum("direction", ["sent_to_facility", "received_from_facility"]).notNull(),
  leadDate: timestamp("leadDate").notNull(),
  // How was the lead communicated?
  method: mysqlEnum("method", ["phone_call", "sms", "direct_contact", "email", "in_person", "other"])
    .default("phone_call").notNull(),
  contactPerson: varchar("contactPerson", { length: 255 }),
  clientArea: varchar("clientArea", { length: 255 }), // e.g. "Pomona", "Ontario"
  // Outcome tracking — signed cases are the #1 metric
  outcome: mysqlEnum("outcome", [
    "pending", "signed", "not_signed", "not_qualified", "duplicate", "unknown",
  ]).default("pending").notNull(),
  signedCase: int("signedCase").default(0).notNull(), // 1 = signed case confirmed
  signedDate: timestamp("signedDate"),
  notes: text("notes"),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityLead = typeof facilityLeads.$inferSelect;
export type InsertFacilityLead = typeof facilityLeads.$inferInsert;

/**
 * V3: Gratitude / relationship-building actions (meals, gifts, visits, thank-you calls)
 */
export const facilityGratitude = mysqlTable("facility_gratitude", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  actionDate: timestamp("actionDate").notNull(),
  actionType: mysqlEnum("actionType", [
    "thank_you_call", "thank_you_sms", "visit", "meal_delivery", "gift", "other",
  ]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }), // cost in USD if applicable
  notes: text("notes"),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FacilityGratitude = typeof facilityGratitude.$inferSelect;
export type InsertFacilityGratitude = typeof facilityGratitude.$inferInsert;

/**
 * V3: Transcript / note drop-in updates.
 * User pastes a call transcript, SMS thread, or manual note.
 * AI extracts a short summary + key fields. User can edit before saving.
 */
export const facilityUpdates = mysqlTable("facility_updates", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  updateDate: timestamp("updateDate").notNull(),
  // Raw input from user (transcript, SMS, or manual note)
  rawText: text("rawText"),
  // AI-generated or manually written short summary (shown at top of activity file)
  summary: varchar("summary", { length: 500 }),
  // Structured data extracted from the transcript
  extractedData: json("extractedData"), // { contactPerson, leadDirection, clientArea, promisedAction, followUpDate, relationshipTone, signedCaseStatus }
  updateType: mysqlEnum("updateType", ["transcript", "sms", "manual_note", "visit_note", "other"])
    .default("manual_note").notNull(),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FacilityUpdate = typeof facilityUpdates.$inferSelect;
export type InsertFacilityUpdate = typeof facilityUpdates.$inferInsert;

/**
 * Actual referrals received from a facility (from 2.Rfral Rewrd sheet)
 * Kept for backward compatibility — new leads go into facility_leads
 */
export const facilityReferrals = mysqlTable("facility_referrals", {
  id: int("id").autoincrement().primaryKey(),
  facilityId: int("facilityId").notNull(),
  referralDate: timestamp("referralDate").notNull(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  caseValue: mysqlEnum("caseValue", ["rank_x", "high", "medium", "low", "na"]).default("medium").notNull(),
  repId: int("repId"),
  repName: varchar("repName", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FacilityReferral = typeof facilityReferrals.$inferSelect;
export type InsertFacilityReferral = typeof facilityReferrals.$inferInsert;

/**
 * RingCentral OAuth tokens stored per-account
 */
export const ringcentralTokens = mysqlTable("ringcentral_tokens", {
  id: int("id").autoincrement().primaryKey(),
  accountId: varchar("accountId", { length: 128 }).notNull().unique(),
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
