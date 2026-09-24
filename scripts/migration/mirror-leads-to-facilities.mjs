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
 *                            otherwise null, and the lead still counts for the rep.
 *                            A partner someone picked by hand in the Sign-ups
 *                            Report (facilityLinkedBy set) is never overwritten
 *   · signedCase / signedDate / outcome — from the sign-up date, so a client
 *                            whose case later closed still counts as signed
 *   · createdAt = the lead's own date, NOT now — notifications alert on recently
 *                            created leads, and stamping 1,200 imports "now"
 *                            would send every manager 1,200 alerts
 *
 * Facility totals (leads received, signed cases, last signed date) are then
 * recomputed from facility_leads, and the partner-linked leads are copied to
 * inbound_leads for the Partner Referral Tracker. Idempotent; runs after every
 * Lead Docket sync.
 *
 *   node scripts/migration/mirror-leads-to-facilities.mjs [--dry] [--explain]   (--explain lists word-pass links)
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { TEAM } from "./leaddocket-rules.mjs";

const DRY = process.argv.includes("--dry");
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const q = async (sql, p = []) => (await c.query(sql, p))[0];

const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");

// ── facility matcher ─────────────────────────────────────────────────────────
// Exact normalised name first. Containment only when the facility name is long
// enough to be distinctive AND exactly one facility matches — a short or shared
// name ("Collision", "Auto Body") must never attach a lead to the wrong partner.
const facs = await q("SELECT id, name, city, territory FROM facilities");
const exact = new Map();
const multi = new Set();
for (const f of facs) {
  const k = nk(f.name);
  if (!k) continue;
  if (exact.has(k)) multi.add(k); else exact.set(k, f.id);
}
const longKeys = facs.map((f) => ({ id: f.id, k: nk(f.name) })).filter((f) => f.k.length >= 10);

// Third pass — distinctive words. Intake writes partners the way people say them:
// "Luke with First Health Medical" for First Health Medical Center, "Salman of
// Bloom Auto Collision" for Bloom Auto Collision & Repair — so the full name is
// never in the text and the passes above miss it. Each facility is scored by
// the share of its words found in the text, weighted by how rare each word is
// across all facility names ("Bloom" says far more than "Collision"). A link
// needs two matching words, one of them rare, and a clear single winner — a
// client's surname alone ("… Ignacio Hernandez") must not attach a lead to
// "Hernandez Auto Body".
const FILLER = new Set(["the", "and", "inc", "llc", "ltd", "corp", "company", "with", "from", "for", "dba"]);
const words = (s) => String(s ?? "").toLowerCase().replace(/'s\b/g, "").replace(/&/g, " ")
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w));
const facWords = facs.map((f) => ({ id: f.id, w: [...new Set(words(f.name))] })).filter((f) => f.w.length >= 2);
const df = new Map();
for (const f of facWords) for (const w of f.w) df.set(w, (df.get(w) ?? 0) + 1);
const idf = (w) => Math.log((facs.length + 1) / (df.get(w) ?? 1));
// A body shop is not a towing company of the same name ("Golden State Body Shop"
// vs "Golden State Towing"): when both texts say what kind of business they are
// and the kinds don't overlap, it isn't a match.
const KINDS = [
  ["towing", /\btow(ing)?\b|wrecker/],
  ["body", /body|collision|paint|auto ?repair|coach/],
  ["chiro", /chiro|spine/],
  ["medical", /medical|clinic|health|urgent|care|wellness|pain|imaging|mri|therap|rehab/],
  ["insurance", /insur|insruance|agency/],
  ["sales", /\bsales\b|dealer/],                 // "Universal Auto Sales" is not Universal Auto Repair
];
const kinds = (s) => new Set(KINDS.filter(([, re]) => re.test(String(s).toLowerCase())).map(([k]) => k));
const facKinds = new Map(facs.map((f) => [f.id, kinds(f.name)]));
const clash = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((k) => b.has(k));

function matchByWords(referrer) {
  const r = new Set(words(referrer));
  if (r.size < 2) return null;
  const rk = kinds(referrer);
  let best = null, second = 0;
  for (const f of facWords) {
    if (clash(rk, facKinds.get(f.id))) continue;
    let hit = 0, total = 0, hits = 0, rare = false;
    for (const w of f.w) {
      total += idf(w);
      // A number alone is not a name: "Martin 559 Towing" is not "H Towing 559".
      if (r.has(w)) { hit += idf(w); hits++; if ((df.get(w) ?? 1) <= 3 && /[a-z]/.test(w)) rare = true; }
    }
    if (hits < 2 || !rare) continue;
    const score = hit / total;
    if (!best || score > best.score) { second = best ? best.score : second; best = { id: f.id, score }; }
    else if (score > second) second = score;
  }
  return best && best.score >= 0.7 && best.score - second >= 0.15 ? best.id : null;
}

// Fourth pass — the partner's name with a word left out. Intake drops words
// ("Caruthers" for Caruthers Towing, "Collision King" for Collision King of
// Tracy) and misspells them ("Reginos" for Regino), so a partner matches when
// every word of its name but one is in the text, spelled the same or one letter
// off. Each guard below is a wrong link the first version of this pass made:
//   · the word left out is the trade or the partner's town, never part of the
//     name — "Four Star Collision" is not Gold Star Collision
//   · at least one matched word is a real name, not a trade ("Colision" counts
//     as the trade) — "Rudy from Collision Center" names no one
//   · the words come in the name's order — "Sams Towing Richard Bravo" is not
//     Richard's Towing
//   · a lone matched word must be spelled exactly, be rare, and the text must say
//     it's the same kind of business — "Superior Market" is not Superior
//     Collision, "Former Client Gilberto Hernandez" not M.Fernandez Towing
// Two partners matching equally well means no link.
const TRADE = new Set(["auto", "autos", "body", "shop", "collision", "collisions", "center", "centre", "repair", "repairs",
  "towing", "tow", "medical", "health", "clinic", "care", "insurance", "services", "service", "group", "chiropractic",
  "chiro", "wellness", "urgent", "paint", "painting", "garage", "motors", "automotive", "recovery", "transport", "agency",
  "office", "mechanic", "tires", "tire", "glass", "smog", "therapy", "physical", "rehab", "spine", "injury", "accident",
  "pain", "imaging", "mri", "cars", "car", "truck", "trucks", "detail", "detailing", "wrecker", "customs", "works"]);
const isTrade = (w) => TRADE.has(w) || [...TRADE].some((t) => oneOff(w, t));
const distinctive = (w, maxDf) => /^[a-z]{4,}$/.test(w) && !isTrade(w) && (df.get(w) ?? 1) <= maxDf;
// The name as people say it: without "(Hector)" or a trailing "- Dr Westbrook".
// Only a trailing one — "Dr. Christy Anthony, MD" stripped of "Dr. Christy" is
// just "Anthony", which every Anthony in the text would match.
const spoken = (name) => String(name ?? "").replace(/\([^)]*\)/g, " ").replace(/\s*[-–]\s*dr\.?\s+[a-z]+\s*$/i, " ");
const facAll = facs.map((f) => ({
  id: f.id,
  w: [...new Set(words(spoken(f.name)))],            // in the name's order
  place: new Set(words(`${f.city ?? ""} ${f.territory ?? ""}`)),
})).filter((f) => f.w.length >= 1);
// One letter added, dropped or changed, for words of five letters or more.
function oneOff(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function matchMissingWord(referrer) {
  const said = words(referrer);
  if (!said.length) return null;
  const rk = kinds(referrer);
  const cands = [];
  for (const f of facAll) {
    const fk = facKinds.get(f.id);
    if (clash(rk, fk)) continue;
    // Where each word of the name sits in the text, spelled exactly or one letter off.
    const at = f.w.map((w) => {
      const i = said.indexOf(w);
      if (i >= 0) return { i, exact: true };
      const j = said.findIndex((s) => oneOff(s, w));
      return j >= 0 ? { i: j, exact: false } : null;
    });
    const found = f.w.filter((_, k) => at[k]);
    const missing = f.w.filter((_, k) => !at[k]);
    if (!found.length || missing.length > 1) continue;
    if (missing.length && !isTrade(missing[0]) && !f.place.has(missing[0])) continue;
    const pos = at.filter(Boolean).map((a) => a.i);
    if (pos.some((p, k) => k > 0 && p <= pos[k - 1])) continue;
    if (found.length === 1) {
      if (!at.find(Boolean).exact || !distinctive(found[0], 2)) continue;
      const sameKind = [...rk].some((k) => fk.has(k));
      if (fk.size ? !sameKind : found[0].length < 6 || (df.get(found[0]) ?? 1) > 1) continue;
    } else if (!found.some((w) => distinctive(w, 4))) continue;
    cands.push({ id: f.id, found: found.length, missing: missing.length });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.found - a.found || a.missing - b.missing);
  const [best, next] = cands;
  if (next && next.found === best.found && next.missing === best.missing) return null;
  return best.id;
}

// Intake often puts the rep first: "Field Representative Genysys Sanchez / Reginos
// Auto Body". The rep is not the partner — that text once matched Sanchez Auto
// Body — so the parts naming a team member or a role are dropped before matching.
// So are former clients and employees who referred someone: they are people,
// not partners ("Former Client Ignacio Hernandez", "Employee Referral Diana Lopez").
const ROLE_WORDS = /\b(field rep(resentative)?|bdr|intake|(former|existing|current|past|previous) client|employee referral)\b/i;
const teamKeys = TEAM.map(([full]) => nk(full));
const partnerPart = (referrer) => String(referrer ?? "").split("/")
  .filter((part) => !ROLE_WORDS.test(part) && !teamKeys.some((t) => nk(part).includes(t)))
  .join(" / ").trim();

const EXPLAIN = process.argv.includes("--explain");
function matchFacility(text) {
  const referrer = partnerPart(text);
  const k = nk(referrer);
  if (k.length < 5) return null;
  if (exact.has(k) && !multi.has(k)) return exact.get(k);
  const hits = longKeys.filter((f) => k.includes(f.k) || (k.length >= 10 && f.k.includes(k)));
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 1) return ids[0];
  const byWords = matchByWords(referrer);
  if (byWords && EXPLAIN) console.log(`  word match: "${referrer}" → ${facs.find((f) => f.id === byWords)?.name}`);
  if (byWords) return byWords;
  const missingWord = matchMissingWord(referrer);
  if (missingWord && EXPLAIN) console.log(`  missing-word match: "${referrer}" → ${facs.find((f) => f.id === missingWord)?.name}`);
  return missingWord;
}

// ── users, for repId ─────────────────────────────────────────────────────────
const users = await q("SELECT id, name FROM users WHERE name IS NOT NULL");
const userId = (name) => users.find((u) => String(u.name).trim().toLowerCase() === String(name ?? "").trim().toLowerCase())?.id ?? null;

// ── mirror ───────────────────────────────────────────────────────────────────
const leads = await q(`SELECT externalId, leadName, member, facility, outcome, classification, leadDate, sud, marketingSource, clientLocation, notes
  FROM lead_intake WHERE externalSource='leaddocket'`);
const existing = new Map((await q("SELECT id, externalId, facilityId, facilityLinkedBy FROM facility_leads WHERE externalSource='leaddocket'")).map((r) => [r.externalId, r]));
const facName = new Map(facs.map((f) => [f.id, f.name]));
const inbound = [];   // partner-referred leads, for the Partner Referral Tracker

let inserted = 0, updated = 0, linked = 0, signed = 0;
for (const l of leads) {
  const isSigned = l.outcome === "Signed" || l.outcome === "Signed Referred Out";
  const lostish = /^(lost|rejected|closed)/i.test(String(l.notes ?? "").replace(/^Lead Docket status:\s*/i, ""));
  const prior = existing.get(String(l.externalId));
  // Linked (or unlinked) by hand in the app: that choice stands.
  const facilityId = prior?.facilityLinkedBy ? prior.facilityId : l.facility ? matchFacility(l.facility) : null;
  if (facilityId) linked++;
  if (isSigned) signed++;
  const when = l.leadDate ? new Date(l.leadDate) : new Date();

  if (facilityId) inbound.push({
    externalId: String(l.externalId),
    when,
    leadName: String(l.leadName ?? "").slice(0, 255) || "(no name)",
    dateReceived: when,
    referringFacility: String(facName.get(facilityId) ?? "").slice(0, 255) || null,
    facilityContact: String(l.facility ?? "").slice(0, 255) || null,   // empty when linked by hand
    assignedAgent: String(l.member ?? "").slice(0, 100) || null,
    caseType: String(l.classification ?? "").trim().slice(0, 100) || null,
    signed: isSigned ? 1 : 0,
    signedDate: isSigned ? when : null,          // the moment it was signed (leadDate = SignedUpDate)
    notSignedReason: !isSigned && /^(lost|rejected)/i.test(String(l.outcome ?? "")) ? String(l.outcome).slice(0, 255) : null,
    notes: [`Lead Docket #${l.externalId}`, l.marketingSource ? `source: ${l.marketingSource}` : ""].filter(Boolean).join(" · "),
  });

  const row = {
    facilityId,
    direction: "received_from_facility",
    leadDate: when,
    method: "other",
    contactPerson: null,
    clientArea: (l.clientLocation ?? "").slice(0, 255) || null,
    outcome: isSigned ? "signed" : lostish ? "not_signed" : "pending",
    signedCase: isSigned ? 1 : 0,
    signedDate: isSigned ? when : null,          // the moment it was signed (leadDate = SignedUpDate)
    notes: [`Lead Docket #${l.externalId}`, l.marketingSource ? `source: ${l.marketingSource}` : "", l.facility ? `referred by: ${l.facility}` : ""]
      .filter(Boolean).join(" · ").slice(0, 4000),
    repId: userId(l.member),
    repName: String(l.member ?? "").slice(0, 255),
    externalId: String(l.externalId),
    externalSource: "leaddocket",
  };
  if (DRY) continue;

  const id = prior?.id;
  if (id) {
    const sets = Object.keys(row).map((k) => `\`${k}\`=?`).join(", ");
    await c.query(`UPDATE facility_leads SET ${sets}, createdAt=?, updatedAt=NOW() WHERE id=?`, [...Object.values(row), when, id]);
    updated++;
  } else {
    const cols = Object.keys(row).map((k) => `\`${k}\``).join(", ");
    const qs = Object.keys(row).map(() => "?").join(", ");
    // createdAt = the lead's own date, so notifications only surface genuinely new leads.
    // IGNORE: a unique key (externalSource, externalId) stops two overlapping runs from storing a lead twice.
    await c.query(`INSERT IGNORE INTO facility_leads (${cols}, createdAt, updatedAt) VALUES (${qs}, ?, NOW())`, [...Object.values(row), when]);
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
    LEFT JOIN (SELECT facilityId, SUM(count) n FROM facility_leads_sent GROUP BY facilityId) m ON m.facilityId = f.id
    SET f.totalLeadsReceived = COALESCE(x.recv, 0),
        f.totalLeadsSent = COALESCE(x.sent, 0) + COALESCE(m.n, 0),   -- logged + monthly counts, as the app defines it
        f.totalSignedCases = COALESCE(x.signedN, 0),
        f.lastSignedCaseDate = x.lastSigned`);
}

// ── Partner Referral Tracker (inbound_leads) ─────────────────────────────────
// The partner-referred leads above are what the tracker's Inbound tab lists.
// Lead Docket owns every field except notes and "counts toward partner
// activity", which are set once so edits made in the app survive.
let inbIns = 0, inbUpd = 0, inbDel = 0;
if (!DRY) {
  const OWNED = ["leadName", "dateReceived", "referringFacility", "facilityContact", "assignedAgent", "caseType", "signed", "signedDate", "notSignedReason"];
  const have = new Map((await q("SELECT id, externalId FROM inbound_leads WHERE externalSource='leaddocket'")).map((r) => [r.externalId, r.id]));
  for (const r of inbound) {
    const id = have.get(r.externalId);
    have.delete(r.externalId);
    if (id) {
      await c.query(`UPDATE inbound_leads SET ${OWNED.map((f) => "`" + f + "`=?").join(", ")}, createdAt=?, updatedAt=NOW() WHERE id=?`, [...OWNED.map((f) => r[f]), r.when, id]);
      inbUpd++;
    } else {
      await c.query(`INSERT IGNORE INTO inbound_leads (${OWNED.map((f) => "`" + f + "`").join(", ")}, notes, countsTowardPartnerActivity, externalId, externalSource, createdAt, updatedAt)
        VALUES (${OWNED.map(() => "?").join(", ")}, ?, 1, ?, 'leaddocket', ?, NOW())`, [...OWNED.map((f) => r[f]), r.notes, r.externalId, r.when]);
      inbIns++;
    }
  }
  // No longer linked to a partner (or gone from Lead Docket): no longer an inbound partner lead.
  for (const id of have.values()) { await c.query("DELETE FROM inbound_leads WHERE id=?", [id]); inbDel++; }
}

console.log(`team leads: ${leads.length} · signed: ${signed} · linked to a partner facility: ${linked}`);
console.log(DRY ? "[DRY RUN] nothing written." : `✅ facility_leads: ${inserted} inserted, ${updated} updated. Facility totals recomputed.`);
if (!DRY) console.log(`✅ inbound_leads: ${inbIns} added, ${inbUpd} updated, ${inbDel} removed.`);
console.log("MIRROR_RESULT " + JSON.stringify({ leads: leads.length, signed, linked, inserted, updated, inbound: inbound.length }));
await c.end();
