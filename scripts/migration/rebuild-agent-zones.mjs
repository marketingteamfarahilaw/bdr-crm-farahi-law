/**
 * Rebuild agent_zones from where each rep's partners actually are.
 *
 * The table was lost with the original database. Rather than guess
 * territories, derive each zone from the cities of the facilities assigned to
 * that rep. Reps with fewer than MIN_FACILITIES are skipped so stray values
 * ("CM", a phone number typed into the rep column) don't become zones.
 * Existing zones are updated in place — colour and profile fields are kept.
 *
 *   node scripts/migration/rebuild-agent-zones.mjs          (report)
 *   node scripts/migration/rebuild-agent-zones.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const MIN_FACILITIES = 5;
const PALETTE = ["#FF6B35", "#4ECDC4", "#A855F7", "#F59E0B", "#3B82F6", "#10B981", "#EF4444", "#EC4899",
  "#14B8A6", "#8B5CF6", "#F97316", "#22C55E", "#0EA5E9", "#E11D48", "#84CC16", "#6366F1"];

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const rows = (await c.query(
  `SELECT assignedRepName rep, city, COUNT(*) n FROM facilities
    WHERE assignedRepName IS NOT NULL AND assignedRepName <> '' AND city IS NOT NULL AND city <> ''
    GROUP BY rep, city`
))[0];

const reps = new Map();
for (const r of rows) {
  const rep = String(r.rep).trim();
  if (!/^[A-Za-z][A-Za-z .'-]+$/.test(rep)) continue;          // skip phone numbers / junk
  const e = reps.get(rep) || { total: 0, cities: new Map() };
  e.total += Number(r.n);
  const city = String(r.city).trim().replace(/\s+/g, " ");
  e.cities.set(city, (e.cities.get(city) || 0) + Number(r.n));
  reps.set(rep, e);
}

const existing = new Map((await c.query("SELECT agentName, color FROM agent_zones"))[0].map((z) => [z.agentName, z.color]));
let i = 0, written = 0;
for (const [rep, e] of [...reps.entries()].sort((a, b) => b[1].total - a[1].total)) {
  if (e.total < MIN_FACILITIES) continue;
  const cities = [...e.cities.entries()].sort((a, b) => b[1] - a[1]).map(([city]) => city);
  const color = existing.get(rep) || PALETTE[i % PALETTE.length];
  i++;
  const [first, ...rest] = rep.split(" ");
  console.log(`${rep.padEnd(18)} ${String(e.total).padStart(4)} facilities · ${cities.length} cities · ${color}  (${cities.slice(0, 5).join(", ")}${cities.length > 5 ? "…" : ""})`);
  if (APPLY) {
    await c.query(
      `INSERT INTO agent_zones (agentName, firstName, lastName, color, cities, active, notes, createdAt, updatedAt)
       VALUES (?,?,?,?,?,1,?,NOW(),NOW())
       ON DUPLICATE KEY UPDATE cities=VALUES(cities), updatedAt=NOW()`,
      [rep, first, rest.join(" ") || null, color, JSON.stringify(cities), "Rebuilt from assigned facilities' cities"]
    );
    written++;
  }
}
console.log(APPLY ? `\n✅ ${written} zones written.` : "\n[DRY RUN] re-run with --apply.");
await c.end();
