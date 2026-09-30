/**
 * Admin Overview (/bdr/admin): the team's non-automated activity — field visits,
 * expenses, referral rewards, errands and referral-friendly referrals, all from
 * the Centralized BDR/FR sheet (the 8-hourly 'sheets' sync) — plus partner leads.
 *
 * Rebuilt 2026-09-29 (Youssef: "need to be accurate and graphs also"). The old
 * version (db.ts getBdrAdminDashboard) looked reps up by a typed list —
 * "Gracel", "Queenie", "Ally", "Miguel", "Rupert" — that matched none of the
 * stored full names, so every per-rep chart read zero and the Field Reps were
 * missing; it had no dates, put every reward in the month of the last sheet
 * import (createdAt), and bucketed months in the server's clock.
 *
 * Now: today's team from @shared/team (BDR and FR), names matched to it; former
 * reps together on one line; a date range; Pacific months; rewards dated by
 * their sign-up date (sud); and each dataset's latest entry, so a sheet that
 * stopped being filled in shows instead of looking like a quiet month.
 *
 * A date that's missing or can't be right (before 2020, after today — the sheet
 * has "3/23/0206" and errands in December 2026) puts a row in no month and no
 * date range, but it still counts in All time and is counted in `coverage.undated`
 * so it can be fixed in the sheet rather than silently vanish.
 */
import { formatInTimeZone } from "date-fns-tz";
import { getDb, getSetting } from "./db";
import { bdrExpenses, fieldVisits, frErrands, frExpenses, inboundLeads, referralRewards, referralTracker } from "../drizzle/schema";
import { CURRENT_TEAM, type TeamRole } from "@shared/team";

const TZ = "America/Los_Angeles";
const day = (d: Date | string | null | undefined) => (d ? formatInTimeZone(new Date(d), TZ, "yyyy-MM-dd") : null);
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/**
 * A reward's sign-up date as the sheet writes it: "2026-06-11", "6/11/2026" or
 * "6/11/26". One reward can cover several sign-ups ("3/4/2026 3/10/2026 6/2/2026");
 * it's dated by the last of them, when the batch was complete.
 */
export function sudDay(s?: string | null): string | null {
  const days = String(s ?? "").split(/[\s,;]+/).map((t) => {
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3].padStart(4, "0")}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  }).filter((d): d is string => !!d).sort();
  return days.length ? days[days.length - 1] : null;
}

/** A referral-tracker month as written ("May 2026") → "2026-05". */
export function monthKey(s?: string | null): string | null {
  const m = String(s ?? "").trim().toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  return m && MONTHS[m[1]] ? `${m[2]}-${MONTHS[m[1]]}` : null;
}

type Person = { name: string; role: TeamRole | "Former" | "Unassigned"; current: boolean };
const UNASSIGNED: Person = { name: "No rep named", role: "Unassigned", current: false };
const TEAM: { full: string; first: string; role: TeamRole }[] = (["FR", "BDR"] as TeamRole[])
  .flatMap((role) => CURRENT_TEAM[role].map((full) => ({ full, first: full.split(" ")[0].toLowerCase(), role })));

/**
 * Who a stored name is: "Lupe Campos", "Lupe" and the typo "Quee" are today's
 * team; anyone else is a former rep (or someone off the team), kept by name.
 */
export function whoIs(raw?: string | null): Person | null {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name || /^\(?unknown\)?$/i.test(name)) return null;
  const low = name.toLowerCase();
  const first = low.split(" ")[0];
  const hit = TEAM.find((t) => t.full.toLowerCase() === low)
    ?? TEAM.find((t) => t.first === first)
    ?? (first.length >= 3 ? TEAM.find((t) => t.first.startsWith(first)) : undefined);
  return hit ? { name: hit.full, role: hit.role, current: true } : { name, role: "Former", current: false };
}

const emptyRep = () => ({
  visits: 0, facilitiesVisited: 0, hours: 0, frExpenses: 0, bdrExpenses: 0, totalExpenses: 0,
  rewards: 0, rewardsPaid: 0, errands: 0, errandsCompleted: 0, referrals: 0, referralsSuccessful: 0,
});
type RepTotals = ReturnType<typeof emptyRep>;
const emptyMonth = (month: string) => ({ month, visits: 0, frExpenses: 0, bdrExpenses: 0, rewardsPaid: 0, errands: 0, referrals: 0, referralsSuccessful: 0 });

export type AdminRange = { from: string; to: string } | null;

export async function getAdminOverview(range: AdminRange) {
  const db = await getDb();
  if (!db) return null;
  const [visits, frExp, bdrExp, rewards, errands, trackers, inbound] = await Promise.all([
    db.select().from(fieldVisits),
    db.select().from(frExpenses),
    db.select().from(bdrExpenses),
    db.select().from(referralRewards),
    db.select().from(frErrands),
    db.select().from(referralTracker),
    db.select({ dateReceived: inboundLeads.dateReceived }).from(inboundLeads),
  ]);
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  // A date the sheet can't mean (typo'd year, or not yet happened) is no date.
  const sane = (d: string | null) => (d && d >= "2020-01-01" && d <= today ? d : null);
  // Undated rows are in no range — but All time is everything in the sheet.
  const inDay = (d: string | null) => (d ? !range || (d >= range.from && d <= range.to) : !range);
  const inMonth = (m: string | null) => (m ? !range || (m >= range.from.slice(0, 7) && m <= range.to.slice(0, 7)) : !range);

  const reps = new Map<string, { person: Person; t: RepTotals }>();
  const rep = (raw?: string | null) => {
    // Former reps share one line, as do rows with no rep; today's team each have their own.
    const p = whoIs(raw) ?? UNASSIGNED;
    const key = p.current ? p.name : p.role === "Former" ? "Former reps" : UNASSIGNED.name;
    if (!reps.has(key)) reps.set(key, { person: p.current || p === UNASSIGNED ? p : { name: "Former reps", role: "Former", current: false }, t: emptyRep() });
    return reps.get(key)!.t;
  };
  const months = new Map<string, ReturnType<typeof emptyMonth>>();
  const month = (d: string | null) => {
    if (!d) return emptyMonth(""); // an undated row counts in All time, in no month
    const k = d.slice(0, 7); if (!months.has(k)) months.set(k, emptyMonth(k)); return months.get(k)!;
  };
  const amount = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return Number.isFinite(n) ? n : 0; };
  const latest: Record<string, string | null> = {};
  const undated = { visits: 0, frExpenses: 0, bdrExpenses: 0, rewards: 0, errands: 0, referrals: 0 };
  const seen = (k: keyof typeof undated, d: string | null) => {
    if (!d) undated[k]++;
    else if (!latest[k] || d > latest[k]!) latest[k] = d;
  };
  const errandTypes = new Map<string, number>();
  const referralStatus = new Map<string, number>();
  const rewardTypes = new Map<string, { count: number; total: number }>();
  const k = { visits: 0, facilitiesVisited: 0, frExpenses: 0, bdrExpenses: 0, rewards: 0, rewardsPaid: 0, errands: 0, errandsCompleted: 0, referrals: 0, referralsSuccessful: 0, leadsFromPartners: 0 };

  for (const v of visits) {
    const d = sane(day(v.visitDate)); seen("visits", d);
    if (!inDay(d)) continue;
    const t = rep(v.agentName);
    k.visits++; k.facilitiesVisited += v.facilityCount ?? 0;
    month(d).visits++;
    t.visits++; t.facilitiesVisited += v.facilityCount ?? 0; t.hours += amount(v.hoursWorked);
  }
  for (const [rows, kind] of [[frExp, "fr"], [bdrExp, "bdr"]] as const) {
    for (const e of rows as any[]) {
      const d = sane(day(e.expenseDate)); seen(kind === "fr" ? "frExpenses" : "bdrExpenses", d);
      if (!inDay(d)) continue;
      const amt = amount(e.amount);
      const t = rep(e.agentName);
      if (kind === "fr") { k.frExpenses += amt; month(d).frExpenses += amt; t.frExpenses += amt; }
      else { k.bdrExpenses += amt; month(d).bdrExpenses += amt; t.bdrExpenses += amt; }
      t.totalExpenses += amt;
    }
  }
  for (const r of rewards) {
    const d = sane(sudDay(r.sud)); seen("rewards", d);
    if (!inDay(d)) continue;
    const paid = amount(r.payoutAmount);
    const t = rep(r.agentName);
    k.rewards++; k.rewardsPaid += paid; month(d).rewardsPaid += paid;
    t.rewards++; t.rewardsPaid += paid;
    const type = (r.referralType ?? "").trim() || "Other";
    const rt = rewardTypes.get(type) ?? { count: 0, total: 0 };
    rt.count++; rt.total += paid; rewardTypes.set(type, rt);
  }
  for (const e of errands) {
    const d = sane(day(e.errandDate)); seen("errands", d);
    if (!inDay(d)) continue;
    const done = e.status === "Completed";
    const t = rep(e.agentName);
    k.errands++; if (done) k.errandsCompleted++;
    month(d).errands++;
    t.errands++; if (done) t.errandsCompleted++;
    const type = (e.taskType ?? "").trim() || "Other";
    errandTypes.set(type, (errandTypes.get(type) ?? 0) + 1);
  }
  for (const r of trackers) {
    // The tracker has months, not days: its "latest" is a month ("2026-03").
    const m0 = monthKey(r.month), m = m0 && sane(`${m0}-01`) ? m0 : null; seen("referrals", m);
    if (!inMonth(m)) continue;
    const ok = r.status === "Successful Sent";
    const t = rep(r.bdrAssigned);
    k.referrals++; if (ok) k.referralsSuccessful++;
    const mm = month(m && `${m}-01`); mm.referrals++; if (ok) mm.referralsSuccessful++;
    t.referrals++; if (ok) t.referralsSuccessful++;
    referralStatus.set(r.status, (referralStatus.get(r.status) ?? 0) + 1);
  }
  for (const l of inbound) if (inDay(day(l.dateReceived))) k.leadsFromPartners++;

  // Every month of the range shows, even a quiet one; all time runs from the first entry to today.
  const keys = Array.from(months.keys()).sort();
  const span = range ? [range.from, range.to] : keys.length ? [`${keys[0]}-01`, today] : null;
  if (span) {
    const [y0, m0] = span[0].split("-").map(Number), [y1, m1] = span[1].split("-").map(Number);
    for (let i = y0 * 12 + m0 - 1; i <= y1 * 12 + m1 - 1; i++) month(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const order = (p: Person) => ({ FR: 0, BDR: 1, Former: 2, Unassigned: 3 } as Record<string, number>)[p.role] ?? 2;
  // Today's whole team always shows, with zeros where there's nothing yet.
  for (const t of TEAM) if (!reps.has(t.full)) reps.set(t.full, { person: { name: t.full, role: t.role, current: true }, t: emptyRep() });
  const byRep = Array.from(reps.values())
    .sort((a, b) => order(a.person) - order(b.person) || a.person.name.localeCompare(b.person.name))
    .map(({ person, t }) => ({ rep: person.name, role: person.role, current: person.current, ...t,
      frExpenses: round2(t.frExpenses), bdrExpenses: round2(t.bdrExpenses), totalExpenses: round2(t.totalExpenses), rewardsPaid: round2(t.rewardsPaid), hours: round2(t.hours) }));

  const sheets = await getSetting("sync_status_sheets").catch(() => null);
  let sheetsSyncedAt: string | null = null;
  try { sheetsSyncedAt = sheets ? JSON.parse(sheets).lastSuccessAt ?? null : null; } catch { /* no status yet */ }

  return {
    range,
    kpis: {
      ...k,
      frExpenses: round2(k.frExpenses), bdrExpenses: round2(k.bdrExpenses),
      totalExpenses: round2(k.frExpenses + k.bdrExpenses), rewardsPaid: round2(k.rewardsPaid),
      activeReps: byRep.filter((r) => r.current && (r.visits || r.totalExpenses || r.rewards || r.errands || r.referrals)).length,
    },
    byRep,
    byMonth: Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, frExpenses: round2(m.frExpenses), bdrExpenses: round2(m.bdrExpenses), rewardsPaid: round2(m.rewardsPaid) })),
    byErrandType: Array.from(errandTypes, ([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    byReferralStatus: Array.from(referralStatus, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    byRewardType: Array.from(rewardTypes, ([type, v]) => ({ type, count: v.count, total: round2(v.total) })).sort((a, b) => b.total - a.total),
    /** The newest entry in each dataset (referrals: a month), and how many rows have no usable date. */
    coverage: { latest, undated, sheetsSyncedAt, today },
  };
}
