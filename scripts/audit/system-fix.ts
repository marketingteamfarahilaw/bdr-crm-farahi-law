/**
 * Fixes the mismatches the system audit (system-audit.ts) found that are the
 * CRM's own doing, not data a person entered (Youssef, 2026-10-02: "fix any
 * discrepancy or mismatch of the data"). Dry run by default — prints what it
 * would change; --apply changes it. Run by the "System fix" workflow.
 *
 *  1. A RingCentral call logged twice (the manual sync and the auto-sync both
 *     found it unlogged at once): keep the first row, delete the copies, take
 *     them off the partner's call total, then add a unique index on rcCallId so
 *     the database refuses a second copy from now on (server/crmDb.ts).
 *  2. A partner's last-contact date set back in time by a call synced late:
 *     moved forward to its latest logged contact.
 *
 *   npx tsx scripts/audit/system-fix.ts [--apply]
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const q = async <T = any>(sql: string, p: unknown[] = []) => (await c.query(sql, p))[0] as T[];
console.log(`SYSTEM FIX — ${APPLY ? "APPLYING" : "dry run (nothing is changed; run with --apply)"}`);

// ── 1. duplicate RingCentral calls ──
const dupes = await q(`SELECT rcCallId, GROUP_CONCAT(id ORDER BY id) ids FROM contact_logs
  WHERE rcCallId IS NOT NULL AND rcCallId <> '' GROUP BY rcCallId HAVING COUNT(*) > 1`);
const extra: number[] = dupes.flatMap((d) => String(d.ids).split(",").slice(1).map(Number));
console.log(`\n1. RingCentral calls logged more than once: ${dupes.length} (${extra.length} extra rows: ${extra.join(", ") || "none"})`);
if (extra.length) {
  const perFacility = await q(`SELECT facilityId, COUNT(*) n FROM contact_logs WHERE id IN (?) GROUP BY facilityId`, [extra]);
  for (const f of perFacility) console.log(`   partner ${f.facilityId}: call total −${f.n}`);
  if (APPLY) {
    await c.beginTransaction();
    try {
      for (const f of perFacility) await c.query(`UPDATE facilities SET totalCalls = GREATEST(totalCalls - ?, 0) WHERE id = ?`, [Number(f.n), f.facilityId]);
      await c.query(`DELETE FROM contact_logs WHERE id IN (?)`, [extra]);
      await c.commit();
      console.log(`   deleted ${extra.length} duplicate rows`);
    } catch (e) { await c.rollback(); throw e; }
  }
}
const idx = await q(`SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'contact_logs' AND index_name = 'uq_contact_logs_rccallid'`);
console.log(`   unique index on rcCallId: ${idx.length ? "already there" : APPLY ? "adding" : "would add"}`);
if (!idx.length && APPLY) {
  // Blank ids would collide with each other; the CRM never writes '' (it writes NULL), but make sure.
  await c.query(`UPDATE contact_logs SET rcCallId = NULL WHERE rcCallId = ''`);
  await c.query(`CREATE UNIQUE INDEX uq_contact_logs_rccallid ON contact_logs (rcCallId)`);
  console.log("   index added");
}

// ── 2. last-contact dates set back in time ──
const behind = await q(`SELECT f.id, f.lastContactDate, x.m FROM facilities f
  JOIN (SELECT facilityId, MAX(contactDate) m FROM contact_logs WHERE facilityId IS NOT NULL GROUP BY facilityId) x ON x.facilityId = f.id
  WHERE f.lastContactDate IS NULL OR f.lastContactDate < x.m`);
console.log(`\n2. Partners whose last-contact date is older than their latest logged contact: ${behind.length}`);
for (const b of behind) console.log(`   partner ${b.id}: ${b.lastContactDate ? new Date(b.lastContactDate).toISOString() : "none"} → ${new Date(b.m).toISOString()}`);
if (behind.length && APPLY) {
  await c.query(`UPDATE facilities f
    JOIN (SELECT facilityId, MAX(contactDate) m FROM contact_logs WHERE facilityId IS NOT NULL GROUP BY facilityId) x ON x.facilityId = f.id
    SET f.lastContactDate = x.m WHERE f.lastContactDate IS NULL OR f.lastContactDate < x.m`);
  console.log("   updated");
}

await c.end();
process.exit(0);
