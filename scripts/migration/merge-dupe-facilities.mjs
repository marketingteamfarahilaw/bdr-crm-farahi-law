/**
 * Merges TRUE duplicate facilities: identical normalized name AND identical
 * last-10-digit phone. Keeper = most contact logs (ties → lowest id).
 * All child rows are repointed to the keeper, then the loser is deleted.
 * Backup (full row + child counts) → merge-dupe-facilities-backup.json
 *
 * Run: node scripts/migration/merge-dupe-facilities.mjs           (dry run)
 *      node scripts/migration/merge-dupe-facilities.mjs --apply
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const CHILD = [
  "contact_logs", "facility_leads_sent", "facility_tasks", "facility_referrals",
  "facility_gratitude", "facility_leads", "facility_updates", "bdr_expenses",
  "fr_expenses", "referral_rewards", "referral_tracker", "uber_receipts",
  "pod_appointments", "qa_reviews", "pd_referrals",
];
const p10 = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const nname = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const c = await mysql.createConnection(process.env.DATABASE_URL);
const q = async (s, p = []) => (await c.query(s, p))[0];
const rows = await q("SELECT * FROM facilities");

const groups = new Map();
for (const r of rows) {
  const phone = p10(r.phone);
  if (!phone) continue; // never merge without a phone to corroborate
  const k = `${nname(r.name)}|${phone}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const plan = [];
for (const grp of Array.from(groups.values()).filter((g) => g.length > 1)) {
  const scored = [];
  for (const r of grp) {
    const n = Object.values((await q("SELECT COUNT(*) n FROM contact_logs WHERE facilityId=?", [r.id]))[0])[0];
    scored.push({ row: r, logs: Number(n) });
  }
  scored.sort((a, b) => b.logs - a.logs || a.row.id - b.row.id);
  plan.push({ keep: scored[0], drop: scored.slice(1) });
}

console.log(`True duplicate groups: ${plan.length} | facilities to remove: ${plan.reduce((s, p) => s + p.drop.length, 0)}`);
for (const p of plan) {
  console.log(`  KEEP #${p.keep.row.id} "${p.keep.row.name}" (${p.keep.logs} logs) ← ${p.drop.map((d) => `#${d.row.id}(${d.logs})`).join(", ")}`);
}

if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to write."); await c.end(); process.exit(0); }

fs.writeFileSync("scripts/migration/merge-dupe-facilities-backup.json", JSON.stringify(plan, null, 2));
let moved = 0, removed = 0;
for (const p of plan) {
  for (const d of p.drop) {
    for (const t of CHILD) {
      const r = await q(`UPDATE ${t} SET facilityId=? WHERE facilityId=?`, [p.keep.row.id, d.row.id]);
      moved += r.affectedRows ?? 0;
    }
    // carry over any field the keeper is missing
    for (const f of ["phone", "email", "address", "city", "state", "zip", "contactName", "territory", "managedBy", "assignedRepName", "category"]) {
      const kv = p.keep.row[f], dv = d.row[f];
      if ((kv === null || kv === "") && dv !== null && dv !== "") await q(`UPDATE facilities SET ${f}=? WHERE id=?`, [dv, p.keep.row.id]);
    }
    await q("DELETE FROM facilities WHERE id=?", [d.row.id]);
    removed++;
  }
}
console.log(`\nAPPLIED — ${removed} duplicate facilities merged, ${moved} child rows repointed (backup → merge-dupe-facilities-backup.json).`);
await c.end();
