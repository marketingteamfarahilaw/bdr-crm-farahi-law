/**
 * Creates the per-agent RingCentral token table so each CRM user can connect
 * their OWN RingCentral account (OAuth). Idempotent — safe to re-run.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);

const [tables] = await c.query("SHOW TABLES LIKE 'user_ringcentral_tokens'");
if (tables.length === 0) {
  await c.query(`
    CREATE TABLE user_ringcentral_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      accountId VARCHAR(128) NULL,
      extensionId VARCHAR(64) NULL,
      ownerName VARCHAR(255) NULL,
      ownerEmail VARCHAR(320) NULL,
      accessToken TEXT NOT NULL,
      refreshToken TEXT NOT NULL,
      tokenExpiry TIMESTAMP NOT NULL,
      lastSyncAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_rc_user (userId)
    )
  `);
  console.log("OK: created table user_ringcentral_tokens");
} else {
  console.log("user_ringcentral_tokens already exists");
}

await c.end();
