import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
// Dynamic import so env.ts (read at import) sees the loaded .env.
const { analyzeCallTranscript } = await import("../../server/rcSync");

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await c.query(
  "SELECT id, rawText FROM facility_updates WHERE updateType='transcript' AND rawText IS NOT NULL AND CHAR_LENGTH(rawText)>60 AND rawText NOT LIKE '[%'"
);
console.log(`Backfilling ${rows.length} recaps with key points…`);
let done = 0;
for (const r of rows) {
  const a = await analyzeCallTranscript(r.rawText);
  if (!a.summary) continue;
  await c.query("UPDATE facility_updates SET summary=?, extractedData=? WHERE id=?", [a.summary, JSON.stringify(a.extractedData), r.id]);
  done++;
  process.stdout.write(".");
}
console.log(`\n✅ Backfilled ${done} recaps with the Summary / Recap / Tasks format.`);
await c.end();
process.exit(0);
