// Lead Docket's accident on each lead: its day, and the other leads intake
// linked to it (driver, passengers…). The Sign-ups Report's "Sign-up Unique
// Count" counts a linked group as one case (Miguel, 2026-09-28: "1 driver
// 1 passenger is 1 case"). Safe to run twice.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
await c.query("ALTER TABLE lead_intake ADD COLUMN IF NOT EXISTS incidentDate VARCHAR(10) NULL");
await c.query("ALTER TABLE lead_intake ADD COLUMN IF NOT EXISTS relatedLeadIds VARCHAR(500) NULL");
console.log("✅ lead_intake.incidentDate + relatedLeadIds ready");
await c.end();
