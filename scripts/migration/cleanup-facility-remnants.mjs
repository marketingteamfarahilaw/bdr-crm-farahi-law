/**
 * Last-mile facility clean-up after the bulk imports and merges.
 *
 *  1. Rows that are not businesses at all — a spreadsheet "#REF!" error that got
 *     imported as a facility. Deleted only when nothing references them.
 *  2. Same-name pairs where one copy has no city. merge-same-name-city.mjs
 *     deliberately requires both cities to match, so these were left behind;
 *     a blank city contradicts nothing, so they are the same business entered
 *     twice. The copy with the most call history survives and keeps the other's
 *     phone number.
 *
 *   node scripts/migration/cleanup-facility-remnants.mjs            (report)
 *   node scripts/migration/cleanup-facility-remnants.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });

const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");
const p10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const CHILD = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads",
  "facility_leads_sent", "facility_gratitude", "fr_expenses", "bdr_expenses", "referral_rewards",
  "referral_tracker", "pd_referrals", "pod_appointments", "qa_reviews", "uber_receipts"];
const FILL = ["address", "city", "contactName", "contactTitle", "contactPhone", "contactEmail", "website",
  "notes", "assignedRepName", "assignedRepId", "latitude", "longitude", "zipCode", "territory"];

// ── 1. junk rows ─────────────────────────────────────────────────────────────
const [junk] = await c.query("SELECT id, name FROM facilities WHERE name LIKE '%#REF%' OR name REGEXP '^[^A-Za-z]+$'");
let deleted = 0;
for (const j of junk) {
  let refs = 0;
  for (const t of CHILD) refs += (await c.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE facilityId=?`, [j.id]))[0][0].n;
  if (refs > 0) { console.log(`  keeping #${j.id} "${j.name}" — ${refs} rows reference it`); continue; }
  console.log(`  delete #${j.id} "${j.name}" (nothing references it)`);
  if (APPLY) await c.query("DELETE FROM facilities WHERE id=?", [j.id]);
  deleted++;
}
console.log(`junk rows removed: ${deleted}\n`);

// ── 2. same name, one copy missing its city ─────────────────────────────────
const [facs] = await c.query("SELECT * FROM facilities");
const byName = new Map();
for (const f of facs) {
  if (junk.some((j) => j.id === f.id)) continue;
  byName.set(nk(f.name), [...(byName.get(nk(f.name)) || []), f]);
}
const merges = [];
for (const g of byName.values()) {
  if (g.length < 2) continue;
  const cities = new Set(g.map((f) => String(f.city ?? "").trim().toLowerCase()).filter(Boolean));
  if (cities.size > 1) continue;                    // genuinely different branches — leave alone
  const sorted = [...g].sort((a, b) => (b.totalCalls ?? 0) - (a.totalCalls ?? 0) || a.id - b.id);
  const [keep, ...drops] = sorted;
  for (const drop of drops) merges.push({ keep, drop });
}
console.log(`same-name pairs with no conflicting city: ${merges.length}`);
merges.forEach(({ keep, drop }) =>
  console.log(`  "${drop.name}" #${drop.id} (${drop.totalCalls ?? 0} calls, ${drop.city || "no city"}) → #${keep.id} (${keep.totalCalls ?? 0} calls, ${keep.city || "no city"})`));

if (!APPLY) { console.log("\n[DRY RUN] re-run with --apply."); await c.end(); process.exit(0); }

let merged = 0;
for (const { keep, drop } of merges) {
  for (const t of CHILD) await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId=?`, [keep.id, drop.id]);
  const sets = [], vals = [];
  for (const col of FILL) {
    if ((keep[col] == null || keep[col] === "") && drop[col] != null && drop[col] !== "") {
      sets.push(`\`${col}\`=?`); vals.push(drop[col]); keep[col] = drop[col];
    }
  }
  const known = new Set([p10(keep.phone), p10(keep.phone2), p10(keep.phone3)].filter(Boolean));
  const extra = p10(drop.phone);
  if (extra && !known.has(extra)) {
    const slot = !keep.phone2 ? "phone2" : !keep.phone3 ? "phone3" : null;
    if (slot) { sets.push(`\`${slot}\`=?`); vals.push(drop.phone); keep[slot] = drop.phone; }
  }
  if (drop.partnerStatus === "active_partner" && keep.partnerStatus !== "active_partner") sets.push("partnerStatus='active_partner'");
  if (sets.length) await c.query(`UPDATE facilities SET ${sets.join(", ")}, updatedAt=NOW() WHERE id=?`, [...vals, keep.id]);
  await c.query("DELETE FROM facilities WHERE id=?", [drop.id]);
  merged++;
}
await c.query(`UPDATE facilities f
  LEFT JOIN (SELECT facilityId, COUNT(*) cnt, MAX(contactDate) last FROM contact_logs GROUP BY facilityId) x ON x.facilityId=f.id
  SET f.totalCalls = COALESCE(x.cnt,0), f.lastContactDate = x.last, f.lastCheckInDate = COALESCE(x.last, f.lastCheckInDate)`);

const [[a]] = await c.query("SELECT COUNT(*) n FROM facilities");
console.log(`\n✅ ${deleted} junk rows deleted, ${merged} merged. facilities now ${a.n}.`);
await c.end();
