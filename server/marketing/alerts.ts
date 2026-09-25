/**
 * 'Needs attention': the few things in this period worth acting on — a Google
 * listing that stopped bringing leads, a vendor whose sign-ups fell, spend with
 * nothing signed, leads still open — each opening the clients behind it.
 *
 * Every alert that states a lead count carries the drill scope of that count,
 * so the clients it opens add up to the number in its sentence. The comparison
 * rules read only compare.byName and compare.totals, which reconcile with the
 * scorecard, and stay silent while the earlier period isn't fully loaded — a
 * half-loaded year must never read as a collapse. Gone-quiet is the one alert
 * not about the selected range: it measures arrivals over the last 63 days up
 * to the last sync, says so, and never feeds a report total.
 */
import { and, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { leaddocketLeads } from "../../drizzle/schema";
import {
  NO_SOURCE, channelOfSource, clean, keyOf, notBdFr, pct,
  type DrillLink, type DrillScope, type Lead, type RowRef,
} from "./common";
import type { Comparison } from "./compare";
import { periodLoaded, type Coverage } from "./coverage";

// ── thresholds (AlertsAccordion in client/src/pages/marketing/Attention.tsx says these in words) ──

// Swing: a row's leads or sign-ups against the comparison period. Both bars
// must be cleared — a third is a real change for a big channel, and 2√E keeps
// a small one's ordinary wobble (Poisson-ish counts) from tripping it.
const SWING_MIN_LEADS = 15;    // prior leads a row needs before its leads are judged
const SWING_MIN_SIGNED = 6;    // prior sign-ups before its sign-ups are
const SWING_SHARE = 0.3;
const SWING_SIGMAS = 2;
const SWING_MAX = 3;           // the strip is meant to be read in five seconds

// Conversion drop, per row: enough leads on both sides for a rate to mean something.
const CONV_MIN_LEADS = 30;
const CONV_MIN_DROP = 5;       // percentage points
const CONV_Z = -2;             // pooled two-proportion z

// Gone quiet: nine weeks gives a steady rate yet still reflects what a listing does now.
const QUIET_DAYS = 63;
const QUIET_MIN_LEADS = 20;    // in those 63 days; below that a gap is normal
const QUIET_MISSING = 5;       // rate × silent days: the leads the silence should have brought
const QUIET_MIN_GAP = 2;       // days, so a busy channel's quiet morning isn't news
// Word of mouth and staff aren't marketing that can switch off.
const QUIET_SKIP = /existing client|employee|referr/i;
// Each Google listing is its own asset (one address can lose its ranking while the
// rest carry on), so listings are judged one by one; every other source by channel,
// where Walker's and Intaker's contract numbers roll over without meaning anything.
const GMB_CHANNEL = channelOfSource("GMB");

const COST_RISE = 0.25;        // cost per sign-up, between whole months with spend entered
const OPEN_MIN = 5;
const UNSOURCED_PCT = 5;

const DAY = 86_400_000;
const EPS = 1e-9;              // so a value exactly on a threshold isn't lost to floating point

export type Alert = { key: string; level: "bad" | "warn" | "good"; text: string; drill?: DrillLink; action?: "spend"; asOfSync?: true };

export type QuietRow = { source: string; n: number; last: Date };

/**
 * Leads per Marketing Source that arrived in the last 63 days, and when the
 * newest came in. Independent of the selected range: it asks whether each
 * source is still producing, not how the period went.
 */
export async function loadQuiet(now: Date): Promise<QuietRow[]> {
  const db = await getDb();
  if (!db) return [];
  const L = leaddocketLeads;
  const since = new Date(now.getTime() - QUIET_DAYS * DAY);
  const rows = await db.select({
    source: L.marketingSource,
    n: sql<number>`COUNT(*)`,
    // Decoded as the column is, so the naive UTC datetime isn't read in the server's zone.
    last: sql<Date | null>`MAX(${L.createdDate})`.mapWith(L.createdDate),
  // Marketing sources only: a rep's leads name the rep ("BDR Grace Lanayon"), and
  // the team doesn't go quiet the way a paid source does.
  }).from(L).where(and(gte(L.createdDate, since), notBdFr)).groupBy(L.marketingSource);
  const out: QuietRow[] = [];
  for (const r of rows) {
    const last = r.last ? new Date(r.last) : null;
    if (!last || Number.isNaN(last.getTime())) continue;
    out.push({ source: clean(r.source) || NO_SOURCE, n: Number(r.n) || 0, last });
  }
  return out;
}

type Row = RowRef & { leads: number; signed: number; open: number; conversion: number; spend: number | null; costPerSignup: number | null };

// tier orders alerts within a level: the statistical ones by how unlikely they
// are (score ≈ z), then the ones measured in money or counts, then housekeeping.
type Ranked = Alert & { tier: number; score: number };
const LEVEL_ORDER = { bad: 0, warn: 1, good: 2 } as const;

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

/** The same rule as the page's scopeOf: a channel asks for its Lead Docket sources. */
const scopeOfRow = (r: RowRef): DrillScope =>
  r.name === NO_SOURCE || !r.members.length ? { source: r.name } : { sources: r.members };
const rowDrill = (r: RowRef, status: "signed" | "all"): DrillLink => ({ title: r.name, scope: scopeOfRow(r), status });

// byName is a plain record keyed by names from Lead Docket; don't let one called
// 'constructor' find Object's.
const priorOf = (c: Comparison, name: string) =>
  Object.prototype.hasOwnProperty.call(c.byName, name) ? c.byName[name] : undefined;

export function buildAlerts(i: {
  leads: Lead[];
  rows: Row[];
  totals: { leads: number; signed: number; open: number; conversion: number; spend: number | null; costPerSignup: number | null };
  compare: Comparison | null;
  quiet: QuietRow[];
  coverage: Coverage;
  now: Date;
  /** Where the selected range starts (Pacific midnight), to tell whether its leads are all loaded yet. */
  rangeFrom: Date;
  rangeInProgress: boolean;
  minLeads: number;
}): Alert[] {
  const out: Ranked[] = [];
  // A partial comparison would compare against leads not loaded yet.
  const c = i.compare && !i.compare.partial ? i.compare : null;

  if (c) {
    const sw = swings(i.rows, c);
    out.push(...sw);
    // A row whose sign-ups already fell says it once.
    const fell = new Set(sw.filter((a) => a.level === "bad" && a.key.startsWith("swing:signed:")).map((a) => a.key.slice("swing:signed:".length)));
    out.push(...conversionDrops(i.rows, c, fell));
    const cost = costRise(i.totals.costPerSignup, c);
    if (cost) out.push(cost);
  }

  out.push(...goneQuiet(i.quiet, i.coverage, i.now));
  // Its sign-ups may just not be loaded yet; spendNotes already says that period's cost is too high for now.
  if (periodLoaded(i.coverage, i.rangeFrom)) out.push(...spendWithoutSignups(i.rows, i.rangeInProgress));
  const open = stillOpen(i.leads, i.totals.open);
  if (open) out.push(open);
  out.push(...housekeeping(i));

  return out
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.tier - b.tier || b.score - a.score)
    .map(({ tier, score, ...a }) => a);
}

/** How far a count moved, when that's more than chance and more than a trifle; null otherwise. */
function moved(cur: number, prior: number, min: number) {
  if (prior < min) return null;
  const d = cur - prior;
  if (Math.abs(d) < Math.max(SWING_SHARE * prior, SWING_SIGMAS * Math.sqrt(prior)) - EPS) return null;
  return { d, score: Math.abs(d) / Math.sqrt(prior) };
}

/** a. Rows whose sign-ups (or, failing that, leads) swung against the comparison. */
function swings(rows: Row[], c: Comparison): Ranked[] {
  const here = new Set(rows.map((r) => r.name));
  // Gone rows count as zero now: a vendor that stopped entirely is the biggest drop of all.
  const all: { ref: RowRef; leads: number; signed: number; gone: boolean }[] = [
    ...rows.map((r) => ({ ref: r as RowRef, leads: r.leads, signed: r.signed, gone: false })),
    ...c.gone.filter((g) => !here.has(g.name)).map((g) => ({ ref: { name: g.name, members: g.members }, leads: 0, signed: 0, gone: true })),
  ];
  const found: Ranked[] = [];
  for (const r of all) {
    // Unsourced leads aren't a channel; the housekeeping alert covers them.
    if (r.ref.name === NO_SOURCE) continue;
    const prior = priorOf(c, r.ref.name);
    if (!prior) continue;
    const s = moved(r.signed, prior.signed, SWING_MIN_SIGNED);
    const l = s ? null : moved(r.leads, prior.leads, SWING_MIN_LEADS);
    const m = s ? { ...s, what: "signed" as const, cur: r.signed, was: prior.signed } : l ? { ...l, what: "leads" as const, cur: r.leads, was: prior.leads } : null;
    if (!m) continue;
    const noun = m.what === "signed" ? "sign-ups" : "leads";
    found.push({
      key: `swing:${m.what}:${r.ref.name}`,
      level: m.d < 0 ? "bad" : "good",
      text: `${r.ref.name} ${noun} ${m.d < 0 ? "down" : "up"} ${fmt(Math.abs(m.d))} (${fmt(m.was)} → ${fmt(m.cur)}) vs ${c.label}.`
        + (r.gone ? " No leads at all this period." : ""),
      // The number after the arrow is what the drill opens: signed clients for a sign-up swing, all for a lead swing.
      ...(r.gone ? {} : { drill: rowDrill(r.ref, m.what === "signed" ? "signed" : "all") }),
      tier: 0,
      score: m.score,
    });
  }
  // Drops first: they're what needs acting on.
  return found
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.score - a.score)
    .slice(0, SWING_MAX);
}

/** b. Rows converting clearly worse than in the comparison period. */
function conversionDrops(rows: Row[], c: Comparison, skip: Set<string>): Ranked[] {
  const out: Ranked[] = [];
  for (const r of rows) {
    if (r.name === NO_SOURCE || skip.has(r.name)) continue;
    const prior = priorOf(c, r.name);
    if (!prior || r.leads < CONV_MIN_LEADS || prior.leads < CONV_MIN_LEADS) continue;
    const p1 = r.signed / r.leads, p0 = prior.signed / prior.leads;
    if ((p0 - p1) * 100 < CONV_MIN_DROP - EPS) continue;
    const p = (r.signed + prior.signed) / (r.leads + prior.leads);
    const se = Math.sqrt(p * (1 - p) * (1 / r.leads + 1 / prior.leads));
    if (!se) continue;
    const z = (p1 - p0) / se;
    if (z > CONV_Z + EPS) continue;
    out.push({
      key: `conv:${r.name}`,
      level: "warn",
      text: `${r.name} converts at ${pct(r.signed, r.leads)}%, down from ${pct(prior.signed, prior.leads)}% in ${c.label} (${plural(r.leads, "lead")} this period).`,
      drill: rowDrill(r, "all"),
      tier: 0,
      score: -z,
    });
  }
  return out;
}

/** e. Cost per sign-up up by a quarter or more — only between whole months with spend entered. */
function costRise(cur: number | null, c: Comparison): Ranked | null {
  const was = c.totals.costPerSignup;
  if (!c.costComparable || cur == null || !was || was <= 0) return null;
  const rise = cur / was - 1;
  if (rise < COST_RISE - EPS) return null;
  return {
    key: "cost",
    level: "warn",
    text: `Cost per sign-up rose ${Math.round(rise * 100)}% on ${c.label} (${usd(was)} → ${usd(cur)}).`,
    tier: 2,
    score: rise,
  };
}

/** c. Sources that normally bring leads steadily and have gone silent, as of the last sync. */
function goneQuiet(quiet: QuietRow[], coverage: Coverage, now: Date): Ranked[] {
  // Until the backfill reaches past the window, a gap may just be leads not loaded yet.
  if (coverage.trustedFrom && new Date(coverage.trustedFrom).getTime() > now.getTime() - QUIET_DAYS * DAY) return [];
  // Silence is measured to the last sync, not to now: a late sync must not read as a quiet listing.
  const asOf = Date.parse(coverage.asOf);
  const at = Number.isFinite(asOf) ? asOf : now.getTime();

  const units = new Map<string, { name: string; listing: boolean; n: number; last: number }>();
  for (const q of quiet) {
    const source = clean(q.source) || NO_SOURCE;
    const last = new Date(q.last).getTime();
    if (source === NO_SOURCE || QUIET_SKIP.test(source) || !Number.isFinite(last)) continue;
    const channel = channelOfSource(source);
    const listing = channel === GMB_CHANNEL;
    const name = listing ? source : channel;
    if (QUIET_SKIP.test(name)) continue;
    const u = units.get(keyOf(name)) ?? { name, listing, n: 0, last: -Infinity };
    u.n += Number(q.n) || 0;
    u.last = Math.max(u.last, last);
    units.set(keyOf(name), u);
  }

  const out: Ranked[] = [];
  units.forEach((u) => {
    if (u.n < QUIET_MIN_LEADS) return;
    const perDay = u.n / QUIET_DAYS;
    const gap = (at - u.last) / DAY;
    const missing = perDay * gap;
    if (gap < QUIET_MIN_GAP - EPS || missing < QUIET_MISSING - EPS) return;
    const usual = perDay >= 3 ? `about ${fmt(Math.round(perDay))} a day` : `about ${fmt(Math.round(perDay * 7))} a week`;
    out.push({
      key: `quiet:${keyOf(u.name)}`,
      level: "bad",
      text: `${u.name}: no leads for ${Math.floor(gap)} days; it averages ${usual}. ${u.listing ? "Check the listing." : "Check it is still running."}`,
      asOfSync: true,
      tier: 0,
      // As unlikely as a count of 0 against an expected `missing`: (E − 0) / √E.
      score: Math.sqrt(missing),
    });
  });
  return out;
}

/** d. Rows with spend entered and nobody signed. Only amber while the period is still running; off until it is loaded. */
function spendWithoutSignups(rows: Row[], inProgress: boolean): Ranked[] {
  return rows
    .filter((r) => (r.spend ?? 0) > 0 && r.signed === 0)
    .map((r) => ({
      key: `nosign:${r.name}`,
      level: inProgress ? ("warn" as const) : ("bad" as const),
      text: `${r.name}: ${usd(r.spend!)} entered, no sign-ups ${inProgress ? "yet " : ""}this period (${plural(r.leads, "lead")}).`,
      drill: rowDrill(r, "all"),
      tier: 1,
      score: r.spend!,
    }));
}

/** f. Leads with no outcome yet — the same count, and the same clients, as the scorecard's Open TOTAL. */
function stillOpen(leads: Lead[], open: number): Ranked | null {
  if (open < OPEN_MIN) return null;
  const byStatus = new Map<string, number>();
  for (const l of leads) {
    if (l.bucket !== "open") continue;
    const s = clean(l.status);
    if (s) byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const top = Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2);
  const detail = top.length ? ` (${top.map(([s, n]) => `${s} ${fmt(n)}`).join(", ")})` : "";
  return {
    key: "open",
    level: "warn",
    text: `${fmt(open)} ${open === 1 ? "lead" : "leads"} from this period ${open === 1 ? "is" : "are"} still open${detail} — worth a push from intake.`,
    drill: { title: "All leads", chips: ["Open"], scope: { bucket: "open" }, status: "all" },
    tier: 3,
    score: open,
  };
}

/** g. What used to be Recommendations: setup and data-quality nudges. */
function housekeeping(i: { rows: Row[]; totals: { leads: number; conversion: number; spend: number | null }; minLeads: number }): Ranked[] {
  const out: Ranked[] = [];
  if (!i.totals.leads) return out;
  if (!i.totals.spend) {
    out.push({ key: "spend", level: "warn", text: "Enter each channel's monthly spend below to see cost per sign-up.", action: "spend", tier: 4, score: 0 });
  }
  const unsourced = i.rows.find((r) => r.name === NO_SOURCE);
  const share = unsourced ? pct(unsourced.leads, i.totals.leads) : 0;
  if (unsourced && share >= UNSOURCED_PCT) {
    out.push({
      key: "unsourced",
      level: "warn",
      text: `${plural(unsourced.leads, "lead")} (${share}%) have no Marketing Source, so no channel gets the credit — ask intake to fill it in on every new lead.`,
      drill: { title: NO_SOURCE, scope: { source: NO_SOURCE }, status: "all" },
      tier: 5,
      score: share,
    });
  }
  const weak = i.rows.filter((r) => r.leads >= 2 * i.minLeads && r.conversion < i.totals.conversion / 2);
  if (weak.length) {
    const names = weak.slice(0, 3).map((r) => r.name).join(", ");
    out.push({
      key: "weak",
      level: "warn",
      text: `Review lead quality from ${names} — ${weak.length === 1 ? "it converts" : "they convert"} at under half the firm's rate of ${i.totals.conversion}%.`,
      drill: rowDrill(weak[0], "all"),
      tier: 6,
      score: 0,
    });
  }
  return out;
}
