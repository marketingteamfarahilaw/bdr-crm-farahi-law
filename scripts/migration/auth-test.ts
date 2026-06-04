import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { hashPassword, verifyPassword } from "../../server/_core/password";

// 1) Crypto round-trip — proves hashPassword/verifyPassword agree (same scrypt params).
const stored = hashPassword("CorrectHorse9");
console.log("round-trip correct  :", verifyPassword("CorrectHorse9", stored) === true ? "PASS" : "FAIL");
console.log("round-trip wrong pw :", verifyPassword("wrong", stored) === false ? "PASS" : "FAIL");
console.log("round-trip null/empty:", verifyPassword("x", null) === false && verifyPassword("x", "") === false ? "PASS" : "FAIL");

// 2) Show the team so we know who needs a password / role.
const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows] = await c.query(
  "SELECT id, name, email, role, openId, CASE WHEN passwordHash IS NULL OR passwordHash='' THEN 'no' ELSE 'yes' END AS hasPw FROM users ORDER BY name"
);
console.log("\nUSERS:");
for (const u of rows as any[]) {
  const owner = u.openId === process.env.OWNER_OPEN_ID ? "  <-- OWNER" : "";
  console.log(`  #${u.id}  ${(u.name || "(no name)").padEnd(20)} ${(u.email || "(no email)").padEnd(34)} role=${(u.role || "").padEnd(12)} pw=${u.hasPw}${owner}`);
}
await c.end();
