/**
 * Scan for duplicate facilities that share the same phone number (last 10 digits).
 * Read-only — reports scope so we can decide on a full dedup.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const norm = `RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10)`;
const [groups] = await c.query(
  `SELECT ${norm} np, COUNT(*) n, GROUP_CONCAT(id ORDER BY id) ids
   FROM facilities
   WHERE phone IS NOT NULL AND phone <> '' AND CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) >= 10
   GROUP BY np HAVING n > 1
   ORDER BY n DESC`
);
const extra = groups.reduce((s, g) => s + (g.n - 1), 0);
const [[tot]] = await c.query(`SELECT COUNT(*) n FROM facilities`);

console.log(`\nTotal facilities: ${tot.n}`);
console.log(`Duplicate phone groups: ${groups.length}`);
console.log(`Extra (duplicate) records that would be merged away: ${extra}`);
console.log(`\nLargest duplicate groups:`);
for (const g of groups.slice(0, 12)) console.log(`  ${g.np}: ${g.n} copies (ids ${g.ids})`);
await c.end();
