/**
 * Marketing Report — every lead the firm takes in Lead Docket, by the marketing
 * source that brought it: how many leads, where they ended up, how many signed,
 * and (from the monthly spend entered in the report) what each lead and each
 * sign-up cost.
 *
 * Reads leaddocket_leads, which sync-leaddocket.mjs fills for every lead it
 * reads. It counts the way the Sign-ups Report does, so the two agree: a signed
 * lead in the month it signed, any other lead in the month it came in, and each
 * lead in exactly one scorecard column (scorecardBucket). Leads credited to a
 * BD/FR representative are left out entirely — they are the Sign-ups Report's,
 * and Youssef wants the two kept apart (Sept 2026).
 *
 * This file composes the page: one read of the range's leads through derive(),
 * the scorecard counted here, and every other panel (server/marketing/*) built
 * from those same leads, so each of their numbers adds back to the scorecard.
 * The reconcile checks say so on every load, and only ever warn.
 *
 * It names every client the firm spoke to, so only canSeeMarketing may call it.
 */
import { and, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "./db";
import { leaddocketLeads, marketingSpend } from "../drizzle/schema";
import {
  LEAD_COLS, NO_SOURCE, TEAM_CHANNEL, channelOfSource, clean, derive, emptyCounts, keyOf, monthsBetween, pct,
  type Counts, type Grouping, type RowRef,
} from "./marketing/common";
import { assignSpend, checkSpend, loadSpend, partialMonths, spendNotes } from "./marketing/spend";
import { getCoverage, monthStates } from "./marketing/coverage";
import { checkReasons, whyNotSigned } from "./marketing/reasons";
import { checkGrid, monthGrid } from "./marketing/monthGrid";
import { checkRoutes, contactRoutes } from "./marketing/routes";
import {
  buildComparison, checkComparison, comparisonRange, loadPrior, paceOf, ripening, toDates,
  type CompareMode, type PriorTally,
} from "./marketing/compare";
import { buildAlerts, loadQuiet, type QuietRow } from "./marketing/alerts";

// Older importers still reach these through here.
export { NO_SOURCE, channelOfSource };
export type { Grouping };

export type CompareChoice = CompareMode | "off";

const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * A raw Lead Docket value as the drill-down matches it: trimmed, with '' for
 * NULL or blank (leadFilter compares TRIM(col), and '' asks for NULL or empty).
 */
const rawOf = (v: string | null) => String(v ?? "").trim();

export async function getMarketingDashboard(
  range: { from: Date; to: Date },
  opts: { group: Grouping; from: string; to: string; compare: CompareChoice; today: string },
) {
  const db = await getDb();
  if (!db) return null;
  const group = opts.group;
  const months = monthsBetween(range.from, range.to);
  const now = new Date();

  // All time has nothing earlier, so it never asks for the prior period.
  const priorRange = opts.compare !== "off" ? comparisonRange(opts.from, opts.to, opts.compare) : null;
  const priorDates = priorRange ? toDates(priorRange) : null;
  const priorMonths = priorDates ? monthsBetween(priorDates.from, priorDates.to) : [];

  const L = leaddocketLeads;
  const [rows, prior, cov, quiet, spendRows] = await Promise.all([
    db.select(LEAD_COLS).from(L).where(and(gte(L.leadDate, range.from), lte(L.leadDate, range.to))),
    // The comparison and the gone-quiet alert are extras: if either read fails,
    // the page still shows this period's numbers, just without them.
    priorDates
      ? loadPrior(priorDates, group).catch((e): PriorTally | null => { console.warn("[marketing] comparison unavailable:", e?.message ?? e); return null; })
      : Promise.resolve(null),
    getCoverage(),
    loadQuiet(now).catch((e): QuietRow[] => { console.warn("[marketing] gone-quiet check unavailable:", e?.message ?? e); return []; }),
    // A mid-month 'previous' range shares a month with this one; load it once.
    loadSpend(Array.from(new Set(months.concat(priorMonths)))),
  ]);

  const leads = derive(rows, months, group);

  const totals = emptyCounts();
  const monthly = months.map((month) => ({ month, leads: 0, signed: 0 }));
  const sources = new Map<string, Counts & { name: string; cells: number[]; members: Set<string> }>();
  type CaseType = { name: string; leads: number; signed: number; bySource: Map<string, number>; variants: Set<string> };
  const caseTypes = new Map<string, CaseType>();
  const campaigns = new Map<string, { name: string; source: string; leads: number; signed: number; variants: Set<string> }>();
  const matrix = new Map<string, Map<string, { leads: number; signed: number }>>();   // row → case type key → counts

  for (const l of leads) {
    const { name: channel, source, signed, bucket, i } = l;

    totals.leads++; totals[bucket]++; if (signed) totals.signed++;
    if (i >= 0) { monthly[i].leads++; if (signed) monthly[i].signed++; }

    const s = sources.get(channel) ?? { ...emptyCounts(), name: channel, cells: months.map(() => 0), members: new Set<string>() };
    s.leads++; s[bucket]++;
    if (source !== NO_SOURCE && source !== TEAM_CHANNEL) s.members.add(source);
    if (signed) { s.signed++; if (i >= 0) s.cells[i]++; }
    sources.set(channel, s);

    const ctName = clean(l.caseType) || "Not recorded";
    const ctKey = keyOf(ctName);
    const ct = caseTypes.get(ctKey) ?? { name: ctName, leads: 0, signed: 0, bySource: new Map(), variants: new Set<string>() };
    ct.leads++; if (signed) { ct.signed++; ct.bySource.set(channel, (ct.bySource.get(channel) ?? 0) + 1); }
    // Every spelling in the group, so a drill-down finds all the leads it counts.
    ct.variants.add(rawOf(l.caseType));
    caseTypes.set(ctKey, ct);

    const cell = matrix.get(channel) ?? new Map();
    const mc = cell.get(ctKey) ?? { leads: 0, signed: 0 };
    mc.leads++; if (signed) mc.signed++;
    cell.set(ctKey, mc);
    matrix.set(channel, cell);

    const cName = clean(l.campaign);
    if (cName) {
      // The row part is the exact row name, as sources and matrix key it: two
      // rows whose names differ only in case are two scorecard rows, and the
      // drill-down scopes to one row's members. Folding them here would count
      // leads the campaign's drill-down can't list. The campaign name still
      // folds case, through variants.
      const ck = channel + "|" + keyOf(cName);
      const c = campaigns.get(ck) ?? { name: cName, source: channel, leads: 0, signed: 0, variants: new Set<string>() };
      c.leads++; if (signed) c.signed++;
      c.variants.add(rawOf(l.campaign));
      campaigns.set(ck, c);
    }
  }

  const rowsSorted = Array.from(sources.values())
    .map((s) => ({ ...s, members: Array.from(s.members) }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads || a.name.localeCompare(b.name));
  // The scorecard rows in page order: spend matching gives a name's dollars to
  // the first row with it, so this order must be the one the page shows.
  const sourceRefs: RowRef[] = rowsSorted.map(({ name, members }) => ({ name, members }));

  // Each spend row lands on exactly one scorecard row or on the unmatched line.
  // A channel takes spend by the channel its name belongs to, so a new contract
  // with no leads yet still counts toward its vendor.
  const monthSet = new Set(months);
  const spend = assignSpend(spendRows.filter((r) => monthSet.has(r.month)), sourceRefs, group, months);

  const sourceList = rowsSorted.map((s) => {
    const rowSpend = spend.byRow.get(s.name) ?? null;
    return {
      ...s,
      conversion: pct(s.signed, s.leads),
      spend: rowSpend,
      costPerLead: rowSpend != null && s.leads ? money(rowSpend / s.leads) : null,
      costPerSignup: rowSpend != null && s.signed ? money(rowSpend / s.signed) : null,
    };
  });

  // Cost across the rows that have spend entered, so unpaid channels don't dilute
  // it. The total spend includes the unmatched line: it was still spent.
  const paid = sourceList.filter((s) => spend.byRow.has(s.name));
  const paidLeads = paid.reduce((a, s) => a + s.leads, 0);
  const paidSigned = paid.reduce((a, s) => a + s.signed, 0);
  const matchedCents = Array.from(spend.byRow.values()).reduce((a, v) => a + cents(v), 0);

  const totalsOut = {
    ...totals,
    conversion: pct(totals.signed, totals.leads),
    sources: sourceList.length,
    spend: spend.total || null,
    spendMatched: spend.byRow.size ? matchedCents / 100 : null,
    costPerLead: paidLeads ? money(spend.total / paidLeads) : null,
    costPerSignup: paidSigned ? money(spend.total / paidSigned) : null,
  };
  const monthlyOut = monthly.map((m) => ({ ...m, conversion: pct(m.signed, m.leads) }));

  const caseTypeList = Array.from(caseTypes.values())
    .map((c) => ({
      name: c.name, leads: c.leads, signed: c.signed, conversion: pct(c.signed, c.leads),
      topSources: Array.from(c.bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, signed]) => ({ name, signed })),
      variants: Array.from(c.variants),
    }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads);

  // Sources × case types, for the biggest of each; the rest fold into "All other"
  // (not "Other" — Lead Docket has a case type of that name).
  const mSources = [...sourceList].sort((a, b) => b.leads - a.leads).slice(0, 10).map((s) => s.name);
  const mTypes = [...caseTypeList].sort((a, b) => b.leads - a.leads).slice(0, 6);
  const mTypeKeys = new Set(mTypes.map((t) => keyOf(t.name)));
  const shownVariants = mTypes.map((t) => t.variants);
  const otherAll = {
    leads: totals.leads - mTypes.reduce((a, t) => a + t.leads, 0),
    signed: totals.signed - mTypes.reduce((a, t) => a + t.signed, 0),
  };
  const caseMatrix = {
    types: [...mTypes.map((t) => t.name), "All other"],
    // Aligned to types. 'All other' lists the shown types' spellings, for notCaseTypes.
    typeVariants: [...shownVariants, shownVariants.reduce<string[]>((a, v) => a.concat(v), [])],
    // The 'All channels' row: the whole report per type, equal to the caseTypes totals.
    all: [...mTypes.map((t) => ({ leads: t.leads, signed: t.signed })), otherAll],
    rows: mSources.map((name) => {
      const cells = matrix.get(name) ?? new Map<string, { leads: number; signed: number }>();
      const other = { leads: 0, signed: 0 };
      cells.forEach((v, k) => { if (!mTypeKeys.has(k)) { other.leads += v.leads; other.signed += v.signed; } });
      return { name, cells: [...mTypes.map((t) => cells.get(keyOf(t.name)) ?? { leads: 0, signed: 0 }), other] };
    }),
  };

  const campaignList = Array.from(campaigns.values())
    .map((c) => ({ name: c.name, source: c.source, leads: c.leads, signed: c.signed, conversion: pct(c.signed, c.leads), variants: Array.from(c.variants) }))
    .sort((a, b) => b.leads - a.leads || b.signed - a.signed)
    .slice(0, 30);

  // ── the feature panels, all from the same leads and spend ──
  const coverage = { ...cov, months: monthStates(cov, months) };
  const why = whyNotSigned(leads, { spendByRow: spend.byRow, spendTotal: spend.total });
  const grid = monthGrid(leads, months, sourceRefs, spend, totalsOut);
  const routes = contactRoutes(leads);
  const compare = priorRange && prior
    ? buildComparison({
        mode: opts.compare as CompareMode,
        range: priorRange,
        current: { from: opts.from, to: opts.to, totals: totalsOut, rows: sourceList },
        prior, priorSpend: spendRows, coverage: cov, group,
      })
    : null;
  const pace = paceOf(monthlyOut, opts.to, opts.today, opts.from);
  const partial = partialMonths(opts.from, opts.to);
  const { partialNote, insights: spendInsights } = spendNotes(spend, partial, coverage.months, months, { group, today: opts.today });
  const minLeads = totals.leads >= 500 ? 25 : 8;
  const alerts = buildAlerts({
    leads, rows: sourceList, totals: totalsOut, compare, quiet, coverage: cov, now, rangeFrom: range.from,
    rangeInProgress: opts.to >= opts.today.slice(0, 8) + "01", minLeads,
  });

  // ── briefing, in order of what Youssef reads first; at most seven ──
  const insights: string[] = [];
  const top = sourceList.find((s) => s.signed > 0);
  // A partial comparison says nothing, so the top channel leads instead.
  const headline = compare?.insights[0]
    ?? (top ? `${top.name} brought the most sign-ups: ${top.signed} of ${totals.signed} (${pct(top.signed, totals.signed)}%).` : null);
  if (headline) insights.push(headline);
  if (pace?.text) insights.push(pace.text);
  insights.push(...why.insights);
  const best = sourceList.filter((s) => s.leads >= minLeads).sort((a, b) => b.conversion - a.conversion)[0];
  if (best) insights.push(`${best.name} converts best: ${best.conversion}% of its ${best.leads} leads signed (firm average ${pct(totals.signed, totals.leads)}%).`);
  const costed = sourceList.filter((s) => s.costPerSignup != null).sort((a, b) => (a.costPerSignup ?? 0) - (b.costPerSignup ?? 0));
  if (costed.length >= 2) {
    const [cheap, dear] = [costed[0], costed[costed.length - 1]];
    insights.push(`Cheapest sign-ups: ${cheap.name}, $${cheap.costPerSignup!.toLocaleString("en-US")} each; dearest: ${dear.name}, $${dear.costPerSignup!.toLocaleString("en-US")}.`);
  }
  insights.push(...spendInsights);
  const ripe = ripening(leads, opts.to, opts.today);
  if (ripe) insights.push(ripe);
  if (compare?.insights[1]) insights.push(compare.insights[1]);
  const unsourced = sources.get(NO_SOURCE);
  if (unsourced) insights.push(`${unsourced.leads} leads (${pct(unsourced.leads, totals.leads)}%) have no Marketing Source in Lead Docket, so no channel gets the credit.`);

  // ── reconciliation: every panel must add back to the scorecard ──
  // Warn only. A mismatch is a bug to fix, not a reason to hide the report.
  const problems: string[] = [];
  const check = (what: string, run: () => string[]) => {
    try { problems.push(...run()); } catch (e) { problems.push(`${what}: check failed — ${e instanceof Error ? e.message : String(e)}`); }
  };
  check("spend", () => checkSpend(spend, sourceList.map((s) => s.spend)));
  check("why", () => checkReasons(why, totals));
  check("grid", () => checkGrid(
    grid, { ...totals, spend: totalsOut.spend },
    sourceList.map((s) => ({ name: s.name, leads: s.leads, signed: s.signed, spend: s.spend, cells: s.cells })),
    why,
  ));
  check("routes", () => checkRoutes(routes, { leads: totals.leads, signed: totals.signed }));
  if (compare && prior) check("compare", () => checkComparison(compare, prior, { rows: sourceList, totals: totalsOut }));
  if (problems.length) console.warn("[marketing] reconcile", `${opts.from} to ${opts.to}, ${group}, vs ${opts.compare}`, problems);

  return {
    months,
    totals: totalsOut,
    monthly: monthlyOut,
    sources: sourceList,
    caseTypes: caseTypeList,
    caseMatrix,
    campaigns: campaignList,
    insights: insights.slice(0, 7),
    coverage,
    spendUnmatched: spend.unmatched,
    partialMonths: partial,
    partialNote,
    why,
    grid,
    routes,
    compare,
    pace,
    alerts,
  };
}

/** Spend entered for these months, one row per month and source. */
export async function listMarketingSpend(months: string[]) {
  const db = await getDb();
  if (!db || !months.length) return [];
  const rows = await db.select().from(marketingSpend).where(inArray(marketingSpend.month, months));
  return rows.map((r) => ({ month: r.month, source: r.source, amount: Number(r.amount), updatedBy: r.updatedBy }));
}
