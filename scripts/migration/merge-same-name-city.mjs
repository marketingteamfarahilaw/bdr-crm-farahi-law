/**
 * Merge facilities that share a name AND a city.
 *
 * These are the same business entered twice — usually once per spreadsheet tab,
 * with a different phone number each time ("Spine and Sport Chiropractic",
 * Alameda: one row with 44 calls, one with none). Facilities sharing a name in
 * DIFFERENT cities are left alone: "Hess Rehabilitation" exists in Anaheim,
 * Fontana and El Monte, and those are three real partners.
 *
 * The row with the most call history survives. The duplicate's phone number is
 * not thrown away — it moves into the survivor's phone2/phone3 if those are
 * free, because reps dial those numbers.
 *
 *   node scripts/migration/merge-same-name-city.mjs            (report)
 *   node scripts/migration/merge-same-name-city.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection(process.env.DATABASE_URL);

const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");
const ck = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const p10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

const CHILD = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads",
  "facility_leads_sent", "facility_gratitude", "fr_expenses", "bdr_expenses", "referral_rewards",
  "referral_tracker", "pd_referrals", "pod_appointments", "qa_reviews", "uber_receipts"];
const FILL = ["address", "contactName", "contactTitle", "contactPhone", "contactEmail", "website", "notes",
  "assignedRepName", "assignedRepId", "latitude", "longitude", "zipCode", "territory"];

const [facs] = await c.query("SELECT * FROM facilities");
const groups = new Map();
for (const f of facs) {
  const city = ck(f.city);
  if (!city) continue;                       // no city — cannot be sure it is the same place
  const key = nk(f.name) + "|" + city;
  groups.set(key, [...(groups.get(key) || []), f]);
}

const merges = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  const sorted = [...g].sort((a, b) => (b.totalCalls ?? 0) - (a.totalCalls ?? 0) || a.id - b.id);
  const [keep, ...drops] = sorted;
  for (const drop of drops) merges.push({ keep, drop });
}

console.log(`same name + same city pairs to merge: ${merges.length}`);
merges.slice(0, 12).forEach(({ keep, drop }) =>
  console.log(`   "${drop.name}" (#${drop.id}, ${drop.totalCalls ?? 0} calls, ${drop.phone ?? "no phone"}) → #${keep.id} (${keep.totalCalls ?? 0} calls)`));

if (!APPLY) { console.log("\n[DRY RUN] re-run with --apply."); await c.end(); process.exit(0); }

let done = 0, phonesKept = 0;
for (const { keep, drop } of merges) {
  for (const t of CHILD) await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId=?`, [keep.id, drop.id]);

  const sets = [], vals = [];
  for (const col of FILL) {
    if ((keep[col] == null || keep[col] === "") && drop[col] != null && drop[col] !== "") {
      sets.push(`\`${col}\`=?`); vals.push(drop[col]); keep[col] = drop[col];
    }
  }
  // Keep the duplicate's phone if it is a genuinely different number.
  const known = new Set([p10(keep.phone), p10(keep.phone2), p10(keep.phone3)].filter(Boolean));
  const extra = p10(drop.phone);
  if (extra && !known.has(extra)) {
    const slot = !keep.phone2 ? "phone2" : !keep.phone3 ? "phone3" : null;
    if (slot) { sets.push(`\`${slot}\`=?`); vals.push(drop.phone); keep[slot] = drop.phone; phonesKept++; }
  }
  if (drop.partnerStatus === "active_partner" && keep.partnerStatus !== "active_partner") {
    sets.push("partnerStatus='active_partner'"); keep.partnerStatus = "active_partner";
  }
  if (sets.length) await c.query(`UPDATE facilities SET ${sets.join(", ")}, updatedAt=NOW() WHERE id=?`, [...vals, keep.id]);
  await c.query("DELETE FROM facilities WHERE id=?", [drop.id]);
  done++;
}
await c.query(`UPDATE facilities f
  LEFT JOIN (SELECT facilityId, COUNT(*) cnt, MAX(contactDate) last FROM contact_logs GROUP BY facilityId) x ON x.facilityId=f.id
  SET f.totalCalls = COALESCE(x.cnt,0), f.lastContactDate = x.last, f.lastCheckInDate = COALESCE(x.last, f.lastCheckInDate)`);

const [[a]] = await c.query("SELECT COUNT(*) n FROM facilities");
const [[b]] = await c.query("SELECT COUNT(*) n FROM facilities WHERE partnerStatus='active_partner'");
console.log(`\n✅ merged ${done} (kept ${phonesKept} alternate phone numbers). facilities now ${a.n}, active partners ${b.n}.`);
await c.end();
