/**
 * Digital Marketing Report — the digital team's daily "MTD Performance
 * Summary" sheet, rebuilt live from Lead Docket: Google Business Profile, the
 * SEO websites and the paid ads, with the team table, open cases, sign-ups by
 * Case Value, the GBP outcome summary, per-location and per-brand tables, ad
 * cost per lead and sign-up, the sign-up lists and 12 months of trends.
 *
 * It counts exactly as the Marketing Report does, so the two agree: the same
 * leaddocket_leads rows, a lead in the Pacific day of its leadDate (the sign-up
 * day for a signed lead, else the day it came in), the same digital sources
 * (DIGITAL_SOURCE_PATTERN, which digitalGroupOf splits into GBP / SEO / Ads),
 * BD/FR-credited leads never digital, and every lead in one column by
 * scorecardBucket (server/marketing/digital.ts says how the team's columns map).
 * "Total Signed" is Signed In-House + Signed Referred Out everywhere, and each
 * place that shows it also shows the split (Youssef, 2026-09-30).
 *
 * The aggregation (buildDigitalReport) is pure, so it is tested without a
 * database; getDigitalMarketingReport only reads and hands it the rows.
 *
 * It names clients, as the Marketing Report does, so only canSeeMarketing reads it.
 */
import { and, gte, lt, lte, sql } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getDb } from "./db";
import { leaddocketLeads } from "../drizzle/schema";
import {
  ADS_CAMPAIGNS, CASE_VALUES, CASE_VALUE_NONE, DIGITAL_GROUPS, DIGITAL_SOURCE_PATTERN, DIGITAL_TARGET, SEO_BRANDS,
  digitalGroupOf, type DigitalGroup,
} from "@shared/marketing";
import { TZ, clean, monthBounds, monthIndexer, monthsBetween, notBdFr, sourceOf } from "./marketing/common";
import { DM_OUTCOMES, DM_OUTCOME_LABEL, dmBucketOf, dmOutcomeOf, isPendingReferral, type DmBucket, type DmOutcome } from "./marketing/digital";
import { loadSpend, type SpendRow } from "./marketing/spend";
import { accidentKeys, isSigned, targetPeriod } from "./signupsReport";
import { classifyLead, isAcceptedCaseType } from "./signupsMonthly";
import { ensureDigitalColumns } from "../scripts/migration/leaddocket-digital.mjs";
import { ensureLiabilityColumns } from "../scripts/migration/leaddocket-liability.mjs";

// ── pure: one lead ──

/** The columns the period query reads. */
export type DmRow = {
  leadId: number;
  leadDate: Date | string | null;
  outcome: string | null;
  status: string | null;
  subStatus: string | null;
  caseType: string | null;
  marketingSource: string | null;
  teamRole: string | null;
  clientName: string | null;
  caseValue: string | null;
  incidentDate: string | null;
  relatedLeadIds: string | null;
  phoneKey: string | null;
};
/** The columns the 12-month trend query reads. */
export type TrendRow = Pick<DmRow, "leadDate" | "outcome" | "status" | "subStatus" | "caseType" | "marketingSource" | "teamRole">;

/** Conversion, share of target and the like: one decimal, null when there is nothing to divide by. */
export const rate = (a: number, b: number | null | undefined) => (b ? Math.round((a / b) * 1000) / 10 : null);
const money = (n: number) => Math.round(n * 100) / 100;
const tenth = (n: number) => Math.round(n * 10) / 10;

/** A stored Case Value as the report groups it: one of the five picks, the raw value, or "Not recorded yet". */
export const caseValueKey = (v: string | null) => clean(v) || CASE_VALUE_NONE;

/** Everything the report needs to know about one digital lead; null for a lead that isn't digital. */
export function classify<T extends TrendRow>(r: T) {
  if (!r.leadDate) return null;
  const source = sourceOf(r);
  const g = digitalGroupOf(source);
  // sourceOf names BD/FR leads "BD/FR team", which is never digital.
  if (!g) return null;
  const bucket = dmBucketOf(r.outcome, r.status);
  const q = classifyLead({ outcome: r.outcome, classification: r.caseType, disposition: r.subStatus, facility: null });
  return {
    ...r,
    source,
    group: g.group,
    label: g.label,
    bucket,
    outcomeRow: dmOutcomeOf(r.outcome, r.status, r.subStatus),
    pendingReferral: bucket === "open" && isPendingReferral(r.status),
    signed: isSigned(r.outcome),
    inHouse: bucket === "signedInHouse",
    referred: bucket === "signedReferred",
    // A PI case is one the firm accepts by case type — signupsMonthly's qualified case types.
    pi: isAcceptedCaseType(r.caseType),
    qualified: q.qualified,
    quality: q.quality,
  };
}
export type DmLead = NonNullable<ReturnType<typeof classify<TrendRow>>>;

// ── pure: counts ──

export type TeamCounts = Record<DmBucket, number> & {
  leads: number; signed: number; pendingReferral: number; qualified: number; quality: number;
};
const emptyTeam = (): TeamCounts => ({
  leads: 0, signed: 0, pendingReferral: 0, qualified: 0, quality: 0,
  open: 0, rejected: 0, referredOut: 0, lostNI: 0, signedReferred: 0, signedInHouse: 0,
});
function add(c: TeamCounts, l: DmLead) {
  c.leads++; c[l.bucket]++;
  if (l.signed) c.signed++;
  if (l.pendingReferral) c.pendingReferral++;
  if (l.qualified) c.qualified++;
  if (l.quality) c.quality++;
}

type Split = { inHouse: number; referred: number; total: number; unique: number };
const byCaseValue = (leads: (DmLead & { caseValue: string | null; key: string })[]) => {
  const m = new Map<string, Split & { keys: Set<string> }>();
  for (const v of CASE_VALUES) m.set(v, { inHouse: 0, referred: 0, total: 0, unique: 0, keys: new Set() });
  for (const l of leads) {
    if (!l.signed) continue;
    const k = caseValueKey(l.caseValue);
    const c = m.get(k) ?? { inHouse: 0, referred: 0, total: 0, unique: 0, keys: new Set<string>() };
    if (l.inHouse) c.inHouse++; else c.referred++;
    c.total++; c.keys.add(l.key);
    m.set(k, c);
  }
  // The five picks in the sheet's order, then anything else Lead Docket held, then the unrecorded.
  const rank = (k: string) => (CASE_VALUES as readonly string[]).indexOf(k) >= 0 ? (CASE_VALUES as readonly string[]).indexOf(k) : k === CASE_VALUE_NONE ? 99 : 50;
  return Array.from(m.entries())
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([value, c]) => ({ value, inHouse: c.inHouse, referred: c.referred, total: c.total, unique: c.keys.size }));
};

export type BuildInput = {
  rows: DmRow[];            // this period's leads (digital or not — non-digital are skipped)
  prior: TrendRow[];        // the previous period of equal length
  trend: TrendRow[];        // the 12 months ending with this period's month
  trendMonths: string[];    // those months, oldest first
  spend: SpendRow[];        // marketing_spend for the months this period touches
  from: string; to: string; // Pacific days, YYYY-MM-DD
  priorFrom: string; priorTo: string;
  days: string[];           // the period's Pacific days (targetPeriod)
  targetMonths: number;     // months' worth of target this period carries (prorated like the Sign-ups scorecard)
  priorTargetMonths: number;
  prorated: boolean;
};

/** The whole report from its rows. Pure. */
export function buildDigitalReport(input: BuildInput) {
  const leads = input.rows.map((r) => classify(r)).filter((l): l is NonNullable<typeof l> => !!l);

  // One key per accident, as the Sign-ups scorecard's "Sign-up Unique Count":
  // leads Lead Docket links, or with the same accident day and phone, are one case.
  const keys = accidentKeys(leads.map((l) => ({
    id: l.leadId, externalId: String(l.leadId), relatedLeadIds: l.relatedLeadIds, incidentDate: l.incidentDate, phone: l.phoneKey,
  })));
  const keyed = leads.map((l, i) => ({ ...l, key: keys[i] }));

  const target = (g: DigitalGroup, months: number) => (DIGITAL_TARGET[g] == null ? null : tenth(DIGITAL_TARGET[g]! * months));

  // ── the team table ──
  const groupCounts = new Map<DigitalGroup, TeamCounts & { uniq: Set<string>; uniqIn: Set<string>; members: Set<string> }>();
  for (const g of DIGITAL_GROUPS) groupCounts.set(g, { ...emptyTeam(), uniq: new Set(), uniqIn: new Set(), members: new Set() });
  for (const l of keyed) {
    const c = groupCounts.get(l.group)!;
    add(c, l);
    c.members.add(l.source);
    if (l.signed) c.uniq.add(l.key);
    if (l.inHouse) c.uniqIn.add(l.key);
  }
  const teamRow = (group: DigitalGroup) => {
    const c = groupCounts.get(group)!;
    const t = target(group, input.targetMonths);
    const { uniq, uniqIn, members, ...counts } = c;
    return {
      group, ...counts, unique: uniq.size, uniqueInHouse: uniqIn.size, members: Array.from(members).sort(),
      target: t, achieved: t ? rate(c.signed, t) : null, conversion: rate(c.signed, c.leads),
    };
  };
  const team = DIGITAL_GROUPS.map(teamRow);
  const sum = (k: keyof TeamCounts | "unique" | "uniqueInHouse") => team.reduce((a, r) => a + (r[k] as number), 0);
  // Targets only where a group has one (GBP and SEO), as the sheet's TOTAL row.
  const totalTarget = team.some((r) => r.target != null) ? tenth(team.reduce((a, r) => a + (r.target ?? 0), 0)) : null;
  // Achieved against the target counts only the groups that have one: Ads sign-ups can't make up for GBP.
  const targetedSigned = team.filter((r) => r.target != null).reduce((a, r) => a + r.signed, 0);
  const total = {
    group: "TOTAL" as const,
    leads: sum("leads"), signed: sum("signed"), pendingReferral: sum("pendingReferral"), qualified: sum("qualified"), quality: sum("quality"),
    open: sum("open"), rejected: sum("rejected"), referredOut: sum("referredOut"), lostNI: sum("lostNI"),
    signedReferred: sum("signedReferred"), signedInHouse: sum("signedInHouse"),
    // Summed like the sheet's TOTAL row (and the scorecard's): an accident is counted in each group it came through.
    unique: sum("unique"), uniqueInHouse: sum("uniqueInHouse"),
    members: team.flatMap((r) => r.members),
    target: totalTarget, targetedSigned, achieved: totalTarget ? rate(targetedSigned, totalTarget) : null,
    conversion: rate(sum("signed"), sum("leads")),
  };

  // ── the previous period, for the headline's changes ──
  const priorLeads = input.prior.map((r) => classify(r)).filter((l): l is NonNullable<typeof l> => !!l);
  const priorBy = (g?: DigitalGroup) => {
    const c = emptyTeam();
    for (const l of priorLeads) if (!g || l.group === g) add(c, l);
    return c;
  };
  const priorTotal = priorBy();
  const priorTargetGroups = DIGITAL_GROUPS.filter((g) => DIGITAL_TARGET[g] != null);
  const priorTarget = tenth(priorTargetGroups.reduce((a, g) => a + (target(g, input.priorTargetMonths) ?? 0), 0));
  const priorTargeted = priorTargetGroups.reduce((a, g) => a + priorBy(g).signed, 0);
  const prior = {
    from: input.priorFrom, to: input.priorTo,
    leads: priorTotal.leads, signed: priorTotal.signed, signedInHouse: priorTotal.signedInHouse, signedReferred: priorTotal.signedReferred,
    conversion: rate(priorTotal.signed, priorTotal.leads), achieved: priorTarget ? rate(priorTargeted, priorTarget) : null,
    groups: Object.fromEntries(DIGITAL_GROUPS.map((g) => { const c = priorBy(g); return [g, { leads: c.leads, signed: c.signed, conversion: rate(c.signed, c.leads) }]; })) as
      Record<DigitalGroup, { leads: number; signed: number; conversion: number | null }>,
  };

  // ── rows within a group: GBP offices, SEO brands, ad campaigns ──
  type LabelAcc = TeamCounts & { group: DigitalGroup; label: string; members: Map<string, number>; uniq: Set<string> };
  const labels = new Map<string, LabelAcc>();
  const labelOf = (group: DigitalGroup, label: string) => {
    const k = group + "|" + label;
    let a = labels.get(k);
    if (!a) { a = { ...emptyTeam(), group, label, members: new Map(), uniq: new Set() }; labels.set(k, a); }
    return a;
  };
  // Every brand and campaign has a row, with leads or not, as on the sheet.
  for (const b of SEO_BRANDS) labelOf("SEO", b);
  for (const c of ADS_CAMPAIGNS) labelOf("Ads", c);
  for (const l of keyed) {
    const a = labelOf(l.group, l.label);
    add(a, l);
    a.members.set(l.source, (a.members.get(l.source) ?? 0) + 1);
    if (l.signed) a.uniq.add(l.key);
  }
  // Spend is entered per Lead Docket source and month; each source's dollars go to its row.
  const spendBy = new Map<string, { amount: number; sources: Set<string> }>();
  const periodMonths = new Set(input.days.map((d) => d.slice(0, 7)));
  for (const s of input.spend) {
    if (!periodMonths.has(s.month)) continue;
    const g = digitalGroupOf(clean(s.source));
    if (!g) continue;   // not a digital source: the Marketing Report's, not this one's
    const k = g.group + "|" + g.label;
    const e = spendBy.get(k) ?? { amount: 0, sources: new Set<string>() };
    e.amount += s.amount; e.sources.add(clean(s.source));
    spendBy.set(k, e);
    labelOf(g.group, g.label);   // a campaign with spend but no leads still shows
  }
  const labelRows = Array.from(labels.values()).map((a) => {
    const spend = spendBy.get(a.group + "|" + a.label);
    const amount = spend ? money(spend.amount) : null;
    return {
      group: a.group, label: a.label,
      leads: a.leads, qualified: a.qualified, quality: a.quality,
      signedInHouse: a.signedInHouse, signedReferred: a.signedReferred, signed: a.signed, unique: a.uniq.size,
      referredOut: a.referredOut, open: a.open,
      conversion: rate(a.signed, a.leads),
      members: Array.from(a.members.entries()).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([source, leads]) => ({ source, leads })),
      spend: amount,
      spendSources: spend ? Array.from(spend.sources).sort() : [],
      // Never a division by nothing: no leads or no sign-ups leave the cost blank.
      cpl: amount != null && a.leads ? money(amount / a.leads) : null,
      cpa: amount != null && a.signed ? money(amount / a.signed) : null,
    };
  });
  const bySigned = (a: { signed: number; leads: number; label: string }, b: { signed: number; leads: number; label: string }) =>
    b.signed - a.signed || b.leads - a.leads || a.label.localeCompare(b.label);
  const orderOf = (list: readonly string[]) => (label: string) => { const i = list.indexOf(label); return i < 0 ? list.length : i; };
  const seoOrder = orderOf(SEO_BRANDS), adsOrder = orderOf(ADS_CAMPAIGNS);
  const locations = labelRows.filter((r) => r.group === "GBP").sort(bySigned);
  const brands = labelRows.filter((r) => r.group === "SEO").sort((a, b) => seoOrder(a.label) - seoOrder(b.label) || bySigned(a, b));
  const campaigns = labelRows.filter((r) => r.group === "Ads").sort((a, b) => adsOrder(a.label) - adsOrder(b.label) || bySigned(a, b));

  // ── per group: case values, the referred-out summary, the outcome summary ──
  const inGroup = (g: DigitalGroup) => keyed.filter((l) => l.group === g);
  const caseValues = Object.fromEntries(DIGITAL_GROUPS.map((g) => [g, byCaseValue(inGroup(g))])) as Record<DigitalGroup, ReturnType<typeof byCaseValue>>;
  const caseValuesAll = byCaseValue(keyed);

  const referred = DIGITAL_GROUPS.map((g) => {
    const ls = inGroup(g);
    const nature = new Map<string, number>();
    for (const l of ls) if (l.referred) { const t = clean(l.caseType) || "Not recorded"; nature.set(t, (nature.get(t) ?? 0) + 1); }
    return {
      group: g,
      referredOut: ls.filter((l) => l.bucket === "referredOut").length,
      successful: ls.filter((l) => l.referred).length,
      nature: Array.from(nature.entries()).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    };
  });

  const outcomesOf = (ls: DmLead[]) => DM_OUTCOMES.map((key: DmOutcome) => {
    const of = ls.filter((l) => l.outcomeRow === key);
    return { key, label: DM_OUTCOME_LABEL[key], total: of.length, pi: of.filter((l) => l.pi).length, nonPi: of.filter((l) => !l.pi).length };
  });
  const outcomes = Object.fromEntries(DIGITAL_GROUPS.map((g) => [g, outcomesOf(inGroup(g))])) as Record<DigitalGroup, ReturnType<typeof outcomesOf>>;

  // ── the sign-up lists ──
  const signups = keyed
    .filter((l) => l.signed)
    .map((l) => ({
      id: l.leadId, name: clean(l.clientName) || `Lead ${l.leadId}`, group: l.group, label: l.label, source: l.source,
      caseValue: clean(l.caseValue) || null, caseType: clean(l.caseType) || "Not recorded",
      date: l.leadDate ? new Date(l.leadDate).toISOString() : null,
      kind: l.inHouse ? ("inHouse" as const) : ("referred" as const),
      accident: l.key,
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.name.localeCompare(b.name));

  // ── sign-ups building up through the period, against the target's pace ──
  // Day by day for up to a quarter; beyond that, month by month.
  const daily = input.days.length <= 92;
  const steps = daily ? input.days : Array.from(new Set(input.days.map((d) => d.slice(0, 7))));
  const stepOf = new Map(steps.map((s, i) => [s, i]));
  const perStep = steps.map(() => ({ GBP: 0, SEO: 0, Ads: 0 } as Record<DigitalGroup, number>));
  for (const l of keyed) {
    if (!l.signed || !l.leadDate) continue;
    const day = formatInTimeZone(new Date(l.leadDate), TZ, "yyyy-MM-dd");
    const i = stepOf.get(daily ? day : day.slice(0, 7));
    if (i != null) perStep[i][l.group]++;
  }
  const paceTarget = totalTarget ?? 0;
  const run = { GBP: 0, SEO: 0, Ads: 0 } as Record<DigitalGroup, number>;
  // The pace line spreads the target evenly over the period's days.
  const dayCount = input.days.length || 1;
  let daysSoFar = 0;
  const cumulative = steps.map((s, i) => {
    for (const g of DIGITAL_GROUPS) run[g] += perStep[i][g];
    daysSoFar += daily ? 1 : input.days.filter((d) => d.startsWith(s)).length;
    return {
      step: s, GBP: run.GBP, SEO: run.SEO, Ads: run.Ads, total: run.GBP + run.SEO + run.Ads,
      targeted: run.GBP + run.SEO, pace: paceTarget ? tenth((paceTarget * daysSoFar) / dayCount) : null,
    };
  });

  // ── 12 months, per group ──
  const indexOf = monthIndexer(input.trendMonths);
  type Month = { leads: number; qualified: number; quality: number; signedInHouse: number; signedReferred: number; signed: number };
  const blank = (): Month => ({ leads: 0, qualified: 0, quality: 0, signedInHouse: 0, signedReferred: 0, signed: 0 });
  const trendRows = input.trendMonths.map((month) => ({ month, GBP: blank(), SEO: blank(), Ads: blank(), all: blank() }));
  for (const r of input.trend) {
    const l = classify(r);
    if (!l || !l.leadDate) continue;
    const i = indexOf(l.leadDate);
    if (i < 0) continue;
    for (const m of [trendRows[i][l.group], trendRows[i].all]) {
      m.leads++;
      if (l.qualified) m.qualified++;
      if (l.quality) m.quality++;
      if (l.inHouse) m.signedInHouse++;
      if (l.referred) m.signedReferred++;
      if (l.signed) m.signed++;
    }
  }
  const trend = trendRows.map((t) => {
    const withRates = (m: Month) => ({ ...m, conversion: rate(m.signed, m.leads), qualityRate: rate(m.quality, m.leads), qualifiedRate: rate(m.qualified, m.leads) });
    return { month: t.month, GBP: withRates(t.GBP), SEO: withRates(t.SEO), Ads: withRates(t.Ads), all: withRates(t.all) };
  });

  // ── what Lead Docket hasn't filled in yet, said plainly on the page ──
  const signedLeads = keyed.filter((l) => l.signed);
  const gaps = {
    signed: signedLeads.length,
    noCaseValue: signedLeads.filter((l) => !clean(l.caseValue)).length,
    // Without an accident day or linked leads, a sign-up can only be its own case.
    noAccident: signedLeads.filter((l) => !l.incidentDate && !clean(l.relatedLeadIds)).length,
  };

  const kpis = (g: DigitalGroup) => {
    const r = team.find((x) => x.group === g)!;
    return {
      leads: r.leads, qualified: r.qualified, quality: r.quality,
      nonQuality: r.qualified - r.quality, nonQualified: r.leads - r.qualified,
      signed: r.signed, signedReferred: r.signedReferred, signedInHouse: r.signedInHouse, unique: r.unique,
      target: r.target, achieved: r.achieved, conversion: r.conversion,
      qualityRate: rate(r.quality, r.leads),
    };
  };

  return {
    period: { from: input.from, to: input.to, days: input.days.length, prorated: input.prorated, targetMonths: Math.round(input.targetMonths * 1000) / 1000 },
    team, total, prior,
    locations, brands, campaigns,
    kpis: { GBP: kpis("GBP"), SEO: kpis("SEO"), Ads: kpis("Ads") },
    caseValues, caseValuesAll, referred, outcomes,
    signups,
    cumulative: { daily, rows: cumulative, target: totalTarget },
    trend,
    spend: {
      total: money(Array.from(spendBy.values()).reduce((a, e) => a + e.amount, 0)),
      months: Array.from(periodMonths).sort(),
      // A period that covers part of a month still shows the whole month's spend.
      partial: input.prorated,
    },
    gaps,
  };
}
export type DigitalReport = ReturnType<typeof buildDigitalReport>;

// ── dates ──

/** The Pacific day before or after a YYYY-MM-DD day, on the calendar. */
export const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** The period of equal length that ends the day before this one starts. */
export function priorPeriod(from: string, to: string) {
  const len = Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8))) / 86_400_000) + 1;
  const priorTo = shiftDay(from, -1);
  return { from: shiftDay(priorTo, -(len - 1)), to: priorTo };
}
const startOf = (day: string) => fromZonedTime(`${day}T00:00:00`, TZ);
const endOf = (day: string) => fromZonedTime(`${day}T23:59:59.999`, TZ);

// ── reading ──

const rowsOf = (r: any) => (Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : []) as Record<string, unknown>[];

// The columns may not exist yet (deploys run no migrations, and the sync may
// not have run since this shipped), so the first read adds them.
let ready: Promise<void> | null = null;
export function ensureDigitalReady() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const run = async (q: string) => rowsOf(await db.execute(sql.raw(q)));
    // phoneKey (read here to spot the same client twice) arrives with the
    // liability columns, which only the sync or the Intake case page added.
    await ensureLiabilityColumns(run);
    await ensureDigitalColumns(run);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const L = leaddocketLeads;
/** Only digital, non-BD/FR leads — the same pattern the page's digitalGroupOf and the drill-downs use. */
export const digitalOnly = sql`(${notBdFr} AND LOWER(TRIM(${L.marketingSource})) REGEXP ${DIGITAL_SOURCE_PATTERN})`;

const DM_COLS = {
  leadId: L.leadId, leadDate: L.leadDate, outcome: L.outcome, status: L.status, subStatus: L.subStatus, caseType: L.caseType,
  marketingSource: L.marketingSource, teamRole: L.teamRole, clientName: L.clientName, caseValue: L.caseValue,
  incidentDate: L.incidentDate, relatedLeadIds: L.relatedLeadIds, phoneKey: L.phoneKey,
};
const TREND_COLS = {
  leadDate: L.leadDate, outcome: L.outcome, status: L.status, subStatus: L.subStatus, caseType: L.caseType,
  marketingSource: L.marketingSource, teamRole: L.teamRole,
};

export async function getDigitalMarketingReport(range: { from: Date; to: Date; fromDay: string; toDay: string }, today: string) {
  const db = await getDb();
  if (!db) return null;
  await ensureDigitalReady();

  const p = priorPeriod(range.fromDay, range.toDay);
  const tp = targetPeriod({ from: range.from, to: range.to }, 1, endOf(today));
  const ptp = targetPeriod({ from: startOf(p.from), to: endOf(p.to) }, 1, endOf(today));
  // The 12 months ending with the period's last month.
  const lastMonth = range.toDay.slice(0, 7);
  const [ly, lm] = lastMonth.split("-").map(Number);
  const firstMonth = formatInTimeZone(new Date(Date.UTC(ly, lm - 12, 15)), "UTC", "yyyy-MM");
  const trendMonths = monthsBetween(monthBounds(firstMonth).start, monthBounds(lastMonth).start);

  const [both, trend, spend] = await Promise.all([
    // This period and the one before it, in one read.
    db.select(DM_COLS).from(L).where(and(gte(L.leadDate, startOf(p.from)), lte(L.leadDate, range.to), digitalOnly)),
    db.select(TREND_COLS).from(L).where(and(gte(L.leadDate, monthBounds(firstMonth).start), lt(L.leadDate, monthBounds(lastMonth).end), digitalOnly)),
    loadSpend(Array.from(new Set(tp.days.map((d) => d.slice(0, 7))))),
  ]).catch((e) => {
    // The database's own reason, not drizzle's echo of the whole query, so a
    // failure on the page says what to fix (and no SQL reaches the browser).
    const why = e?.cause?.sqlMessage ?? e?.cause?.message ?? e?.sqlMessage ?? e?.message ?? String(e);
    console.warn("[digital] read failed:", e?.message ?? e);
    throw new Error(`Couldn't read the Lead Docket data: ${String(why).slice(0, 300)}`);
  });
  const fromT = range.from.getTime();
  const at = (r: { leadDate: Date | null }) => (r.leadDate ? new Date(r.leadDate).getTime() : -Infinity);

  return buildDigitalReport({
    rows: both.filter((r) => at(r) >= fromT),
    prior: both.filter((r) => at(r) < fromT),
    trend, trendMonths, spend,
    from: range.fromDay, to: range.toDay, priorFrom: p.from, priorTo: p.to,
    days: tp.days, targetMonths: tp.targetMonths, priorTargetMonths: ptp.targetMonths, prorated: tp.prorated,
  });
}
