/**
 * Lead Docket's own option lists — every Marketing Source, Contact Source,
 * Campaign and the like as configured in Lead Docket, including ones no lead
 * uses yet (Youssef, 2026-10-08: "scrape all channels and sources"). Read-only:
 * GETs only, and prints names, ids and endpoint paths — no clients.
 *
 * The API's description (swagger) is read first to find the list endpoints;
 * the usual names are tried as well.
 *
 *   npx tsx scripts/audit/leaddocket-lists.ts
 */
import "dotenv/config";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
if (!KEY) { console.log("No LEADDOCKET_API_KEY on the server."); // 3. Lead Docket's source list (/api/Lookups: Id + SourceName) against what the leads use,
// from the CRM's copy — so options no lead has used show as 0.
const { body: lk } = await get("/api/Lookups");
if (Array.isArray(lk) && lk.length) {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const use = new Map<string, { ms: number; ms12: number; cs: number; cp: number; last: string }>();
  const bump = (name: unknown, f: "ms" | "cs" | "cp", n: number, n12: number, last: Date | null) => {
    const k = String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!k) return;
    const e = use.get(k) ?? { ms: 0, ms12: 0, cs: 0, cp: 0, last: "" };
    e[f] += n; if (f === "ms") e.ms12 += n12;
    const d = last ? new Date(last).toISOString().slice(0, 10) : "";
    if (d > e.last) e.last = d;
    use.set(k, e);
  };
  for (const [col, f] of [["marketingSource", "ms"], ["contactSource", "cs"], ["campaign", "cp"]] as const) {
    const [rows] = await c.query(`SELECT ${col} name, COUNT(*) n, SUM(leadDate >= ?) n12, MAX(leadDate) last FROM leaddocket_leads GROUP BY ${col}`, [yearAgo]);
    for (const r of rows as any[]) bump(r.name, f, Number(r.n), Number(r.n12) || 0, r.last);
  }
  await c.end();
  console.log(`\n## LEAD DOCKET SOURCE LIST (/api/Lookups) — ${lk.length} entries, with how many leads use each name`);
  console.log(["Id", "SourceName", "As Marketing Source", "Marketing Source 12m", "As Contact Source", "As Campaign", "Last lead"].join("\t"));
  const rows = lk.map((x: any) => ({ id: idOf(x), name: String(x.SourceName ?? nameOf(x)).trim() }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  for (const r of rows) {
    const u = use.get(r.name.replace(/\s+/g, " ").toLowerCase()) ?? { ms: 0, ms12: 0, cs: 0, cp: 0, last: "" };
    console.log([r.id, r.name, u.ms, u.ms12, u.cs, u.cp, u.last].join("\t"));
  }
  const listed = new Set(rows.map((r: any) => r.name.replace(/\s+/g, " ").toLowerCase()));
  console.log("\n## NAMES ON LEADS THAT AREN'T IN THE LIST (typed in, or since removed)");
  for (const [k, u] of use) if (!listed.has(k) && (u.ms || u.cs)) console.log([k, u.ms, u.cs, u.cp, u.last].join("\t"));
}
process.exit(0); }
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));

async function get(p: string): Promise<{ status: number; body: any }> {
  for (let a = 1; a <= 6; a++) {
    await sleep(400);
    let r: Response;
    try { r = await fetch(BASE + p, { headers: { api_key: KEY, accept: "application/json" } }); } catch { await sleep(1500 * a); continue; }
    if (r.status === 429) { await sleep(8000 * a); continue; }
    const text = await r.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body };
  }
  return { status: 0, body: null };
}

// 1. The API's own description, if it publishes one: list the GET paths (never a lead's data).
const DOCS = ["/swagger/docs/v1", "/api/swagger/docs/v1", "/swagger/v1/swagger.json", "/api/swagger/v1/swagger.json", "/swagger/v2/swagger.json", "/help"];
const discovered = new Set<string>();
for (const p of DOCS) {
  const { status, body } = await get(p);
  console.log(`docs ${p}: HTTP ${status}${body && typeof body === "object" && body.paths ? ` — ${Object.keys(body.paths).length} paths` : ""}`);
  if (body && typeof body === "object" && body.paths) {
    for (const [path, ops] of Object.entries<any>(body.paths)) if (ops.get) discovered.add(path);
    break;
  }
}
if (discovered.size) {
  console.log("\n## GET ENDPOINTS IN THE API DESCRIPTION");
  for (const p of Array.from(discovered).sort()) console.log(p);
}

// 2. Every list-like GET endpoint without a path parameter, plus the usual names.
const GUESSES = [
  "/api/MarketingSources", "/api/MarketingSource", "/api/Lookups/MarketingSources", "/api/Leads/MarketingSources",
  "/api/ContactSources", "/api/ContactSource", "/api/Lookups/ContactSources", "/api/Leads/ContactSources",
  "/api/Campaigns", "/api/Campaign", "/api/Lookups/Campaigns", "/api/Leads/Campaigns",
  "/api/ReferralSources", "/api/Referrers", "/api/Offices", "/api/CaseTypes", "/api/PracticeAreas", "/api/SubStatuses", "/api/Statuses",
  "/api/Lookups", "/api/Lists", "/api/CustomFields",
];
// From the description: list endpoints only — no path parameter, and named like a list of options.
const candidates = [...GUESSES, ...Array.from(discovered).filter((p) => !p.includes("{") && /source|campaign|lookup|list|status|office|type|area|referr/i.test(p))];
const seen = new Set<string>();
const nameOf = (x: any) => (x == null ? "" : typeof x !== "object" ? String(x)
  : String(x.SourceName ?? x.Name ?? x.name ?? x.Description ?? x.Value ?? x.Text ?? x.Title ?? x.StatusName ?? x.Data?.Name ?? x.Data?.StatusName ?? x.Data?.Description ?? ""));
const idOf = (x: any) => (x && typeof x === "object" ? (x.Id ?? x.id ?? x.Data?.Id ?? "") : "");
const activeOf = (x: any) => {
  if (!x || typeof x !== "object") return "";
  const v = x.IsActive ?? x.Active ?? x.Data?.IsActive ?? (x.Inactive != null ? !x.Inactive : undefined);
  return v == null ? "" : v ? "yes" : "no";
};

console.log("\n## LIST ENDPOINTS");
for (const p of candidates) {
  if (seen.has(p.toLowerCase())) continue;
  seen.add(p.toLowerCase());
  const { status, body } = await get(p);
  const arr: any[] | null = Array.isArray(body) ? body : Array.isArray(body?.Records) ? body.Records : Array.isArray(body?.Data) ? body.Data : Array.isArray(body?.Items) ? body.Items : null;
  console.log(`${p}: HTTP ${status}${arr ? ` — ${arr.length} items` : body && typeof body === "object" ? ` — object with keys ${Object.keys(body).slice(0, 12).join(", ")}` : ""}`);
  if (!arr || !arr.length || /lookups$/i.test(p)) continue;   // printed with its usage below
  console.log(`### ${p}`);
  console.log(["Id", "Name", "Active", "Other fields"].join("\t"));
  for (const x of arr) {
    const keys = x && typeof x === "object" ? Object.keys(x.Data ?? x).filter((k) => !/^(id|name)$/i.test(k)).slice(0, 8).join(",") : "";
    console.log([idOf(x), nameOf(x), activeOf(x), keys].join("\t"));
  }
}
// 3. Lead Docket's source list (/api/Lookups: Id + SourceName) against what the leads use,
// from the CRM's copy — so options no lead has used show as 0.
const { body: lk } = await get("/api/Lookups");
if (Array.isArray(lk) && lk.length) {
  const mysql = (await import("mysql2/promise")).default;
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const use = new Map<string, { ms: number; ms12: number; cs: number; cp: number; last: string }>();
  const bump = (name: unknown, f: "ms" | "cs" | "cp", n: number, n12: number, last: Date | null) => {
    const k = String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!k) return;
    const e = use.get(k) ?? { ms: 0, ms12: 0, cs: 0, cp: 0, last: "" };
    e[f] += n; if (f === "ms") e.ms12 += n12;
    const d = last ? new Date(last).toISOString().slice(0, 10) : "";
    if (d > e.last) e.last = d;
    use.set(k, e);
  };
  for (const [col, f] of [["marketingSource", "ms"], ["contactSource", "cs"], ["campaign", "cp"]] as const) {
    const [rows] = await c.query(`SELECT ${col} name, COUNT(*) n, SUM(leadDate >= ?) n12, MAX(leadDate) last FROM leaddocket_leads GROUP BY ${col}`, [yearAgo]);
    for (const r of rows as any[]) bump(r.name, f, Number(r.n), Number(r.n12) || 0, r.last);
  }
  await c.end();
  console.log(`\n## LEAD DOCKET SOURCE LIST (/api/Lookups) — ${lk.length} entries, with how many leads use each name`);
  console.log(["Id", "SourceName", "As Marketing Source", "Marketing Source 12m", "As Contact Source", "As Campaign", "Last lead"].join("\t"));
  const rows = lk.map((x: any) => ({ id: idOf(x), name: String(x.SourceName ?? nameOf(x)).trim() }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
  for (const r of rows) {
    const u = use.get(r.name.replace(/\s+/g, " ").toLowerCase()) ?? { ms: 0, ms12: 0, cs: 0, cp: 0, last: "" };
    console.log([r.id, r.name, u.ms, u.ms12, u.cs, u.cp, u.last].join("\t"));
  }
  const listed = new Set(rows.map((r: any) => r.name.replace(/\s+/g, " ").toLowerCase()));
  console.log("\n## NAMES ON LEADS THAT AREN'T IN THE LIST (typed in, or since removed)");
  for (const [k, u] of use) if (!listed.has(k) && (u.ms || u.cs)) console.log([k, u.ms, u.cs, u.cp, u.last].join("\t"));
}
process.exit(0);
