// Read-only: list users so we can identify the app owner (OWNER_OPEN_ID).
import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const [rows] = await conn.query(
  "SELECT id, openId, name, role, loginMethod, lastSignedIn FROM users ORDER BY id",
);
for (const r of rows) {
  console.log(
    `#${r.id}  role=${(r.role || "").padEnd(8)} login=${(r.loginMethod || "").padEnd(10)} name=${r.name || ""}  openId=${r.openId}`,
  );
}
await conn.end();
