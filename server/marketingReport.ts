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
 * It names every client the firm spoke to, so only canSeeMarketing may call it.
 */
import { and, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getDb, getSetting } from "./db";
import { leaddocketLeads, marketingSpend } from "../drizzle/schema";
import { isSigned, scorecardBucket, type ScoreBucket } from "./signupsReport";

const TZ = "America/Los_Angeles";
export const NO_SOURCE = "No source recorded";

const monthOf = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const keyOf = (s: string) => s.toLowerCase();

/** The source a lead is reported under: its Marketing Source. */
const sourceOf = (l: { marketingSource: string | null }) => clean(l.marketingSource) || NO_SOURCE;

/**
 * Not a BD/FR lead. Those are the Sign-ups Report's and never counted here.
 * Malvin Rosales (Intake) is credited like a rep but isn't BD/FR, and the
 * Sign-ups Report leaves him out — so his leads are counted here, and every
 * Lead Docket lead lands in exactly one of the two reports.
 */
const notBdFr = sql`(${leaddocketLeads.teamRep} IS NULL OR ${leaddocketLeads.teamRole} NOT IN ('BDR', 'FR'))`;

/**
 * Lead Docket names a source per contract or listing — "Walker Advertising
 * Contract 26", "GMB 525 W Main St Visalia" — so the channel view groups those
 * into the vendor or channel they belong to.
 */
const CHANNEL_RULES: [RegExp, string][] = [
  [/^walker advertising\b/i, "Walker Advertising"],
  [/^(gmb\b|google my business)/i, "Google Business Profile (GMB)"],   // Google's old name for it
  [/^intaker\b/i, "Intaker"],
  [/^justin\s*for\s*justice/i, "Justin For Justice"],   // also "JustinforJustice Website"
];
export const channelOfSource = (source: string) => {
  for (const [re, name] of CHANNEL_RULES) if (re.test(source)) return name;
  return source.replace(/\s+(contract|#)\s*\d+$/i, "").trim() || source;
};
export type Grouping = "channel" | "source";

/** Every Pacific month the range touches, oldest first. */
function monthsBetween(from: Date, to: Date) {
  const out: string[] = [];
  let [y, m] = monthOf(from).split("-").map(Number);
  const last = monthOf(to);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The start of a Pacific month, and of the one after it. */
function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: fromZonedTime(`${month}-01T00:00:00`, TZ), end: fromZonedTime(`${next}-01T00:00:00`, TZ) };
}

type Counts = Record<ScoreBucket, number> & { leads: number; signed: number };
const emptyCounts = (): Counts => ({ leads: 0, signed: 0, open: 0, rejected: 0, referredOut: 0, notInterested: 0, signedReferred: 0, signedInHouse: 0 });

/** How much of Lead Docket is loaded — the backfill fills it newest first. */
async function getCoverage() {
  const db = await getDb();
  let stored = { total: 0, stored: 0, remaining: null as number | null, at: null as string | null };
  try {
    const raw = await getSetting("leaddocket_marketing_coverage");
    if (raw) { const v = JSON.parse(raw); stored = { total: v.total ?? 0, stored: v.stored ?? 0, remaining: v.remaining ?? null, at: v.at ?? null }; }
  } catch { /* shown as unknown */ }
  // The backfill reads newest first, so the oldest non-team lead loaded marks
  // how far back the numbers are complete while it is still running.
  let completeFrom: string | null = null;
  if (db) {
    const [r] = await db.select({ d: sql<Date | null>`MIN(${leaddocketLeads.createdDate})` }).from(leaddocketLeads).where(isNull(leaddocketLeads.teamRep));
    completeFrom = r?.d ? new Date(r.d).toISOString() : null;
  }
  const complete = stored.remaining === 0;
  return { ...stored, complete, completeFrom };
}

export async function getMarketingDashboard(range: { from: Date; to: Date }, opts: { group: Grouping }) {
  const db = await getDb();
  if (!db) return null;
  const conds = [gte(leaddocketLeads.leadDate, range.from), lte(leaddocketLeads.leadDate, range.to)];
  conds.push(notBdFr);
  const rows = await db.select({
    leadDate: leaddocketLeads.leadDate, outcome: leaddocketLeads.outcome, caseType: leaddocketLeads.caseType,
    marketingSource: leaddocketLeads.marketingSource, campaign: leaddocketLeads.campaign,
  }).from(leaddocketLeads).where(and(...conds));

  const months = monthsBetween(range.from, range.to);
  const monthIdx = new Map(months.map((m, i) => [m, i]));

  const totals = emptyCounts();
  const monthly = months.map((month) => ({ month, leads: 0, signed: 0 }));
  const sources = new Map<string, Counts & { name: string; cells: number[]; members: Set<string> }>();
  const caseTypes = new Map<string, { name: string; leads: number; signed: number; bySource: Map<string, number> }>();
  const campaigns = new Map<string, { name: string; source: string; leads: number; signed: number }>();
  const matrix = new Map<string, Map<string, { leads: number; signed: number }>>();   // source → case type key → counts

  for (const l of rows) {
    if (!l.leadDate) continue;
    const source = sourceOf(l);
    // "No source" is its own row either way; the rest group by channel on request.
    const channel = opts.group === "channel" && source !== NO_SOURCE ? channelOfSource(source) : source;
    const signed = isSigned(l.outcome);
    const bucket = scorecardBucket(l.outcome);
    const i = monthIdx.get(monthOf(new Date(l.leadDate)));

    totals.leads++; totals[bucket]++; if (signed) totals.signed++;
    if (i !== undefined) { monthly[i].leads++; if (signed) monthly[i].signed++; }

    const s = sources.get(channel) ?? { ...emptyCounts(), name: channel, cells: months.map(() => 0), members: new Set<string>() };
    s.leads++; s[bucket]++;
    if (source !== NO_SOURCE) s.members.add(source);
    if (signed) { s.signed++; if (i !== undefined) s.cells[i]++; }
    sources.set(channel, s);

    const ctName = clean(l.caseType) || "Not recorded";
    const ct = caseTypes.get(keyOf(ctName)) ?? { name: ctName, leads: 0, signed: 0, bySource: new Map() };
    ct.leads++; if (signed) { ct.signed++; ct.bySource.set(channel, (ct.bySource.get(channel) ?? 0) + 1); }
    caseTypes.set(keyOf(ctName), ct);

    const cell = matrix.get(channel) ?? new Map();
    const mc = cell.get(keyOf(ctName)) ?? { leads: 0, signed: 0 };
    mc.leads++; if (signed) mc.signed++;
    cell.set(keyOf(ctName), mc);
    matrix.set(channel, cell);

    const cName = clean(l.campaign);
    if (cName) {
      const ck = keyOf(channel) + "|" + keyOf(cName);
      const c = campaigns.get(ck) ?? { name: cName, source: channel, leads: 0, signed: 0 };
      c.leads++; if (signed) c.signed++;
      campaigns.set(ck, c);
    }
  }

  // Spend entered for the months the range touches, per source.
  const spendRows = months.length
    ? await db.select().from(marketingSpend).where(inArray(marketingSpend.month, months))
    : [];
  const spendBy = new Map<string, number>();
  for (const r of spendRows) spendBy.set(keyOf(clean(r.source)), (spendBy.get(keyOf(clean(r.source))) ?? 0) + Number(r.amount));

  const sourceList = Array.from(sources.values()).map((s) => {
    // A channel's spend is what was entered for it plus for each of its sources.
    const members = Array.from(s.members);
    const parts = [s.name, ...members.filter((m) => m !== s.name)].map((n) => spendBy.get(keyOf(n))).filter((v): v is number => v != null);
    const spend = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
    return {
      ...s,
      members,
      conversion: pct(s.signed, s.leads),
      spend,
      costPerLead: spend != null && s.leads ? Math.round((spend / s.leads) * 100) / 100 : null,
      costPerSignup: spend != null && s.signed ? Math.round((spend / s.signed) * 100) / 100 : null,
    };
  }).sort((a, b) => b.signed - a.signed || b.leads - a.leads || a.name.localeCompare(b.name));

  // Cost across the sources that have spend entered, so unpaid channels don't dilute it.
  const paid = sourceList.filter((s) => s.spend != null);
  const spendTotal = Array.from(spendBy.values()).reduce((a, b) => a + b, 0);
  const paidLeads = paid.reduce((a, s) => a + s.leads, 0);
  const paidSigned = paid.reduce((a, s) => a + s.signed, 0);

  const caseTypeList = Array.from(caseTypes.values())
    .map((c) => ({
      name: c.name, leads: c.leads, signed: c.signed, conversion: pct(c.signed, c.leads),
      topSources: Array.from(c.bySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, signed]) => ({ name, signed })),
    }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads);

  // Sources × case types, for the biggest of each; the rest fold into "All other"
  // (not "Other" — Lead Docket has a case type of that name).
  const mSources = [...sourceList].sort((a, b) => b.leads - a.leads).slice(0, 10).map((s) => s.name);
  const mTypes = [...caseTypeList].sort((a, b) => b.leads - a.leads).slice(0, 6).map((c) => c.name);
  const mTypeKeys = new Set(mTypes.map(keyOf));
  const caseMatrix = {
    types: [...mTypes, "All other"],
    rows: mSources.map((name) => {
      const cells = matrix.get(name) ?? new Map<string, { leads: number; signed: number }>();
      const other = { leads: 0, signed: 0 };
      cells.forEach((v, k) => { if (!mTypeKeys.has(k)) { other.leads += v.leads; other.signed += v.signed; } });
      return { name, cells: [...mTypes.map((t) => cells.get(keyOf(t)) ?? { leads: 0, signed: 0 }), other] };
    }),
  };

  const campaignList = Array.from(campaigns.values())
    .map((c) => ({ ...c, conversion: pct(c.signed, c.leads) }))
    .sort((a, b) => b.leads - a.leads || b.signed - a.signed)
    .slice(0, 30);

  // ── briefing ──
  const insights: string[] = [];
  const top = sourceList.find((s) => s.signed > 0);
  if (top) insights.push(`${top.name} brought the most sign-ups: ${top.signed} of ${totals.signed} (${pct(top.signed, totals.signed)}%).`);
  const minLeads = totals.leads >= 500 ? 25 : 8;
  const best = sourceList.filter((s) => s.leads >= minLeads).sort((a, b) => b.conversion - a.conversion)[0];
  if (best) insights.push(`${best.name} converts best: ${best.conversion}% of its ${best.leads} leads signed (firm average ${pct(totals.signed, totals.leads)}%).`);
  const costed = sourceList.filter((s) => s.costPerSignup != null).sort((a, b) => (a.costPerSignup ?? 0) - (b.costPerSignup ?? 0));
  if (costed.length >= 2) {
    const [cheap, dear] = [costed[0], costed[costed.length - 1]];
    insights.push(`Cheapest sign-ups: ${cheap.name}, $${cheap.costPerSignup!.toLocaleString("en-US")} each; dearest: ${dear.name}, $${dear.costPerSignup!.toLocaleString("en-US")}.`);
  }
  const unsourced = sources.get(NO_SOURCE);
  if (unsourced) insights.push(`${unsourced.leads} leads (${pct(unsourced.leads, totals.leads)}%) have no Marketing Source in Lead Docket, so no channel gets the credit.`);

  const recommendations: string[] = [];
  if (!spendTotal) recommendations.push("Enter each source's monthly spend below to see cost per lead and cost per sign-up.");
  if (unsourced && pct(unsourced.leads, totals.leads) >= 5) recommendations.push("Ask intake to fill in Marketing Source on every new lead — unsourced leads can't be credited or costed.");
  const weak = sourceList.filter((s) => s.leads >= minLeads * 2 && s.conversion < pct(totals.signed, totals.leads) / 2);
  if (weak.length) recommendations.push(`Review lead quality from ${weak.slice(0, 3).map((s) => s.name).join(", ")} — they convert at less than half the firm's rate.`);

  return {
    months,
    totals: {
      ...totals,
      conversion: pct(totals.signed, totals.leads),
      sources: sourceList.length,
      spend: spendTotal || null,
      costPerLead: paidLeads ? Math.round((spendTotal / paidLeads) * 100) / 100 : null,
      costPerSignup: paidSigned ? Math.round((spendTotal / paidSigned) * 100) / 100 : null,
    },
    monthly: monthly.map((m) => ({ ...m, conversion: pct(m.signed, m.leads) })),
    sources: sourceList,
    caseTypes: caseTypeList,
    caseMatrix,
    campaigns: campaignList,
    insights,
    recommendations,
    coverage: await getCoverage(),
  };
}

/** The clients behind the numbers: filtered, newest first, a page at a time. */
export async function getMarketingLeads(q: {
  from: Date; to: Date; source?: string; sources?: string[]; month?: string;
  status?: "all" | "signed" | "open"; search?: string; limit: number;
}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const L = leaddocketLeads;
  const conds = [gte(L.leadDate, q.from), lte(L.leadDate, q.to)];
  conds.push(notBdFr);
  if (q.source === NO_SOURCE) conds.push(or(isNull(L.marketingSource), eq(L.marketingSource, ""))!);
  // A channel row passes the Lead Docket sources it groups.
  else if (q.sources?.length) conds.push(inArray(L.marketingSource, q.sources));
  else if (q.source) conds.push(eq(L.marketingSource, q.source));
  if (q.month) {
    const { start, end } = monthBounds(q.month);
    conds.push(gte(L.leadDate, start), lt(L.leadDate, end));
  }
  // Signed = the outcomes isSigned counts (the sync writes "Signed" / "Signed Referred Out").
  const signedCond = or(eq(L.outcome, "Signed"), eq(L.outcome, "Signed Referred Out"), eq(L.outcome, "Referral Accepted"))!;
  if (q.status === "signed") conds.push(signedCond);
  if (q.status === "open") conds.push(sql`NOT (${signedCond})`);
  const term = clean(q.search);
  if (term) {
    const p = `%${term}%`;
    conds.push(or(like(L.clientName, p), like(L.caseType, p), like(L.campaign, p), like(L.marketingSource, p), like(L.city, p))!);
  }
  const where = and(...conds);
  const [[count], rows] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)` }).from(L).where(where),
    db.select({
      id: L.leadId, name: L.clientName, caseType: L.caseType, marketingSource: L.marketingSource,
      campaign: L.campaign, leadDate: L.leadDate, outcome: L.outcome, city: L.city, intakeBy: L.intakeBy,
    }).from(L).where(where).orderBy(desc(L.leadDate)).limit(q.limit),
  ]);
  return {
    total: Number(count?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      name: clean(r.name) || `Lead ${r.id}`,
      caseType: clean(r.caseType) || "Not recorded",
      source: sourceOf(r),
      detail: clean(r.campaign) || null,
      date: r.leadDate ? new Date(r.leadDate).toISOString() : null,
      outcome: clean(r.outcome),
      signed: isSigned(r.outcome),
      city: clean(r.city) || null,
      intakeBy: clean(r.intakeBy) || null,
    })),
  };
}

/** Spend entered for these months, one row per month and source. */
export async function listMarketingSpend(months: string[]) {
  const db = await getDb();
  if (!db || !months.length) return [];
  const rows = await db.select().from(marketingSpend).where(inArray(marketingSpend.month, months));
  return rows.map((r) => ({ month: r.month, source: r.source, amount: Number(r.amount), updatedBy: r.updatedBy }));
}

/** Set one source's spend for one month; null or 0 clears it. */
export async function setMarketingSpend(month: string, source: string, amount: number | null, by: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const name = clean(source).slice(0, 255);
  const where = and(eq(marketingSpend.month, month), eq(marketingSpend.source, name));
  if (amount == null || amount === 0) {
    await db.delete(marketingSpend).where(where);
    return { ok: true as const };
  }
  const [have] = await db.select({ id: marketingSpend.id }).from(marketingSpend).where(where).limit(1);
  if (have) await db.update(marketingSpend).set({ amount: amount.toFixed(2), updatedBy: by.slice(0, 255) }).where(eq(marketingSpend.id, have.id));
  else await db.insert(marketingSpend).values({ month, source: name, amount: amount.toFixed(2), updatedBy: by.slice(0, 255) });
  return { ok: true as const };
}
