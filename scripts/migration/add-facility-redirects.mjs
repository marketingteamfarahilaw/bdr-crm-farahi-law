// Merged and deleted facilities leave a forwarding address (server/facilityMerge.ts):
// the name and phone numbers that were theirs now point at the facility kept, or at
// nothing. The 8-hourly Google Sheets sync and call matching read it, so a merge or
// delete from the Facilities page sticks. Safe to run twice.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
await c.query(`CREATE TABLE IF NOT EXISTS facility_redirects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(10) NOT NULL,
  value VARCHAR(255) NOT NULL,
  facilityId INT NULL,
  fromFacilityId INT NULL,
  reason VARCHAR(20) NOT NULL,
  createdBy VARCHAR(255) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY facility_redirects_kind_value (kind, value),
  KEY facility_redirects_facility (facilityId)
)`);
const [[t]] = await c.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facility_redirects'");
console.log(t.n ? "✅ facility_redirects is there" : "❌ facility_redirects missing");
await c.end();
