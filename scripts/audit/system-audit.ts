/**
 * Read-only consistency audit of the CRM's data (Youssef, 2026-10-02: "audit
 * the system and fix any discrepancy or mismatch of the data"). Every check
 * compares two places that should agree, and prints how many disagree with a
 * few row ids — never client names — so the run log is safe to read. Run on
 * the server by the "System audit" workflow; changes nothing.
 *
 *   npx tsx scripts/audit/system-audit.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { outcomeFor } from "../migration/leaddocket-rules.mjs";
import { whoIs } from "../../server/adminOverview";
import { getSystemHealth } from "../../server/systemHealth";

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
const q = async <T = any>(sql: string, p: unknown[] = []) => (await c.query(sql, p))[0] as T[];
let issues = 0;
function report(title: string, n: number, sample: unknown[] = [], note = "") {
  if (n) issues++;
  console.log(`${n ? "✗" : "✓"} ${title}: ${n}${n && sample.length ? ` — e.g. ${sample.slice(0, 12).join(", ")}` : ""}${note ? `  (${note})` : ""}`);
}
async function check(name: string, fn: () => Promise<void>) {
  console.log(`\n── ${name}`);
  try { await fn(); } catch (e) { issues++; console.log(`✗ check failed: ${(e as Error).message}`); }
}
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

console.log("SYSTEM AUDIT — " + new Date().toISOString());

await check("Background jobs", async () => {
  const h = await getSystemHealth();
  for (const x of h.checks) console.log(`${x.state === "ok" ? "✓" : "✗"} ${x.label}: ${x.detail}`);
  if (h.worst !== "ok") issues++;
});

await check("Lead Docket copy — its own derived fields", async () => {
  const rows = await q(`SELECT leadId, status, outcome, signedUpDate, createdDate, leadDate, teamRole, teamRep FROM leaddocket_leads`);
  const badOutcome = rows.filter((r) => String(r.outcome ?? "") !== outcomeFor(r.status, r.signedUpDate).slice(0, 60));
  report("outcome doesn't match status + sign-up date", badOutcome.length, badOutcome.map((r) => `${r.leadId} (${r.outcome} vs ${outcomeFor(r.status, r.signedUpDate)})`));
  const badDate = rows.filter((r) => day(r.leadDate) !== day(r.signedUpDate ?? r.createdDate));
  report("leadDate isn't the sign-up date (or created date)", badDate.length, badDate.map((r) => r.leadId));
  report("no created date", rows.filter((r) => !r.createdDate).length, rows.filter((r) => !r.createdDate).map((r) => r.leadId));
  const future = rows.filter((r) => r.createdDate && new Date(r.createdDate).getTime() > Date.now() + 86400000);
  report("created in the future", future.length, future.map((r) => r.leadId));
  const roleNoRep = rows.filter((r) => r.teamRole && !r.teamRep);
  report("credited to a role but no rep", roleNoRep.length, roleNoRep.map((r) => r.leadId));
});

await check("Team leads: Lead Docket copy vs Sign-ups data (lead_intake)", async () => {
  const ld = await q(`SELECT leadId, teamRole, teamRep, outcome, leadDate FROM leaddocket_leads WHERE teamRole IS NOT NULL AND teamRole <> ''`);
  const li = await q(`SELECT id, externalId, role, member, outcome, leadDate FROM lead_intake WHERE externalSource = 'leaddocket'`);
  const byLd = new Map(ld.map((r) => [String(r.leadId), r]));
  const byLi = new Map<string, any[]>();
  for (const r of li) byLi.set(String(r.externalId), [...(byLi.get(String(r.externalId)) ?? []), r]);
  const missing = ld.filter((r) => !byLi.has(String(r.leadId)));
  report("team lead in Lead Docket copy, missing from Sign-ups data", missing.length, missing.map((r) => r.leadId));
  const orphan = li.filter((r) => !byLd.has(String(r.externalId)));
  report("Sign-ups row whose Lead Docket lead is no longer the team's (or gone)", orphan.length, orphan.map((r) => `${r.id}/LD ${r.externalId}`));
  const dupes = Array.from(byLi.entries()).filter(([, rs]) => rs.length > 1);
  report("Lead Docket lead with more than one Sign-ups row", dupes.length, dupes.map(([k]) => k));
  const pairs = li.map((r) => [r, byLd.get(String(r.externalId))] as const).filter(([, l]) => l);
  const role = pairs.filter(([r, l]) => r.role !== l!.teamRole);
  report("role differs", role.length, role.map(([r, l]) => `${r.externalId} (${r.role} vs ${l!.teamRole})`));
  const member = pairs.filter(([r, l]) => String(r.member ?? "") !== String(l!.teamRep ?? ""));
  report("credited rep differs", member.length, member.map(([r]) => r.externalId));
  const outcome = pairs.filter(([r, l]) => String(r.outcome ?? "") !== String(l!.outcome ?? ""));
  report("outcome differs", outcome.length, outcome.map(([r, l]) => `${r.externalId} (${r.outcome} vs ${l!.outcome})`));
  const date = pairs.filter(([r, l]) => day(r.leadDate) !== day(l!.leadDate));
  report("lead date differs", date.length, date.map(([r]) => r.externalId));
  const sep = (rs: any[], d: string, dateKey: string, signed: (r: any) => boolean) => rs.filter((r) => String(r[dateKey] ?? "").length && day(r[dateKey])!.startsWith(d) && signed(r)).length;
  const isS = (o: unknown) => /^(signed|signed referred out|referral accepted)$/i.test(String(o ?? "").trim());
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    const a = sep(li, m, "leadDate", (r) => isS(r.outcome)), b = sep(ld, m, "leadDate", (r) => isS(r.outcome));
    report(`${m} team sign-ups: Sign-ups data ${a} vs Lead Docket copy ${b} (UTC days)`, Math.abs(a - b));
  }
});

await check("Partner links (facility_leads)", async () => {
  const orphan = await q(`SELECT fl.id FROM facility_leads fl LEFT JOIN facilities f ON f.id = fl.facilityId WHERE fl.facilityId IS NOT NULL AND f.id IS NULL`);
  report("linked to a partner that doesn't exist", orphan.length, orphan.map((r) => r.id));
  const dupe = await q(`SELECT externalId, COUNT(*) n FROM facility_leads WHERE externalSource = 'leaddocket' AND externalId IS NOT NULL GROUP BY externalId HAVING n > 1`);
  report("same Lead Docket lead linked twice", dupe.length, dupe.map((r) => r.externalId));
  const gone = await q(`SELECT fl.id FROM facility_leads fl LEFT JOIN leaddocket_leads l ON l.leadId = fl.externalId WHERE fl.externalSource = 'leaddocket' AND l.leadId IS NULL`);
  report("Lead Docket lead linked here but missing from the Lead Docket copy", gone.length, gone.map((r) => r.id));
});

await check("Partners — stored totals vs the records", async () => {
  const f = await q(`SELECT id, totalSignedCases, totalLeadsReceived, totalLeadsSent, totalCalls, lastContactDate FROM facilities`);
  const signed = new Map((await q(`SELECT facilityId, SUM(signedCase) n FROM facility_leads WHERE facilityId IS NOT NULL AND direction = 'received_from_facility' GROUP BY facilityId`)).map((r) => [r.facilityId, Number(r.n)]));
  const recv = new Map((await q(`SELECT facilityId, COUNT(*) n FROM facility_leads WHERE facilityId IS NOT NULL AND direction = 'received_from_facility' GROUP BY facilityId`)).map((r) => [r.facilityId, Number(r.n)]));
  const sent = new Map((await q(`SELECT facilityId, COUNT(*) n FROM facility_leads WHERE facilityId IS NOT NULL AND direction = 'sent_to_facility' GROUP BY facilityId`)).map((r) => [r.facilityId, Number(r.n)]));
  const calls = new Map((await q(`SELECT facilityId, COUNT(*) n, MAX(contactDate) last FROM contact_logs WHERE facilityId IS NOT NULL GROUP BY facilityId`)).map((r) => [r.facilityId, r]));
  const off = (name: string, get: (r: any) => number, actual: Map<any, number>) => {
    const bad = f.filter((r) => Number(get(r) ?? 0) !== (actual.get(r.id) ?? 0));
    report(`${name}: stored total ≠ count of records`, bad.length, bad.map((r) => `${r.id} (${get(r) ?? 0} vs ${actual.get(r.id) ?? 0})`));
  };
  off("signed cases", (r) => r.totalSignedCases, signed);
  off("leads received", (r) => r.totalLeadsReceived, recv);
  off("leads sent", (r) => r.totalLeadsSent, sent);
  off("calls", (r) => r.totalCalls, new Map(Array.from(calls.entries()).map(([k, v]) => [k, Number(v.n)])));
  const behind = f.filter((r) => { const l = calls.get(r.id)?.last; return l && (!r.lastContactDate || new Date(l) > new Date(r.lastContactDate)); });
  report("last contact date older than the latest logged contact", behind.length, behind.map((r) => r.id));
  const dupNames = await q(`SELECT LOWER(TRIM(name)) k, COUNT(*) n FROM facilities GROUP BY k HAVING n > 1`);
  report("partners with the same name more than once", dupNames.length, [], "merge candidates");
  const reps = await q(`SELECT id, assignedRepName, frRepName FROM facilities WHERE assignedRepName IS NOT NULL OR frRepName IS NOT NULL`);
  const unknownRep = reps.filter((r) => [r.assignedRepName, r.frRepName].some((n) => n && !whoIs(n)?.current));
  report("assigned to someone not on today's team", unknownRep.length, unknownRep.map((r) => r.id));
});

await check("Expenses (from the Centralized sheet)", async () => {
  for (const t of ["fr_expenses", "bdr_expenses"]) {
    const rows = await q(`SELECT id, agentName, amount, expenseDate, store FROM ${t}`);
    const noRep = rows.filter((r) => !whoIs(r.agentName));
    report(`${t}: no rep named`, noRep.length, noRep.map((r) => r.id));
    const former = rows.filter((r) => { const p = whoIs(r.agentName); return p && !p.current; });
    report(`${t}: rep not on today's team (spelling?)`, former.length, Array.from(new Set(former.map((r) => JSON.stringify(String(r.agentName).trim())))));
    const zero = rows.filter((r) => !Number(r.amount));
    report(`${t}: zero or missing amount`, zero.length, zero.map((r) => r.id));
    const future = rows.filter((r) => r.expenseDate && new Date(r.expenseDate).getTime() > Date.now() + 86400000);
    report(`${t}: dated in the future`, future.length, future.map((r) => `${r.id} (${day(r.expenseDate)})`));
    const seen = new Map<string, number[]>();
    for (const r of rows) { const k = [whoIs(r.agentName)?.name, day(r.expenseDate), Number(r.amount).toFixed(2), String(r.store ?? "").toLowerCase().trim()].join("|"); seen.set(k, [...(seen.get(k) ?? []), r.id]); }
    const dup = Array.from(seen.values()).filter((ids) => ids.length > 1 && Number(rows.find((r) => r.id === ids[0])?.amount));
    report(`${t}: same rep, day, amount and store more than once`, dup.length, dup.map((ids) => ids.join("+")));
  }
});

await check("Calls and visits", async () => {
  const rc = await q(`SELECT rcCallId, COUNT(*) n FROM contact_logs WHERE rcCallId IS NOT NULL AND rcCallId <> '' GROUP BY rcCallId HAVING n > 1`);
  report("RingCentral call logged more than once", rc.length, rc.map((r) => r.rcCallId));
  const noRep = await q(`SELECT id FROM contact_logs WHERE (repName IS NULL OR repName = '') AND fromRingCentral = 1`);
  report("RingCentral call with no rep", noRep.length, noRep.map((r) => r.id));
  const reps = await q(`SELECT repName, COUNT(*) n FROM contact_logs WHERE repName IS NOT NULL AND repName <> '' GROUP BY repName`);
  const odd = reps.filter((r) => !whoIs(r.repName)?.current);
  report("call rep names not on today's team", odd.length, odd.map((r) => `${JSON.stringify(r.repName)}×${r.n}`));
  const orphan = await q(`SELECT cl.id FROM contact_logs cl LEFT JOIN facilities f ON f.id = cl.facilityId WHERE cl.facilityId IS NOT NULL AND f.id IS NULL`);
  report("call logged against a partner that doesn't exist", orphan.length, orphan.map((r) => r.id));
  const future = await q(`SELECT id FROM contact_logs WHERE contactDate > NOW() + INTERVAL 1 DAY`);
  report("call dated in the future", future.length, future.map((r) => r.id));
  const fv = await q(`SELECT agentName, COUNT(*) n FROM field_visits GROUP BY agentName`).catch(() => []);
  const oddFv = fv.filter((r) => !whoIs(r.agentName)?.current);
  report("field visit rep names not on today's team", oddFv.length, oddFv.map((r) => `${JSON.stringify(r.agentName)}×${r.n}`));
});

await check("Users", async () => {
  const u = await q(`SELECT id, role, agentName, name FROM users WHERE role IN ('bdr_agent','fr_agent')`);
  const bad = u.filter((r) => !whoIs(r.agentName ?? r.name)?.current);
  report("BDR/FR agent logins not matched to anyone on today's team", bad.length, bad.map((r) => `${r.id} (${r.role})`));
});

console.log(`\n${issues ? `${issues} check(s) found something` : "Everything agrees."}`);
await c.end();
process.exit(0);
