/**
 * Pull the BD/FR team's leads and sign-ups from Lead Docket into lead_intake,
 * which is what the Sign-ups Report reads.
 *
 * Lead Docket holds every lead the firm takes; only a fraction are the team's.
 * A lead is credited to a representative in its MarketingSource field, written
 * in several shapes:
 *
 *   "BDR Miguel Flores"                → BDR, Miguel Flores
 *   "Field Representative Lupe Campos" → FR,  Lupe Campos
 *   "Jezel Mercado BC - Sacramento"    → FR,  Jezel Mercado   (business card)
 *   "Malvin Rosales"                   → Intake, Malvin Rosales  (bare name)
 *
 * Because the last shape carries no prefix, matching is done against the team
 * roster below rather than against a pattern alone. Anything naming nobody on
 * the roster — Walker Advertising, GMB listings, Intaker, the website, employee
 * referrals — is the firm's lead, not the team's, and is skipped. The run
 * prints the top skipped sources so miscredited work is visible rather than
 * silently lost.
 *
 * Lead Docket ignores every filter parameter it documents (they all return the
 * full set), so the list is paged for ids and each lead read once. --since
 * limits that to leads changed recently, which is what a scheduled run uses.
 *
 *   node scripts/migration/sync-leaddocket.mjs --status 6            (sign-ups only)
 *   node scripts/migration/sync-leaddocket.mjs                       (every status)
 *   node scripts/migration/sync-leaddocket.mjs --since 2026-09-01    (incremental)
 *   node scripts/migration/sync-leaddocket.mjs --dry                 (report only)
 *   node scripts/migration/sync-leaddocket.mjs --ours-only           (re-read the team's leads only)
 *   node scripts/migration/sync-leaddocket.mjs --since 2020-01-01 --status-names "Signed Up,Referred,Closed,Lost"
 *                                                                    (history: every sign-up since 2020)
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { creditedRep, outcomeFor, str } from "./leaddocket-rules.mjs";
import { ldInstant, pacificYmd } from "./dates.mjs";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
if (!KEY) { console.error("LEADDOCKET_API_KEY is not set"); process.exit(1); }

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes("--dry");
// --coverage: list every lead and report which the sync has never checked (or
// checked before its last change), by status and year. Reads no lead details.
const COVERAGE = process.argv.includes("--coverage");
// --ours-only: re-read just the leads already credited to the team (e.g. to pick
// up a newly synced field) without waiting behind the whole backlog.
const OURS_ONLY = process.argv.includes("--ours-only");
const SINCE = arg("--since") ? new Date(arg("--since")) : null;
const ONLY = arg("--status") ? Number(arg("--status")) : null;
// --status-names "Signed Up,Referred,Closed,Lost": scan these statuses by name (ids differ per account).
const NAMES = arg("--status-names") ? arg("--status-names").split(",").map((x) => x.trim().toLowerCase()) : null;

// Lead Docket rate-limits per endpoint group (see X-RateLimit-Group / -Limit):
//   list    /api/Leads?Status=…   "LeadsAndOpportunities"  250 / minute
//   detail  /api/Leads/{id}       "LeadsByIdFull"           50 / minute
// Detail is where MarketingSource lives, so it sets the pace: a full backfill of
// ~7,700 sign-ups takes about 2½ hours, while an incremental run only reads the
// leads that changed. Going faster doesn't finish sooner — it earns 429s, and
// before this pacing existed those were retried three times, given up on, and
// the lead silently dropped (one run skipped 2,248 leads without a word).
const GAP_MS = { detail: 1300, list: 290 };    // ≈46/min and ≈207/min, under each cap
const lastCall = { detail: 0, list: 0 };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const api = async (p) => {
  const group = /^\/api\/Leads\/\d+/.test(p) ? "detail" : "list";
  for (let attempt = 1; attempt <= 12; attempt++) {
    const wait = lastCall[group] + GAP_MS[group] - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[group] = Date.now();

    let r;
    try {
      r = await fetch(BASE + p, { headers: { api_key: KEY } });
    } catch (e) {
      await sleep(Math.min(30000, 1000 * attempt));   // network blip
      continue;
    }
    if (r.status === 429) {
      // Wait for the window the server names, plus a margin; never give up quietly.
      const reset = Number(r.headers.get("retry-after") ?? r.headers.get("x-ratelimit-reset") ?? 0);
      await sleep(Math.max(reset * 1000, 5000 * attempt) + 500);
      continue;
    }
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + p);
    return await r.json();
  }
  throw new Error("gave up after repeated rate limiting: " + p);
};

// ── fetch ───────────────────────────────────────────────────────────────────
const statuses = (await api("/api/Statuses")).map((x) => ({ id: x.Data.Id, name: x.Data.StatusName }));
const wanted = ONLY ? statuses.filter((s) => s.id === ONLY)
  : NAMES ? statuses.filter((s) => NAMES.includes(String(s.name).toLowerCase()))
  : statuses;
console.log("statuses to scan:", wanted.map((s) => s.id + "=" + s.name).join(", "));

const rows = [];
for (const st of wanted) {
  let page = 1, pages = 1;
  do {
    const r = await api("/api/Leads?Status=" + st.id + "&Page=" + page);
    pages = r.TotalPages ?? 1;
    for (const rec of r.Records ?? []) rows.push({ ...rec, StatusName: st.name });
    page++;
  } while (page <= pages);
  console.log("  " + st.name + ": " + rows.filter((r) => r.StatusName === st.name).length);
}

const LIMIT = arg("--limit") ? Number(arg("--limit")) : null;   // for spot-checks
const changed = SINCE ? rows.filter((r) => (ldInstant(r.LastUpdateDate ?? r.CreatedDate) ?? new Date(0)) > SINCE) : rows;

const c = DRY && !COVERAGE ? null : await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });

// Every lead checked is remembered with the LastUpdateDate it had — ours or not —
// so a lead is only read again once Lead Docket says it changed. That makes the
// sync resumable: a deploy or restart mid-run (the server restarts on every push)
// picks up where it stopped instead of re-reading hours of leads from the start.
// It also makes each 8-hourly run read only genuinely new or edited leads.
const seen = new Map();
const wasOurs = new Set();   // leads the ledger already credits to the team
if (c) {
  await c.query(`CREATE TABLE IF NOT EXISTS leaddocket_seen (
    leadId BIGINT NOT NULL PRIMARY KEY,
    lastUpdate VARCHAR(40) NULL,
    isOurs TINYINT NOT NULL DEFAULT 0,
    checkedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  const [s] = await c.query("SELECT leadId, lastUpdate, isOurs FROM leaddocket_seen");
  for (const r of s) { seen.set(String(r.leadId), r.lastUpdate); if (r.isOurs) wasOurs.add(String(r.leadId)); }
}
const stamp = (r) => String(r.LastUpdateDate ?? r.CreatedDate ?? "");
const unseen = changed.filter((r) => seen.get(String(r.Id)) !== stamp(r));

if (COVERAGE) {
  const by = new Map();
  for (const r of unseen) {
    const k = `${r.StatusName} · ${String(r.CreatedDate ?? "").slice(0, 4) || "no date"} · ${seen.has(String(r.Id)) ? "changed since checked" : "never checked"}`;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...by].sort()) console.log("  " + k + ": " + n);
  console.log("COVERAGE " + JSON.stringify({ total: rows.length, upToDate: rows.length - unseen.length, notUpToDate: unseen.length }));
  await c.end();
  process.exit(0);
}
// The team's own leads first: they are what the reports show, so a long backlog
// of other leads never holds them up.
const queue = (OURS_ONLY ? unseen.filter((r) => wasOurs.has(String(r.Id))) : unseen)
  .sort((a, b) => Number(wasOurs.has(String(b.Id))) - Number(wasOurs.has(String(a.Id))));
const fresh = LIMIT ? queue.slice(0, LIMIT) : queue;
console.log("\n" + rows.length + " leads total, " + changed.length + " in range" + (SINCE ? " (changed since " + SINCE.toISOString().slice(0, 10) + ")" : "") +
  ", " + (changed.length - unseen.length) + " already checked and unchanged, " + fresh.length + " to read");

let ours = 0, inserted = 0, updated = 0, skipped = 0, failed = 0;
let lastWasOurs = false;
const byRep = new Map();
const skippedSources = new Map();

// Sequential on purpose: the pacing in api() is what keeps us under the limit.
// A lead that can't be read is queued and retried at the end, never dropped —
// and it is not marked as seen, so it can't be skipped next time either.
const retry = [];
async function processLead(row) {
  let raw;
  try { raw = await api("/api/Leads/" + row.Id); } catch { return "failed"; }
  const d = raw?.Data ?? raw;
  if (!d) return "failed";
  lastWasOurs = false;
  await store(d);
  if (c) {
    await c.query(
      "INSERT INTO leaddocket_seen (leadId, lastUpdate, isOurs) VALUES (?,?,?) ON DUPLICATE KEY UPDATE lastUpdate=VALUES(lastUpdate), isOurs=VALUES(isOurs)",
      [row.Id, stamp(row), lastWasOurs ? 1 : 0]
    );
  }
  return "done";
}

async function store(d) {
    const source = str(d.MarketingSource);
    const rep = creditedRep(source);
    if (!rep) {
      skipped++;
      const key = source || "(no marketing source)";
      skippedSources.set(key, (skippedSources.get(key) || 0) + 1);
      return;
    }
    ours++;
    lastWasOurs = true;
    byRep.set(rep.role + " " + rep.member, (byRep.get(rep.role + " " + rep.member) || 0) + 1);
    if (DRY) return;

    const contact = d.Contact ?? {};
    const when = d.SignedUpDate ?? d.CreatedDate ?? null;
    const vals = {
      leadDate: ldInstant(when),
      role: rep.role,
      member: rep.member.slice(0, 120),
      leadName: ([str(contact.FirstName), str(contact.LastName)].filter(Boolean).join(" ").trim() || ("Lead " + d.Id)).slice(0, 255),
      lastName: str(contact.LastName).slice(0, 255) || null,
      phone: str(contact.MobilePhone || contact.PhoneNumber).slice(0, 60) || null,
      email: str(contact.Email).slice(0, 320) || null,
      outcome: outcomeFor(str(d.Status) || str(d.StatusName), d.SignedUpDate).slice(0, 120),
      notes: ("Lead Docket status: " + (str(d.Status) || str(d.StatusName) || "unknown")).slice(0, 4000),
      classification: str(d.PracticeArea || d.CaseType).slice(0, 120) || null,
      sud: pacificYmd(ldInstant(d.SignedUpDate)),   // the Pacific day it was signed — see dates.mjs
      disposition: str(d.SubStatus).slice(0, 120) || null,
      // Intake records the referring partner in "Marketing Source Details"
      // (FoundUsNotes) far more often than in "Referred By", which is usually empty.
      facility: (str(d.ReferredByName) || str(d.FoundUsNotes)).trim().slice(0, 255) || null,
      clientLocation: str(d.Office).slice(0, 255) || null,
      externalId: String(d.Id),
      externalSource: "leaddocket",
      marketingSource: source.slice(0, 255) || null,
    };
    const [ex] = await c.query("SELECT id FROM lead_intake WHERE externalId=? LIMIT 1", [String(d.Id)]);
    if (ex.length) {
      const sets = Object.keys(vals).map((k) => "`" + k + "`=?").join(", ");
      await c.query("UPDATE lead_intake SET " + sets + ", updatedAt=NOW() WHERE id=?", [...Object.values(vals), ex[0].id]);
      updated++;
    } else {
      const cols = Object.keys(vals).map((k) => "`" + k + "`").join(", ");
      const qs = Object.keys(vals).map(() => "?").join(", ");
      await c.query("INSERT INTO lead_intake (" + cols + ", createdAt, updatedAt) VALUES (" + qs + ", NOW(), NOW())", Object.values(vals));
      inserted++;
    }
}

const started = Date.now();
for (let i = 0; i < fresh.length; i++) {
  if ((await processLead(fresh[i])) === "failed") retry.push(fresh[i]);
  if (i % 200 === 0 || i === fresh.length - 1) {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log("  …" + (i + 1) + "/" + fresh.length + " read in " + mins + " min — " + ours + " ours, " + skipped + " not ours, " + retry.length + " to retry");
  }
}

// Second pass for anything that failed; after that, report what is still missing
// rather than pretending the run was complete.
if (retry.length) {
  console.log("\nretrying " + retry.length + " leads that could not be read the first time…");
  await sleep(60000);                          // let the per-minute window fully reset
  const still = [];
  for (const row of retry) if ((await processLead(row)) === "failed") still.push(row.Id);
  failed = still.length;
  if (still.length) console.log("STILL UNREADABLE (" + still.length + "): " + still.slice(0, 30).join(", ") + (still.length > 30 ? " …" : ""));
}

console.log("\nBD/FR leads found : " + ours);
console.log("not the team's    : " + skipped + (failed ? "  |  STILL UNREADABLE: " + failed : ""));
console.log("\nby representative:");
[...byRep.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + String(v).padStart(5) + "  " + k));
console.log("\ntop sources NOT credited to the team (check for miscredited work):");
[...skippedSources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log("  " + String(v).padStart(5) + "  " + k));
console.log(DRY ? "\n[DRY RUN] nothing written." : "\n✅ inserted " + inserted + ", updated " + updated + ".");
// One machine-readable line, so the in-app sync can show the result.
console.log("SYNC_RESULT " + JSON.stringify({ scanned: fresh.length, ours, skipped, failed, inserted, updated, byRep: Object.fromEntries(byRep) }));
if (c) await c.end();
if (failed > 0) process.exit(2);   // a partial sync must not look like a success
