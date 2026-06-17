/**
 * Creates the FR/BDR Dual Partnership Model schema in the live DB:
 *   - pods, pod_appointments, qa_reviews tables
 *   - facilities.loopStage + facilities.visitRequested columns
 * Idempotent (IF NOT EXISTS / guarded ALTERs). Seeds a sensible initial
 * loopStage for existing facilities from their current activity.
 *
 * Run: node scripts/migration/add-partnership-tables.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const has = async (table, col) => {
  const [r] = await c.query(
    "SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?",
    [table, col]
  );
  return r[0].n > 0;
};

await c.query(`CREATE TABLE IF NOT EXISTS pods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  region VARCHAR(255),
  frName VARCHAR(255), frUserId INT,
  bdrName VARCHAR(255), bdrUserId INT,
  qaCoachName VARCHAR(255), qaCoachUserId INT,
  monthlyTarget INT NOT NULL DEFAULT 12,
  bonusPerLead DECIMAL(10,2) DEFAULT 0.00,
  frSplitPct INT NOT NULL DEFAULT 95,
  active INT NOT NULL DEFAULT 1,
  notes TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);

await c.query(`CREATE TABLE IF NOT EXISTS pod_appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  podId INT, facilityId INT, facilityName VARCHAR(255),
  scheduledFor TIMESTAMP NOT NULL,
  type ENUM('visit','lunch','drop_in','meeting','other') NOT NULL DEFAULT 'visit',
  bdrName VARCHAR(255), frName VARCHAR(255),
  briefing TEXT,
  status ENUM('scheduled','attended','no_show','cancelled','rescheduled') NOT NULL DEFAULT 'scheduled',
  outcome TEXT,
  createdById INT, createdByName VARCHAR(255),
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_appt_pod (podId), INDEX idx_appt_fr (frName), INDEX idx_appt_when (scheduledFor)
)`);

await c.query(`CREATE TABLE IF NOT EXISTS qa_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  podId INT,
  subjectType ENUM('call','visit','coaching') NOT NULL DEFAULT 'call',
  refId INT, facilityId INT, facilityName VARCHAR(255),
  subjectName VARCHAR(255),
  reviewerId INT, reviewerName VARCHAR(255),
  score INT, toneScore INT, messagingScore INT, objectionScore INT,
  flag ENUM('none','coaching_needed','breakdown','kudos') NOT NULL DEFAULT 'none',
  notes TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_qa_pod (podId), INDEX idx_qa_subject (subjectType, refId)
)`);

if (!(await has("facilities", "loopStage"))) {
  await c.query("ALTER TABLE facilities ADD COLUMN loopStage ENUM('research','first_contact','appointment_set','visited','post_visit','nurture') NULL");
  console.log("added facilities.loopStage");
}
if (!(await has("facilities", "visitRequested"))) {
  await c.query("ALTER TABLE facilities ADD COLUMN visitRequested INT NOT NULL DEFAULT 0");
  console.log("added facilities.visitRequested");
}

// Seed an initial loop stage from current activity so the board isn't empty:
//   active_partner → nurture; have a contact log → first_contact; else → research
const seed = await c.query(`UPDATE facilities SET loopStage =
  CASE
    WHEN partnerStatus='active_partner' OR relationshipStatus='active_partner' THEN 'nurture'
    WHEN lastContactDate IS NOT NULL THEN 'first_contact'
    ELSE 'research'
  END
  WHERE loopStage IS NULL`);
console.log("seeded loopStage for", seed[0].affectedRows, "facilities");

const [[pc]] = await c.query("SELECT COUNT(*) n FROM pods");
console.log("Tables ready. pods rows:", pc.n);
await c.end();
