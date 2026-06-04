import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [rel] = await c.query("SELECT COALESCE(relationshipStatus,'(null)') s, COUNT(*) n FROM facilities GROUP BY relationshipStatus ORDER BY n DESC");
const [part] = await c.query("SELECT COALESCE(partnerStatus,'(null)') s, COUNT(*) n FROM facilities GROUP BY partnerStatus ORDER BY n DESC");
console.log("relationshipStatus:", JSON.stringify(rel));
console.log("partnerStatus:   ", JSON.stringify(part));
await c.end();
