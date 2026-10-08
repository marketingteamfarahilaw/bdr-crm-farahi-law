/**
 * Every Marketing Source, Contact Source and Campaign in Lead Docket, for
 * reorganising them (Youssef, 2026-10-08: "audit our channels and sources in
 * Lead Docket and come back with a list and suggested organization").
 * Read-only; names and counts only — no clients. Tab-separated, so the log
 * pastes into a spreadsheet.
 *
 *   npx tsx scripts/audit/sources-audit.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { channelOfSource, isTollFreeLine, sourceCategoryOf } from "../../shared/marketing";
import { routeOf } from "../../server/marketing/routes";
import { isSigned } from "../../server/signupsReport";
import { sourceHygiene } from "../../server/digitalAudit";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const [raw] = await c.query(`SELECT marketingSource m, contactSource cs, campaign cp, outcome, teamRole, leadDate, teamRep FROM leaddocket_leads`);
const rows = raw as { m: string | null; cs: string | null; cp: string | null; outcome: string | null; teamRole: string | null; leadDate: Date | null; teamRep: string | null }[];
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const yearAgo = Date.now() - 365 * 86_400_000;
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "");
console.log(`SOURCES AUDIT — ${rows.length} leads in the CRM's copy of Lead Docket; "12m" = since ${day(yearAgo)}`);

type Agg = { name: string; leads: number; signed: number; leads12: number; signed12: number; first: number | null; last: number | null; team: number; spellings: Set<string> };
function agg(key: (r: (typeof rows)[number]) => string) {
  const by = new Map<string, Agg>();
  for (const r of rows) {
    const name = clean(key(r));
    const k = name.toLowerCase();
    const e = by.get(k) ?? { name, leads: 0, signed: 0, leads12: 0, signed12: 0, first: null, last: null, team: 0, spellings: new Set() };
    const t = r.leadDate ? new Date(r.leadDate).getTime() : null;
    const s = isSigned(r.outcome);
    e.leads++; if (s) e.signed++;
    if (t && t >= yearAgo) { e.leads12++; if (s) e.signed12++; }
    if (t && (!e.first || t < e.first)) e.first = t;
    if (t && (!e.last || t > e.last)) e.last = t;
    if (r.teamRole === "BDR" || r.teamRole === "FR") e.team++;
    e.spellings.add(String(key(r) ?? ""));
    by.set(k, e);
  }
  return Array.from(by.values()).sort((a, b) => b.leads12 - a.leads12 || b.leads - a.leads || a.name.localeCompare(b.name));
}
const filed = (name: string, team: number, leads: number) => {
  if (!name) return "No source";
  if (team > leads / 2) return "BD/FR team";
  if (isTollFreeLine(name)) return "Toll-free line";
  const k = sourceCategoryOf(name);
  if (k.kind === "digital") return `Digital · ${k.group} · ${k.label}`;
  if (k.kind === "merch") return `Merch & print · ${k.label}`;
  return channelOfSource(name);
};
const status = (e: Agg) => (!e.last ? "" : e.last >= yearAgo ? (e.leads12 >= 5 ? "active" : "rare") : "dormant");

console.log("\n## MARKETING SOURCES");
console.log(["Marketing Source", "Leads", "Signed", "Leads 12m", "Signed 12m", "First", "Last", "Status", "BD/FR leads", "CRM files as", "Spellings"].join("\t"));
const ms = agg((r) => r.m ?? "");
for (const e of ms) console.log([e.name || "(blank)", e.leads, e.signed, e.leads12, e.signed12, day(e.first), day(e.last), status(e), e.team, filed(e.name, e.team, e.leads), e.spellings.size].join("\t"));

console.log("\n## CONTACT SOURCES");
console.log(["Contact Source", "Leads", "Signed", "Leads 12m", "Signed 12m", "First", "Last", "Status", "CRM route"].join("\t"));
for (const e of agg((r) => r.cs ?? "")) console.log([e.name || "(blank)", e.leads, e.signed, e.leads12, e.signed12, day(e.first), day(e.last), status(e), routeOf(e.name || null)].join("\t"));

console.log("\n## CAMPAIGNS");
console.log(["Campaign", "Leads", "Signed", "Leads 12m", "Signed 12m", "First", "Last", "Status"].join("\t"));
for (const e of agg((r) => r.cp ?? "")) console.log([e.name || "(blank)", e.leads, e.signed, e.leads12, e.signed12, day(e.first), day(e.last), status(e)].join("\t"));

console.log("\n## MARKETING SOURCE × CONTACT SOURCE, last 12 months (top 200 pairs, BD/FR reps as one row)");
console.log(["Marketing Source", "Contact Source", "Leads 12m", "Signed 12m"].join("\t"));
const pairs = new Map<string, { m: string; cs: string; n: number; s: number }>();
for (const r of rows) {
  if (!r.leadDate || new Date(r.leadDate).getTime() < yearAgo) continue;
  const m = r.teamRole === "BDR" || r.teamRole === "FR" ? `(BD/FR rep — ${r.teamRole})` : clean(r.m) || "(blank)";
  const cs = clean(r.cs) || "(blank)";
  const k = m.toLowerCase() + "\u0001" + cs.toLowerCase();
  const e = pairs.get(k) ?? { m, cs, n: 0, s: 0 };
  e.n++; if (isSigned(r.outcome)) e.s++;
  pairs.set(k, e);
}
for (const p of Array.from(pairs.values()).sort((a, b) => b.n - a.n).slice(0, 200)) console.log([p.m, p.cs, p.n, p.s].join("\t"));

console.log("\n## NEAR-DUPLICATE MARKETING SOURCE NAMES (all time)");
const h = sourceHygiene(ms.filter((e) => e.name).map((e) => ({ source: e.name, leads: e.leads, first: day(e.first) || null, last: day(e.last) || null })));
for (const d of h.duplicates) console.log([d.exact ? "same name, spelled differently" : "probably the same", d.leads, d.rows.join(" / "), d.names.map((n) => `${n.source} (${n.leads})`).join(" | ")].join("\t"));

await c.end();
process.exit(0);
