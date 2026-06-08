/**
 * Agent activity reports — aggregates a single agent's (or everyone's) activity
 * across calls, leads, field visits, errands, referral rewards, and expenses for
 * a date range. Feeds the Reports Center (KPIs, trend series, detail tables, and
 * PDF/Excel exports).
 */
import { and, gte, lte, inArray, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  contactLogs,
  facilityLeads,
  fieldVisits,
  frErrands,
  referralRewards,
  frExpenses,
  bdrExpenses,
} from "../drizzle/schema";

const num = (v: any) => {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? 0 : n;
};
const dayKey = (d: any) => {
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
};

export type AgentReport = {
  range: { from: string; to: string };
  kpis: {
    callsTotal: number; callsConnected: number; callsVoicemail: number; partnerCheckins: number;
    leadsSent: number; leadsReceived: number; signedCases: number;
    visits: number; facilitiesVisited: number; hours: number;
    errandsTotal: number; errandsCompleted: number;
    rewardsTotal: number; rewardsAccepted: number; payoutTotal: number;
    frExpenseTotal: number; bdrExpenseTotal: number; expenseTotal: number;
  };
  series: { date: string; calls: number; visits: number; leads: number }[];
  detail: {
    calls: any[]; leads: any[]; visits: any[]; rewards: any[]; errands: any[]; expenses: any[];
  };
};

function emptyReport(from: Date, to: Date): AgentReport {
  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      callsTotal: 0, callsConnected: 0, callsVoicemail: 0, partnerCheckins: 0,
      leadsSent: 0, leadsReceived: 0, signedCases: 0,
      visits: 0, facilitiesVisited: 0, hours: 0,
      errandsTotal: 0, errandsCompleted: 0,
      rewardsTotal: 0, rewardsAccepted: 0, payoutTotal: 0,
      frExpenseTotal: 0, bdrExpenseTotal: 0, expenseTotal: 0,
    },
    series: [],
    detail: { calls: [], leads: [], visits: [], rewards: [], errands: [], expenses: [] },
  };
}

export async function getAgentReport(opts: { names?: string[]; from: Date; to: Date }): Promise<AgentReport> {
  const db = await getDb();
  const { names, from, to } = opts;
  if (!db) return emptyReport(from, to);

  const nameFilter = (col: any) => (names && names.length ? [inArray(col, names)] : []);

  const [calls, leads, visits, errands, rewards, frExp, bdrExp] = await Promise.all([
    db.select().from(contactLogs)
      .where(and(gte(contactLogs.contactDate, from), lte(contactLogs.contactDate, to), ...nameFilter(contactLogs.repName)))
      .orderBy(desc(contactLogs.contactDate)),
    db.select().from(facilityLeads)
      .where(and(gte(facilityLeads.leadDate, from), lte(facilityLeads.leadDate, to), ...nameFilter(facilityLeads.repName)))
      .orderBy(desc(facilityLeads.leadDate)),
    db.select().from(fieldVisits)
      .where(and(gte(fieldVisits.visitDate, from), lte(fieldVisits.visitDate, to), ...nameFilter(fieldVisits.agentName)))
      .orderBy(desc(fieldVisits.visitDate)),
    db.select().from(frErrands)
      .where(and(gte(frErrands.errandDate, from), lte(frErrands.errandDate, to), ...nameFilter(frErrands.agentName)))
      .orderBy(desc(frErrands.errandDate)),
    db.select().from(referralRewards)
      .where(and(gte(referralRewards.createdAt, from), lte(referralRewards.createdAt, to), ...nameFilter(referralRewards.agentName)))
      .orderBy(desc(referralRewards.createdAt)),
    db.select().from(frExpenses)
      .where(and(gte(frExpenses.expenseDate, from), lte(frExpenses.expenseDate, to), ...nameFilter(frExpenses.agentName)))
      .orderBy(desc(frExpenses.expenseDate)),
    db.select().from(bdrExpenses)
      .where(and(gte(bdrExpenses.expenseDate, from), lte(bdrExpenses.expenseDate, to), ...nameFilter(bdrExpenses.agentName)))
      .orderBy(desc(bdrExpenses.expenseDate)),
  ]);

  const callRows = (calls as any[]).filter((c) => c.contactType === "call");
  const frExpenseTotal = (frExp as any[]).reduce((s, e) => s + num(e.amount), 0);
  const bdrExpenseTotal = (bdrExp as any[]).reduce((s, e) => s + num(e.amount), 0);

  // Daily trend (calls / visits / leads)
  const seriesMap = new Map<string, { calls: number; visits: number; leads: number }>();
  const bump = (d: any, key: "calls" | "visits" | "leads") => {
    const k = dayKey(d);
    if (!k) return;
    const e = seriesMap.get(k) ?? { calls: 0, visits: 0, leads: 0 };
    e[key]++;
    seriesMap.set(k, e);
  };
  callRows.forEach((c) => bump(c.contactDate, "calls"));
  (visits as any[]).forEach((v) => bump(v.visitDate, "visits"));
  (leads as any[]).forEach((l) => bump(l.leadDate, "leads"));
  const series = Array.from(seriesMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      callsTotal: callRows.length,
      callsConnected: callRows.filter((c) => c.callResult === "connected").length,
      callsVoicemail: callRows.filter((c) => c.callResult === "voicemail").length,
      partnerCheckins: callRows.filter((c) => c.callType === "partner_checkin").length,
      leadsSent: (leads as any[]).filter((l) => l.direction === "sent_to_facility").length,
      leadsReceived: (leads as any[]).filter((l) => l.direction === "received_from_facility").length,
      signedCases: (leads as any[]).filter((l) => l.signedCase === 1).length,
      visits: (visits as any[]).length,
      facilitiesVisited: (visits as any[]).reduce((s, v) => s + (v.facilityCount ?? 0), 0),
      hours: (visits as any[]).reduce((s, v) => s + num(v.hoursWorked), 0),
      errandsTotal: (errands as any[]).length,
      errandsCompleted: (errands as any[]).filter((e) => e.status === "Completed").length,
      rewardsTotal: (rewards as any[]).length,
      rewardsAccepted: (rewards as any[]).filter((r) => r.status === "Accepted").length,
      payoutTotal: (rewards as any[]).filter((r) => r.status === "Accepted").reduce((s, r) => s + num(r.payoutAmount), 0),
      frExpenseTotal,
      bdrExpenseTotal,
      expenseTotal: frExpenseTotal + bdrExpenseTotal,
    },
    series,
    detail: {
      calls: callRows.map((c) => ({ date: c.contactDate, result: c.callResult, type: c.callType, duration: c.callDuration, rep: c.repName, summary: c.summary })),
      leads: (leads as any[]).map((l) => ({ date: l.leadDate, direction: l.direction, outcome: l.outcome, signed: l.signedCase === 1 ? "Yes" : "", area: l.clientArea, rep: l.repName })),
      visits: (visits as any[]).map((v) => ({ date: v.visitDate, agent: v.agentName, facilities: v.facilityCount, hours: v.hoursWorked, notes: v.notes })),
      rewards: (rewards as any[]).map((r) => ({ date: r.createdAt, agent: r.agentName, client: r.clientName, tier: r.clientTier, type: r.referralType, payout: num(r.payoutAmount), status: r.status, case: r.caseNumber })),
      errands: (errands as any[]).map((e) => ({ date: e.errandDate, agent: e.agentName, client: e.clientName, task: e.taskType, status: e.status })),
      expenses: [
        ...(frExp as any[]).map((e) => ({ date: e.expenseDate, agent: e.agentName, kind: "FR", store: e.store, reason: e.reason, amount: num(e.amount), card: e.cardType })),
        ...(bdrExp as any[]).map((e) => ({ date: e.expenseDate, agent: e.agentName, kind: "BDR", store: e.store, reason: e.reason, amount: num(e.amount), card: "" })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    },
  };
}
