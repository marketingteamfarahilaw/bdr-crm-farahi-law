/**
 * Team Reports — live replacements for the BDR/FR Excel workbooks:
 *   1. MTD Check-Ins & FR Visits   (MTD BDR CHECK-IN & FR VISIT REPORT.xlsx)
 *   2. Sign-Ups per Facility       (SIGN UPS PER FACILITY + FR Sign Ups vs Unique Facility sheets)
 *   3. New Facilities              (MTD NEW FACILITIES REPORT - BDR & FR.xlsx)
 *   4. Call Activity               (BDR Daily Calls Tracker.xlsx)
 *   5. Leads & Targets             (BDR_FR Leads Tracker.xlsx Summary/Dashboard)
 *
 * Same metrics and groupings as the workbooks, computed from CRM data, with
 * the Excel's known formula bugs fixed (totals that only summed the first few
 * rows, averages that skipped agents). All day-bucketing is America/Los_Angeles.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { contactLogs, facilities, fieldVisits, leadIntake } from "../drizzle/schema";

const LA = "America/Los_Angeles";
const dayKey = (d: Date | string) => formatInTimeZone(new Date(d), LA, "yyyy-MM-dd");
const monthKey = (d: Date | string) => formatInTimeZone(new Date(d), LA, "yyyy-MM");

const durToSec = (s: any) => {
  const str = String(s ?? "");
  const p = str.split(":").map((x) => parseInt(x, 10));
  if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) return p[0] * 60 + p[1];
  const n = parseInt(str, 10);
  return isNaN(n) ? 0 : n;
};

/** lead_intake.sud ("sign-up date") is free-text — normalize to a Date. */
const parseSud = (s?: string | null): Date | null => {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const us = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? 2000 + parseInt(us[3], 10) : parseInt(us[3], 10);
    const d = new Date(y, parseInt(us[1], 10) - 1, parseInt(us[2], 10), 12);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
};

const normOutcome = (s?: string | null) => String(s ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const isSigned = (o: string) => o === "signed" || o === "signed referred out" || o === "referral accepted";

export const TARGETS = {
  bdrCheckinsPerFacility: 4,
  bdrVisitsPerFacility: 2,
  frVisitsPerFacility: 4,
  frCheckinsPerFacility: 2,
  frMonthlySigned: 10,
  bdrMonthlySigned: 2,
  dailyHandleSec: 2.5 * 3600,
} as const;

type Range = { from: Date; to: Date };

// ─── 1. MTD Check-Ins & Visits ────────────────────────────────────────────────

export async function getCheckinVisitReport({ from, to }: Range) {
  const db = await getDb();
  if (!db) return null;

  const calls = await db
    .select({
      repName: contactLogs.repName, facilityId: contactLogs.facilityId,
      callType: contactLogs.callType, contactDate: contactLogs.contactDate,
      facilityName: facilities.name,
    })
    .from(contactLogs)
    .leftJoin(facilities, eq(contactLogs.facilityId, facilities.id))
    .where(and(
      eq(contactLogs.contactType, "call"),
      inArray(contactLogs.callType, ["bdr_checkin", "partner_checkin", "fr_checkin"]),
      gte(contactLogs.contactDate, from), lte(contactLogs.contactDate, to),
    ));

  const visits = await db.select().from(fieldVisits)
    .where(and(gte(fieldVisits.visitDate, from), lte(fieldVisits.visitDate, to)));

  const allFacilities = await db
    .select({ id: facilities.id, name: facilities.name, rep: facilities.assignedRepName, status: facilities.partnerStatus })
    .from(facilities);
  const bookSize = new Map<string, number>();           // rep (lowercase) → facility count
  const facilityOwner = new Map<string, string>();      // facility name (lowercase) → rep
  for (const f of allFacilities) {
    if (f.status === "do_not_use") continue;
    const rep = (f.rep ?? "").trim();
    if (!rep) continue;
    bookSize.set(rep.toLowerCase(), (bookSize.get(rep.toLowerCase()) ?? 0) + 1);
    facilityOwner.set((f.name ?? "").toLowerCase(), rep);
  }

  // rep → facility → { dates: Map<day, count> }
  type FacAct = { facility: string; checkins: Map<string, number>; visits: Map<string, number> };
  const build = (section: "bdr" | "fr") => new Map<string, Map<string, FacAct>>();
  const bdr = build("bdr"), fr = build("fr");

  const add = (map: Map<string, Map<string, FacAct>>, rep: string, fac: string, kind: "checkins" | "visits", day: string, n = 1) => {
    if (!rep || !fac) return;
    const r = map.get(rep) ?? new Map<string, FacAct>();
    const f = r.get(fac.toLowerCase()) ?? { facility: fac, checkins: new Map(), visits: new Map() };
    f[kind].set(day, (f[kind].get(day) ?? 0) + n);
    r.set(fac.toLowerCase(), f); map.set(rep, r);
  };

  for (const c of calls) {
    const rep = (c.repName ?? "").trim();
    const fac = c.facilityName ?? `#${c.facilityId}`;
    const day = dayKey(c.contactDate);
    if (c.callType === "fr_checkin") add(fr, rep, fac, "checkins", day);
    else add(bdr, rep, fac, "checkins", day);
  }
  for (const v of visits) {
    const day = dayKey(v.visitDate);
    const facs: Array<{ id?: number; name?: string }> = Array.isArray(v.facilitiesVisited) ? (v.facilitiesVisited as any) : [];
    for (const fv of facs) {
      const name = (fv?.name ?? "").trim();
      if (!name) continue;
      if (v.agentRole === "FR" || v.agentRole === "Manager") add(fr, v.agentName.trim(), name, "visits", day);
      // a visit also credits the owning BDR's facility row (the workbook's BDR "FR VISIT" columns)
      const owner = facilityOwner.get(name.toLowerCase());
      if (owner) add(bdr, owner, name, "visits", day);
    }
  }

  const serialize = (map: Map<string, Map<string, FacAct>>, slots: { checkins: number; visits: number }, targets: { checkins: number; visits: number }) => {
    const reps = Array.from(map.entries()).map(([rep, facs]) => {
      const rows = Array.from(facs.values()).map((f) => {
        const ck = Array.from(f.checkins.entries()).sort(([a], [b]) => a.localeCompare(b));
        const vs = Array.from(f.visits.entries()).sort(([a], [b]) => a.localeCompare(b));
        return {
          facility: f.facility,
          checkinSlots: ck.slice(0, slots.checkins).map(([date, count]) => ({ date, count })),
          checkinOverflow: Math.max(0, ck.length - slots.checkins),
          totalCheckins: ck.reduce((s, [, n]) => s + n, 0),
          visitSlots: vs.slice(0, slots.visits).map(([date, count]) => ({ date, count })),
          totalVisits: vs.reduce((s, [, n]) => s + n, 0),
        };
      }).sort((a, b) => b.totalCheckins + b.totalVisits - (a.totalCheckins + a.totalVisits));
      const totalCheckins = rows.reduce((s, r) => s + r.totalCheckins, 0);
      const totalVisits = rows.reduce((s, r) => s + r.totalVisits, 0);
      const book = bookSize.get(rep.toLowerCase()) ?? rows.length;
      return {
        rep, bookSize: book, facilitiesTouched: rows.length,
        totalCheckins, totalVisits,
        avgCheckins: book ? totalCheckins / book : 0,
        avgVisits: book ? totalVisits / book : 0,
        rows,
      };
    }).sort((a, b) => b.totalCheckins - a.totalCheckins);
    const sumBook = reps.reduce((s, r) => s + r.bookSize, 0);
    return {
      targets, reps,
      total: {
        bookSize: sumBook,
        totalCheckins: reps.reduce((s, r) => s + r.totalCheckins, 0),
        totalVisits: reps.reduce((s, r) => s + r.totalVisits, 0),
        avgCheckins: sumBook ? reps.reduce((s, r) => s + r.totalCheckins, 0) / sumBook : 0,
        avgVisits: sumBook ? reps.reduce((s, r) => s + r.totalVisits, 0) / sumBook : 0,
      },
    };
  };

  return {
    bdr: serialize(bdr, { checkins: 4, visits: 2 }, { checkins: TARGETS.bdrCheckinsPerFacility, visits: TARGETS.bdrVisitsPerFacility }),
    fr: serialize(fr, { checkins: 2, visits: 4 }, { checkins: TARGETS.frCheckinsPerFacility, visits: TARGETS.frVisitsPerFacility }),
  };
}

// ─── 2. Sign-Ups per facility / per tier / vs unique facilities ──────────────

export async function getSignupReport({ from, to }: Range) {
  const db = await getDb();
  if (!db) return null;
  // pull a generous window on leadDate, then re-window on effective (SUD) date
  const wide = new Date(from.getTime() - 120 * 86400000);
  const rows = await db.select().from(leadIntake)
    .where(and(gte(leadIntake.leadDate, wide), lte(leadIntake.leadDate, to)));

  const signed = rows.filter((r) => isSigned(normOutcome(r.outcome))).map((r) => {
    const eff = parseSud(r.sud) ?? (r.leadDate ? new Date(r.leadDate) : null);
    return { ...r, eff };
  }).filter((r) => r.eff && r.eff >= from && r.eff <= to);

  const tierOf = (v?: string | null) => {
    const t = String(v ?? "").toLowerCase().trim();
    if (t.startsWith("high")) return "high";
    if (t.startsWith("med")) return "medium";
    if (t.startsWith("low")) return "low";
    if (t.includes("rank")) return "rankX";
    return "unknown";
  };

  // View A: role → member → facility → month → tier counts
  type Cell = { high: number; medium: number; low: number; rankX: number; unknown: number; total: number };
  const blank = (): Cell => ({ high: 0, medium: 0, low: 0, rankX: 0, unknown: 0, total: 0 });
  const months = new Set<string>();
  const byFacility = new Map<string, { role: string; member: string; facility: string; months: Map<string, Cell>; total: Cell }>();
  // View B: member → facility counts
  const byMember = new Map<string, { role: string; member: string; total: number; facilities: Map<string, number> }>();

  for (const r of signed) {
    const role = String(r.role ?? "").toUpperCase().includes("FR") ? "FR" : "BDR";
    const member = String(r.member ?? "Unknown").trim() || "Unknown";
    const facility = String(r.facility ?? "").trim() || "Independent";
    const m = monthKey(r.eff!);
    months.add(m);
    const tier = tierOf(r.value);

    const fk = `${role}|${member.toLowerCase()}|${facility.toLowerCase()}`;
    const fe = byFacility.get(fk) ?? { role, member, facility, months: new Map(), total: blank() };
    const cell = fe.months.get(m) ?? blank();
    (cell as any)[tier]++; cell.total++;
    (fe.total as any)[tier]++; fe.total.total++;
    fe.months.set(m, cell); byFacility.set(fk, fe);

    const mk = `${role}|${member.toLowerCase()}`;
    const me = byMember.get(mk) ?? { role, member, total: 0, facilities: new Map() };
    me.total++; me.facilities.set(facility, (me.facilities.get(facility) ?? 0) + 1);
    byMember.set(mk, me);
  }

  return {
    months: Array.from(months).sort(),
    perFacility: Array.from(byFacility.values())
      .map((f) => ({ ...f, months: Object.fromEntries(f.months) }))
      .sort((a, b) => a.role.localeCompare(b.role) || a.member.localeCompare(b.member) || b.total.total - a.total.total),
    perMember: Array.from(byMember.values())
      .map((m) => ({
        role: m.role, member: m.member, total: m.total,
        uniqueFacilities: m.facilities.size,
        facilities: Array.from(m.facilities.entries()).map(([facility, count]) => ({ facility, count })).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => a.role.localeCompare(b.role) || b.total - a.total),
  };
}

// ─── 3. New Facilities ────────────────────────────────────────────────────────

export async function getNewFacilitiesReport(
  { from, to }: Range,
  opts: {
    /** Skip bulk-migrated rows (Filevine backfill) — they're data imports, not real month acquisitions. */
    excludeImports?: boolean;
    /** Restrict to these agents (full or first-name match). */
    agentNames?: string[] | null;
  } = {}
) {
  const db = await getDb();
  if (!db) return null;
  const all = await db
    .select({
      id: facilities.id, name: facilities.name, rep: facilities.assignedRepName,
      createdAt: facilities.createdAt, updatedAt: facilities.updatedAt, status: facilities.partnerStatus,
      notes: facilities.notes,
    })
    .from(facilities);

  const normS = (s: string) => s.toLowerCase().trim();
  const firstS = (s: string) => normS(s).split(/\s+/)[0] ?? "";
  const wanted = opts.agentNames?.map(normS).filter(Boolean) ?? null;
  const repMatches = (rep: string) => !wanted || wanted.some((w) => normS(rep) === w || firstS(rep) === firstS(w));

  // Bulk-load detection: ≥20 facilities created within the same minute is a data
  // import (initial seeding, migrations), not real acquisitions. Auto-excluded
  // from "added" alongside the tagged Filevine backfill.
  const minuteKey = (d: Date) => Math.floor(d.getTime() / 60000);
  const minuteCounts = new Map<number, number>();
  for (const f of all) { const k = minuteKey(new Date(f.createdAt)); minuteCounts.set(k, (minuteCounts.get(k) ?? 0) + 1); }
  const isBulkCreated = (d: Date) => (minuteCounts.get(minuteKey(d)) ?? 0) >= 20;

  const byRep = new Map<string, { rep: string; startCount: number; added: Array<{ id: number; name: string; date: string }>; droppedApprox: number; active: number }>();
  for (const f of all) {
    const rep = (f.rep ?? "Unassigned").trim() || "Unassigned";
    const e = byRep.get(rep.toLowerCase()) ?? { rep, startCount: 0, added: [], droppedApprox: 0, active: 0 };
    const created = new Date(f.createdAt);
    const isDropped = f.status === "do_not_use" || f.status === "dormant";
    const isImport = !!(f.notes && String(f.notes).startsWith("Imported from Filevine")) || isBulkCreated(created);
    if (!isDropped && f.status !== null) e.active++;
    if (created < from && !isDropped) e.startCount++;
    if (created >= from && created <= to && !(opts.excludeImports && isImport)) e.added.push({ id: f.id, name: f.name, date: dayKey(created) });
    if (isDropped && new Date(f.updatedAt) >= from && new Date(f.updatedAt) <= to && !(opts.excludeImports && isImport)) e.droppedApprox++;
    byRep.set(rep.toLowerCase(), e);
  }
  const reps = Array.from(byRep.values())
    .filter((r) => repMatches(r.rep))
    .map((r) => ({ ...r, added: r.added.sort((a, b) => a.date.localeCompare(b.date)), addedCount: r.added.length }))
    .filter((r) => r.active > 0 || r.addedCount > 0 || r.startCount > 0)
    .sort((a, b) => b.active - a.active);
  return {
    reps,
    total: {
      startCount: reps.reduce((s, r) => s + r.startCount, 0),
      addedCount: reps.reduce((s, r) => s + r.addedCount, 0),
      droppedApprox: reps.reduce((s, r) => s + r.droppedApprox, 0),
      active: reps.reduce((s, r) => s + r.active, 0),
    },
  };
}

// ─── 4. Call Activity (Daily Calls Tracker) ───────────────────────────────────

export async function getCallActivityReport({ from, to }: Range) {
  const db = await getDb();
  if (!db) return null;
  const calls = await db
    .select({
      repName: contactLogs.repName, contactDate: contactLogs.contactDate,
      callDuration: contactLogs.callDuration, callResult: contactLogs.callResult,
      callType: contactLogs.callType, direction: contactLogs.direction, summary: contactLogs.summary,
    })
    .from(contactLogs)
    .where(and(eq(contactLogs.contactType, "call"), gte(contactLogs.contactDate, from), lte(contactLogs.contactDate, to)));

  type AgentDay = { calls: number; sec: number; inbound: number; outbound: number; notConnected: number };
  const agents = new Map<string, Map<string, AgentDay>>();
  for (const c of calls) {
    if (c.callType === "internal") continue;
    const rep = (c.repName ?? "").trim();
    if (!rep) continue;
    const sec = durToSec(c.callDuration);
    const connectedish = sec >= 30; // the workbook's 30s floor for handle-time metrics
    const day = dayKey(c.contactDate);
    const dir = (c.direction ?? (/inbound/i.test(String(c.summary)) ? "Inbound" : "Outbound"));
    const m = agents.get(rep) ?? new Map<string, AgentDay>();
    const d = m.get(day) ?? { calls: 0, sec: 0, inbound: 0, outbound: 0, notConnected: 0 };
    if (connectedish) {
      d.calls++; d.sec += sec;
      if (dir === "Inbound") d.inbound++; else d.outbound++;
    } else d.notConnected++;
    m.set(day, d); agents.set(rep, m);
  }

  const perAgent = Array.from(agents.entries()).map(([rep, days]) => {
    const ds = Array.from(days.entries()).sort(([a], [b]) => a.localeCompare(b));
    const totalCalls = ds.reduce((s, [, d]) => s + d.calls, 0);
    const totalSec = ds.reduce((s, [, d]) => s + d.sec, 0);
    const activeDays = ds.filter(([, d]) => d.calls > 0).length;
    return {
      rep, totalCalls, totalSec, activeDays,
      inbound: ds.reduce((s, [, d]) => s + d.inbound, 0),
      outbound: ds.reduce((s, [, d]) => s + d.outbound, 0),
      notConnected: ds.reduce((s, [, d]) => s + d.notConnected, 0),
      avgCallsPerDay: activeDays ? totalCalls / activeDays : 0,
      avgDailySec: activeDays ? totalSec / activeDays : 0,
      balanceToTargetSec: TARGETS.dailyHandleSec - (activeDays ? totalSec / activeDays : 0),
      days: ds.map(([day, d]) => ({ day, ...d })),
    };
  }).sort((a, b) => b.totalSec - a.totalSec);

  const sumSec = perAgent.reduce((s, a) => s + a.totalSec, 0);
  const sumDays = perAgent.reduce((s, a) => s + a.activeDays, 0);
  return {
    targetDailySec: TARGETS.dailyHandleSec,
    perAgent,
    team: {
      totalCalls: perAgent.reduce((s, a) => s + a.totalCalls, 0),
      totalSec: sumSec,
      avgDailySec: sumDays ? sumSec / sumDays : 0, // weighted: ΣHT/Σdays (fixes the Excel's mixed methods)
      inbound: perAgent.reduce((s, a) => s + a.inbound, 0),
      outbound: perAgent.reduce((s, a) => s + a.outbound, 0),
    },
  };
}

// ─── 5. Leads & Targets ───────────────────────────────────────────────────────

export async function getLeadsTargetReport({ from, to }: Range) {
  const db = await getDb();
  if (!db) return null;
  const wide = new Date(from.getTime() - 120 * 86400000);
  const rows = await db.select().from(leadIntake)
    .where(and(gte(leadIntake.leadDate, wide), lte(leadIntake.leadDate, to)));

  // months in window (for prorating targets across multi-month ranges)
  const monthsInWindow = Math.max(1, Math.round((to.getTime() - from.getTime()) / (30.44 * 86400000)));

  type Row = {
    role: string; member: string; total: number; open: number; rejected: number; referredOut: number;
    notInterested: number; signedReferredOut: number; signedInHouse: number; totalSigned: number;
    signUpUnique: number; target: number;
  };
  const byMember = new Map<string, Row>();
  for (const r of rows) {
    const eff = parseSud(r.sud) ?? (r.leadDate ? new Date(r.leadDate) : null);
    const o = normOutcome(r.outcome);
    const signedNow = isSigned(o) && eff && eff >= from && eff <= to;
    const leadInWindow = r.leadDate && new Date(r.leadDate) >= from && new Date(r.leadDate) <= to;
    if (!leadInWindow && !signedNow) continue;

    const role = String(r.role ?? "").toUpperCase().includes("FR") ? "FR" : "BDR";
    const member = String(r.member ?? "Unknown").trim() || "Unknown";
    const k = `${role}|${member.toLowerCase()}`;
    const e = byMember.get(k) ?? {
      role, member, total: 0, open: 0, rejected: 0, referredOut: 0, notInterested: 0,
      signedReferredOut: 0, signedInHouse: 0, totalSigned: 0, signUpUnique: 0,
      target: (role === "FR" ? TARGETS.frMonthlySigned : TARGETS.bdrMonthlySigned) * monthsInWindow,
    };
    if (leadInWindow) {
      e.total++;
      if (o === "open" || o === "") e.open++;
      else if (o.startsWith("reject")) e.rejected++;
      else if (o === "referred out") e.referredOut++;
      else if (o.startsWith("not interested")) e.notInterested++;
    }
    if (signedNow) {
      if (o === "signed referred out") e.signedReferredOut++;
      else e.signedInHouse++;
      e.totalSigned++;
      if (String(r.classification ?? "").toLowerCase().trim() === "driver") e.signUpUnique++;
    }
    byMember.set(k, e);
  }

  const members = Array.from(byMember.values()).map((m) => ({
    ...m,
    achievedPct: m.target ? Math.round((m.totalSigned / m.target) * 100) : 0,
    conversionPct: m.total ? Math.round((m.totalSigned / m.total) * 100) : 0,
  })).sort((a, b) => a.role.localeCompare(b.role) || b.totalSigned - a.totalSigned);

  const roleTotal = (role: string) => {
    const list = members.filter((m) => m.role === role);
    const t = {
      role, member: "TOTAL",
      total: list.reduce((s, m) => s + m.total, 0),
      open: list.reduce((s, m) => s + m.open, 0),
      rejected: list.reduce((s, m) => s + m.rejected, 0),
      referredOut: list.reduce((s, m) => s + m.referredOut, 0),
      notInterested: list.reduce((s, m) => s + m.notInterested, 0),
      signedReferredOut: list.reduce((s, m) => s + m.signedReferredOut, 0),
      signedInHouse: list.reduce((s, m) => s + m.signedInHouse, 0),
      totalSigned: list.reduce((s, m) => s + m.totalSigned, 0),
      signUpUnique: list.reduce((s, m) => s + m.signUpUnique, 0),
      target: list.reduce((s, m) => s + m.target, 0),
    };
    return {
      ...t,
      achievedPct: t.target ? Math.round((t.totalSigned / t.target) * 100) : 0,   // weighted (Dashboard method)
      conversionPct: t.total ? Math.round((t.totalSigned / t.total) * 100) : 0,
    };
  };

  return { members, totals: { FR: roleTotal("FR"), BDR: roleTotal("BDR") } };
}
