/**
 * Daily Work View — "what do I work on right now". Aggregates the six action
 * queues + integration health from existing data. Scoped: agents see their own
 * book; managers see everything.
 */
import { and, asc, desc, eq, lte, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, getSetting } from "./db";
import {
  facilities, facilityTasks, frExpenses, bdrExpenses, rcUnmatchedCalls,
  referralTracker, pdReferrals,
} from "../drizzle/schema";

type Scope = { all?: boolean; agentNames?: string[] };
const namesOf = (s: Scope) => (s.all ? null : (s.agentNames ?? []).filter(Boolean));

export async function getDailyWork(scope: Scope) {
  const db = await getDb();
  if (!db) return null;
  const names = namesOf(scope);
  const now = new Date();
  const cutoff14 = new Date(now.getTime() - 14 * 86400000);
  const inNames = (col: any) => (names && names.length ? inArray(col, names) : undefined);

  // 1) Partners overdue for contact (>14d), longest gap first
  const opConds: any[] = [
    inArray(facilities.partnerStatus, ["active_partner", "priority_partner", "needs_follow_up"]),
    or(isNull(facilities.lastContactDate), lte(facilities.lastContactDate, cutoff14)),
  ];
  if (names && names.length) opConds.push(inArray(facilities.assignedRepName, names));
  const overduePartners = await db.select({
    id: facilities.id, name: facilities.name, category: facilities.category, city: facilities.city,
    phone: facilities.phone, assignedRepName: facilities.assignedRepName, lastContactDate: facilities.lastContactDate, partnerStatus: facilities.partnerStatus,
  }).from(facilities).where(and(...opConds)).orderBy(asc(facilities.lastContactDate)).limit(40);

  // 2) Tasks due today or overdue (open / in progress)
  const dueTasks = await db.select({
    id: facilityTasks.id, facilityId: facilityTasks.facilityId, facilityName: facilities.name,
    title: facilityTasks.title, dueDate: facilityTasks.dueDate, status: facilityTasks.status,
    priority: facilityTasks.priority, assignedToName: facilityTasks.assignedToName,
  }).from(facilityTasks).leftJoin(facilities, eq(facilityTasks.facilityId, facilities.id))
    .where(and(inArray(facilityTasks.status, ["open", "in_progress"]), lte(facilityTasks.dueDate, now), ...(names && names.length ? [inArray(facilityTasks.assignedToName, names)] : [])))
    .orderBy(asc(facilityTasks.dueDate)).limit(60);

  // 3) Pending expenses (FR + BDR), reimbursement not yet submitted/approved
  const frPending = await db.select({ id: frExpenses.id, amount: frExpenses.amount, facilityName: frExpenses.facilityName, store: frExpenses.store, expenseDate: frExpenses.expenseDate, agentName: frExpenses.agentName })
    .from(frExpenses).where(and(eq(frExpenses.reimbursementStatus, "pending"), ...(names && names.length ? [inArray(frExpenses.agentName, names)] : []))).orderBy(desc(frExpenses.expenseDate)).limit(50);
  const bdrPending = await db.select({ id: bdrExpenses.id, amount: bdrExpenses.amount, facilityName: bdrExpenses.facilityName, store: bdrExpenses.store, expenseDate: bdrExpenses.expenseDate, agentName: bdrExpenses.agentName })
    .from(bdrExpenses).where(and(eq(bdrExpenses.reimbursementStatus, "pending"), ...(names && names.length ? [inArray(bdrExpenses.agentName, names)] : []))).orderBy(desc(bdrExpenses.expenseDate)).limit(50);
  const pendingExpenses = [...frPending.map((e) => ({ ...e, kind: "FR" })), ...bdrPending.map((e) => ({ ...e, kind: "BDR" }))]
    .sort((a, b) => new Date(b.expenseDate ?? 0).getTime() - new Date(a.expenseDate ?? 0).getTime());
  const pendingExpenseTotal = pendingExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  // 4) Unmatched RingCentral calls awaiting partner assignment
  const ucConds: any[] = [eq(rcUnmatchedCalls.status, "unassigned")];
  if (names && names.length) ucConds.push(inArray(rcUnmatchedCalls.agentName, names));
  const unmatchedCalls = await db.select().from(rcUnmatchedCalls).where(and(...ucConds)).orderBy(desc(rcUnmatchedCalls.startTime)).limit(40);

  // 5) Chiro cases awaiting assignment (referral tracker, Pending)
  const chiroConds: any[] = [eq(referralTracker.status, "Pending")];
  if (names && names.length) chiroConds.push(inArray(referralTracker.bdrAssigned, names));
  const chiroAwaiting = await db.select({ id: referralTracker.id, clientName: referralTracker.clientName, facilityName: referralTracker.facilityName, facilityType: referralTracker.facilityType, bdrAssigned: referralTracker.bdrAssigned, month: referralTracker.month })
    .from(referralTracker).where(and(...chiroConds)).orderBy(desc(referralTracker.createdAt)).limit(40);

  // 6) PD cars awaiting a status update (new / waiting on liability)
  const pdConds: any[] = [inArray(pdReferrals.status, ["new_case", "waiting_liability"])];
  if (names && names.length) pdConds.push(inArray(pdReferrals.assignedRepName, names));
  const pdAwaiting = await db.select({ id: pdReferrals.id, clientName: pdReferrals.clientName, caseNumber: pdReferrals.caseNumber, vehicleInfo: pdReferrals.vehicleInfo, status: pdReferrals.status })
    .from(pdReferrals).where(and(...pdConds)).orderBy(desc(pdReferrals.updatedAt)).limit(40);

  return {
    overduePartners, dueTasks, pendingExpenses, pendingExpenseTotal, unmatchedCalls, chiroAwaiting, pdAwaiting,
    counts: {
      overduePartners: overduePartners.length, dueTasks: dueTasks.length, pendingExpenses: pendingExpenses.length,
      unmatchedCalls: unmatchedCalls.length, chiroAwaiting: chiroAwaiting.length, pdAwaiting: pdAwaiting.length,
    },
  };
}

export async function getIntegrationHealth(agents: Array<{ name: string | null; lastSyncAt: Date | null; connected: boolean }>) {
  const db = await getDb();
  const connected = agents.filter((a) => a.connected);
  const lastSync = connected.map((a) => a.lastSyncAt).filter(Boolean).sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? null;
  let unmatchedCount = 0;
  if (db) { const rows: any[] = await db.select({ n: sql<number>`COUNT(*)` }).from(rcUnmatchedCalls).where(eq(rcUnmatchedCalls.status, "unassigned")); unmatchedCount = Number(rows[0]?.n ?? 0); }
  const fvUrl = (await getSetting("filevine_webhook_url")) || process.env.FILEVINE_WEBHOOK_URL || null;
  return {
    ringcentral: {
      connectedAgents: connected.length, totalAgents: agents.length, lastSync,
      unmatchedCalls: unmatchedCount,
      staleAgents: connected.filter((a) => !a.lastSyncAt || new Date(a.lastSyncAt) < new Date(Date.now() - 24 * 3600000)).map((a) => a.name),
    },
    filevine: {
      configured: !!fvUrl,
      lastPushAt: await getSetting("filevine_last_push_at"),
      lastStatus: await getSetting("filevine_last_push_status"),
      lastError: await getSetting("filevine_last_error"),
    },
  };
}
