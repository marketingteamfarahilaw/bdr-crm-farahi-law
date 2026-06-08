/**
 * Adds contact_logs.rcSessionId — the RingCentral telephonySessionId, which is
 * stable ACROSS extensions. The existing rcCallId is a per-extension record id,
 * so now that call sync is per-agent, one physical call landing in two connected
 * agents' extension logs (ring group / shared line / transferred inbound) gets a
 * different rcCallId in each and was logged twice. Deduping on rcSessionId fixes
 * that. Idempotent — safe to re-run.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);

const [cols] = await c.query("SHOW COLUMNS FROM contact_logs LIKE 'rcSessionId'");
if (cols.length === 0) {
  await c.query("ALTER TABLE contact_logs ADD COLUMN rcSessionId VARCHAR(64) NULL");
  console.log("OK: added column contact_logs.rcSessionId");
} else {
  console.log("contact_logs.rcSessionId already exists");
}

await c.end();
