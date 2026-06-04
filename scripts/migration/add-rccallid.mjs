import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query("ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS rcCallId VARCHAR(64) NULL");
// Index so dedup lookups (WHERE rcCallId IN (...)) are fast.
try {
  await c.query("CREATE INDEX idx_contact_logs_rccallid ON contact_logs (rcCallId)");
  console.log("✅ rcCallId column + index ready");
} catch (e) {
  // Index may already exist on re-run — that's fine.
  console.log("✅ rcCallId column ready (index already present)");
}
await c.end();
