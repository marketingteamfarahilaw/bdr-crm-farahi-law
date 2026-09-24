/**
 * Merge only the duplicates that are unambiguous, and leave the rest for a human.
 *
 * A pair qualifies when it shares a phone number AND one name contains the
 * other once punctuation is stripped ("Sanchez Auto Body" / "Sanchez Auto Body
 * Shop", "Fruitvale Collision" / "Fruitvale Collision Center"). Pairs with
 * genuinely different names on one line — "VA Collision Monterey Park" and
 * "Nitro Collision Center" — are NOT merged: those are often two businesses
 * sharing a phone, and merging would destroy a real partner and its history.
 *
 * The surviving row is the one with the most call history (ties → lowest id),
 * so nothing that reps have worked against is lost. Every child table is
 * repointed before the duplicate is removed, and blank fields on the survivor
 * are filled from it.
 *
 *   node scripts/migration/merge-obvious-duplicates.mjs            (report)
 *   node scripts/migration/merge-obvious-duplicates.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });

const p10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
// "and" vs "&" is a spelling difference, not a different business.
const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");
const city = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

const CHILD = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads",
  "facility_leads_sent", "facility_gratitude", "fr_expenses", "bdr_expenses", "referral_rewards",
  "referral_tracker", "pd_referrals", "pod_appointments", "qa_reviews", "uber_receipts"];
const FILL = ["address", "city", "phone", "phone2", "phone3", "contactName", "contactTitle", "contactPhone",
  "contactEmail", "website", "notes", "assignedRepName", "assignedRepId", "latitude", "longitude", "zipCode", "territory"];

const [facs] = await c.query("SELECT * FROM facilities");
const byPhone = new Map();
for (const f of facs) { const p = p10(f.phone); if (p) byPhone.set(p, [...(byPhone.get(p) || []), f]); }

const merges = [], skipped = [];
for (const group of byPhone.values()) {
  if (group.length < 2) continue;
  // Compare every pair in the group; only containment counts as obvious.
  const used = new Set();
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (used.has(a.id) || used.has(b.id)) continue;
      const ka = nk(a.name), kb = nk(b.name);
      const contained = ka === kb || ka.includes(kb) || kb.includes(ka);
      const sameCity = !a.city || !b.city || city(a.city) === city(b.city);
      if (contained && sameCity) {
        // Keep whichever carries more history.
        const [keep, drop] = (a.totalCalls ?? 0) >= (b.totalCalls ?? 0) ? [a, b] : [b, a];
        merges.push({ keep, drop });
        used.add(drop.id);
      } else {
        skipped.push([a, b]);
      }
    }
  }
}

console.log(`obvious duplicates to merge : ${merges.length}`);
merges.slice(0, 15).forEach(({ keep, drop }) =>
  console.log(`   "${drop.name}" (#${drop.id}, ${drop.totalCalls ?? 0} calls) → "${keep.name}" (#${keep.id}, ${keep.totalCalls ?? 0} calls)`));
console.log(`\nleft for human review        : ${skipped.length}`);
skipped.slice(0, 8).forEach(([a, b]) => console.log(`   #${a.id} ${a.name}  |  #${b.id} ${b.name}`));

if (!APPLY) { console.log("\n[DRY RUN] re-run with --apply."); await c.end(); process.exit(0); }

let done = 0;
for (const { keep, drop } of merges) {
  for (const t of CHILD) await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId=?`, [keep.id, drop.id]);
  const sets = [], vals = [];
  for (const col of FILL) if ((keep[col] == null || keep[col] === "") && drop[col] != null && drop[col] !== "") { sets.push(`\`${col}\`=?`); vals.push(drop[col]); }
  if (drop.partnerStatus === "active_partner" && keep.partnerStatus !== "active_partner") sets.push("partnerStatus='active_partner'");
  if (sets.length) await c.query(`UPDATE facilities SET ${sets.join(", ")}, updatedAt=NOW() WHERE id=?`, [...vals, keep.id]);
  await c.query("DELETE FROM facilities WHERE id=?", [drop.id]);
  done++;
}
// Call counts move with the rows, so recompute them.
await c.query(`UPDATE facilities f
  LEFT JOIN (SELECT facilityId, COUNT(*) cnt, MAX(contactDate) last FROM contact_logs GROUP BY facilityId) x ON x.facilityId=f.id
  SET f.totalCalls = COALESCE(x.cnt,0), f.lastContactDate = x.last, f.lastCheckInDate = COALESCE(x.last, f.lastCheckInDate)`);

const [[a]] = await c.query("SELECT COUNT(*) n FROM facilities");
const [[b]] = await c.query("SELECT COUNT(*) n FROM facilities WHERE partnerStatus='active_partner'");
console.log(`\n✅ merged ${done}. facilities now ${a.n}, active partners ${b.n}.`);
await c.end();
