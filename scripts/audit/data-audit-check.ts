/**
 * Re-checks the Marketing Report's "Data audit" view for one period against
 * Lead Docket itself (Youssef, 2026-10-05: "re-check the numbers"). Read-only;
 * prints counts and Lead Docket ids only — no client names.
 *
 *  1. The audit's own arithmetic: each panel's total is the sum of its rows,
 *     and every lead counted in one appears in its list.
 *  2. Every lead the audit lists (possibly digital, possibly not digital, the
 *     toll-free line, BD/FR leads on a campaign) is read live from Lead Docket,
 *     and the fields the audit decides on — Marketing Source, Contact Source,
 *     Campaign, UTM, referring URL, keywords, status, dates, the BD/FR credit —
 *     are compared with the CRM's copy.
 *  3. The audit is worked out again from the live records, to show whether any
 *     difference changes what it says.
 *
 *   npx tsx scripts/audit/data-audit-check.ts --from 2026-09-01 --to 2026-09-30
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { fromZonedTime } from "date-fns-tz";
import { misregistered, teamCampaigns, type AuditLead } from "../../server/digitalAudit";
import { creditFor, outcomeFor, str } from "../migration/leaddocket-rules.mjs";
import { ldInstant } from "../migration/dates.mjs";

const TZ = "America/Los_Angeles";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const FROM = arg("--from") ?? "2026-09-01", TO = arg("--to") ?? "2026-09-30";
const start = fromZonedTime(`${FROM}T00:00:00`, TZ), end = fromZonedTime(`${TO}T23:59:59.999`, TZ);
const cut = (v: unknown, n: number) => str(v).replace(/\s+/g, " ").trim().slice(0, n) || null;
const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const COLS = "leadId, leadDate, clientName, outcome, marketingSource, teamRole, contactSource, campaign, utm, referringUrl, keywords, status";
type Row = AuditLead & { status: string | null };
const [raw] = await c.query(`SELECT ${COLS} FROM leaddocket_leads WHERE leadDate >= ? AND leadDate <= ?`, [start, end]);
const rows = raw as Row[];
const isTeam = (r: { teamRole: string | null }) => r.teamRole === "BDR" || r.teamRole === "FR";
const outside = rows.filter((r) => !isTeam(r)), team = rows.filter((r) => isTeam(r) && str(r.campaign).trim());

console.log(`DATA AUDIT RE-CHECK — ${FROM} to ${TO}`);
console.log(`The CRM's copy: ${rows.length} leads dated in the period (${outside.length} not BD/FR, ${rows.length - outside.length} BD/FR).`);

// ── 1. the audit's own arithmetic ──
type Mis = ReturnType<typeof misregistered>;
const panels = (m: Mis, t: ReturnType<typeof teamCampaigns>) => ({
  "Possibly digital": m.possiblyDigital, "Possibly not digital": m.possiblyNotDigital, "Toll-free line": m.tollFree, "BD/FR leads on a campaign": t,
});
const before = misregistered(outside), beforeTeam = teamCampaigns(team);
console.log("\n1. THE AUDIT'S OWN ARITHMETIC");
let sums = 0;
for (const [name, groups] of Object.entries(panels(before, beforeTeam))) {
  const leads = groups.reduce((a, g) => a + g.leads, 0), signed = groups.reduce((a, g) => a + g.signed, 0);
  const listed = groups.reduce((a, g) => a + g.clients.length, 0);
  const bad = groups.filter((g) => g.signed > g.leads || g.clients.length > g.leads || (g.leads <= 100 && g.clients.length !== g.leads));
  sums += bad.length;
  console.log(`  ${bad.length ? "✗" : "✓"} ${name}: ${groups.length} rows, ${leads} leads, ${signed} signed, ${listed} listed${bad.length ? ` — ${bad.length} rows don't add up` : ""}`);
}
// A lead is counted once per panel.
const idsOf = (groups: { clients: { id: number }[] }[]) => groups.flatMap((g) => g.clients.map((x) => x.id));
for (const [name, groups] of Object.entries(panels(before, beforeTeam))) {
  const ids = idsOf(groups); const dup = ids.length - new Set(ids).size;
  if (dup) { sums++; console.log(`  ✗ ${name}: ${dup} leads listed twice`); }
}
if (!sums) console.log("  ✓ every total is the sum of its rows, and no lead is counted twice in a panel");

// ── 2. every listed lead, live from Lead Docket ──
const listedIds = new Set<number>(Object.values(panels(before, beforeTeam)).flatMap(idsOf));
const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
let last = 0;
async function detail(id: number): Promise<any | null> {
  for (let a = 1; a <= 10; a++) {
    // The detail endpoint allows 50 a minute and the sync shares it: one every 1.6 s.
    const wait = last + 1600 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
    let r: Response;
    try { r = await fetch(`${BASE}/api/Leads/${id}`, { headers: { api_key: KEY } }); } catch { await sleep(2000 * a); continue; }
    if (r.status === 429) { await sleep(10_000 * a); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status} for lead ${id}`);
    const j = await r.json(); return j?.Data ?? j;
  }
  throw new Error(`rate limited on lead ${id}`);
}

console.log(`\n2. EVERY LISTED LEAD, LIVE FROM LEAD DOCKET — ${listedIds.size} leads`);
if (!KEY) { console.log("  skipped: no LEADDOCKET_API_KEY on the server"); await c.end(); process.exit(0); }
const byId = new Map(rows.map((r) => [r.leadId, r]));
const FIELDS = ["marketingSource", "contactSource", "campaign", "utm", "referringUrl", "keywords", "status", "teamRole", "outcome"] as const;
const diffs = new Map<string, number[]>();
const gone: number[] = [], moved: number[] = [];
const live = new Map<number, Row>();
for (const id of listedIds) {
  const d = await detail(id);
  if (!d) { gone.push(id); continue; }
  const status = str(d.Status) || str(d.StatusName);
  const leadDate = ldInstant(d.SignedUpDate) ?? ldInstant(d.CreatedDate);
  const rep = creditFor(d.Id, str(d.MarketingSource));
  const now: Row = {
    leadId: id, leadDate, clientName: null, outcome: outcomeFor(status, d.SignedUpDate).slice(0, 60),
    marketingSource: cut(d.MarketingSource, 255), teamRole: rep ? rep.role : null, contactSource: cut(d.ContactSource, 255),
    campaign: cut(d.Campaign, 255), utm: cut(d.UTM, 500), referringUrl: cut(d.ReferringUrl, 500), keywords: cut(d.Keywords, 255), status: cut(status, 80),
  };
  live.set(id, now);
  if (!leadDate || leadDate < start || leadDate > end) moved.push(id);
  const was = byId.get(id)!;
  for (const f of FIELDS) if (!same(was[f], now[f])) diffs.set(f, [...(diffs.get(f) ?? []), id]);
}
const changed = new Set(Array.from(diffs.values()).flat());
console.log(`  read ${live.size}; not found in Lead Docket: ${gone.length}${gone.length ? " — ids " + gone.join(", ") : ""}`);
console.log(`  ${changed.size ? "✗" : "✓"} leads whose audit fields differ from the CRM's copy: ${changed.size}`);
for (const [f, ids] of diffs) console.log(`     ${f}: ${ids.length} — Lead Docket ids ${ids.slice(0, 30).join(", ")}${ids.length > 30 ? " …" : ""}`);
console.log(`  ${moved.length ? "✗" : "✓"} leads whose date has moved out of the period: ${moved.length}${moved.length ? " — ids " + moved.join(", ") : ""}`);

// ── 3. the audit again, from the live records ──
const fresh = rows.filter((r) => !gone.includes(r.leadId) && !moved.includes(r.leadId)).map((r) => ({ ...r, ...(live.get(r.leadId) ?? {}) }));
const after = misregistered(fresh.filter((r) => !isTeam(r))), afterTeam = teamCampaigns(fresh.filter((r) => isTeam(r) && str(r.campaign).trim()));
console.log("\n3. THE AUDIT AGAIN, FROM LEAD DOCKET'S LIVE RECORDS (only the listed leads re-read)");
const A = panels(before, beforeTeam), B = panels(after, afterTeam);
for (const name of Object.keys(A) as (keyof typeof A)[]) {
  const n = (g: { leads: number }[]) => g.reduce((a, x) => a + x.leads, 0), s = (g: { signed: number }[]) => g.reduce((a, x) => a + x.signed, 0);
  const ok = n(A[name]) === n(B[name]) && s(A[name]) === s(B[name]);
  console.log(`  ${ok ? "✓" : "✗"} ${name}: CRM copy ${n(A[name])} leads / ${s(A[name])} signed → live ${n(B[name])} / ${s(B[name])}`);
}
console.log("\n  Leads that aren't listed weren't re-read here; the month's full Lead Docket list was checked against the CRM by the Lead Docket audit.");
await c.end();
process.exit(0);
