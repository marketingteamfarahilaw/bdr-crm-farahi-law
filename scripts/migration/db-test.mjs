// Read-only connectivity test for the production TiDB (Manus) database.
// Tries the app's exact connection method first, then an explicit-TLS fallback.
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL did not load from .env");
  process.exit(1);
}
console.log("Loaded DATABASE_URL:", url.replace(/:([^:@/]+)@/, ":••••••@"));

async function tryConnect(label, config) {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    const [tables] = await conn.query("SHOW TABLES");
    let usersCount = "n/a";
    try {
      const [[r]] = await conn.query("SELECT COUNT(*) AS c FROM users");
      usersCount = r.c;
    } catch {}
    console.log(`✅ ${label}: connected — ${tables.length} tables, users rows = ${usersCount}`);
    return true;
  } catch (e) {
    console.log(`❌ ${label}: ${e.code || ""} ${e.message}`);
    return false;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// 1) Exactly how the app connects today: pass the raw URL string to mysql2.
let ok = await tryConnect("raw URL (app default)", url);

// 2) Fallback: explicit config with an SSL object (TiDB Cloud requires TLS).
if (!ok) {
  const u = new URL(url);
  ok = await tryConnect("explicit config + ssl object", {
    host: u.hostname,
    port: Number(u.port) || 4000,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}

process.exit(ok ? 0 : 1);
