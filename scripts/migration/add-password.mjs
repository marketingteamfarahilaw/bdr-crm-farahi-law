import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS passwordHash VARCHAR(255) NULL");
console.log("✅ users.passwordHash column ready");
await c.end();
