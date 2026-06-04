/**
 * Seed or reset a user's login password from the command line.
 *
 *   corepack pnpm exec tsx scripts/migration/set-password.ts <email> <password>
 *
 * Use this once before the first production login to set the super-admin's
 * password (so you can sign in after the dev backdoor is disabled). After that,
 * manage passwords from the Team & Roles page in the app.
 *
 * Reuses server/_core/password.ts so the hash format always matches login.
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { hashPassword } from "../../server/_core/password";

const email = process.argv[2]?.toLowerCase().trim();
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: tsx scripts/migration/set-password.ts <email> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}

const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows] = (await c.query(
  "SELECT id, name, email, role FROM users WHERE email=? ORDER BY (passwordHash IS NOT NULL) DESC, id DESC",
  [email]
)) as any;

if (!rows.length) {
  console.error(`No user found with email "${email}".`);
  await c.end();
  process.exit(1);
}
if (rows.length > 1) {
  console.warn(`⚠  ${rows.length} accounts share ${email}; setting the password on the one login will use (id=${rows[0].id}).`);
}

const u = rows[0];
await c.query("UPDATE users SET passwordHash=? WHERE id=?", [hashPassword(password), u.id]);
console.log(`✅ Password set for ${u.name || u.email}  (id=${u.id}, role=${u.role}). They can now sign in with their email + this password.`);
await c.end();
