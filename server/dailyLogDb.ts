/**
 * Daily Activity Log — aggregates everything that happened on a given day from
 * the existing activity tables (calls + transcripts, field visits, leads &
 * referrals, completed tasks, facility notes, gratitude actions, pod meetings/
 * visits) and rolls it up two ways: BY PERSON and BY FACILITY. Read-only; it
 * archives nothing new — every day is recomputed from source so history is
 * always accurate. Days are bucketed in America/Los_Angeles time.
 */
import { and, gte, lte, inArray, eq, desc } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import {
  contactLogs, fieldVisits, facilityLeads, facilityTasks, facilityUpdates,
  facilityGratitude, facilityReferrals, podAppointments, facilities,
} from "../drizzle/schema";

const LA = "America/Los_Angeles";
export const todayLA = () => formatInTimeZone(new Date(), LA, "yyyy-MM-dd");
const dayWindow = (dateStr: string) => ({
  start: fromZonedTime(`${dateStr} 00:00:00`, LA),
  end: fromZonedTime(`${dateStr} 23:59:59.999`, LA),
});

type Ev = { kind: string; when: Date; who: string; facilityId: number | null; facilityName: string | null; detail: string };

const CONTACT_KIND: Record<string, string> = { call: "call", visit: "visit", meeting: "meeting", email: "email", text: "text", other: "contact" };

export async function getDailyLog(dateStr: string, scope: { agentNames?: string[]; all?: boolean } = {}) {
  const db = await getDb();
  if (!db) return { date: dateStr, byPerson: [], byFacility: [], totals: {} };
  const { start, end } = dayWindow(dateStr);
  const names = scope.all ? null : (scope.agentNames ?? []).filter(Boolean);
  const scoped = (col: any) => (names && names.length ? inArray(col, names) : undefined);

  const facRows = await db.select({ id: facilities.id, name: facilities.name }).from(facilities);
  const facName = new Map(facRows.map((f) => [f.id, f.name]));
  const nm = (id: number | null | undefined) => (id ? facName.get(id) ?? null : null);

  const events: Ev[] = [];
  const W = (col: any, extra?: any) => and(gte(col, start), lte(col, end), ...(extra ? [extra] : []));

  // Calls / visits / meetings / emails (contact_logs — includes RingCentral + AI summaries)
  for (const r of await db.select().from(contactLogs).where(W(contactLogs.contactDate, scoped(contactLogs.repName)))) {
    events.push({ kind: CONTACT_KIND[r.contactType] ?? "contact", when: r.contactDate as Date, who: r.repName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: r.summary || `${r.callResult ?? "call"}${r.callType ? ` · ${r.callType}` : ""}` });
  }
  // Field visits (FR daily log)
  for (const r of await db.select().from(fieldVisits).where(W(fieldVisits.visitDate, scoped(fieldVisits.agentName)))) {
    events.push({ kind: "visit", when: r.visitDate as Date, who: r.agentName ?? "—", facilityId: null, facilityName: null, detail: r.notes || `Field visit — ${r.facilityCount ?? 0} facilities${r.hoursWorked ? ` (${r.hoursWorked}h)` : ""}` });
  }
  // Leads received / referrals sent (facility_leads V3)
  for (const r of await db.select().from(facilityLeads).where(W(facilityLeads.leadDate, scoped(facilityLeads.repName)))) {
    const sent = r.direction === "sent_to_facility";
    events.push({ kind: sent ? "referral_sent" : "lead_received", when: r.leadDate as Date, who: r.repName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: `${sent ? "Referral sent" : "Lead received"}${r.contactPerson ? ` · ${r.contactPerson}` : ""}${r.outcome && r.outcome !== "pending" ? ` · ${r.outcome}` : ""}${r.signedCase ? " · SIGNED" : ""}` });
  }
  // Completed tasks
  for (const r of await db.select().from(facilityTasks).where(W(facilityTasks.completedAt, scoped(facilityTasks.assignedToName)))) {
    events.push({ kind: "task_completed", when: r.completedAt as Date, who: r.assignedToName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: `Task done: ${r.title}` });
  }
  // Facility notes / updates / transcripts
  for (const r of await db.select().from(facilityUpdates).where(W(facilityUpdates.updateDate, scoped(facilityUpdates.repName)))) {
    events.push({ kind: "note", when: r.updateDate as Date, who: r.repName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: r.summary || `${r.updateType ?? "note"} added` });
  }
  // Gratitude / relationship actions
  for (const r of await db.select().from(facilityGratitude).where(W(facilityGratitude.actionDate, scoped(facilityGratitude.repName)))) {
    events.push({ kind: "gratitude", when: r.actionDate as Date, who: r.repName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: `${r.actionType}${r.amount ? ` ($${r.amount})` : ""}` });
  }
  // Referrals received (legacy table)
  for (const r of await db.select().from(facilityReferrals).where(W(facilityReferrals.referralDate, scoped(facilityReferrals.repName)))) {
    events.push({ kind: "lead_received", when: r.referralDate as Date, who: r.repName ?? "—", facilityId: r.facilityId, facilityName: nm(r.facilityId), detail: `Referral received${r.clientName ? ` · ${r.clientName}` : ""}` });
  }
  // Pod meetings / scheduled visits attended (filtered by who below)
  for (const r of await db.select().from(podAppointments).where(W(podAppointments.scheduledFor))) {
    const who = r.frName || r.bdrName || r.createdByName || "—";
    if (names && names.length && !names.includes(who)) continue;
    const completed = r.status === "attended";
    const kind = r.type === "meeting" || r.type === "lunch" ? "meeting" : "visit";
    events.push({ kind, when: r.scheduledFor as Date, who, facilityId: r.facilityId, facilityName: r.facilityName ?? nm(r.facilityId), detail: `${completed ? "Completed" : r.status} ${r.type}${r.outcome ? ` · ${r.outcome}` : r.briefing ? ` · ${String(r.briefing).slice(0, 80)}` : ""}` });
  }

  events.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());

  // Open tasks (pending) as of end-of-day, for carry-over
  const openTasks = await db.select().from(facilityTasks).where(and(eq(facilityTasks.status, "open"), lte(facilityTasks.createdAt, end), ...(names && names.length ? [inArray(facilityTasks.assignedToName, names)] : [])));

  // ── Roll up BY PERSON ──
  const persons = new Map<string, any>();
  const ensure = (who: string) => { if (!persons.has(who)) persons.set(who, { person: who, calls: 0, facilitiesContacted: new Set(), meetings: 0, visits: 0, notesAdded: 0, referralsSent: 0, leadsReceived: 0, tasksCompleted: 0, pendingFollowUps: 0, events: [] }); return persons.get(who); };
  for (const e of events) {
    const p = ensure(e.who);
    p.events.push(e);
    if (e.kind === "call") p.calls++;
    if (["call", "visit", "meeting", "email", "text", "contact"].includes(e.kind) && e.facilityId) p.facilitiesContacted.add(e.facilityId);
    if (e.kind === "meeting") p.meetings++;
    if (e.kind === "visit") p.visits++;
    if (e.kind === "note") p.notesAdded++;
    if (e.kind === "referral_sent") p.referralsSent++;
    if (e.kind === "lead_received") p.leadsReceived++;
    if (e.kind === "task_completed") p.tasksCompleted++;
  }
  // "carried over" = open tasks that are due or overdue as of this day
  for (const t of openTasks) { const who = t.assignedToName ?? ""; const due = t.dueDate && new Date(t.dueDate) <= end; if (due && persons.has(who)) persons.get(who).pendingFollowUps++; }
  const byPerson = Array.from(persons.values()).map((p) => ({ ...p, facilitiesContacted: p.facilitiesContacted.size, events: p.events })).sort((a, b) => (b.calls + b.visits + b.meetings + b.notesAdded) - (a.calls + a.visits + a.meetings + a.notesAdded));

  // ── Roll up BY FACILITY ──
  const openByFac = new Map<number, string[]>();
  for (const t of openTasks) { if (!t.facilityId) continue; if (!openByFac.has(t.facilityId)) openByFac.set(t.facilityId, []); openByFac.get(t.facilityId)!.push(t.title); }
  const facs = new Map<number, any>();
  for (const e of events) {
    if (!e.facilityId) continue;
    if (!facs.has(e.facilityId)) facs.set(e.facilityId, { facilityId: e.facilityId, facilityName: e.facilityName, events: [], lastContacted: null, lastSummary: null, lastVisit: null, latestAction: null, pendingFollowUp: null });
    const f = facs.get(e.facilityId);
    f.events.push(e);
    if (["call", "visit", "meeting", "email", "text", "contact"].includes(e.kind)) { f.lastContacted = e.when; f.lastSummary = e.detail; }
    if (e.kind === "visit" || (e.kind === "meeting")) f.lastVisit = e.when;
    f.latestAction = `${e.who}: ${e.detail}`;
  }
  facs.forEach((f, fid) => { const open = openByFac.get(fid); if (open?.length) f.pendingFollowUp = open.slice(0, 3).join("; "); });
  const byFacility = Array.from(facs.values()).sort((a, b) => new Date(b.lastContacted ?? 0).getTime() - new Date(a.lastContacted ?? 0).getTime());

  const totals = {
    peopleActive: byPerson.length,
    facilitiesTouched: byFacility.length,
    calls: events.filter((e) => e.kind === "call").length,
    visits: events.filter((e) => e.kind === "visit").length,
    meetings: events.filter((e) => e.kind === "meeting").length,
    notes: events.filter((e) => e.kind === "note").length,
    referralsSent: events.filter((e) => e.kind === "referral_sent").length,
    leadsReceived: events.filter((e) => e.kind === "lead_received").length,
    tasksCompleted: events.filter((e) => e.kind === "task_completed").length,
    pending: openTasks.length,
  };

  return { date: dateStr, byPerson, byFacility, totals };
}

/** Dates (LA) with any logged activity, most-recent first — for the archive picker. */
export async function getActiveDates(scope: { agentNames?: string[]; all?: boolean } = {}, days = 120) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 86400000);
  const names = scope.all ? null : (scope.agentNames ?? []).filter(Boolean);
  const counts = new Map<string, number>();
  const add = (d: any) => { if (!d) return; const k = formatInTimeZone(new Date(d), LA, "yyyy-MM-dd"); counts.set(k, (counts.get(k) ?? 0) + 1); };
  const cl = await db.select({ d: contactLogs.contactDate }).from(contactLogs).where(and(gte(contactLogs.contactDate, since), ...(names && names.length ? [inArray(contactLogs.repName, names)] : [])));
  for (const r of cl) add(r.d);
  const fv = await db.select({ d: fieldVisits.visitDate }).from(fieldVisits).where(and(gte(fieldVisits.visitDate, since), ...(names && names.length ? [inArray(fieldVisits.agentName, names)] : [])));
  for (const r of fv) add(r.d);
  return Array.from(counts.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : -1));
}
