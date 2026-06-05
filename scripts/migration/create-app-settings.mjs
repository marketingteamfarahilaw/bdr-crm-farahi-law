import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query(`CREATE TABLE IF NOT EXISTS app_settings (
  settingKey VARCHAR(100) NOT NULL,
  settingValue LONGTEXT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (settingKey)
)`);
const [cols] = await c.query("SHOW COLUMNS FROM app_settings");
console.log("app_settings ready — columns:", cols.map((x) => x.Field).join(", "));
await c.end();
