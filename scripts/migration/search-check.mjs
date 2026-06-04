import dotenv from "dotenv"; dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL);
for (const q of ["name LIKE '%diamond%'", "name LIKE '%Diamond%'", "LOWER(name) LIKE '%diamond%'"]) {
  const [r] = await c.query(`SELECT COUNT(*) n FROM facilities WHERE ${q}`);
  console.log(q.padEnd(34), "→", r[0].n);
}
await c.end();
