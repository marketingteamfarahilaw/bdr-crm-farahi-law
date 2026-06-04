// Safe facility de-duplication. Groups facilities that share BOTH a normalized
// phone AND a normalized name (so different locations sharing a corporate line
// are NOT merged). For each group it keeps the record with the most contact
// history, preserves the most-advanced partner status and any assigned rep,
// reassigns all child rows, and deletes the empty duplicates.
//
//   node -r dotenv/config scripts/migration/dedup-facilities.mjs --dry   (preview)
//   node -r dotenv/config scripts/migration/dedup-facilities.mjs         (apply)
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const digits = (s) => (s || "").replace(/\D/g, "");
const nameKey = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const RANK = { priority_partner: 6, active_partner: 5, needs_follow_up: 4, prospect: 3, dormant: 2, do_not_use: 1 };
const dry = process.argv.includes("--dry");

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await c.query("SELECT id, name, phone, partnerStatus, assignedRepId, assignedRepName FROM facilities WHERE phone IS NOT NULL AND phone<>''");
const [cols] = await c.query("SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='facilityId'");
const childTables = cols.map((x) => x.t);
const [counts] = await c.query("SELECT facilityId fid, COUNT(*) n FROM contact_logs GROUP BY facilityId");
const logCount = new Map(counts.map((r) => [r.fid, Number(r.n)]));

const groups = new Map();
for (const f of facs) {
  const d = digits(f.phone);
  if (d.length < 7) continue; // skip junk numbers
  const key = d + "|" + nameKey(f.name);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}

let mergedGroups = 0, removed = 0, moved = 0;
for (const members of groups.values()) {
  if (members.length < 2) continue;
  members.sort((a, b) =>
    (logCount.get(b.id) || 0) - (logCount.get(a.id) || 0) ||
    (RANK[b.partnerStatus] || 0) - (RANK[a.partnerStatus] || 0) ||
    a.id - b.id
  );
  const keep = members[0];
  const dups = members.slice(1).map((m) => m.id);
  const bestStatus = members.map((m) => m.partnerStatus).filter(Boolean).sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] || keep.partnerStatus;
  const rep = members.find((m) => m.assignedRepId);
  console.log(`${dry ? "[dry] " : ""}${(keep.name || "").slice(0, 34).padEnd(34)} keep #${keep.id} (${logCount.get(keep.id) || 0} logs) ← merge ${dups.join(", ")}`);
  mergedGroups++; removed += dups.length;
  if (dry) continue;
  const ph = dups.map(() => "?").join(",");
  for (const t of childTables) {
    const [r] = await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId IN (${ph})`, [keep.id, ...dups]);
    moved += r.affectedRows;
  }
  await c.query(
    "UPDATE facilities SET partnerStatus=?, assignedRepId=COALESCE(assignedRepId,?), assignedRepName=COALESCE(assignedRepName,?) WHERE id=?",
    [bestStatus, rep?.assignedRepId ?? null, rep?.assignedRepName ?? null, keep.id]
  );
  await c.query(`DELETE FROM facilities WHERE id IN (${ph})`, dups);
}
console.log(`\n${dry ? "[DRY RUN] would merge" : "✅ Merged"} ${mergedGroups} groups, ${dry ? "removing" : "removed"} ${removed} duplicate records${dry ? "" : `, moved ${moved} child rows`}.`);
await c.end();
