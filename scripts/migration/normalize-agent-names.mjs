/**
 * Canonicalise rep names to the full name on their user account.
 *
 * The same person is recorded several ways depending on where a row came from:
 * RingCentral and the app write "Queenie Miranda", while the team's
 * spreadsheets (and therefore the imported history) hold just "Queenie". Rows
 * then scatter across two names — reports show a person twice, and an agent
 * filtered to their own name misses most of their own work.
 *
 * Only unambiguous first names are rewritten: if two users share one, nothing
 * is touched. Runs as a dry run unless --apply is passed.
 *
 *   node scripts/migration/normalize-agent-names.mjs
 *   node scripts/migration/normalize-agent-names.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const TARGETS = [
  ["contact_logs", "repName"],
  ["rc_unmatched_calls", "agentName"],
  ["referral_tracker", "bdrAssigned"],
  ["fr_expenses", "agentName"],
  ["bdr_expenses", "agentName"],
  ["field_visits", "agentName"],
  ["fr_errands", "agentName"],
  ["referral_rewards", "agentName"],
  ["lead_intake", "member"],
];

const c = await mysql.createConnection(process.env.DATABASE_URL);

const [users] = await c.query("SELECT id, name FROM users WHERE name IS NOT NULL AND name <> ''");
const byFirst = new Map();
for (const u of users) {
  const first = String(u.name).trim().split(/\s+/)[0].toLowerCase();
  if (!first) continue;
  byFirst.set(first, [...(byFirst.get(first) || []), String(u.name).trim()]);
}
const canonical = new Map();
for (const [first, names] of byFirst) {
  const unique = [...new Set(names)];
  if (unique.length === 1 && unique[0].includes(" ")) canonical.set(first, unique[0]);
  else if (unique.length > 1) console.log(`skipping "${first}" — ${unique.length} users share it: ${unique.join(", ")}`);
}
console.log(`Canonical names: ${[...canonical.values()].join(", ")}\n`);

let total = 0;
for (const [table, col] of TARGETS) {
  const [rows] = await c.query(
    `SELECT \`${col}\` v, COUNT(*) n FROM \`${table}\`
      WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> '' GROUP BY v`
  );
  for (const r of rows) {
    const value = String(r.v).trim();
    if (value.includes(" ")) continue;                    // already a full name
    const full = canonical.get(value.toLowerCase());
    if (!full) continue;                                  // no matching user — leave it
    console.log(`${table}.${col}: "${value}" -> "${full}"  (${r.n} rows)`);
    total += r.n;
    if (APPLY) await c.query(`UPDATE \`${table}\` SET \`${col}\` = ? WHERE \`${col}\` = ?`, [full, value]);
  }
}

console.log(`\n${APPLY ? "✅ Updated" : "[DRY RUN] would update"} ${total} rows.`);
if (!APPLY) console.log("Re-run with --apply to write the changes.");
await c.end();
