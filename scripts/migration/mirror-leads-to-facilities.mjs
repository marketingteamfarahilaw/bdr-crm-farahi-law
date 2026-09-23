/**
 * Make the BD/FR team's Lead Docket leads visible everywhere in the CRM.
 *
 * The Lead Docket sync writes to lead_intake, which only the Sign-ups Report
 * reads. The Command Center, facility profiles, Representative Performance and
 * the rep reports all read facility_leads instead — so without this step the
 * leads existed but most pages showed none.
 *
 * Each team lead is upserted into facility_leads by its Lead Docket id:
 *   · repName / repId      — the credited representative
 *   · facilityId           — the referring partner, when Lead Docket's
 *                            "Referred by" names one that matches safely;
 *                            otherwise null, and the lead still counts for the rep
 *   · signedCase / signedDate / outcome — from the sign-up date, so a client
 *                            whose case later closed still counts as signed
 *   · createdAt = the lead's own date, NOT now — notifications alert on recently
 *                            created leads, and stamping 1,200 imports "now"
 *                            would send every manager 1,200 alerts
 *
 * Facility totals (leads received, signed cases, last signed date) are then
 * recomputed from facility_leads. Idempotent; runs after every Lead Docket sync.
 *
 *   node scripts/migration/mirror-leads-to-facilities.mjs [--dry]
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const DRY = process.argv.includes("--dry");
const c = await mysql.createConnection(process.env.DATABASE_URL);
const q = async (sql, p = []) => (await c.query(sql, p))[0];

const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");

// ── facility matcher ─────────────────────────────────────────────────────────
// Exact normalised name first. Containment only when the facility name is long
// enough to be distinctive AND exactly one facility matches — a short or shared
// name ("Collision", "Auto Body") must never attach a lead to the wrong partner.
const facs = await q("SELECT id, name FROM facilities");
const exact = new Map();
const multi = new Set();
for (const f of facs) {
  const k = nk(f.name);
  if (!k) continue;
  if (exact.has(k)) multi.add(k); else exact.set(k, f.id);
}
const longKeys = facs.map((f) => ({ id: f.id, k: nk(f.name) })).filter((f) => f.k.length >= 10);

function matchFacility(referrer) {
  const k = nk(referrer);
  if (k.length < 5) return null;
  if (exact.has(k) && !multi.has(k)) return exact.get(k);
  const hits = longKeys.filter((f) => k.includes(f.k) || (k.length >= 10 && f.k.includes(k)));
  const ids = [...new Set(hits.map((h) => h.id))];
  return ids.length === 1 ? ids[0] : null;
}

// ── users, for repId ─────────────────────────────────────────────────────────
const users = await q("SELECT id, name FROM users WHERE name IS NOT NULL");
const userId = (name) => users.find((u) => String(u.name).trim().toLowerCase() === String(name ?? "").trim().toLowerCase())?.id ?? null;

// ── mirror ───────────────────────────────────────────────────────────────────
const leads = await q(`SELECT externalId, member, facility, outcome, leadDate, sud, marketingSource, clientLocation, notes
  FROM lead_intake WHERE externalSource='leaddocket'`);
const existing = new Map((await q("SELECT id, externalId FROM facility_leads WHERE externalSource='leaddocket'")).map((r) => [r.externalId, r.id]));

let inserted = 0, updated = 0, linked = 0, signed = 0;
for (const l of leads) {
  const isSigned = l.outcome === "Signed" || l.outcome === "Signed Referred Out";
  const lostish = /^(lost|rejected|closed)/i.test(String(l.notes ?? "").replace(/^Lead Docket status:\s*/i, ""));
  const facilityId = l.facility ? matchFacility(l.facility) : null;
  if (facilityId) linked++;
  if (isSigned) signed++;
  const when = l.leadDate ? new Date(l.leadDate) : new Date();

  const row = {
    facilityId,
    direction: "received_from_facility",
    leadDate: when,
    method: "other",
    contactPerson: null,
    clientArea: (l.clientLocation ?? "").slice(0, 255) || null,
    outcome: isSigned ? "signed" : lostish ? "not_signed" : "pending",
    signedCase: isSigned ? 1 : 0,
    signedDate: isSigned && l.sud ? new Date(l.sud) : null,
    notes: [`Lead Docket #${l.externalId}`, l.marketingSource ? `source: ${l.marketingSource}` : "", l.facility ? `referred by: ${l.facility}` : ""]
      .filter(Boolean).join(" · ").slice(0, 4000),
    repId: userId(l.member),
    repName: String(l.member ?? "").slice(0, 255),
    externalId: String(l.externalId),
    externalSource: "leaddocket",
  };
  if (DRY) continue;

  const id = existing.get(String(l.externalId));
  if (id) {
    const sets = Object.keys(row).map((k) => `\`${k}\`=?`).join(", ");
    await c.query(`UPDATE facility_leads SET ${sets}, updatedAt=NOW() WHERE id=?`, [...Object.values(row), id]);
    updated++;
  } else {
    const cols = Object.keys(row).map((k) => `\`${k}\``).join(", ");
    const qs = Object.keys(row).map(() => "?").join(", ");
    // createdAt = the lead's own date, so notifications only surface genuinely new leads.
    await c.query(`INSERT INTO facility_leads (${cols}, createdAt, updatedAt) VALUES (${qs}, ?, NOW())`, [...Object.values(row), when]);
    inserted++;
  }
}

// ── facility totals, recomputed from facility_leads ──────────────────────────
if (!DRY) {
  await c.query(`UPDATE facilities f
    LEFT JOIN (
      SELECT facilityId,
             SUM(direction='received_from_facility') recv,
             SUM(direction='sent_to_facility') sent,
             SUM(signedCase=1) signedN,
             MAX(CASE WHEN signedCase=1 THEN COALESCE(signedDate, leadDate) END) lastSigned
      FROM facility_leads WHERE facilityId IS NOT NULL GROUP BY facilityId
    ) x ON x.facilityId = f.id
    SET f.totalLeadsReceived = COALESCE(x.recv, 0),
        f.totalLeadsSent = COALESCE(x.sent, f.totalLeadsSent, 0),
        f.totalSignedCases = COALESCE(x.signedN, 0),
        f.lastSignedCaseDate = x.lastSigned`);
}

console.log(`team leads: ${leads.length} · signed: ${signed} · linked to a partner facility: ${linked}`);
console.log(DRY ? "[DRY RUN] nothing written." : `✅ facility_leads: ${inserted} inserted, ${updated} updated. Facility totals recomputed.`);
console.log("MIRROR_RESULT " + JSON.stringify({ leads: leads.length, signed, linked, inserted, updated }));
await c.end();
