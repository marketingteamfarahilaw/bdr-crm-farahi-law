import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
await c.query(`CREATE TABLE IF NOT EXISTS lead_intake (
  id INT AUTO_INCREMENT PRIMARY KEY,
  leadDate TIMESTAMP NULL,
  role VARCHAR(80),
  member VARCHAR(120),
  leadName VARCHAR(255) NOT NULL,
  value VARCHAR(60),
  outcome VARCHAR(120),
  classification VARCHAR(120),
  sud VARCHAR(120),
  liability VARCHAR(120),
  disposition VARCHAR(120),
  facility VARCHAR(255),
  typeOfFacility VARCHAR(120),
  clientLocation VARCHAR(255),
  fvDocumentation TEXT,
  createdById INT,
  notes TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);
const [cols] = await c.query("SHOW COLUMNS FROM lead_intake");
console.log("lead_intake ready — columns:", cols.map((x) => x.Field).join(", "));
await c.end();
