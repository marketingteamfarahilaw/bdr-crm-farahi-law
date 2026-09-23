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
 *   "Malvin Rosales"                   → BDR, Malvin Rosales  (bare name)
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
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
if (!KEY) { console.error("LEADDOCKET_API_KEY is not set"); process.exit(1); }

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes("--dry");
const SINCE = arg("--since") ? new Date(arg("--since")) : null;
const ONLY = arg("--status") ? Number(arg("--status")) : null;

// ── the team ────────────────────────────────────────────────────────────────
// Role is how the person is credited when the source carries no prefix.
const TEAM = [
  ["Queenie Miranda", "BDR"],
  ["Ally Maceda", "BDR"],
  ["Miguel Flores", "BDR"],
  ["Grace Lanayon", "BDR"],
  ["John Bautista", "BDR"],
  ["Angelica Tobias", "BDR"],
  ["Jaque Solayao", "BDR"],
  ["Malvin Rosales", "BDR"],
  ["Zulema Salas", "FR"],
  ["Lupe Campos", "FR"],
  ["Jezel Mercado", "FR"],
  ["Genysys Sanchez", "FR"],
];
const BY_FIRST = new Map(TEAM.map(([full, role]) => [full.split(" ")[0].toLowerCase(), { full, role }]));

const api = async (p) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(BASE + p, { headers: { api_key: KEY } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((s) => setTimeout(s, 500 * attempt));
    }
  }
};

/** Some fields come back as objects ({Id, Name, …}) rather than strings. */
const str = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return String(v.Name ?? v.Value ?? v.Title ?? "");
  return String(v);
};

const tidy = (s) => String(s).replace(/\s*[-–—].*$/, "").replace(/\s+/g, " ").trim();

/** Map a bare or shortened first name onto the roster spelling ("Quee" → Queenie Miranda). */
function canonical(name) {
  const first = String(name).trim().split(/\s+/)[0].toLowerCase();
  if (!first) return null;
  for (const [key, hit] of BY_FIRST) if (key.startsWith(first) || first.startsWith(key)) return hit;
  return null;
}

/** The representative a lead belongs to, or null when it is not the team's. */
function creditedRep(marketingSource) {
  const s = String(marketingSource ?? "").trim();
  if (!s) return null;

  // An explicit prefix wins, so someone tagged "BDR <name>" keeps that role.
  const bdr = s.match(/^BDR\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (bdr) { const hit = canonical(tidy(bdr[1])); return { role: "BDR", member: hit ? hit.full : tidy(bdr[1]) }; }

  const fr = s.match(/^(?:Field\s+Representative|FR)\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (fr) { const hit = canonical(tidy(fr[1])); return { role: "FR", member: hit ? hit.full : tidy(fr[1]) }; }

  // Otherwise credit whoever on the roster is named anywhere in the source.
  for (const [full, role] of TEAM) {
    const pattern = new RegExp("\\b" + full.replace(/\s+/g, "\\s+") + "\\b", "i");
    if (pattern.test(s)) return { role, member: full };
  }
  return null;
}

const outcomeFor = (s) => {
  const t = String(s ?? "").toLowerCase();
  if (t.includes("signed up")) return "Signed";
  if (t === "referred") return "Signed Referred Out";
  return String(s ?? "");
};

// ── fetch ───────────────────────────────────────────────────────────────────
const statuses = (await api("/api/Statuses")).map((x) => ({ id: x.Data.Id, name: x.Data.StatusName }));
const wanted = ONLY ? statuses.filter((s) => s.id === ONLY) : statuses;
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

const fresh = SINCE ? rows.filter((r) => new Date(r.LastUpdateDate ?? r.CreatedDate ?? 0) > SINCE) : rows;
console.log("\n" + rows.length + " leads total, " + fresh.length + " to read" + (SINCE ? " (changed since " + SINCE.toISOString().slice(0, 10) + ")" : ""));

const c = DRY ? null : await mysql.createConnection(process.env.DATABASE_URL);
let ours = 0, inserted = 0, updated = 0, skipped = 0, failed = 0;
const byRep = new Map();
const skippedSources = new Map();

const BATCH = 8;
for (let i = 0; i < fresh.length; i += BATCH) {
  const details = await Promise.all(fresh.slice(i, i + BATCH).map((r) => api("/api/Leads/" + r.Id).catch(() => null)));
  for (const raw of details) {
    const d = raw?.Data ?? raw;
    if (!d) { failed++; continue; }
    const source = str(d.MarketingSource);
    const rep = creditedRep(source);
    if (!rep) {
      skipped++;
      const key = source || "(no marketing source)";
      skippedSources.set(key, (skippedSources.get(key) || 0) + 1);
      continue;
    }
    ours++;
    byRep.set(rep.role + " " + rep.member, (byRep.get(rep.role + " " + rep.member) || 0) + 1);
    if (DRY) continue;

    const contact = d.Contact ?? {};
    const when = d.SignedUpDate ?? d.CreatedDate ?? null;
    const vals = {
      leadDate: when ? new Date(when) : null,
      role: rep.role,
      member: rep.member.slice(0, 120),
      leadName: ([str(contact.FirstName), str(contact.LastName)].filter(Boolean).join(" ").trim() || ("Lead " + d.Id)).slice(0, 255),
      lastName: str(contact.LastName).slice(0, 255) || null,
      phone: str(contact.MobilePhone || contact.PhoneNumber).slice(0, 60) || null,
      email: str(contact.Email).slice(0, 320) || null,
      outcome: outcomeFor(str(d.Status) || str(d.StatusName)).slice(0, 120),
      classification: str(d.PracticeArea || d.CaseType).slice(0, 120) || null,
      sud: d.SignedUpDate ? String(d.SignedUpDate).slice(0, 10) : null,
      disposition: str(d.SubStatus).slice(0, 120) || null,
      facility: str(d.ReferredByName).slice(0, 255) || null,
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
  if ((i / BATCH) % 40 === 0) console.log("  …" + Math.min(i + BATCH, fresh.length) + "/" + fresh.length + " read — " + ours + " ours");
  await new Promise((r) => setTimeout(r, 150));
}

console.log("\nBD/FR leads found : " + ours);
console.log("not the team's    : " + skipped + (failed ? "  |  unreadable: " + failed : ""));
console.log("\nby representative:");
[...byRep.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("  " + String(v).padStart(5) + "  " + k));
console.log("\ntop sources NOT credited to the team (check for miscredited work):");
[...skippedSources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log("  " + String(v).padStart(5) + "  " + k));
console.log(DRY ? "\n[DRY RUN] nothing written." : "\n✅ inserted " + inserted + ", updated " + updated + ".");
if (c) await c.end();
