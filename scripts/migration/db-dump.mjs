// Read-only full backup of the production TiDB database -> backups/*.sql
// Uses only SELECT / SHOW. It does NOT modify the source database.
// The resulting .sql RECREATES tables (DROP + CREATE) and is meant to be
// restored into a SEPARATE/target database — never run it against production.
import "dotenv/config";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL not loaded from .env");
  process.exit(1);
}

const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port) || 4000,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  dateStrings: true, // keep timestamps exactly as stored (no TZ shifting)
  supportBigNumbers: true,
  bigNumberStrings: true,
});

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return conn.escape(v);
  if (Buffer.isBuffer(v)) return conn.escape(v);
  if (typeof v === "object") return conn.escape(JSON.stringify(v)); // JSON columns
  return conn.escape(v);
}

const [tablesRows] = await conn.query("SHOW TABLES");
const tableKey = Object.keys(tablesRows[0])[0];
const tables = tablesRows.map((r) => r[tableKey]);

fs.mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join("backups", `farahi-prod-${stamp}.sql`);
const ws = fs.createWriteStream(outFile);
ws.write(
  `-- farahi-lead-scraper production backup\n-- Source: TiDB Cloud (Manus)\n-- Generated: ${new Date().toISOString()}\n-- Restore target: a SEPARATE database (this script drops & recreates tables)\n\nSET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n`,
);

let grand = 0;
console.log("Dumping tables (table : rows):");
for (const t of tables) {
  const [[createRow]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
  const ddl = createRow["Create Table"] || createRow["Create View"];
  ws.write(`\n--\n-- Table: ${t}\n--\nDROP TABLE IF EXISTS \`${t}\`;\n${ddl};\n\n`);

  const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
  if (rows.length) {
    const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(", ");
    const values = rows.map((r) => "(" + Object.values(r).map(esc).join(", ") + ")");
    for (let i = 0; i < values.length; i += 200) {
      ws.write(`INSERT INTO \`${t}\` (${cols}) VALUES\n${values.slice(i, i + 200).join(",\n")};\n`);
    }
  }
  grand += rows.length;
  console.log(`  ${t.padEnd(26)} ${rows.length}`);
}

ws.write(`\nSET FOREIGN_KEY_CHECKS=1;\n`);
await new Promise((res) => ws.end(res));
await conn.end();

const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`\n✅ Backup written: ${outFile} (${sizeKb} KB)`);
console.log(`   ${tables.length} tables, ${grand} total rows`);
