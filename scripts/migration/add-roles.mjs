// Expand the users.role enum to support the 5-role model. Additive — existing
// 'admin'/'user' values are preserved.
import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query(
  "ALTER TABLE users MODIFY COLUMN role ENUM('user','admin','super_admin','bdr_manager','fr_manager','bdr_agent','fr_agent') NOT NULL DEFAULT 'user'",
);
console.log("✅ role enum expanded");
const [rows] = await c.query("SELECT role, COUNT(*) n FROM users GROUP BY role");
console.log("current role distribution:", JSON.stringify(rows));
await c.end();
