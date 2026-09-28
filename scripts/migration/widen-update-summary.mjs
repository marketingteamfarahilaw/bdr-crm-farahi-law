// Call recaps' summaries can run past 500 characters (Claude writes two or three
// full sentences); the insert then failed and the recap was retried for nothing
// (2026-09-28). Widening a VARCHAR is a metadata-only change. Safe to run twice.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
await c.query("ALTER TABLE facility_updates MODIFY COLUMN summary VARCHAR(2000) NULL");
const [[col]] = await c.query("SELECT CHARACTER_MAXIMUM_LENGTH n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'facility_updates' AND COLUMN_NAME = 'summary'");
console.log("✅ facility_updates.summary is now VARCHAR(" + col.n + ")");
await c.end();
