import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  longtext,
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
  role: mysqlEnum("role", ["user", "admin", "super_admin", "bdr_manager", "fr_manager", "bdr_agent", "fr_agent", "intake_manager", "intake_agent", "intake_frontline"]).default("user").notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }), // scrypt salt:hash for email+password login
  agentName: varchar("agentName", { length: 100 }), // Links user to BDR agent data (e.g. 'Gracel', 'Queenie', 'Ally', 'Miguel', 'Rupert')
  ringoutMyLocation: varchar("ringoutMyLocation", { length: 30 }), // Phone number for RingOut first-leg call (e.g. +12025551234)
  photoUrl: longtext("photoUrl"), // Profile photo — a small resized data URL
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
  lienFriendly: boolean("lienFriendly").default(false),
  lienSignals: text("lienSignals"),  // JSON-serialized string[] of detected lien keyword signals
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
 * Generic key-value application settings (singleton-style).
 * Used for branding — logo_light / logo_dark hold small resized data URLs.
 */
export const appSettings = mysqlTable("app_settings", {
  settingKey: varchar("settingKey", { length: 100 }).primaryKey(),
  settingValue: longtext("settingValue"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;

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
  direction: varchar("direction", { length: 20 }),  // Inbound | Outbound (RC-synced; older rows backfilled from summary)
  fromRingCentral: int("fromRingCentral").default(0).notNull(),
  // RingCentral call-log record id — per-extension dedupe key for auto-synced calls.
  rcCallId: varchar("rcCallId", { length: 64 }),
  // RingCentral telephonySessionId — stable ACROSS extensions, so one physical
  // call landing in two agents' extension logs (ring group / transfer) dedupes.
  rcSessionId: varchar("rcSessionId", { length: 64 }),
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

/**
 * Per-AGENT RingCentral OAuth tokens. Each CRM user connects their OWN
 * RingCentral account (authorization-code flow) so their calls are pulled from
 * THEIR extension and attributed to them — instead of everything rolling up to
 * the single account/JWT owner. Keyed uniquely by the CRM user id.
 */
export const userRingcentralTokens = mysqlTable("user_ringcentral_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  accountId: varchar("accountId", { length: 128 }),
  extensionId: varchar("extensionId", { length: 64 }),
  ownerName: varchar("ownerName", { length: 255 }),
  ownerEmail: varchar("ownerEmail", { length: 320 }),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  tokenExpiry: timestamp("tokenExpiry").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserRingcentralToken = typeof userRingcentralTokens.$inferSelect;
export type InsertUserRingcentralToken = typeof userRingcentralTokens.$inferInsert;

// ─── BDR Report Tables (digitized from Excel BDR system) ─────────────────────

/**
 * Field Visits — daily log of facility visits by FR/BDR agents
 * Mirrors the "2.Visits" Excel sheet
 */
export const fieldVisits = mysqlTable("field_visits", {
  id: int("id").autoincrement().primaryKey(),
  visitDate: timestamp("visitDate").notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  agentEmail: varchar("agentEmail", { length: 320 }),
  agentRole: mysqlEnum("agentRole", ["FR", "BDR", "Manager"]).default("FR").notNull(),
  // Facilities visited (stored as JSON array of {facilityId, facilityName})
  facilitiesVisited: json("facilitiesVisited").notNull(), // {id: number, name: string}[]
  facilityCount: int("facilityCount").default(0).notNull(),
  hoursWorked: varchar("hoursWorked", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FieldVisit = typeof fieldVisits.$inferSelect;
export type InsertFieldVisit = typeof fieldVisits.$inferInsert;

/**
 * FR Expenses — field rep expense log per facility
 * Mirrors the "2.FR Expen" Excel sheet
 */
export const frExpenses = mysqlTable("fr_expenses", {
  id: int("id").autoincrement().primaryKey(),
  expenseDate: timestamp("expenseDate").notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  agentEmail: varchar("agentEmail", { length: 320 }),
  facilityId: int("facilityId"),
  facilityName: varchar("facilityName", { length: 255 }),
  store: varchar("store", { length: 255 }), // e.g. "UberEats", "Walmart", "Costco"
  reason: varchar("reason", { length: 500 }), // e.g. "Partner check-in food delivery"
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  cardType: mysqlEnum("cardType", ["Personal", "Company"]).default("Company").notNull(),
  receiptUrl: varchar("receiptUrl", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FrExpense = typeof frExpenses.$inferSelect;
export type InsertFrExpense = typeof frExpenses.$inferInsert;

/**
 * BDR Expenses — business development rep expense log
 * Mirrors the "2.BDR Expen" Excel sheet
 */
export const bdrExpenses = mysqlTable("bdr_expenses", {
  id: int("id").autoincrement().primaryKey(),
  month: varchar("month", { length: 20 }), // e.g. "May 2026"
  expenseDate: timestamp("expenseDate").notNull(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  agentEmail: varchar("agentEmail", { length: 320 }),
  facilityId: int("facilityId"),
  facilityName: varchar("facilityName", { length: 255 }),
  facilityPhone: varchar("facilityPhone", { length: 50 }),
  store: varchar("store", { length: 255 }),
  reason: varchar("reason", { length: 500 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type BdrExpense = typeof bdrExpenses.$inferSelect;
export type InsertBdrExpense = typeof bdrExpenses.$inferInsert;

/**
 * Referral Rewards — client referrals with tier, payout, and status
 * Mirrors the referral rewards Excel sheet
 */
export const referralRewards = mysqlTable("referral_rewards", {
  id: int("id").autoincrement().primaryKey(),
  agentName: varchar("agentName", { length: 255 }).notNull(),
  agentEmail: varchar("agentEmail", { length: 320 }),
  sud: varchar("sud", { length: 100 }), // Sign-Up Date
  referralType: mysqlEnum("referralType", ["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"]).default("Chiro").notNull(),
  facilityId: int("facilityId"),
  facilityName: varchar("facilityName", { length: 255 }),
  clientName: varchar("clientName", { length: 255 }),
  clientTier: mysqlEnum("clientTier", ["Medium", "High", "Rank X", "Standard"]).default("Standard").notNull(),
  payoutAmount: decimal("payoutAmount", { precision: 10, scale: 2 }),
  status: mysqlEnum("status", ["Accepted", "Pending", "Denied"]).default("Pending").notNull(),
  caseNumber: varchar("caseNumber", { length: 100 }),
  coordinator: varchar("coordinator", { length: 255 }),
  deliveryType: varchar("deliveryType", { length: 100 }), // e.g. "Zelle", "Check", "Cash"
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ReferralReward = typeof referralRewards.$inferSelect;
export type InsertReferralReward = typeof referralRewards.$inferInsert;

/**
 * FR Errands — field errands per client (welfare checks, video footage, etc.)
 * Mirrors the "2.FR Errand" Excel sheet
 */
export const frErrands = mysqlTable("fr_errands", {
  id: int("id").autoincrement().primaryKey(),
  errandDate: timestamp("errandDate").notNull(),
  clientName: varchar("clientName", { length: 255 }).notNull(),
  clientTier: mysqlEnum("clientTier", ["Medium", "High", "Rank X", "Standard"]).default("Standard").notNull(),
  taskType: varchar("taskType", { length: 255 }).notNull(), // e.g. "Acquire video footage", "Welfare check", "Get witness statement"
  agentName: varchar("agentName", { length: 255 }),
  agentEmail: varchar("agentEmail", { length: 320 }),
  status: mysqlEnum("status", ["Completed", "Not Completed", "In Progress"]).default("In Progress").notNull(),
  address: text("address"),
  notes: text("notes"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type FrErrand = typeof frErrands.$inferSelect;
export type InsertFrErrand = typeof frErrands.$inferInsert;

/**
 * Referral-Friendly Tracker — tracks which facility each client was referred to
 * Mirrors the referral-friendly Excel sheet
 */
export const referralTracker = mysqlTable("referral_tracker", {
  id: int("id").autoincrement().primaryKey(),
  month: varchar("month", { length: 20 }), // e.g. "May 2026"
  clientName: varchar("clientName", { length: 255 }).notNull(),
  pdCoordinator: varchar("pdCoordinator", { length: 255 }),
  partnerStatus: varchar("partnerStatus", { length: 100 }), // e.g. "Partner", "Non-Partner"
  facilityId: int("facilityId"),
  facilityName: varchar("facilityName", { length: 255 }),
  facilityType: varchar("facilityType", { length: 100 }), // e.g. "Chiro", "Body Shop"
  bdrAssigned: varchar("bdrAssigned", { length: 255 }),
  status: mysqlEnum("status", [
    "Successful Sent",
    "Demo Sent",
    "Pending",
    "Unsuccessful",
    "In Progress",
  ]).default("Pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ReferralTracker = typeof referralTracker.$inferSelect;
export type InsertReferralTracker = typeof referralTracker.$inferInsert;

/**
 * Uber Eats receipts pulled from the Uber for Business Receipt API.
 * Each completed order becomes an expense; this row tracks the source order
 * (dedupe by orderId) and links to the created expense.
 */
export const uberReceipts = mysqlTable("uber_receipts", {
  id: int("id").autoincrement().primaryKey(),
  orderId: varchar("orderId", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 8 }),
  orderDate: timestamp("orderDate"),
  requesterName: varchar("requesterName", { length: 255 }),
  requesterEmail: varchar("requesterEmail", { length: 320 }),
  storeName: varchar("storeName", { length: 255 }),
  deliveryAddress: text("deliveryAddress"),
  facilityId: int("facilityId"),
  facilityName: varchar("facilityName", { length: 255 }),
  expenseId: int("expenseId"),
  expenseTable: varchar("expenseTable", { length: 32 }),
  raw: json("raw"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UberReceipt = typeof uberReceipts.$inferSelect;
export type InsertUberReceipt = typeof uberReceipts.$inferInsert;

// ─── Partner Lead Referral Workflow ───────────────────────────────────────────

/**
 * Outbound referrals — leads sent FROM the firm TO a partner facility.
 * Covers Steps 8 & 11 of the Partner Lead Referral Workflow.
 */
export const outboundReferrals = mysqlTable("outbound_referrals", {
  id: int("id").autoincrement().primaryKey(),

  // Client info
  clientName: varchar("clientName", { length: 255 }).notNull(),
  filevineLinkOrRef: varchar("filevineLinkOrRef", { length: 500 }),
  clientAddress: text("clientAddress"),
  clientCity: varchar("clientCity", { length: 100 }),
  clientZip: varchar("clientZip", { length: 20 }),
  dateSigned: timestamp("dateSigned"),

  // Referral decision
  referralNeeded: boolean("referralNeeded").default(true),
  referralType: varchar("referralType", { length: 100 }),
  assignedAgent: varchar("assignedAgent", { length: 100 }),
  recommendedFacility: varchar("recommendedFacility", { length: 255 }),
  facilityOwner: varchar("facilityOwner", { length: 100 }),
  distanceTravelTime: varchar("distanceTravelTime", { length: 100 }),
  reasonForSelection: text("reasonForSelection"),

  // Referral tracking
  referralSentDate: timestamp("referralSentDate"),
  status: mysqlEnum("status", [
    "Pending Review",
    "Assigned to Agent",
    "Facility Selected",
    "Referral Sent",
    "Facility Confirmed",
    "Client Scheduled",
    "Client Attended",
    "Issue / Needs Follow-Up",
    "Completed",
    "Not Referred",
  ]).default("Pending Review").notNull(),
  followUpDate: timestamp("followUpDate"),
  facilityConfirmed: boolean("facilityConfirmed").default(false),
  clientScheduled: boolean("clientScheduled").default(false),
  clientAttended: boolean("clientAttended").default(false),

  // Reciprocity context
  facilityHadSentLeads: boolean("facilityHadSentLeads").default(false),

  // Meta
  notes: text("notes"),
  lastUpdatedBy: varchar("lastUpdatedBy", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OutboundReferral = typeof outboundReferrals.$inferSelect;
export type InsertOutboundReferral = typeof outboundReferrals.$inferInsert;

/**
 * Inbound leads — leads received BY the firm FROM a partner facility.
 * Covers Step 9 of the Partner Lead Referral Workflow.
 */
export const inboundLeads = mysqlTable("inbound_leads", {
  id: int("id").autoincrement().primaryKey(),

  // Lead info
  leadName: varchar("leadName", { length: 255 }).notNull(),
  dateReceived: timestamp("dateReceived"),
  referringFacility: varchar("referringFacility", { length: 255 }),
  facilityContact: varchar("facilityContact", { length: 255 }),
  assignedAgent: varchar("assignedAgent", { length: 100 }),
  caseType: varchar("caseType", { length: 100 }),

  // Outcome
  signed: boolean("signed").default(false),
  signedDate: timestamp("signedDate"),
  notSignedReason: text("notSignedReason"),

  // Reciprocity
  countsTowardPartnerActivity: boolean("countsTowardPartnerActivity").default(true),

  // Meta
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InboundLead = typeof inboundLeads.$inferSelect;
export type InsertInboundLead = typeof inboundLeads.$inferInsert;

// Lead capture / intake sheet (mirrors the team's Excel columns).
export const leadIntake = mysqlTable("lead_intake", {
  id: int("id").autoincrement().primaryKey(),
  leadDate: timestamp("leadDate"),
  role: varchar("role", { length: 80 }),
  member: varchar("member", { length: 120 }),
  leadName: varchar("leadName", { length: 255 }).notNull(),
  lastName: varchar("lastName", { length: 255 }),
  phone: varchar("phone", { length: 60 }),
  email: varchar("email", { length: 320 }),
  value: varchar("value", { length: 60 }),
  outcome: varchar("outcome", { length: 120 }),
  classification: varchar("classification", { length: 120 }),
  sud: varchar("sud", { length: 120 }),
  liability: varchar("liability", { length: 120 }),
  disposition: varchar("disposition", { length: 120 }),
  facility: varchar("facility", { length: 255 }),
  typeOfFacility: varchar("typeOfFacility", { length: 120 }),
  clientLocation: varchar("clientLocation", { length: 255 }),
  fvDocumentation: text("fvDocumentation"),
  createdById: int("createdById"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LeadIntake = typeof leadIntake.$inferSelect;
export type InsertLeadIntake = typeof leadIntake.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// INTAKE — AI Case Desk (Eve-style client intake; fully separate from the
// BD/FR facility CRM — the intake team never touches facility data and BD/FR
// never see potential-client case data).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A potential new client (PNC). One row per person/case — calls, AI analyses,
 * and human review all hang off this. The AI fills the case-fact columns from
 * call transcripts; the intake team verifies/edits and decides the outcome.
 */
export const intakeLeads = mysqlTable("intake_leads", {
  id: int("id").autoincrement().primaryKey(),

  // Pipeline
  status: mysqlEnum("status", ["new", "reviewing", "qualified", "unqualified", "referred_out", "signed", "lost", "duplicate"]).default("new").notNull(),
  source: mysqlEnum("source", ["phone", "web", "referral", "walk_in", "manual"]).default("phone").notNull(),

  // Person
  firstName: varchar("firstName", { length: 120 }),
  lastName: varchar("lastName", { length: 120 }),
  phone: varchar("phone", { length: 60 }),
  email: varchar("email", { length: 320 }),
  preferredLanguage: varchar("preferredLanguage", { length: 40 }),
  callerName: varchar("callerName", { length: 255 }),             // who actually called (may be a relative)
  callerRelationship: varchar("callerRelationship", { length: 120 }),
  clientLocation: varchar("clientLocation", { length: 255 }),

  // Case facts (AI-extracted, human-verified)
  caseType: varchar("caseType", { length: 60 }),                  // auto_accident | slip_fall | dog_bite | premises | work_injury | medical_malpractice | product_liability | wrongful_death | other
  incidentDate: timestamp("incidentDate"),
  incidentLocation: varchar("incidentLocation", { length: 255 }),
  incidentDescription: text("incidentDescription"),
  injuries: text("injuries"),
  injurySeverity: mysqlEnum("injurySeverity", ["none", "minor", "moderate", "severe", "catastrophic", "unknown"]).default("unknown"),
  treatmentStatus: mysqlEnum("treatmentStatus", ["none", "er_visit", "hospitalized", "ongoing", "completed", "unknown"]).default("unknown"),
  treatmentDetails: text("treatmentDetails"),
  liabilityAssessment: mysqlEnum("liabilityAssessment", ["clear_other_party", "mostly_other_party", "shared", "unclear", "client_at_fault", "unknown"]).default("unknown"),
  liabilityNotes: text("liabilityNotes"),
  policeReport: mysqlEnum("policeReport", ["yes", "no", "unknown"]).default("unknown"),
  defendantInsurer: varchar("defendantInsurer", { length: 255 }),
  clientInsurer: varchar("clientInsurer", { length: 255 }),
  umCoverage: mysqlEnum("umCoverage", ["yes", "no", "unknown"]).default("unknown"),
  healthInsurance: varchar("healthInsurance", { length: 255 }),
  propertyDamage: text("propertyDamage"),
  lostWages: mysqlEnum("lostWages", ["yes", "no", "unknown"]).default("unknown"),
  priorAttorney: mysqlEnum("priorAttorney", ["yes", "no", "unknown"]).default("unknown"),
  governmentEntity: mysqlEnum("governmentEntity", ["yes", "no", "unknown"]).default("unknown"),  // govt defendant → 6-month CA claim deadline
  referredBy: varchar("referredBy", { length: 255 }),

  // Statute of limitations (computed in code — deterministic, CA rules)
  solDate: timestamp("solDate"),
  solRisk: mysqlEnum("solRisk", ["ok", "warning", "urgent", "expired", "unknown"]).default("unknown"),

  // AI qualification
  qualificationScore: int("qualificationScore"),                  // 0–100
  qualificationTier: mysqlEnum("qualificationTier", ["hot", "qualified", "review", "unqualified"]),
  aiSummary: text("aiSummary"),
  aiAnalysis: json("aiAnalysis"),                                 // rubric breakdown, red flags, missing info, suggested questions
  aiRecommendation: text("aiRecommendation"),

  // Working the lead
  assignedToId: int("assignedToId"),
  assignedToName: varchar("assignedToName", { length: 255 }),
  reviewOutcome: varchar("reviewOutcome", { length: 255 }),
  reviewNotes: text("reviewNotes"),
  reviewedById: int("reviewedById"),
  reviewedAt: timestamp("reviewedAt"),

  // Hand-offs
  piClientId: int("piClientId"),                                  // pi_clients row created on "signed"
  filevineSyncedAt: timestamp("filevineSyncedAt"),

  notes: text("notes"),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type IntakeLead = typeof intakeLeads.$inferSelect;
export type InsertIntakeLead = typeof intakeLeads.$inferInsert;

/**
 * Every intake call (synced from the intake team's RingCentral extensions).
 * Carries the Whisper transcript; linked to a lead by caller phone number.
 */
export const intakeCalls = mysqlTable("intake_calls", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId"),                                          // intake_leads.id once matched/linked
  direction: varchar("direction", { length: 20 }),
  fromNumber: varchar("fromNumber", { length: 60 }),
  toNumber: varchar("toNumber", { length: 60 }),
  callerName: varchar("callerName", { length: 255 }),
  callDate: timestamp("callDate"),
  durationSeconds: int("durationSeconds").default(0),
  callResult: varchar("callResult", { length: 40 }),              // connected | voicemail | no_answer | busy | other
  agentId: int("agentId"),                                        // intake specialist whose extension handled it
  agentName: varchar("agentName", { length: 255 }),
  rcCallId: varchar("rcCallId", { length: 64 }),
  rcSessionId: varchar("rcSessionId", { length: 64 }),
  hasRecording: int("hasRecording").default(0),
  recordingUrl: varchar("recordingUrl", { length: 600 }),         // direct playback URL (AI voice-agent calls); RC calls use /api/intake-recording
  transcript: longtext("transcript"),                             // long calls exceed TEXT's 64KB — MySQL truncates silently
  transcriptLang: varchar("transcriptLang", { length: 20 }),
  aiProcessed: int("aiProcessed").default(0),
  aiSummary: text("aiSummary"),
  subject: varchar("subject", { length: 255 }),                   // AI short title, e.g. "Inquiry About Ankle Injury"
  callPurpose: varchar("callPurpose", { length: 40 }),            // new_case | follow_up | existing_client | solicitation | wrong_number | other
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type IntakeCall = typeof intakeCalls.$inferSelect;
export type InsertIntakeCall = typeof intakeCalls.$inferInsert;

/** Activity timeline on a lead: status changes, notes, AI runs, Filevine pushes. */
export const intakeLeadEvents = mysqlTable("intake_lead_events", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  eventType: varchar("eventType", { length: 40 }).notNull(),      // created | status_change | note | call_linked | ai_analysis | assigned | filevine_push | signed | edited
  title: varchar("title", { length: 255 }),
  detail: text("detail"),
  payload: json("payload"),
  actorId: int("actorId"),
  actorName: varchar("actorName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type IntakeLeadEvent = typeof intakeLeadEvents.$inferSelect;
export type InsertIntakeLeadEvent = typeof intakeLeadEvents.$inferInsert;
