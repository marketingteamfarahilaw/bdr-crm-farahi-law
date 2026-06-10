/**
 * Creates the Intake (AI Case Desk) tables and adds the intake roles to the
 * users.role enum. Idempotent — safe to re-run.
 *
 *   node scripts/migration/create-intake-tables.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);

// 1) users.role enum — add intake_manager / intake_agent
const [cols] = await c.query("SHOW COLUMNS FROM users LIKE 'role'");
const enumDef = String(cols[0]?.Type ?? "");
if (!enumDef.includes("intake_manager")) {
  await c.query(`
    ALTER TABLE users MODIFY COLUMN role
      ENUM('user','admin','super_admin','bdr_manager','fr_manager','bdr_agent','fr_agent','intake_manager','intake_agent')
      NOT NULL DEFAULT 'user'
  `);
  console.log("OK: users.role enum extended with intake_manager / intake_agent");
} else {
  console.log("SKIP: users.role already has the intake roles");
}

// 2) intake_leads
const [t1] = await c.query("SHOW TABLES LIKE 'intake_leads'");
if (t1.length === 0) {
  await c.query(`
    CREATE TABLE intake_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      status ENUM('new','reviewing','qualified','unqualified','referred_out','signed','lost','duplicate') NOT NULL DEFAULT 'new',
      source ENUM('phone','web','referral','walk_in','manual') NOT NULL DEFAULT 'phone',
      firstName VARCHAR(120) NULL,
      lastName VARCHAR(120) NULL,
      phone VARCHAR(60) NULL,
      email VARCHAR(320) NULL,
      preferredLanguage VARCHAR(40) NULL,
      callerName VARCHAR(255) NULL,
      callerRelationship VARCHAR(120) NULL,
      clientLocation VARCHAR(255) NULL,
      caseType VARCHAR(60) NULL,
      incidentDate TIMESTAMP NULL,
      incidentLocation VARCHAR(255) NULL,
      incidentDescription TEXT NULL,
      injuries TEXT NULL,
      injurySeverity ENUM('none','minor','moderate','severe','catastrophic','unknown') DEFAULT 'unknown',
      treatmentStatus ENUM('none','er_visit','hospitalized','ongoing','completed','unknown') DEFAULT 'unknown',
      treatmentDetails TEXT NULL,
      liabilityAssessment ENUM('clear_other_party','mostly_other_party','shared','unclear','client_at_fault','unknown') DEFAULT 'unknown',
      liabilityNotes TEXT NULL,
      policeReport ENUM('yes','no','unknown') DEFAULT 'unknown',
      defendantInsurer VARCHAR(255) NULL,
      clientInsurer VARCHAR(255) NULL,
      umCoverage ENUM('yes','no','unknown') DEFAULT 'unknown',
      healthInsurance VARCHAR(255) NULL,
      propertyDamage TEXT NULL,
      lostWages ENUM('yes','no','unknown') DEFAULT 'unknown',
      priorAttorney ENUM('yes','no','unknown') DEFAULT 'unknown',
      governmentEntity ENUM('yes','no','unknown') DEFAULT 'unknown',
      referredBy VARCHAR(255) NULL,
      solDate TIMESTAMP NULL,
      solRisk ENUM('ok','warning','urgent','expired','unknown') DEFAULT 'unknown',
      qualificationScore INT NULL,
      qualificationTier ENUM('hot','qualified','review','unqualified') NULL,
      aiSummary TEXT NULL,
      aiAnalysis JSON NULL,
      aiRecommendation TEXT NULL,
      assignedToId INT NULL,
      assignedToName VARCHAR(255) NULL,
      reviewOutcome VARCHAR(255) NULL,
      reviewNotes TEXT NULL,
      reviewedById INT NULL,
      reviewedAt TIMESTAMP NULL,
      piClientId INT NULL,
      filevineSyncedAt TIMESTAMP NULL,
      notes TEXT NULL,
      createdById INT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_intake_leads_status (status),
      KEY idx_intake_leads_phone (phone),
      KEY idx_intake_leads_created (createdAt)
    )
  `);
  console.log("OK: created table intake_leads");
} else console.log("SKIP: intake_leads exists");

// 3) intake_calls
const [t2] = await c.query("SHOW TABLES LIKE 'intake_calls'");
if (t2.length === 0) {
  await c.query(`
    CREATE TABLE intake_calls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      leadId INT NULL,
      direction VARCHAR(20) NULL,
      fromNumber VARCHAR(60) NULL,
      toNumber VARCHAR(60) NULL,
      callerName VARCHAR(255) NULL,
      callDate TIMESTAMP NULL,
      durationSeconds INT DEFAULT 0,
      callResult VARCHAR(40) NULL,
      agentId INT NULL,
      agentName VARCHAR(255) NULL,
      rcCallId VARCHAR(64) NULL,
      rcSessionId VARCHAR(64) NULL,
      hasRecording INT DEFAULT 0,
      transcript LONGTEXT NULL,
      transcriptLang VARCHAR(20) NULL,
      aiProcessed INT DEFAULT 0,
      aiSummary TEXT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_intake_calls_lead (leadId),
      KEY idx_intake_calls_rcid (rcCallId),
      KEY idx_intake_calls_session (rcSessionId),
      KEY idx_intake_calls_date (callDate)
    )
  `);
  console.log("OK: created table intake_calls");
} else console.log("SKIP: intake_calls exists");

// 4) intake_lead_events
const [t3] = await c.query("SHOW TABLES LIKE 'intake_lead_events'");
if (t3.length === 0) {
  await c.query(`
    CREATE TABLE intake_lead_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      leadId INT NOT NULL,
      eventType VARCHAR(40) NOT NULL,
      title VARCHAR(255) NULL,
      detail TEXT NULL,
      payload JSON NULL,
      actorId INT NULL,
      actorName VARCHAR(255) NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_intake_events_lead (leadId)
    )
  `);
  console.log("OK: created table intake_lead_events");
} else console.log("SKIP: intake_lead_events exists");

await c.end();
console.log("Done.");
