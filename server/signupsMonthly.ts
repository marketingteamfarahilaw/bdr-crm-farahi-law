/**
 * Monthly leads summary for the Sign-ups Report — the team's "2026 Monthly
 * leads summary" sheet, rebuilt from Lead Docket (Youssef, 2026-09-28: "i want
 * that looks like this but we dont have access to domo only lead docket and
 * filevine"). One table per role, a column per month: leads, how many name
 * their referring partner (in place of the sheet's "Leads in DOMO"), qualified
 * and quality leads, sign-ups, and the rates between them.
 *
 * Months follow the rest of the report: a lead counts in the Pacific month of
 * its leadDate, which is the day it signed for a signed lead and the day it
 * came in otherwise — so a month's leads, scorecard and summary all agree.
 *
 * Qualified and quality follow the firm's intake rules (server/intakeAI.ts):
 * qualified is an accepted personal-injury case type; quality is qualified with
 * property damage, injuries and treatment, and no gap in treatment. Lead Docket
 * doesn't hold those answers, so quality is an estimate (Youssef chose this):
 * a qualified lead counts unless intake turned it down for one of them.
 */
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { leadIntake } from "../drizzle/schema";
import { isCurrentRep } from "@shared/team";
import { isNonReportingRep } from "@shared/permissions";
import { isSigned, type SignupsFilter } from "./signupsReport";

const TZ = "America/Los_Angeles";

/** Lead Docket case types the firm accepts: Auto, Semi / 18 Wheeler, Slip and Fall… */
const QUALIFIED_TYPE = /^(auto|motorcycle|bicycle|pedestrian|semi|truck|slip and fall|trip and fall|dog bite|personal injury|wrongful death|premises|product liability)\b/i;
/** A turned-down lead whose reason says it isn't a personal-injury case after all, whatever its case type. */
const NOT_PI_REASON = /not a pi case|employment law|work comp|med mal|medical malpractice|criminal law|family law|civil law|general inquiry|immigration|tenant landlord|defamation/i;
/** Turned down for a quality criterion: no injuries, property damage only, no treatment, or a gap in treatment. */
const NOT_QUALITY_REASON = /no injur|minimal pd|pd only|no treatment|gap in treatment/i;

export type MonthlyLead = { outcome: string | null; classification: string | null; disposition: string | null; facility: string | null };

/** Where one lead lands in the summary. Sign-ups are judged by case type only: their sub-statuses are paperwork steps. */
export function classifyLead(l: MonthlyLead) {
  const signed = isSigned(l.outcome);
  const reason = signed ? "" : String(l.disposition ?? "");
  const qualified = QUALIFIED_TYPE.test(String(l.classification ?? "").trim()) && !NOT_PI_REASON.test(reason);
  const pdOnly = !signed && /^rejected\s*-\s*pd/i.test(String(l.outcome ?? ""));
  const quality = qualified && !pdOnly && !NOT_QUALITY_REASON.test(reason);
  const referral = String(l.outcome ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim() === "signed referred out";
  return {
    signed: signed && !referral,
    signedReferral: signed && referral,
    qualified,
    quality,
    partnerNamed: !!String(l.facility ?? "").trim(),
  };
}

export type MonthCounts = { leads: number; partnerNamed: number; qualified: number; quality: number; signed: number; signedReferral: number };
const empty = (): MonthCounts => ({ leads: 0, partnerNamed: 0, qualified: 0, quality: 0, signed: 0, signedReferral: 0 });

/** The sheet's rows from the counts. The two "to quality" and "to leads" rates use the sheet's own formulas. */
export function withRates(c: MonthCounts) {
  const totalSigned = c.signed + c.signedReferral;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    ...c,
    totalSigned,
    pctPartnerNamed: pct(c.partnerNamed, c.leads),
    pctSignedToLeads: pct(totalSigned, c.leads),
    pctQuality: pct(c.quality, c.leads),
    // The sheet divides in-house sign-ups by quality leads, so it can pass 100%.
    pctSignedToQuality: pct(c.signed, c.quality),
  };
}
export type MonthRow = ReturnType<typeof withRates>;

type Row = MonthlyLead & { leadDate: Date | string | null; role: string | null; member: string | null };

/** January to the current month of `year` (all twelve for a past year), one group per role — or one for a rep. */
export function buildMonthly(rows: Row[], year: number, today: string, filter: SignupsFilter = {}) {
  const thisMonth = today.slice(0, 7);
  const lastMonth = String(year) === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
  const months = Array.from({ length: lastMonth }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { key, label: formatInTimeZone(new Date(Date.UTC(year, i, 15)), "UTC", "MMM"), current: key === thisMonth };
  });
  const index = new Map(months.map((m, i) => [m.key, i]));

  const groups = new Map<string, { key: string; label: string; months: MonthCounts[]; total: MonthCounts }>();
  const years = new Set<number>();
  for (const l of rows) {
    // The same leads the rest of the report counts.
    if (!l.leadDate || isNonReportingRep(l.member)) continue;
    if (filter.role && l.role !== filter.role) continue;
    if (filter.member && l.member !== filter.member) continue;
    if (filter.team === "current" && !isCurrentRep(l.member)) continue;
    const month = formatInTimeZone(new Date(l.leadDate), TZ, "yyyy-MM");
    years.add(Number(month.slice(0, 4)));
    const at = index.get(month);
    if (at == null) continue;
    const key = filter.member ? filter.member : String(l.role ?? "Other");
    if (!groups.has(key)) groups.set(key, { key, label: key, months: months.map(empty), total: empty() });
    const g = groups.get(key)!;
    const c = classifyLead(l);
    for (const t of [g.months[at], g.total]) {
      t.leads++;
      if (c.partnerNamed) t.partnerNamed++;
      if (c.qualified) t.qualified++;
      if (c.quality) t.quality++;
      if (c.signed) t.signed++;
      if (c.signedReferral) t.signedReferral++;
    }
  }
  // FR first, as on the team's sheet.
  const order = ["FR", "BDR"];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const list = Array.from(groups.values()).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  return {
    year,
    // The years a reader can switch to: the last few with leads.
    years: Array.from(years).filter((y) => y <= Number(today.slice(0, 4))).sort((a, b) => b - a).slice(0, 4),
    today,
    months,
    groups: list.map((g) => ({ key: g.key, label: g.label, months: g.months.map(withRates), total: withRates(g.total) })),
  };
}

export async function getSignupsMonthly(year: number | undefined, filter: SignupsFilter = {}) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      leadDate: leadIntake.leadDate, role: leadIntake.role, member: leadIntake.member, outcome: leadIntake.outcome,
      classification: leadIntake.classification, disposition: leadIntake.disposition, facility: leadIntake.facility,
    })
    .from(leadIntake);
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  return buildMonthly(rows, year ?? Number(today.slice(0, 4)), today, filter);
}
