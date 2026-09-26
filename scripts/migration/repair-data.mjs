/**
 * Data-integrity repair for the CRM. Idempotent — safe to re-run whenever an
 * import or a sync leaves derived data out of step. Dry run unless --apply.
 *
 * What it fixes, and why each matters:
 *
 *  1. Rep names on facilities → the full name on the user's account.
 *     Spreadsheets record "Queenie"; logins are "Queenie Miranda".
 *  2. facilities.assignedRepId → linked to that user. Notifications, referral
 *     imbalance flags and several metrics scope by id only, so without the link
 *     an agent's own partners never surface for them.
 *  3. totalCalls / lastContactDate / lastCheckInDate → recomputed from
 *     contact_logs. createContactLog maintains these on every new call, but
 *     bulk imports insert directly, so the facility lists, "last contact" and
 *     overdue views were reading stale or empty values.
 *  4. Unmatched calls whose number now belongs to a facility → filed against it.
 *  5. Expenses / rewards / tracker / field visits → facilityId linked by exact
 *     normalised name (and phone where the sheet has one).
 *  6. Exact duplicate facilities (same normalised name AND same phone) → merged
 *     into the oldest row; every child table is repointed first, blank fields
 *     are filled from the duplicate, then it is removed. Same-phone rows with
 *     DIFFERENT names are only reported — they are often separate branches.
 *
 *   node scripts/migration/repair-data.mjs            (report only)
 *   node scripts/migration/repair-data.mjs --apply
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const q = async (sql, p = []) => (await c.query(sql, p))[0];
const exec = async (sql, p = []) => (APPLY ? (await c.query(sql, p))[0].affectedRows ?? 0 : 0);

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const phone10 = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ""; };
const nkey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const log = (...a) => console.log(...a);
log(APPLY ? "=== APPLYING REPAIRS ===\n" : "=== DRY RUN — nothing will be written ===\n");

// ── users: unambiguous first name → { id, full name } ─────────────────────────
const users = await q("SELECT id, name FROM users WHERE name IS NOT NULL AND name <> ''");
const firstMap = new Map();
for (const u of users) {
  const first = u.name.trim().split(/\s+/)[0].toLowerCase();
  firstMap.set(first, [...(firstMap.get(first) || []), u]);
}
const userFor = (raw) => {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const exact = users.find((u) => u.name.trim().toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const hits = firstMap.get(t.split(/\s+/)[0].toLowerCase()) || [];
  return hits.length === 1 && !t.includes(" ") ? hits[0] : null;   // bare first name only, and unambiguous
};

// ── 1 + 2. rep names and user links ──────────────────────────────────────────
{
  const rows = await q("SELECT assignedRepName v, COUNT(*) n, SUM(assignedRepId IS NULL) unlinked FROM facilities WHERE assignedRepName IS NOT NULL AND assignedRepName <> '' GROUP BY v");
  let renamed = 0, linked = 0;
  for (const r of rows) {
    const u = userFor(r.v);
    if (!u) continue;
    if (r.v !== u.name) { log(`[1] rep "${r.v}" → "${u.name}" (${r.n} facilities)`); renamed += r.n; await exec("UPDATE facilities SET assignedRepName=? WHERE assignedRepName=?", [u.name, r.v]); }
    if (Number(r.unlinked) > 0) { linked += Number(r.unlinked); await exec("UPDATE facilities SET assignedRepId=? WHERE assignedRepName IN (?,?) AND assignedRepId IS NULL", [u.id, r.v, u.name]); }
  }
  log(`[1] rep names normalised: ${renamed}`);
  log(`[2] facilities linked to a user account: ${linked}`);
  const noAccount = rows.filter((r) => !userFor(r.v)).sort((a, b) => b.n - a.n);
  log(`    reps with no user account yet (left as names): ${noAccount.map((r) => `${r.v}=${r.n}`).join("  ")}\n`);
}

// ── 6. exact duplicates — before rollups, so counts come out right ───────────
{
  const facs = await q("SELECT * FROM facilities ORDER BY id");
  const groups = new Map();
  for (const f of facs) {
    const p = phone10(f.phone);
    if (!p) continue;
    const k = nkey(f.name) + "|" + p;
    groups.set(k, [...(groups.get(k) || []), f]);
  }
  const CHILD = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads", "partner_aliases", "facility_leads_sent", "facility_gratitude", "fr_expenses", "bdr_expenses", "referral_rewards", "referral_tracker", "pd_referrals", "pod_appointments", "qa_reviews", "uber_receipts"];
  const FILL = ["address", "city", "phone2", "phone3", "contactName", "contactTitle", "contactPhone", "contactEmail", "website", "notes", "assignedRepName", "assignedRepId", "latitude", "longitude", "zipCode", "territory"];
  let merged = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [keep, ...dups] = g;
    for (const d of dups) {
      log(`[6] merge #${d.id} "${d.name}" → #${keep.id}`);
      merged++;
      for (const t of CHILD) await exec(`UPDATE \`${t}\` SET facilityId=? WHERE facilityId=?`, [keep.id, d.id]);
      const sets = [], vals = [];
      for (const col of FILL) if ((keep[col] == null || keep[col] === "") && d[col] != null && d[col] !== "") { sets.push(`\`${col}\`=?`); vals.push(d[col]); keep[col] = d[col]; }
      if (d.partnerStatus === "active_partner" && keep.partnerStatus !== "active_partner") { sets.push("partnerStatus='active_partner'"); keep.partnerStatus = "active_partner"; }
      if (sets.length) await exec(`UPDATE facilities SET ${sets.join(", ")} WHERE id=?`, [...vals, keep.id]);
      await exec("DELETE FROM facilities WHERE id=?", [d.id]);
    }
  }
  log(`[6] exact duplicates merged: ${merged}`);

  // Report-only: same phone, different names.
  const byPhone = new Map();
  for (const f of facs) { const p = phone10(f.phone); if (p) byPhone.set(p, [...(byPhone.get(p) || []), f]); }
  const suspects = [...byPhone.values()].filter((v) => new Set(v.map((f) => nkey(f.name))).size > 1);
  log(`    same phone, different names — NOT merged, needs a human: ${suspects.length} groups`);
  suspects.slice(0, 8).forEach((g) => log("      " + g.map((f) => `#${f.id} ${f.name}`).join("  |  ")));
  log("");
}

// ── 4. unmatched calls that now match a facility ─────────────────────────────
{
  const facs = await q("SELECT id, phone, phone2, phone3, contactPhone FROM facilities");
  const byPhone = new Map();
  for (const f of facs) for (const p of [f.phone, f.phone2, f.phone3, f.contactPhone]) { const k = phone10(p); if (k && !byPhone.has(k)) byPhone.set(k, f.id); }
  const calls = await q("SELECT * FROM rc_unmatched_calls WHERE status='unassigned'");
  let n = 0;
  for (const u of calls) {
    const external = u.direction === "Inbound" ? u.fromNumber : u.toNumber;
    const fid = byPhone.get(phone10(external)) ?? byPhone.get(phone10(u.toNumber)) ?? byPhone.get(phone10(u.fromNumber));
    if (!fid) continue;
    n++;
    const secs = Number(u.durationSeconds) || 0;
    const result = /connect|accept/i.test(u.callResult || "") ? "connected" : /voicemail/i.test(u.callResult || "") ? "voicemail" : /miss|no answer/i.test(u.callResult || "") ? "no_answer" : /busy/i.test(u.callResult || "") ? "busy" : "other";
    await exec(
      `INSERT INTO contact_logs (facilityId, contactType, contactDate, callResult, callDuration, callType, summary, repName, direction, fromRingCentral, rcCallId, rcSessionId, createdAt)
       VALUES (?, 'call', ?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, NOW())`,
      [fid, u.startTime, result, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, u.toName ? `Matched later — ${u.toName}` : "Matched later", u.agentName, u.direction, String(u.rcCallId).startsWith("xls:") ? 0 : 1, u.rcCallId, u.rcSessionId]
    );
    await exec("UPDATE rc_unmatched_calls SET status='assigned' WHERE id=?", [u.id]);
  }
  log(`[4] unmatched calls filed against a facility: ${n}\n`);
}

// ── 3. rollups from contact_logs ─────────────────────────────────────────────
{
  const [[stale]] = await c.query(`SELECT COUNT(*) n FROM facilities f
     LEFT JOIN (SELECT facilityId, COUNT(*) cnt, MAX(contactDate) last FROM contact_logs GROUP BY facilityId) x ON x.facilityId=f.id
     WHERE f.totalCalls <> COALESCE(x.cnt,0) OR NOT (f.lastContactDate <=> x.last)`);
  log(`[3] facilities with stale call rollups: ${stale.n}`);
  await exec(`UPDATE facilities f
     LEFT JOIN (SELECT facilityId, COUNT(*) cnt, MAX(contactDate) last FROM contact_logs GROUP BY facilityId) x ON x.facilityId=f.id
     SET f.totalCalls = COALESCE(x.cnt,0),
         f.lastContactDate = x.last,
         f.lastCheckInDate = COALESCE(x.last, f.lastCheckInDate)`);
}

// ── 5. link operational rows to facilities by name / phone ───────────────────
{
  const facs = await q("SELECT id, name, phone, phone2, phone3 FROM facilities");
  const byName = new Map(), byPhone = new Map(), dupName = new Set();
  for (const f of facs) {
    const k = nkey(f.name);
    if (k) { if (byName.has(k)) dupName.add(k); else byName.set(k, f.id); }
    for (const p of [f.phone, f.phone2, f.phone3]) { const d = phone10(p); if (d && !byPhone.has(d)) byPhone.set(d, f.id); }
  }
  const find = (name, ph) => byPhone.get(phone10(ph)) ?? (dupName.has(nkey(name)) ? null : byName.get(nkey(name))) ?? null;
  for (const [t, phoneCol] of [["fr_expenses", null], ["bdr_expenses", "facilityPhone"], ["referral_rewards", null], ["referral_tracker", null]]) {
    const rows = await q(`SELECT id, facilityName${phoneCol ? `, ${phoneCol} ph` : ""} FROM \`${t}\` WHERE facilityId IS NULL AND facilityName IS NOT NULL AND facilityName <> ''`);
    let n = 0;
    for (const r of rows) { const fid = find(r.facilityName, r.ph); if (fid) { n++; await exec(`UPDATE \`${t}\` SET facilityId=? WHERE id=?`, [fid, r.id]); } }
    log(`[5] ${t}: linked ${n} of ${rows.length} unlinked rows`);
  }
  const visits = await q("SELECT id, facilitiesVisited FROM field_visits");
  let vn = 0;
  for (const v of visits) {
    let arr = v.facilitiesVisited;
    if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { continue; } }
    if (!Array.isArray(arr)) continue;
    let changed = false;
    for (const item of arr) if (item && item.id == null) { const fid = find(item.name); if (fid) { item.id = fid; changed = true; vn++; } }
    if (changed) await exec("UPDATE field_visits SET facilitiesVisited=? WHERE id=?", [JSON.stringify(arr), v.id]);
  }
  log(`[5] field_visits: linked ${vn} visited-facility entries`);
}

// ── 7. city spellings ────────────────────────────────────────────────────────
// "San Diego" / "SanDiego", "Hayward" / "hayward" split one place into two for
// territories, zones and every by-city report. Each group collapses to its most
// common properly-capitalised spelling; territory follows when it mirrored city.
{
  const rows = await q("SELECT city, COUNT(*) n FROM facilities WHERE city IS NOT NULL AND city <> '' GROUP BY city");
  const clean = (raw) => {
    let t = String(raw).trim().replace(/\s+/g, " ").replace(/,+$/, "");
    const addr = t.match(/,\s*([A-Za-z .]+),\s*CA\b/i);          // "4685 York Blvd, Los Angeles, CA 90041"
    if (addr) t = addr[1].trim();
    if (t.includes(",")) return null;                            // several cities in one cell — cannot pick one
    if (/[@#!0-9]/.test(t)) return null;                         // an email, a spreadsheet error, a number
    if (/^(tba|n\/?a|none|unknown|-)$/i.test(t)) return null;
    t = t.replace(/^(San|Santa|Los|El|La|Del|Rancho|Palm|Long|Redwood|Yuba|Culver)(?=[A-Z])/, "$1 ");
    return t;
  };
  const titled = (t) => t.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  const groups = new Map();
  for (const r of rows) {
    const cl = clean(r.city);
    const k = cl ? cl.toLowerCase().replace(/[^a-z]/g, "") : "__drop__" + r.city;
    groups.set(k, [...(groups.get(k) || []), { ...r, cl }]);
  }
  let changed = 0;
  for (const g of groups.values()) {
    const best = g.filter((x) => x.cl).sort((a, b) => b.n - a.n)[0];
    // Prefer a spelling that is already mixed-case; otherwise title-case it.
    const canonical = best ? (best.cl !== best.cl.toLowerCase() && best.cl !== best.cl.toUpperCase() ? best.cl : titled(best.cl)) : null;
    for (const x of g) {
      const target = x.cl ? canonical : null;
      if (target === x.city) continue;
      log(`[7] city "${x.city}" → ${target ? `"${target}"` : "(cleared)"}  (${x.n})`);
      changed += Number(x.n);
      await exec("UPDATE facilities SET territory=? WHERE city=? AND territory=?", [target, x.city, x.city]);
      await exec("UPDATE facilities SET city=? WHERE city=?", [target, x.city]);
    }
  }
  log(`[7] city values corrected: ${changed}`);
}

log(`\n${APPLY ? "✅ Repairs applied." : "[DRY RUN] Re-run with --apply to write these changes."}`);
await c.end();
