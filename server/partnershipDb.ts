/**
 * Data layer for the FR/BDR Dual Partnership Model.
 * Pods, scheduled visits + briefings, QA reviews, the coordinated loop board,
 * shared-quota math, bonus-pool math, and partnership health scoring.
 */
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  pods,
  podAppointments,
  qaReviews,
  facilities,
  facilityLeads,
  contactLogs,
  fieldVisits,
  type InsertPod,
  type InsertPodAppointment,
  type InsertQaReview,
} from "../drizzle/schema";

const LOOP_STAGES = ["research", "first_contact", "appointment_set", "visited", "post_visit", "nurture"] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

// Month "YYYY-MM" → [start, end] Date range (UTC, matches DB timezone "Z").
export function monthRange(month?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [y, mo] = m.split("-").map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { start, end, label: m };
}

const names = (p: { frName?: string | null; bdrName?: string | null }) =>
  [p.frName, p.bdrName].filter((x): x is string => !!x && !!x.trim());

// ─── Pods ────────────────────────────────────────────────────────────────────
export async function listPods() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pods).orderBy(desc(pods.active), pods.name);
}
export async function getPod(id: number) {
  const db = await getDb();
  if (!db) return null;
  const r = await db.select().from(pods).where(eq(pods.id, id)).limit(1);
  return r[0] ?? null;
}
export async function createPod(data: InsertPod) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const r: any = await db.insert(pods).values(data);
  return r?.[0]?.insertId ?? r?.insertId ?? null;
}
export async function updatePod(id: number, data: Partial<InsertPod>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(pods).set({ ...data, updatedAt: new Date() }).where(eq(pods.id, id));
}
export async function deletePod(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(pods).where(eq(pods.id, id));
}

/** The pod an agent belongs to (matches FR, BDR, or QA Coach by name). */
export async function getPodForAgent(agentName?: string | null) {
  if (!agentName) return null;
  const all = await listPods();
  const a = agentName.toLowerCase().trim();
  return all.find((p) =>
    [p.frName, p.bdrName, p.qaCoachName].some((n) => (n ?? "").toLowerCase().trim() === a)
  ) ?? null;
}

// ─── Appointments (BDR schedules FR's visit + briefing) ───────────────────────
export async function listAppointments(opts: { podId?: number; frNames?: string[]; upcomingOnly?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (opts.podId) conds.push(eq(podAppointments.podId, opts.podId));
  if (opts.frNames?.length) conds.push(inArray(podAppointments.frName, opts.frNames));
  if (opts.upcomingOnly) conds.push(gte(podAppointments.scheduledFor, new Date(Date.now() - 86400000)));
  const q = db.select().from(podAppointments);
  if (conds.length) q.where(and(...conds));
  return q.orderBy(desc(podAppointments.scheduledFor)).limit(500);
}
export async function createAppointment(data: InsertPodAppointment) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const r: any = await db.insert(podAppointments).values(data);
  // Move the facility's loop stage forward when a visit is booked.
  if (data.facilityId) {
    await db.update(facilities).set({ loopStage: "appointment_set", updatedAt: new Date() }).where(eq(facilities.id, data.facilityId));
  }
  return r?.[0]?.insertId ?? r?.insertId ?? null;
}
export async function updateAppointment(id: number, data: Partial<InsertPodAppointment>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(podAppointments).set({ ...data, updatedAt: new Date() }).where(eq(podAppointments.id, id));
  // When a visit is marked attended, advance the facility to post-visit follow-up.
  if (data.status === "attended") {
    const row = await db.select({ facilityId: podAppointments.facilityId }).from(podAppointments).where(eq(podAppointments.id, id)).limit(1);
    const fid = row[0]?.facilityId;
    if (fid) await db.update(facilities).set({ loopStage: "post_visit", updatedAt: new Date() }).where(eq(facilities.id, fid));
  }
}

// ─── QA reviews ───────────────────────────────────────────────────────────────
export async function listQaReviews(opts: { podId?: number; limit?: number } = {}) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(qaReviews);
  if (opts.podId) q.where(eq(qaReviews.podId, opts.podId));
  return q.orderBy(desc(qaReviews.createdAt)).limit(opts.limit ?? 200);
}
export async function createQaReview(data: InsertQaReview) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const r: any = await db.insert(qaReviews).values(data);
  return r?.[0]?.insertId ?? r?.insertId ?? null;
}
/** Recent BDR/FR calls with content, for the QA queue — flags which are reviewed. */
export async function recentCallsForReview(opts: { repNames?: string[]; limit?: number } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(contactLogs.contactType, "call")];
  if (opts.repNames?.length) conds.push(inArray(contactLogs.repName, opts.repNames));
  const rows = await db.select({
    id: contactLogs.id, facilityId: contactLogs.facilityId, contactDate: contactLogs.contactDate,
    repName: contactLogs.repName, callResult: contactLogs.callResult, summary: contactLogs.summary,
  }).from(contactLogs).where(and(...conds)).orderBy(desc(contactLogs.contactDate)).limit(opts.limit ?? 60);
  const ids = rows.map((r) => r.id);
  let reviewed = new Set<number>();
  if (ids.length) {
    const rv = await db.select({ refId: qaReviews.refId }).from(qaReviews).where(and(eq(qaReviews.subjectType, "call"), inArray(qaReviews.refId, ids)));
    reviewed = new Set(rv.map((r) => r.refId!).filter(Boolean));
  }
  return rows.map((r) => ({ ...r, reviewed: reviewed.has(r.id) }));
}

// ─── Coordinated Loop board ───────────────────────────────────────────────────
export async function getLoopBoard(opts: { agentNames?: string[]; all?: boolean } = {}) {
  const db = await getDb();
  if (!db) return { stages: {} as Record<string, any[]>, counts: {} as Record<string, number> };
  const conds = [];
  if (!opts.all && opts.agentNames?.length) conds.push(inArray(facilities.assignedRepName, opts.agentNames));
  const q = db.select({
    id: facilities.id, name: facilities.name, category: facilities.category, city: facilities.city,
    assignedRepName: facilities.assignedRepName, loopStage: facilities.loopStage,
    visitRequested: facilities.visitRequested, lastContactDate: facilities.lastContactDate,
    partnerStatus: facilities.partnerStatus,
  }).from(facilities);
  if (conds.length) q.where(and(...conds));
  const rows = await q.limit(4000);
  const stages: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const s of LOOP_STAGES) { stages[s] = []; counts[s] = 0; }
  for (const r of rows) {
    const s = (r.loopStage ?? "research") as string;
    if (!stages[s]) { stages[s] = []; counts[s] = 0; }
    if (stages[s].length < 200) stages[s].push(r); // cap per column for payload size
    counts[s]++;
  }
  return { stages, counts };
}
export async function setLoopStage(facilityId: number, stage: LoopStage) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(facilities).set({ loopStage: stage, updatedAt: new Date() }).where(eq(facilities.id, facilityId));
}

// ─── Partner visit requests (§4) ──────────────────────────────────────────────
export async function setVisitRequested(facilityId: number, flag: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(facilities).set({ visitRequested: flag ? 1 : 0, updatedAt: new Date() }).where(eq(facilities.id, facilityId));
}
export async function listVisitRequests(opts: { agentNames?: string[]; all?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(facilities.visitRequested, 1)];
  if (!opts.all && opts.agentNames?.length) conds.push(inArray(facilities.assignedRepName, opts.agentNames));
  return db.select({
    id: facilities.id, name: facilities.name, category: facilities.category, city: facilities.city,
    phone: facilities.phone, assignedRepName: facilities.assignedRepName, loopStage: facilities.loopStage,
    lastContactDate: facilities.lastContactDate,
  }).from(facilities).where(and(...conds)).orderBy(desc(facilities.updatedAt)).limit(300);
}

// ─── Shared quota + bonus pool (§5, §6) ───────────────────────────────────────
/** Qualified leads = cases a partner referred TO the firm this month, by the pod's reps. */
async function podLeadStats(repNames: string[], start: Date, end: Date) {
  const db = await getDb();
  if (!db || !repNames.length) return { qualified: 0, signed: 0 };
  const rows = await db.select({ signedCase: facilityLeads.signedCase, outcome: facilityLeads.outcome })
    .from(facilityLeads)
    .where(and(
      eq(facilityLeads.direction, "received_from_facility"),
      inArray(facilityLeads.repName, repNames),
      gte(facilityLeads.leadDate, start),
      lte(facilityLeads.leadDate, end),
    ));
  let qualified = 0, signed = 0;
  for (const r of rows) {
    if (r.outcome !== "not_qualified" && r.outcome !== "duplicate") qualified++;
    if (r.signedCase === 1 || r.outcome === "signed") signed++;
  }
  return { qualified, signed };
}

export async function getQuotaSummary(month?: string) {
  const { start, end, label } = monthRange(month);
  const allPods = (await listPods()).filter((p) => p.active === 1);
  const dayOfMonth = new Date().getUTCDate();
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const monthFrac = Math.min(1, dayOfMonth / daysInMonth);

  const out = [];
  for (const p of allPods) {
    const reps = names(p);
    const { qualified, signed } = await podLeadStats(reps, start, end);
    const target = p.monthlyTarget || 12;
    const expected = Math.round(target * monthFrac);
    const pace = qualified >= expected ? "on_track" : qualified >= expected * 0.7 ? "slightly_behind" : "behind";
    out.push({
      podId: p.id, podName: p.name, region: p.region,
      frName: p.frName, bdrName: p.bdrName, qaCoachName: p.qaCoachName,
      target, qualified, signed, expected, pace,
      pctToTarget: target ? Math.round((qualified / target) * 100) : 0,
    });
  }
  return { month: label, monthFrac, pods: out };
}

// ─── Partnership health score (§8) ────────────────────────────────────────────
export async function getPodHealth(podId: number, month?: string) {
  const db = await getDb();
  const p = await getPod(podId);
  if (!db || !p) return null;
  const { start, end } = monthRange(month);
  const reps = names(p);

  // Appointments this month: attendance + briefing context
  const appts = await db.select({ status: podAppointments.status, briefing: podAppointments.briefing })
    .from(podAppointments).where(and(eq(podAppointments.podId, podId), gte(podAppointments.scheduledFor, start), lte(podAppointments.scheduledFor, end)));
  const past = appts.filter((a) => a.status !== "scheduled" && a.status !== "rescheduled");
  const attended = appts.filter((a) => a.status === "attended").length;
  const noShow = appts.filter((a) => a.status === "no_show").length;
  const withBriefing = appts.filter((a) => (a.briefing ?? "").trim().length > 10).length;
  const attendRate = past.length ? attended / past.length : null;
  const briefingRate = appts.length ? withBriefing / appts.length : null;

  // Communication cadence: any rep activity in the last 10 days
  let lastActivity: Date | null = null;
  if (reps.length) {
    const r = await db.select({ d: contactLogs.contactDate }).from(contactLogs)
      .where(inArray(contactLogs.repName, reps)).orderBy(desc(contactLogs.contactDate)).limit(1);
    lastActivity = r[0]?.d ?? null;
  }
  const daysSince = lastActivity ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000) : 999;

  // Lead pace
  const { qualified } = await podLeadStats(reps, start, end);
  const target = p.monthlyTarget || 12;
  const dayOfMonth = new Date().getUTCDate();
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const expected = target * (dayOfMonth / daysInMonth);
  const paceRatio = expected > 0 ? qualified / expected : 1;

  // QA breakdown flags this month
  const qa = await db.select({ flag: qaReviews.flag }).from(qaReviews)
    .where(and(eq(qaReviews.podId, podId), gte(qaReviews.createdAt, start), lte(qaReviews.createdAt, end)));
  const breakdownFlags = qa.filter((q) => q.flag === "breakdown").length;

  // Score 0-100
  let score = 100;
  const warnings: string[] = [];
  if (attendRate !== null && attendRate < 0.7) { score -= 25; warnings.push(`FR attended only ${Math.round(attendRate * 100)}% of booked visits`); }
  if (briefingRate !== null && briefingRate < 0.6) { score -= 15; warnings.push("Many visits booked without a briefing — FR arriving without context"); }
  if (noShow >= 2) { score -= 10; warnings.push(`${noShow} no-shows / late reschedules this month`); }
  if (daysSince > 10) { score -= 20; warnings.push(`No logged contact in ${daysSince} days — communication gap`); }
  if (paceRatio < 0.7) { score -= 20; warnings.push(`Behind on the shared quota (${qualified}/${target})`); }
  if (breakdownFlags > 0) { score -= 15 * breakdownFlags; warnings.push(`${breakdownFlags} QA "breakdown" flag(s)`); }
  score = Math.max(0, Math.min(100, score));
  const band = score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk";

  return {
    podId, score, band, warnings,
    metrics: { attended, noShow, attendRate, briefingRate, daysSinceContact: daysSince, qualified, target, paceRatio, breakdownFlags },
  };
}

// ─── Leadership rollup (§9) ────────────────────────────────────────────────────
export async function getLeadershipSummary(month?: string) {
  const quota = await getQuotaSummary(month);
  const withHealth = [];
  for (const pod of quota.pods) {
    const health = await getPodHealth(pod.podId, month);
    withHealth.push({ ...pod, health: health ? { score: health.score, band: health.band, warnings: health.warnings } : null });
  }
  const totals = withHealth.reduce(
    (a, p) => ({ target: a.target + p.target, qualified: a.qualified + p.qualified, signed: a.signed + p.signed }),
    { target: 0, qualified: 0, signed: 0 }
  );
  return { month: quota.month, pods: withHealth, totals };
}

// ─── BDR Desk — the office rep's daily cockpit ────────────────────────────────
/**
 * A prioritized call queue for a BDR: who to call next and WHY. Built from the
 * loop stage, the last contact date, scheduled visits, and partner requests.
 * One facility lands in its single highest-priority bucket.
 */
export async function getBdrQueue(opts: { agentNames?: string[]; all?: boolean } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (!opts.all && opts.agentNames?.length) conds.push(inArray(facilities.assignedRepName, opts.agentNames));
  const q = db.select({
    id: facilities.id, name: facilities.name, phone: facilities.phone, city: facilities.city,
    assignedRepName: facilities.assignedRepName, loopStage: facilities.loopStage,
    visitRequested: facilities.visitRequested, lastContactDate: facilities.lastContactDate, partnerStatus: facilities.partnerStatus,
  }).from(facilities);
  if (conds.length) q.where(and(...conds));
  const facs = await q.limit(4000);

  // Soonest upcoming scheduled visit per facility
  const appts = await db.select({ facilityId: podAppointments.facilityId, scheduledFor: podAppointments.scheduledFor })
    .from(podAppointments).where(and(eq(podAppointments.status, "scheduled"), gte(podAppointments.scheduledFor, new Date(Date.now() - 86400000))));
  const apptMap = new Map<number, Date>();
  for (const a of appts) if (a.facilityId && (!apptMap.has(a.facilityId) || new Date(a.scheduledFor) < apptMap.get(a.facilityId)!)) apptMap.set(a.facilityId, a.scheduledFor as Date);

  const now = Date.now();
  const daysSince = (d: any) => (d ? Math.floor((now - new Date(d).getTime()) / 86400000) : null);
  const queue: any[] = [];
  for (const f of facs) {
    const ds = daysSince(f.lastContactDate);
    const appt = apptMap.get(f.id) ?? null;
    let category: string | null = null, reason = "", priority = 99;
    if (f.loopStage === "post_visit") { category = "post_visit"; reason = "FR visited — follow up to reinforce the relationship"; priority = 1; }
    else if (appt) { category = "confirm_visit"; reason = "Upcoming visit — confirm with the partner"; priority = 2; }
    else if (f.visitRequested) { category = "visit_requested"; reason = "Partner asked for an in-person visit — book the FR"; priority = 2; }
    else if (f.partnerStatus === "active_partner" && (ds === null || ds >= 14)) { category = "gone_quiet"; reason = ds === null ? "Active partner — no contact logged yet" : `No contact in ${ds} days`; priority = 3; }
    else if ((f.loopStage === "research" || f.loopStage === "first_contact") && (ds === null || ds >= 7)) { category = "first_contact"; reason = "Introduce the firm — plant the seed"; priority = 4; }
    if (category) queue.push({ ...f, category, reason, priority, daysSince: ds, nextAppt: appt });
  }
  queue.sort((a, b) => a.priority - b.priority || (b.daysSince ?? -1) - (a.daysSince ?? -1));
  return queue.slice(0, 200);
}

/** The BDR's own activity scorecard. */
export async function getBdrScorecard(agentNames: string[], month?: string) {
  const db = await getDb();
  if (!db || !agentNames.length) return null;
  const { start, end } = monthRange(month);
  const startToday = new Date(); startToday.setUTCHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const calls = await db.select({ d: contactLogs.contactDate, res: contactLogs.callResult }).from(contactLogs)
    .where(and(inArray(contactLogs.repName, agentNames), eq(contactLogs.contactType, "call"), gte(contactLogs.contactDate, weekAgo)));
  let callsToday = 0, callsWeek = 0, connectedWeek = 0;
  for (const c of calls) { callsWeek++; if (c.res === "connected") connectedWeek++; if (new Date(c.d) >= startToday) callsToday++; }

  const appts = await db.select({ id: podAppointments.id }).from(podAppointments)
    .where(and(inArray(podAppointments.bdrName, agentNames), gte(podAppointments.createdAt, start), lte(podAppointments.createdAt, end)));
  const { qualified } = await podLeadStats(agentNames, start, end);

  return { callsToday, callsWeek, connectedWeek, connectRate: callsWeek ? Math.round((connectedWeek / callsWeek) * 100) : 0, apptsSet: appts.length, qualifiedLeads: qualified };
}

// ─── Pod coordination feed (§8 — spot misaligned messaging / gaps) ────────────
export async function getPodFeed(podId: number, limit = 60) {
  const db = await getDb();
  const p = await getPod(podId);
  if (!db || !p) return [];
  const reps = names(p);
  const events: any[] = [];

  if (reps.length) {
    const calls = await db.select({ id: contactLogs.id, when: contactLogs.contactDate, who: contactLogs.repName, facilityId: contactLogs.facilityId, summary: contactLogs.summary, callResult: contactLogs.callResult })
      .from(contactLogs).where(inArray(contactLogs.repName, reps)).orderBy(desc(contactLogs.contactDate)).limit(limit);
    for (const c of calls) events.push({ kind: "call", when: c.when, who: c.who, facilityId: c.facilityId, text: c.summary || `Call (${c.callResult ?? "—"})` });

    const visits = await db.select({ id: fieldVisits.id, when: fieldVisits.visitDate, who: fieldVisits.agentName, count: fieldVisits.facilityCount, notes: fieldVisits.notes })
      .from(fieldVisits).where(inArray(fieldVisits.agentName, reps)).orderBy(desc(fieldVisits.visitDate)).limit(limit);
    for (const v of visits) events.push({ kind: "visit", when: v.when, who: v.who, text: v.notes || `Field visit — ${v.count} facilities` });
  }

  const appts = await db.select({ id: podAppointments.id, when: podAppointments.scheduledFor, who: podAppointments.bdrName, fr: podAppointments.frName, facilityName: podAppointments.facilityName, briefing: podAppointments.briefing, status: podAppointments.status })
    .from(podAppointments).where(eq(podAppointments.podId, podId)).orderBy(desc(podAppointments.scheduledFor)).limit(limit);
  for (const a of appts) events.push({ kind: "appointment", when: a.when, who: a.who, text: `${a.status} visit @ ${a.facilityName ?? "facility"}${a.briefing ? ` — briefing: ${a.briefing.slice(0, 120)}` : ""}` });

  const qa = await db.select({ id: qaReviews.id, when: qaReviews.createdAt, who: qaReviews.reviewerName, flag: qaReviews.flag, notes: qaReviews.notes, subjectType: qaReviews.subjectType })
    .from(qaReviews).where(eq(qaReviews.podId, podId)).orderBy(desc(qaReviews.createdAt)).limit(limit);
  for (const q of qa) events.push({ kind: "qa", when: q.when, who: q.who, text: `QA ${q.subjectType} [${q.flag}] ${q.notes ?? ""}` });

  return events.filter((e) => e.when).sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, limit);
}
