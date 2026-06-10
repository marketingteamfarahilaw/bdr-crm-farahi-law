/**
 * Creates the Intake team accounts (idempotent — skips emails that already
 * exist). Prints each member's temp password ONCE; distribute and have them
 * change it via the super admin if needed.
 *
 *   node scripts/migration/create-intake-team.mjs
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { scryptSync, randomBytes } from "crypto";

const TEAM = [
  { name: "Malvin Rosales",   email: "malvin@farahilaw.com",  role: "intake_manager" }, // Intakes Manager
  { name: "Toni Fernandez",   email: "toni@farahilaw.com",    role: "intake_agent" },   // Operations Coordinator
  { name: "Felix Cedillo",    email: "felix@farahilaw.com",   role: "intake_agent" },   // Specialist
  { name: "Karen Vega",       email: "karenv@farahilaw.com",  role: "intake_agent" },   // Specialist
  { name: "George Iniguez",   email: "gi@farahilaw.com",      role: "intake_agent" },   // Specialist
  { name: "Melanie Vigueria", email: "melanie@farahilaw.com", role: "intake_agent" },   // Frontline
  { name: "Hugo Cachu",       email: "hugoc@farahilaw.com",   role: "intake_agent" },   // Frontline
  { name: "Ernesto De Sucre", email: "ernestd@farahilaw.com", role: "intake_agent" },   // Frontline
  { name: "Gizhel Flores",    email: "gizhel@farahilaw.com",  role: "intake_agent" },   // Frontline
];

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
};
// Readable, strong-enough temp password (they should be rotated after first login).
const tempPassword = () => {
  const words = randomBytes(4).toString("hex").slice(0, 6);
  const num = 100 + (randomBytes(1)[0] % 900);
  return `Intake-${words}-${num}`;
};
const rid = () => randomBytes(12).toString("hex");

const c = await mysql.createConnection(process.env.DATABASE_URL);
const created = [];
for (const m of TEAM) {
  const [existing] = await c.query("SELECT id, role FROM users WHERE email = ?", [m.email]);
  if (existing.length > 0) {
    // Account exists — just make sure the role is the intake one.
    if (existing[0].role !== m.role) {
      await c.query("UPDATE users SET role = ? WHERE id = ?", [m.role, existing[0].id]);
      console.log(`UPDATED role → ${m.role.padEnd(15)} ${m.name} <${m.email}> (account existed)`);
    } else {
      console.log(`SKIP   already set        ${m.name} <${m.email}>`);
    }
    continue;
  }
  const pw = tempPassword();
  await c.query(
    "INSERT INTO users (openId, name, email, role, passwordHash) VALUES (?, ?, ?, ?, ?)",
    [`local_${rid()}`, m.name, m.email, m.role, hashPassword(pw)],
  );
  created.push({ ...m, pw });
  console.log(`CREATED ${m.role.padEnd(15)} ${m.name} <${m.email}>`);
}
await c.end();

if (created.length) {
  console.log("\n=== TEMP PASSWORDS (share securely, shown only once) ===");
  for (const m of created) console.log(`${m.name.padEnd(20)} ${m.email.padEnd(26)} ${m.pw}`);
}
console.log("\nDone.");
