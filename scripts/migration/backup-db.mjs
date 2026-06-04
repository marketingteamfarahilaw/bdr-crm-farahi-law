import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import fs from "fs";

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [tables] = await c.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
const dump = {};
for (const { t } of tables) {
  const [rows] = await c.query(`SELECT * FROM \`${t}\``);
  dump[t] = rows;
}
fs.mkdirSync("backups", { recursive: true });
const stamp = (process.argv[2] || "manual") + "-" + Math.floor(Date.now() / 1000);
const path = `backups/backup-${stamp}.json`;
fs.writeFileSync(path, JSON.stringify(dump));
console.log(`✅ Backed up ${tables.length} tables → ${path} (${(fs.statSync(path).size / 1048576).toFixed(1)} MB)`);
for (const t of Object.keys(dump)) if (dump[t].length) console.log(`  ${t}: ${dump[t].length}`);
await c.end();
