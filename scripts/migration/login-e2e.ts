import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { hashPassword } from "../../server/_core/password";

const EMAIL = "marketingteam@farahilaw.com"; // owner #1, unique email
const PW = "E2eTest-9182!";
const BASE = "http://localhost:3000";

const c = await mysql.createConnection(process.env.DATABASE_URL!);
const [before] = (await c.query("SELECT passwordHash FROM users WHERE email=? LIMIT 1", [EMAIL])) as any;
const prevHash = before[0]?.passwordHash ?? null;
await c.query("UPDATE users SET passwordHash=? WHERE email=?", [hashPassword(PW), EMAIL]);

try {
  // 1) Correct login → expect 200, success, Set-Cookie
  const loginRes = await fetch(`${BASE}/api/trpc/auth.login?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: { email: EMAIL, password: PW } } }),
  });
  const setCookie = loginRes.headers.get("set-cookie");
  const loginBody = await loginRes.text();
  console.log("login status :", loginRes.status);
  console.log("set-cookie   :", setCookie ? "present → " + setCookie.split("=")[0] : "MISSING");
  console.log("login body   :", loginBody.slice(0, 240));

  // 2) auth.me with the cookie → expect the user object (authenticated)
  const cookie = setCookie?.split(";")[0];
  if (cookie) {
    const input = encodeURIComponent(JSON.stringify({ "0": { json: null } }));
    const meRes = await fetch(`${BASE}/api/trpc/auth.me?batch=1&input=${input}`, { headers: { cookie } });
    console.log("auth.me      :", meRes.status, (await meRes.text()).slice(0, 240));
  }

  // 3) Wrong password → expect 401 UNAUTHORIZED
  const badRes = await fetch(`${BASE}/api/trpc/auth.login?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "0": { json: { email: EMAIL, password: "definitely-wrong" } } }),
  });
  console.log("wrong pw     :", badRes.status, (await badRes.text()).slice(0, 140));
} finally {
  if (prevHash === null) await c.query("UPDATE users SET passwordHash=NULL WHERE email=?", [EMAIL]);
  else await c.query("UPDATE users SET passwordHash=? WHERE email=?", [prevHash, EMAIL]);
  console.log("→ restored owner passwordHash to its previous state (no lasting change).");
  await c.end();
}
