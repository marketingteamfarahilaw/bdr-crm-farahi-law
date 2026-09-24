import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const [cols] = await c.query("SHOW COLUMNS FROM users LIKE 'photoUrl'");
if (cols.length === 0) {
  await c.query("ALTER TABLE users ADD COLUMN photoUrl LONGTEXT NULL");
  console.log("OK: added users.photoUrl");
} else {
  console.log("users.photoUrl already exists");
}
await c.end();
