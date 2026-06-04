// Thorough, safe facility de-duplication.
// Groups by normalized PHONE, then clusters names by CONTAINMENT (one name is a
// substring of another → same business). Records with the same phone but
// genuinely different names (e.g. two locations on one corporate line) are NOT
// merged — they're reported for manual review. Keeps the richest record,
// preserves the most-advanced partner status + assigned rep, reassigns all
// child rows, deletes the empties.
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

const byPhone = new Map();
for (const f of facs) {
  const d = digits(f.phone);
  if (d.length < 7) continue;
  if (!byPhone.has(d)) byPhone.set(d, []);
  byPhone.get(d).push(f);
}

// Strong key: strip punctuation + generic filler words so that punctuation /
// wording variants of the SAME business collapse, while different businesses
// (and numbered second locations) stay distinct.
const FILLER = /\b(center|centre|clinic|inc|llc|co|corp|corporation|the|and|of)\b/g;
const strongKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();

// Two records are "the same business" if: names are equal, one name contains the
// other, or they're equal after strong-normalization.
function related(a, b) {
  const na = nameKey(a.name), nb = nameKey(b.name);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 6 && long.includes(short)) return true;
  const sa = strongKey(a.name), sb = strongKey(b.name);
  return sa.length >= 5 && sa === sb;
}

const merges = [];
const review = [];
for (const [phone, members] of byPhone) {
  if (members.length < 2) continue;
  const parent = members.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++)
      if (related(members[i], members[j])) parent[find(i)] = find(j);
  const clusters = new Map();
  for (let i = 0; i < members.length; i++) {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(members[i]);
  }
  const list = [...clusters.values()];
  for (const cl of list) {
    if (cl.length < 2) continue;
    cl.sort((a, b) => (logCount.get(b.id) || 0) - (logCount.get(a.id) || 0) || (RANK[b.partnerStatus] || 0) - (RANK[a.partnerStatus] || 0) || a.id - b.id);
    merges.push({ keep: cl[0], dups: cl.slice(1) });
  }
  if (list.length > 1) review.push({ phone, names: list.map((cl) => cl[0].name) });
}

console.log(`${dry ? "[DRY] " : ""}Merging ${merges.length} clusters (${merges.reduce((s, m) => s + m.dups.length, 0)} duplicate records):`);
for (const m of merges) console.log(`  ${(m.keep.name || "").slice(0, 40).padEnd(40)} keep #${m.keep.id} ← ${m.dups.map((d) => d.id).join(", ")}`);

let moved = 0;
if (!dry) {
  for (const m of merges) {
    const dups = m.dups.map((d) => d.id);
    const ph = dups.map(() => "?").join(",");
    const bestStatus = [m.keep, ...m.dups].map((x) => x.partnerStatus).filter(Boolean).sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] || m.keep.partnerStatus;
    const rep = [m.keep, ...m.dups].find((x) => x.assignedRepId);
    for (const t of childTables) { const [r] = await c.query(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId IN (${ph})`, [m.keep.id, ...dups]); moved += r.affectedRows; }
    await c.query("UPDATE facilities SET partnerStatus=?, assignedRepId=COALESCE(assignedRepId,?), assignedRepName=COALESCE(assignedRepName,?) WHERE id=?", [bestStatus, rep?.assignedRepId ?? null, rep?.assignedRepName ?? null, m.keep.id]);
    await c.query(`DELETE FROM facilities WHERE id IN (${ph})`, dups);
  }
}

if (review.length) {
  console.log(`\n⚠ ${review.length} phone number(s) shared by DIFFERENT names — left untouched (likely separate locations; review if any are dupes):`);
  for (const r of review.slice(0, 40)) console.log(`  ${r.phone}: ${r.names.join("  |  ")}`);
}
console.log(`\n${dry ? "[DRY RUN] would merge" : "✅ Merged"} ${merges.reduce((s, m) => s + m.dups.length, 0)} records${dry ? "" : `, moved ${moved} child rows`}.`);
await c.end();
