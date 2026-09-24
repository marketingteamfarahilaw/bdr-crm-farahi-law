import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const adds = [
  ["lastName", "VARCHAR(255)"],
  ["phone", "VARCHAR(60)"],
  ["email", "VARCHAR(320)"],
];
for (const [col, type] of adds) {
  const [cols] = await c.query(`SHOW COLUMNS FROM lead_intake LIKE '${col}'`);
  if (cols.length === 0) {
    await c.query(`ALTER TABLE lead_intake ADD COLUMN ${col} ${type} NULL`);
    console.log("OK: added lead_intake." + col);
  } else {
    console.log("lead_intake." + col + " already exists");
  }
}
await c.end();
