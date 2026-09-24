/**
 * Whole-CRM consistency audit. Read-only; safe to run any time.
 *
 * The other QA scripts compare the CRM with its sources (qa-crm-vs-excel with
 * the Google Sheet, qa-leaddocket with Lead Docket, sync-leaddocket --coverage
 * for leads the sync never read). This one checks that the CRM agrees with
 * ITSELF: the same fact stored in two tables must match, the facility totals
 * must equal the rows they summarise, and every report page must show what the
 * database holds for the same period. A page that disagrees with another page
 * is the discrepancy people actually notice.
 *
 * Page checks call the running app as the owner, so run it on the server:
 *   node scripts/migration/audit-all.mjs
 */
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import { SignJWT } from "jose";
import { fromZonedTime } from "date-fns-tz";
import { TEAM } from "./leaddocket-rules.mjs";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
const q = async (sql, p = []) => (await c.query(sql, p))[0];
const one = async (sql, p = []) => Number(Object.values((await q(sql, p))[0] ?? { n: 0 })[0] ?? 0);

let failures = 0;
const ok = (msg) => console.log("  ✓ " + msg);
const bad = (msg) => { failures++; console.log("  ✗ " + msg); };
const same = (label, a, b) => (Number(a) === Number(b) ? ok(`${label}: ${a}`) : bad(`${label}: ${a} vs ${b}`));

const SIGNED = "('Signed','Signed Referred Out')";
const WENT_OUT = ["Referral Sent", "Facility Confirmed", "Client Scheduled", "Client Attended", "Completed"];

// ── 1. the same fact in two tables ───────────────────────────────────────────
console.log("1. SAME FACT, TWO TABLES");
same("Lead Docket leads — lead_intake vs facility_leads",
  await one("SELECT COUNT(*) FROM lead_intake WHERE externalSource='leaddocket'"),
  await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='leaddocket'"));
same("Lead Docket sign-ups — lead_intake vs facility_leads",
  await one(`SELECT COUNT(*) FROM lead_intake WHERE externalSource='leaddocket' AND outcome IN ${SIGNED}`),
  await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='leaddocket' AND signedCase=1"));
{
  const a = await q(`SELECT member k, COUNT(*) n, SUM(outcome IN ${SIGNED}) s FROM lead_intake WHERE externalSource='leaddocket' GROUP BY member`);
  const b = await q("SELECT repName k, COUNT(*) n, SUM(signedCase=1) s FROM facility_leads WHERE externalSource='leaddocket' GROUP BY repName");
  const bm = new Map(b.map((r) => [r.k, r]));
  const diff = a.filter((r) => { const o = bm.get(r.k); return !o || Number(o.n) !== Number(r.n) || Number(o.s) !== Number(r.s); });
  diff.length ? bad(`per-rep leads/sign-ups differ for: ${diff.map((r) => r.k).join(", ")}`) : ok(`per-rep leads and sign-ups agree for all ${a.length} representatives`);
}
same("partner-referred leads — facility_leads (linked) vs Partner Referral Tracker inbound",
  await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='leaddocket' AND facilityId IS NOT NULL"),
  await one("SELECT COUNT(*) FROM inbound_leads WHERE externalSource='leaddocket'"));
same("partner-referred sign-ups — facility_leads vs tracker inbound",
  await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='leaddocket' AND facilityId IS NOT NULL AND signedCase=1"),
  await one("SELECT COUNT(*) FROM inbound_leads WHERE externalSource='leaddocket' AND signed=1"));
same("outbound referrals — Referral-Friendly sheet rows vs tracker outbound",
  await one("SELECT COUNT(*) FROM referral_tracker"),
  await one("SELECT COUNT(*) FROM outbound_referrals WHERE externalSource='sheet'"));
same("referrals that went out — tracker vs leads sent to partners",
  await one(`SELECT COUNT(*) FROM outbound_referrals WHERE status IN (${WENT_OUT.map(() => "?").join(",")})`, WENT_OUT),
  await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='outbound'"));

// ── 2. totals must equal the rows they summarise ─────────────────────────────
console.log("\n2. FACILITY TOTALS vs THE ROWS BEHIND THEM");
{
  // "Leads sent" = logged leads plus monthly counts entered on the profile (crmDb getTotalLeadsSentMap).
  const rows = await q(`SELECT f.id, f.name, f.totalLeadsReceived tr, f.totalLeadsSent ts, f.totalSignedCases tsc,
      COALESCE(x.recv,0) recv, COALESCE(x.sent,0) + COALESCE(m.n,0) sent, COALESCE(x.sg,0) sg
    FROM facilities f LEFT JOIN (
      SELECT facilityId, SUM(direction='received_from_facility') recv, SUM(direction='sent_to_facility') sent, SUM(signedCase=1) sg
      FROM facility_leads WHERE facilityId IS NOT NULL GROUP BY facilityId) x ON x.facilityId=f.id
    LEFT JOIN (SELECT facilityId, SUM(count) n FROM facility_leads_sent GROUP BY facilityId) m ON m.facilityId=f.id`);
  for (const [col, want, label] of [["tr", "recv", "leads received"], ["ts", "sent", "leads sent"], ["tsc", "sg", "signed cases"]]) {
    const off = rows.filter((r) => Number(r[col] ?? 0) !== Number(r[want]));
    off.length ? bad(`${off.length} facilities show the wrong ${label} (e.g. ${off.slice(0, 3).map((r) => `${r.name}: ${r[col]} vs ${r[want]}`).join("; ")})`)
      : ok(`${label}: every facility's total equals its rows`);
  }
}

// ── 3. nothing points at a record that isn't there ───────────────────────────
console.log("\n3. ORPHANS");
{
  const cols = await q(`SELECT TABLE_NAME t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'facilityId' AND TABLE_NAME <> 'facilities'`);
  let clean = 0;
  for (const { t } of cols) {
    const n = await one(`SELECT COUNT(*) FROM \`${t}\` x LEFT JOIN facilities f ON f.id = x.facilityId WHERE x.facilityId IS NOT NULL AND f.id IS NULL`);
    n ? bad(`${t}: ${n} rows point at a facility that no longer exists`) : clean++;
  }
  ok(`${clean} of ${cols.length} tables with a facility link have no broken links`);
}

// ── 4. nothing stored twice ──────────────────────────────────────────────────
console.log("\n4. DUPLICATES");
for (const [t, src] of [["lead_intake", "leaddocket"], ["facility_leads", "leaddocket"], ["facility_leads", "outbound"], ["inbound_leads", "leaddocket"], ["outbound_referrals", "sheet"]]) {
  const n = await one(`SELECT COUNT(*) FROM (SELECT externalId FROM \`${t}\` WHERE externalSource=? GROUP BY externalId HAVING COUNT(*)>1) d`, [src]);
  n ? bad(`${t} (${src}): ${n} records stored more than once`) : ok(`${t} (${src}): no record stored twice`);
}

// ── 5. one spelling per representative ───────────────────────────────────────
// Reports group by name, so "Ally" and "Ally Maceda" in two tables are two people.
console.log("\n5. REPRESENTATIVE NAMES");
{
  const roster = new Set(TEAM.map(([full]) => full));
  const firsts = new Map(TEAM.map(([full]) => [full.split(" ")[0].toLowerCase(), full]));
  const sources = [
    ["lead_intake", "member"], ["facility_leads", "repName"], ["inbound_leads", "assignedAgent"],
    ["outbound_referrals", "assignedAgent"], ["referral_tracker", "bdrAssigned"], ["referral_rewards", "agentName"],
    ["fr_expenses", "agentName"], ["bdr_expenses", "agentName"], ["fr_errands", "agentName"],
    ["field_visits", "agentName"], ["contact_logs", "repName"], ["facilities", "assignedRepName"],
  ];
  for (const [t, col] of sources) {
    const rows = await q(`SELECT \`${col}\` k, COUNT(*) n FROM \`${t}\` WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> '' GROUP BY \`${col}\``).catch(() => null);
    if (!rows) continue;
    // A short form of a roster name ("Ally") is a split spelling; a name not on the roster at all may be a former rep or someone outside the team.
    const split = rows.filter((r) => !roster.has(r.k) && firsts.has(String(r.k).trim().split(/\s+/)[0].toLowerCase()));
    split.length ? bad(`${t}.${col}: ${split.map((r) => `"${r.k}" (${r.n})`).join(", ")} — short forms of roster names`)
      : ok(`${t}.${col}: roster names spelled in full`);
  }
}

// ── 6. dates that can't be right ─────────────────────────────────────────────
console.log("\n6. IMPOSSIBLE DATES");
for (const [t, col] of [["lead_intake", "leadDate"], ["facility_leads", "leadDate"], ["contact_logs", "contactDate"], ["fr_expenses", "expenseDate"],
  ["bdr_expenses", "expenseDate"], ["field_visits", "visitDate"], ["fr_errands", "errandDate"], ["outbound_referrals", "referralSentDate"], ["inbound_leads", "dateReceived"]]) {
  const future = await one(`SELECT COUNT(*) FROM \`${t}\` WHERE \`${col}\` > NOW() + INTERVAL 2 DAY`).catch(() => null);
  const ancient = await one(`SELECT COUNT(*) FROM \`${t}\` WHERE \`${col}\` < '2015-01-01'`).catch(() => null);
  if (future === null) continue;
  future || ancient ? bad(`${t}.${col}: ${future} in the future, ${ancient} before 2015`) : ok(`${t}.${col}: all dates plausible`);
}

// ── 7. every page shows what the database holds ──────────────────────────────
console.log("\n7. REPORT PAGES vs DATABASE");
const token = await new SignJWT({ openId: process.env.OWNER_OPEN_ID, appId: process.env.VITE_APP_ID, name: "CRM audit" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor(Date.now() / 1000) + 900)
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));
const port = process.env.PORT || "3100";
const page = async (proc, input) => {
  const u = `http://127.0.0.1:${port}/api/trpc/${proc}` + (input ? "?input=" + encodeURIComponent(JSON.stringify({ json: input })) : "");
  const j = await (await fetch(u, { headers: { cookie: "app_session_id=" + token } })).json();
  if (j.error) throw new Error(`${proc}: ${j.error.json?.message ?? "error"}`);
  return j.result.data.json;
};
// Periods are Los Angeles calendar days, as the pages define them.
const la = (d, end) => fromZonedTime(`${d}T${end ? "23:59:59.999" : "00:00:00"}`, "America/Los_Angeles");
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const ym = today.slice(0, 7);
const lastMonthStart = (() => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); })();
const lastMonthEnd = (() => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); })();
const periods = [
  ["year to date", `${today.slice(0, 4)}-01-01`, today],
  ["last month", lastMonthStart, lastMonthEnd],
  ["this month", `${ym}-01`, today],
];
for (const [name, from, to] of periods) {
  console.log(`  — ${name} (${from} → ${to})`);
  const R = [la(from), la(to, true)];
  const dbLeads = await one("SELECT COUNT(*) FROM lead_intake WHERE externalSource='leaddocket' AND leadDate BETWEEN ? AND ?", R);
  const dbSigned = await one(`SELECT COUNT(*) FROM lead_intake WHERE externalSource='leaddocket' AND outcome IN ${SIGNED} AND leadDate BETWEEN ? AND ?`, R);
  const dbSent = await one("SELECT COUNT(*) FROM facility_leads WHERE direction='sent_to_facility' AND leadDate BETWEEN ? AND ?", R);

  const sd = await page("teamReports.signupsDashboard", { from, to });
  same(`Sign-ups Report leads (database ${dbLeads})`, sd.totals.leads, dbLeads);
  same(`Sign-ups Report signed (database ${dbSigned})`, sd.totals.signed, dbSigned);
  const partnerLinked = await one("SELECT COUNT(*) FROM facility_leads WHERE externalSource='leaddocket' AND facilityId IS NOT NULL AND leadDate BETWEEN ? AND ?", R);
  same("Sign-ups Report partner-referred leads vs partner links", sd.totals.attributed, partnerLinked);

  const ap = await page("reports.agentPerformance", { from, to });
  same(`Representative Performance leads received (database ${dbLeads})`, ap.kpis.leadsReceived, dbLeads);
  same(`Representative Performance signed (database ${dbSigned})`, ap.kpis.signed, dbSigned);
  same(`Representative Performance leads sent (database ${dbSent})`, ap.kpis.leadsSent, dbSent);

  const ts = await page("teamReports.signups", { from, to });
  const tsTotal = ts.perMember.reduce((a, m) => a + Number(m.total ?? 0), 0);
  same(`Team Reports sign-ups (database ${dbSigned})`, tsTotal, dbSigned);
}
{
  const cc = await page("crm.management.dashboard");
  same("Command Center facilities", cc.totalFacilities, await one("SELECT COUNT(*) FROM facilities"));
  same("Command Center active partners", cc.activePartners, await one("SELECT COUNT(*) FROM facilities WHERE partnerStatus='active_partner'"));
  same("Command Center leads received from partners", cc.totalLeadsReceived, await one("SELECT COUNT(*) FROM facility_leads WHERE direction='received_from_facility' AND facilityId IS NOT NULL"));
  same("Command Center signed cases from partners", cc.totalSignedCases, await one("SELECT COUNT(*) FROM facility_leads WHERE signedCase=1 AND facilityId IS NOT NULL"));
  same("Command Center leads sent to partners", cc.totalLeadsSent,
    await one("SELECT COUNT(*) FROM facility_leads WHERE direction='sent_to_facility' AND facilityId IS NOT NULL")
    + await one("SELECT COALESCE(SUM(count),0) FROM facility_leads_sent"));
  same("Command Center referrals", cc.totalReferrals,
    await one("SELECT COUNT(*) FROM facility_referrals") + await one("SELECT COUNT(*) FROM inbound_leads"));

  const rs = await page("referralWorkflow.stats");
  same("Referral Reports outbound", rs.summary.totalOutbound, await one("SELECT COUNT(*) FROM outbound_referrals"));
  same("Referral Reports inbound", rs.summary.totalInbound, await one("SELECT COUNT(*) FROM inbound_leads"));
  same("Referral Reports signed from partners", rs.summary.totalSigned, await one("SELECT COUNT(*) FROM inbound_leads WHERE signed=1"));
}

console.log(`\n${failures === 0 ? "✅ Everything agrees." : `⚠ ${failures} check(s) failed — see ✗ lines.`}`);
console.log("AUDIT_RESULT " + JSON.stringify({ failures }));
await c.end();
process.exit(failures ? 1 : 0);
