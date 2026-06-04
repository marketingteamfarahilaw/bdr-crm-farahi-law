// Merge "Accident Recovery Center- [City]" entries into the real clinic/shop on
// the same phone (per user confirmation they're the same physical location).
// Also folds same-clinic name variants together (e.g. "Hadaya Chiropractic Inc."
// + "Hadaya Chiropractic Palmdale"). Keeps the real business with the most
// history. If a phone has TWO genuinely different real businesses, it's skipped
// and reported.
//
//   node -r dotenv/config scripts/migration/merge-accident-recovery.mjs --dry
//   node -r dotenv/config scripts/migration/merge-accident-recovery.mjs
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const digits = (s) => (s || "").replace(/\D/g, "");
const nameKey = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const isARC = (name) => /accident\s*recovery/i.test(name || "");
const RANK = { priority_partner: 6, active_partner: 5, needs_follow_up: 4, prospect: 3, dormant: 2, do_not_use: 1 };
const dry = process.argv.includes("--dry");

// Same real business if equal, one name contains the other, or they share the
// first two significant (3+ char) words.
function realRelated(a, b) {
  const na = nameKey(a.name), nb = nameKey(b.name);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sh = na.length <= nb.length ? na : nb, lo = na.length <= nb.length ? nb : na;
  if (sh.length >= 6 && lo.includes(sh)) return true;
  const wa = na.split(" ").filter((w) => w.length > 2), wb = nb.split(" ").filter((w) => w.length > 2);
  return wa.length >= 2 && wb.length >= 2 && wa[0] === wb[0] && wa[1] === wb[1];
}

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

const merges = [];
const skipped = [];
for (const [phone, members] of byPhone) {
  const arc = members.filter((m) => isARC(m.name));
  const real = members.filter((m) => !isARC(m.name));
  if (arc.length === 0 || real.length === 0) continue;
  // cluster the real businesses
  const parent = real.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < real.length; i++)
    for (let j = i + 1; j < real.length; j++)
      if (realRelated(real[i], real[j])) parent[find(i)] = find(j);
  const roots = new Set(real.map((_, i) => find(i)));
  if (roots.size === 1) {
    const all = [...real].sort((a, b) => (logCount.get(b.id) || 0) - (logCount.get(a.id) || 0) || (RANK[b.partnerStatus] || 0) - (RANK[a.partnerStatus] || 0) || a.id - b.id);
    merges.push({ keep: all[0], dups: [...all.slice(1), ...arc] });
  } else {
    skipped.push({ phone, real: real.map((r) => r.name), arc: arc.map((a) => a.name) });
  }
}

console.log(`${dry ? "[DRY] " : ""}Merging into ${merges.length} businesses:`);
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

if (skipped.length) {
  console.log(`\n⚠ ${skipped.length} phone(s) with two genuinely different businesses — left alone:`);
  for (const s of skipped) console.log(`  ${s.phone}: [${s.real.join(", ")}]  + [${s.arc.join(", ")}]`);
}
console.log(`\n${dry ? "[DRY RUN] would merge" : "✅ Merged"} ${merges.reduce((s, m) => s + m.dups.length, 0)} records${dry ? "" : `, moved ${moved} child rows`}.`);
await c.end();
