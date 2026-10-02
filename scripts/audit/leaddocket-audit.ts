/**
 * A deep, read-only audit of one month in Lead Docket (Youssef, 2026-10-02:
 * "really deep audit Lead Docket and see how much sign-ups we lose in Sep and
 * leads"). Run on the server by the "Lead Docket audit" workflow; prints counts
 * only — no client names, no notes — so the run log can be read safely.
 *
 * Leads are sorted into the Marketing Report's own reason families
 * (server/marketing/reasons.ts), so this agrees with that report: signed, still
 * open, and the ways a lead didn't sign. "Lost business" is a viable lead that
 * didn't sign (went elsewhere or quiet, referred out, no reason); junk, no
 * claim, not our kind of case and past the deadline are "not viable".
 *
 *  0. The month beside the two before it.
 *  1. Completeness: Lead Docket's own list of the month's leads against the
 *     CRM's copy (leaddocket_leads) — leads never synced, or synced stale.
 *  2. The funnel: where each of the month's leads is now.
 *  3. Lost business by reason, channel, Marketing Source, intake person, case
 *     value and case type; high-value leads lost.
 *  4. Sign-ups dated in the month that are no longer "Signed Up".
 *  5. Still open, and how many have gone quiet (no update in 7+ days).
 *
 *   npx tsx scripts/audit/leaddocket-audit.ts --month 2026-09
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";
import { channelOfSource, NOT_VIABLE, REASON_LABEL, type ReasonKey } from "../../shared/marketing";
import { reasonOf } from "../../server/marketing/reasons";
import { scorecardBucket } from "../../server/signupsReport";
import { ldInstant } from "../migration/dates.mjs";

const TZ = "America/Los_Angeles";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const MONTH = arg("--month") ?? formatInTimeZone(new Date(), TZ, "yyyy-MM");
const shift = (m: string, d: number) => { const [y, mo] = m.split("-").map(Number); const t = y * 12 + mo - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const MONTHS = [shift(MONTH, -2), shift(MONTH, -1), MONTH];
const ym = (d: Date | string | null | undefined) => (d ? formatInTimeZone(new Date(d), TZ, "yyyy-MM") : null);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

type Row = {
  leadId: number; createdDate: Date | null; signedUpDate: Date | null; status: string | null; subStatus: string | null; outcome: string | null;
  marketingSource: string | null; contactSource: string | null; campaign: string | null; intakeBy: string | null;
  teamRole: string | null; teamRep: string | null; caseValue: string | null; caseType: string | null; lastUpdate: string | null;
};
const low = (s: unknown) => String(s ?? "").toLowerCase().trim();
const family = (r: Row): ReasonKey => reasonOf(scorecardBucket(r.outcome), r.status, r.subStatus);
const notViable = (r: Row) => NOT_VIABLE.has(family(r));
/** Lost business: a viable lead that didn't sign. */
const isLost = (r: Row) => family(r) !== "signed" && family(r) !== "open" && !notViable(r);
const label = (r: Row) => REASON_LABEL[family(r)];
const channel = (r: Row) => (r.teamRole === "BDR" || r.teamRole === "FR" ? "BD/FR team"
  : !String(r.marketingSource ?? "").trim() ? "No Marketing Source" : channelOfSource(String(r.marketingSource).trim()));

type Cells = [string, ...(string | number)[]];
function table(title: string, rows: Cells[], head: string[]) {
  console.log(`\n${title}`);
  if (!rows.length) { console.log("  (none)"); return; }
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (r: (string | number)[]) => "  " + r.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ");
  console.log(line(head));
  for (const r of rows) console.log(line(r));
}
function tally<T>(xs: T[], key: (x: T) => string, top = 25): Cells[] {
  const m = new Map<string, number>();
  for (const x of xs) { const k = (key(x) || "(blank)").slice(0, 80); m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, top);
}

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const start = new Date(`${MONTHS[0]}-01T00:00:00-07:00`);
const [raw] = await c.query(
  `SELECT leadId, createdDate, signedUpDate, status, subStatus, outcome, marketingSource, contactSource, campaign, intakeBy,
          teamRole, teamRep, caseValue, caseType, lastUpdate
     FROM leaddocket_leads WHERE createdDate >= ? OR signedUpDate >= ?`, [start, start]);
const all = raw as Row[];
const cohort = (m: string) => all.filter((r) => ym(r.createdDate) === m);
const signedIn = (m: string) => all.filter((r) => ym(r.signedUpDate) === m);
console.log(`LEAD DOCKET AUDIT — ${MONTH} (Pacific months)`);

// ── 0. the trend ──
table("0. THREE MONTHS SIDE BY SIDE (leads by the month they came in)", MONTHS.map((m) => {
  const co = cohort(m), n = (f: (r: Row) => boolean) => co.filter(f).length;
  const signed = n((r) => family(r) === "signed"), viable = co.length - n(notViable);
  return [m, co.length, viable, signed, pct(signed, co.length), pct(signed, viable), n(isLost), n(notViable), n((r) => family(r) === "open"), signedIn(m).length];
}), ["Month", "Leads in", "Viable", "Signed", "Conv.", "Win (viable)", "Lost (viable)", "Not viable", "Still open", "Sign-ups dated in month"]);

// ── 1. completeness against Lead Docket itself ──
const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";
const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));
let lastCall = 0;
async function api(p: string): Promise<any> {
  for (let a = 1; a <= 10; a++) {
    const wait = lastCall + 300 - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
    let r: Response;
    try { r = await fetch(BASE + p, { headers: { api_key: KEY } }); } catch { await sleep(1000 * a); continue; }
    if (r.status === 429) { await sleep(5000 * a); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${p}`);
    return r.json();
  }
  throw new Error("rate limited: " + p);
}
console.log("\n1. COMPLETENESS — Lead Docket's own list vs the CRM's copy");
if (!KEY) console.log("  skipped: no LEADDOCKET_API_KEY on the server");
else {
  try {
    const statuses = ((await api("/api/Statuses")) as any[]).map((x) => ({ id: x.Data.Id, name: String(x.Data.StatusName) }));
    const ld: { id: string; status: string; month: string | null }[] = [];
    for (const st of statuses) {
      let page = 1, pages = 1;
      do {
        const r = await api(`/api/Leads?Status=${st.id}&Page=${page}`);
        pages = r.TotalPages ?? 1;
        for (const rec of r.Records ?? []) ld.push({ id: String(rec.Id), status: st.name, month: ym(ldInstant(rec.CreatedDate)) });
        page++;
      } while (page <= pages);
    }
    const inMonth = ld.filter((x) => x.month === MONTH);
    const [dbRows] = await c.query(`SELECT leadId, status FROM leaddocket_leads`);
    const db = new Map((dbRows as any[]).map((r) => [String(r.leadId), r as { status: string | null }]));
    const missing = inMonth.filter((x) => !db.has(x.id));
    const stale = inMonth.filter((x) => db.has(x.id) && low(db.get(x.id)!.status) !== low(x.status));
    console.log(`  Lead Docket lists ${inMonth.length} leads created in ${MONTH} (of ${ld.length} in all); the CRM has ${cohort(MONTH).length}.`);
    console.log(`  Not in the CRM at all: ${missing.length}${missing.length ? " — Lead Docket ids " + missing.slice(0, 40).map((x) => x.id).join(", ") + (missing.length > 40 ? " …" : "") : ""}`);
    console.log(`  In the CRM with an out-of-date status: ${stale.length}`);
    table("  The month's leads by Lead Docket status", tally(inMonth, (x) => x.status), ["Status (Lead Docket)", "Leads"]);
    if (missing.length) table("  Missing from the CRM, by status", tally(missing, (x) => x.status), ["Status", "Leads"]);
    if (stale.length) table("  Out of date: CRM status → Lead Docket status now", tally(stale, (x) => `${db.get(x.id)!.status ?? "(blank)"} → ${x.status}`), ["Change", "Leads"]);
  } catch (e) { console.log("  could not read Lead Docket: " + (e as Error).message); }
}

// ── 2. the month's funnel ──
const co = cohort(MONTH);
table(`2. ${MONTH} FUNNEL — the ${co.length} leads that came in, where each one is now`,
  tally(co, label, 10).map(([k, n]) => [k, n, pct(Number(n), co.length)] as Cells), ["Reason family", "Leads", "Share"]);
table("   Current Lead Docket status (raw)", tally(co, (r) => r.status ?? "", 40).map(([k, n]) => [k, n, pct(Number(n), co.length)] as Cells), ["Status", "Leads", "Share"]);

// ── 3. lost business ──
const lost = co.filter(isLost);
console.log(`\n3. LOST BUSINESS — ${lost.length} of ${co.length} leads (${pct(lost.length, co.length)}) were viable but didn't sign; ${co.filter(notViable).length} more were never viable`);
table("   Lost, by reason", tally(lost, (r) => `${label(r)} · ${r.subStatus || r.status || "no reason recorded"}`, 40), ["Family · reason", "Leads"]);
table("   Not viable, by reason (lead quality, not intake)", tally(co.filter(notViable), (r) => `${label(r)} · ${r.subStatus || r.status || "—"}`, 25), ["Family · reason", "Leads"]);
const byKey = (key: (r: Row) => string, title: string, top = 25) => {
  const groups = new Map<string, Row[]>();
  for (const r of co) { const k = (key(r) || "(blank)").slice(0, 60); groups.set(k, [...(groups.get(k) ?? []), r]); }
  table(title, Array.from(groups.entries()).map(([k, rs]) => {
    const n = (f: (r: Row) => boolean) => rs.filter(f).length;
    const signed = n((r) => family(r) === "signed"), viable = rs.length - n(notViable);
    return [k, rs.length, viable, signed, pct(signed, viable), n(isLost), n((r) => family(r) === "lostThem"), n((r) => family(r) === "open")] as Cells;
  }).sort((a, b) => Number(b[5]) - Number(a[5])).slice(0, top), ["", "Leads", "Viable", "Signed", "Win (viable)", "Lost", "…elsewhere/quiet", "Open"]);
};
byKey(channel, "   By channel");
byKey((r) => (r.teamRole === "BDR" || r.teamRole === "FR" ? `${r.teamRole} ${r.teamRep ?? ""}` : String(r.marketingSource ?? "").trim()), "   By Marketing Source (top 25 by lost)");
byKey((r) => r.intakeBy ?? "", "   By intake person (who handled the lead)");
byKey((r) => r.caseValue ?? "not recorded", "   By case value");
byKey((r) => String(r.caseType ?? "").replace(/\s+/g, " ").trim(), "   By case type", 15);
const valuable = lost.filter((r) => /high|rank x/i.test(r.caseValue ?? ""));
table(`   High-value leads lost (case value High or Rank X): ${valuable.length}`, tally(valuable, (r) => `${label(r)} · ${r.subStatus || "no reason"} · ${channel(r)}`, 30), ["Family · reason · channel", "Leads"]);

// ── 4. sign-ups that slipped ──
const su = signedIn(MONTH);
const slipped = su.filter((r) => !/signed up/i.test(r.status ?? "") && low(r.status) !== "referred");
table(`4. SIGN-UPS DATED ${MONTH}: ${su.length} — ${slipped.length} no longer "Signed Up" (${pct(slipped.length, su.length)})`,
  tally(slipped, (r) => `${r.status ?? "(blank)"}${r.subStatus ? " · " + r.subStatus : ""}`, 30), ["Status now", "Sign-ups"]);
table("   Of them, by channel", tally(slipped, channel), ["Channel", "Sign-ups"]);
console.log(`   Signed, then referred out to another firm: ${su.filter((r) => low(r.status) === "referred").length}`);

// ── 5. still open ──
const open = co.filter((r) => family(r) === "open");
const quiet = open.filter((r) => { const t = ldInstant(r.lastUpdate); return !t || Date.now() - t.getTime() > 7 * 86400000; });
console.log(`\n5. STILL OPEN: ${open.length} of the month's leads — ${quiet.length} with no update in 7+ days`);
table("   Open, by status", tally(open, (r) => r.status ?? ""), ["Status", "Leads"]);
table("   Gone quiet, by channel", tally(quiet, channel), ["Channel", "Leads"]);
table("   Gone quiet, by intake person", tally(quiet, (r) => r.intakeBy ?? ""), ["Intake", "Leads"]);

// ── attribution ──
const noSource = co.filter((r) => !String(r.marketingSource ?? "").trim());
console.log(`\nATTRIBUTION: ${noSource.length} of the month's leads have no Marketing Source (${noSource.filter((r) => r.signedUpDate).length} of them signed) — they count for no channel.`);

await c.end();
process.exit(0);
