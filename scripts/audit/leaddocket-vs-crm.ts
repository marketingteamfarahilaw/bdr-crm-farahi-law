/**
 * Lead Docket against the CRM, both ways, read-only (Youssef, 2026-10-08: "a
 * lead deleted in Lead Docket stays in the CRM … audit what we have in Lead
 * Docket should be in the CRM"). Nothing is changed.
 *
 *  1. Every lead Lead Docket lists, in every status, against the CRM's copy
 *     (leaddocket_leads): missing from the CRM, or held with an older status.
 *  2. Leads the CRM holds — its copy, the Sign-ups data (lead_intake) and the
 *     partner links (facility_leads) — that Lead Docket no longer lists. Each is
 *     asked for by id: "deleted in Lead Docket" only when Lead Docket says it
 *     doesn't exist. Lead Docket ids and, for the team's leads, the rep — no
 *     client names, so the run log is safe to read.
 *
 *   npx tsx scripts/audit/leaddocket-vs-crm.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
if (!KEY) { console.log("No LEADDOCKET_API_KEY on the server."); process.exit(0); }
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
const last = { list: 0, detail: 0 };
async function api(p: string): Promise<{ status: number; body: any }> {
  const g = /^\/api\/Leads\/\d+/.test(p) ? "detail" : "list";
  for (let a = 1; a <= 10; a++) {
    // The sync's own pace: about 207 list and 46 detail reads a minute, under Lead Docket's caps.
    const wait = last[g] + (g === "detail" ? 1300 : 290) - Date.now(); if (wait > 0) await sleep(wait); last[g] = Date.now();
    let r: Response;
    try { r = await fetch(BASE + p, { headers: { api_key: KEY } }); } catch { await sleep(2000 * a); continue; }
    if (r.status === 429) { await sleep(8000 * a); continue; }
    let body: any = null; try { body = await r.json(); } catch { /* none */ }
    return { status: r.status, body };
  }
  throw new Error("rate limited: " + p);
}

const statuses = ((await api("/api/Statuses")).body as any[]).map((x) => ({ id: x.Data.Id, name: String(x.Data.StatusName) }));
const ld = new Map<string, { status: string }>();
for (const st of statuses) {
  let page = 1, pages = 1;
  do {
    const { status, body } = await api(`/api/Leads?Status=${st.id}&Page=${page}`);
    if (status !== 200) throw new Error(`HTTP ${status} listing ${st.name} page ${page} — stopping rather than report a partial list`);
    pages = body.TotalPages ?? 1;
    for (const rec of body.Records ?? []) ld.set(String(rec.Id), { status: st.name });
    page++;
  } while (page <= pages);
}
console.log(`LEAD DOCKET vs CRM — ${new Date().toISOString()}\nLead Docket lists ${ld.size} leads in ${statuses.length} statuses.`);

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p))[0] as any[];
const copy = new Map((await q("SELECT CAST(leadId AS CHAR) id, status, teamRole, teamRep, leadDate FROM leaddocket_leads")).map((r) => [r.id, r]));
const intake = new Map((await q("SELECT externalId id, member, role, outcome, leadDate FROM lead_intake WHERE externalSource='leaddocket'")).map((r) => [String(r.id), r]));
const links = new Map((await q("SELECT externalId id, facilityId, repName FROM facility_leads WHERE externalSource='leaddocket'")).map((r) => [String(r.id), r]));
console.log(`The CRM holds ${copy.size} in its Lead Docket copy, ${intake.size} in the Sign-ups data, ${links.size} partner links.`);

// 1. Lead Docket → CRM
const missing = [...ld.keys()].filter((id) => !copy.has(id));
const stale = [...ld.entries()].filter(([id, v]) => copy.has(id) && String(copy.get(id).status ?? "").toLowerCase() !== v.status.toLowerCase());
console.log(`\n1. IN LEAD DOCKET, NOT (OR NOT UP TO DATE) IN THE CRM`);
console.log(`  ${missing.length ? "✗" : "✓"} missing from the CRM: ${missing.length}${missing.length ? " — ids " + missing.slice(0, 40).join(", ") + (missing.length > 40 ? " …" : "") : ""}`);
console.log(`  ${stale.length ? "✗" : "✓"} older status in the CRM: ${stale.length} (the next sync updates these)`);

// 2. CRM → Lead Docket
const held = new Set([...copy.keys(), ...intake.keys(), ...links.keys()].filter((id) => /^\d+$/.test(id)));
const unlisted = [...held].filter((id) => !ld.has(id));
console.log(`\n2. IN THE CRM, NO LONGER LISTED BY LEAD DOCKET: ${unlisted.length} — checking each…`);
const gone: string[] = [], exists: string[] = [], unsure: string[] = [];
for (const id of unlisted.slice(0, 400)) {
  const { status, body } = await api(`/api/Leads/${id}`);
  const d = body?.Data ?? body;
  if (status === 404 || status === 410 || (status === 200 && (!d || d.IsDeleted === true))) gone.push(id);
  else if (status === 200) exists.push(id);
  else unsure.push(`${id} (HTTP ${status})`);
}
console.log(`  ✗ deleted in Lead Docket, still in the CRM: ${gone.length}`);
console.log(`  · still exist in Lead Docket but in no listed status: ${exists.length}${exists.length ? " — ids " + exists.slice(0, 20).join(", ") : ""}`);
if (unsure.length) console.log(`  ? couldn't tell: ${unsure.join(", ")}`);
if (unlisted.length > 400) console.log(`  (checked the first 400 of ${unlisted.length})`);

const day = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const team = gone.filter((id) => intake.has(id) || copy.get(id)?.teamRole);
console.log(`\n  Of them, the BD/FR team's (counted in the Sign-ups Report): ${team.length}`);
console.log(["Lead Docket id", "Rep", "Role", "Outcome / status", "Lead date", "In: copy · sign-ups · partner link"].join("\t"));
for (const id of team) {
  const i = intake.get(id), k = copy.get(id);
  console.log([id, i?.member ?? k?.teamRep ?? "", i?.role ?? k?.teamRole ?? "", i?.outcome ?? k?.status ?? "", day(i?.leadDate ?? k?.leadDate),
    [copy.has(id) ? "copy" : "", intake.has(id) ? "sign-ups" : "", links.has(id) ? `link${links.get(id).facilityId ? " (partner)" : ""}` : ""].filter(Boolean).join(" · ")].join("\t"));
}
const others = gone.filter((id) => !team.includes(id));
console.log(`\n  Not the team's (Marketing Report only): ${others.length}${others.length ? " — ids " + others.slice(0, 60).join(", ") + (others.length > 60 ? " …" : "") : ""}`);
await c.end();
process.exit(0);
