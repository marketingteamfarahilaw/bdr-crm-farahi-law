/**
 * Marketing spend: loading it, matching it to the report's rows so every
 * dollar lands in exactly one place, and entering it.
 *
 * Money is added up in integer cents throughout, so the rows, the "Spend with
 * no matching leads" line and the TOTAL agree to the cent however many months
 * and names are summed.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { leaddocketLeads, marketingSpend } from "../../drizzle/schema";
import { channelOfSource } from "@shared/marketing";
import { clean, keyOf, monthOf, notBdFr, type Grouping, type RowRef } from "./common";
import type { MonthState } from "./coverage";

export type SpendRow = { month: string; source: string; amount: number };

const toCents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const dollars = (c: number) => (c / 100).toFixed(2);   // for the decimal(12,2) column

/** Spend entered for these months, one row per month and name as stored. */
export async function loadSpend(months: string[]): Promise<SpendRow[]> {
  const db = await getDb();
  if (!db || !months.length) return [];
  const rows = await db.select({ month: marketingSpend.month, source: marketingSpend.source, amount: marketingSpend.amount })
    .from(marketingSpend).where(inArray(marketingSpend.month, months));
  return rows.map((r) => ({ month: r.month, source: r.source, amount: Number(r.amount) }));
}

export type SpendAssignment = {
  byRow: Map<string, number>;                  // row name -> spend in range; only rows that have spend
  byRowMonth: Map<string, (number | null)[]>;  // aligned to months; null = nothing entered
  byMonth: (number | null)[];                  // every spend row, matched or not
  unmatched: { source: string; amount: number; why: "noLeads" | "channel" }[]; // summed across months, largest first
  total: number;                               // = sum(byRow) + sum(unmatched), exactly
};

/**
 * Puts each spend row on exactly one scorecard row, or on the unmatched list.
 *
 * Channel view matches by the channel the spend's name belongs to, not by the
 * channel's member sources — members only lists sources that had leads, so
 * spend on a new contract with no leads yet used to vanish from its channel.
 * Rows are matched case-insensitively and the first row wins, so two rows that
 * differ only in letter case never both take the same dollars.
 */
export function assignSpend(spend: SpendRow[], rows: RowRef[], group: Grouping, months: string[]): SpendAssignment {
  const monthIdx = new Map(months.map((m, i) => [m, i] as [string, number]));
  const rowByKey = new Map<string, string>();
  for (const r of rows) if (!rowByKey.has(keyOf(r.name))) rowByKey.set(keyOf(r.name), r.name);
  // In Source view, spend entered under a channel's name has no row of its own;
  // saying so beats listing it as if the vendor brought no leads.
  const channelKeys = new Set(rows.map((r) => keyOf(channelOfSource(r.name))));

  const rowCents = new Map<string, number>();
  const rowMonthCents = new Map<string, (number | null)[]>();
  const monthCents: (number | null)[] = months.map(() => null);
  type Lost = { source: string; month: string; cents: number; why: SpendAssignment["unmatched"][number]["why"] };
  const lost = new Map<string, Lost>();

  for (const s of spend) {
    const i = monthIdx.get(s.month);
    const cents = toCents(Number(s.amount));
    // Months outside the range belong to another period (the comparison loads
    // its own), and a $0 row carries no money to place.
    if (i === undefined || !Number.isFinite(cents) || cents === 0) continue;
    const n = clean(s.source);
    const target = group === "channel"
      ? rowByKey.get(keyOf(channelOfSource(n))) ?? rowByKey.get(keyOf(n))
      : rowByKey.get(keyOf(n));
    monthCents[i] = (monthCents[i] ?? 0) + cents;
    if (target !== undefined) {
      rowCents.set(target, (rowCents.get(target) ?? 0) + cents);
      const cells = rowMonthCents.get(target) ?? months.map((): number | null => null);
      cells[i] = (cells[i] ?? 0) + cents;
      rowMonthCents.set(target, cells);
      continue;
    }
    const k = keyOf(n);
    const u: Lost = lost.get(k) ?? { source: n, month: s.month, cents: 0, why: group === "source" && channelKeys.has(k) ? "channel" : "noLeads" };
    u.cents += cents;
    // Shown as most recently entered, when case twins were typed differently.
    if (s.month >= u.month) { u.month = s.month; u.source = n || u.source; }
    lost.set(k, u);
  }

  // In the scorecard's row order, so anything that walks byRow reads like the page.
  const byRow = new Map<string, number>();
  const byRowMonth = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const c = rowCents.get(r.name);
    if (c === undefined || byRow.has(r.name)) continue;
    byRow.set(r.name, fromCents(c));
    byRowMonth.set(r.name, (rowMonthCents.get(r.name) ?? []).map((v) => (v == null ? null : fromCents(v))));
  }
  const unmatched = Array.from(lost.values())
    .sort((a, b) => b.cents - a.cents || a.source.localeCompare(b.source))
    .map((u) => ({ source: u.source || "(no name)", amount: fromCents(u.cents), why: u.why }));
  const total = monthCents.reduce<number>((a, c) => a + (c ?? 0), 0);

  return {
    byRow,
    byRowMonth,
    byMonth: monthCents.map((c) => (c == null ? null : fromCents(c))),
    unmatched,
    total: fromCents(total),
  };
}

/**
 * The range's first and last month when the range covers only part of them.
 * Spend is monthly, so such a month's whole spend is set against part of its
 * leads. from and to are yyyy-MM-dd Pacific calendar dates.
 */
export function partialMonths(from: string, to: string): { month: string; covered: number; days: number }[] {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to) || to < from) return [];
  const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const fm = from.slice(0, 7), tm = to.slice(0, 7);
  const fd = Number(from.slice(8, 10)), td = Number(to.slice(8, 10));
  const out: { month: string; covered: number; days: number }[] = [];
  if (fm === tm) {
    const days = daysIn(fm), covered = Math.min(td, days) - fd + 1;
    if (covered < days) out.push({ month: fm, covered, days });
    return out;
  }
  const fdays = daysIn(fm);
  if (fd > 1) out.push({ month: fm, covered: fdays - fd + 1, days: fdays });
  const tdays = daysIn(tm);
  if (td < tdays) out.push({ month: tm, covered: td, days: tdays });
  return out;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (m: string, withYear: boolean) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] + (withYear ? ` ${m.slice(0, 4)}` : "");
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const listed = (names: string[]) =>
  names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

/**
 * The sentences that explain when cost per sign-up can't be taken at face
 * value: a month only partly in the range, or one whose leads are still
 * loading. Only months with spend entered are mentioned — without spend there
 * is no cost to mislead.
 *
 * opts.group only picks the word for the unmatched line. opts.today (Pacific
 * yyyy-MM-dd, defaulting to now) says whether a part month is still running:
 * only then will its cost per sign-up come down on its own.
 */
export function spendNotes(
  a: SpendAssignment, partial: ReturnType<typeof partialMonths>, states: MonthState[], months: string[],
  opts: { group?: Grouping; today?: string } = {},
): { partialNote: string | null; insights: string[] } {
  const group = opts.group ?? "channel";
  const running = opts.today ? opts.today.slice(0, 7) : monthOf(new Date());
  const hasSpend = (m: string) => { const i = months.indexOf(m); return i >= 0 && (a.byMonth[i] ?? 0) > 0; };
  const oneYear = months.length > 0 && months[0].slice(0, 4) === months[months.length - 1].slice(0, 4);
  const sentences: string[] = [];

  for (const p of partial) {
    if (!hasSpend(p.month)) continue;
    const tail = p.month === running ? "runs high until the month ends" : "runs high";
    sentences.push(`${monthWords(p.month, !oneYear)}'s spend counts in full, but this range covers ${p.covered} of its ${p.days} days, so its cost per sign-up ${tail}.`);
  }

  const loading = months.filter((m, i) => states[i] != null && states[i] !== "full" && hasSpend(m));
  if (loading.length === 1) {
    sentences.push(`${monthWords(loading[0], true)}'s leads are still loading, so its cost per sign-up is too high for now.`);
  } else if (loading.length > 1) {
    const words = loading.map((m) => monthWords(m, true));
    const which = words.length <= 3
      ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
      : `${words.length} months between ${words[0]} and ${words[words.length - 1]}`;
    sentences.push(`Leads for ${which} are still loading, so their cost per sign-up is too high for now.`);
  }

  const partialNote = sentences.length ? sentences.join(" ") : null;
  const insights: string[] = [];
  if (partialNote) insights.push(partialNote);
  const noLeads = a.unmatched.filter((u) => u.why === "noLeads");
  if (noLeads.length) {
    const sum = fromCents(noLeads.reduce((s, u) => s + toCents(u.amount), 0));
    insights.push(`${money(sum)} of spend (${listed(noLeads.map((u) => u.source))}) matches no ${group === "source" ? "source" : "channel"} with leads this period.`);
  }
  const channel = a.unmatched.filter((u) => u.why === "channel");
  if (channel.length) {
    const sum = fromCents(channel.reduce((s, u) => s + toCents(u.amount), 0));
    insights.push(`${money(sum)} of spend (${listed(channel.map((u) => u.source))}) was entered for a whole channel, so only the Channels view sets it against leads.`);
  }
  return { partialNote, insights };
}

/**
 * The reconciliation problems in an assignment, given the Spend cell of every
 * scorecard row (sources[].spend, in any order). Empty means every dollar is
 * on exactly one row or the unmatched line, and the months, rows and TOTAL
 * all add up to the cent.
 */
export function checkSpend(a: SpendAssignment, rowSpend: (number | null)[]): string[] {
  const out: string[] = [];
  const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((s, x) => s + (x == null ? 0 : toCents(x)), 0);
  const shownAs = (c: number) => money(fromCents(c));
  const total = toCents(a.total);
  const rows = sum(Array.from(a.byRow.values()));
  const lost = sum(a.unmatched.map((u) => u.amount));
  const cells = sum(rowSpend);
  const months = sum(a.byMonth);

  if (rows + lost !== total) out.push(`spend: rows ${shownAs(rows)} + unmatched ${shownAs(lost)} ≠ total ${shownAs(total)}`);
  if (cells + lost !== total) out.push(`spend: scorecard Spend cells ${shownAs(cells)} + unmatched ${shownAs(lost)} ≠ total ${shownAs(total)}`);
  if (months !== total) out.push(`spend: months ${shownAs(months)} ≠ total ${shownAs(total)}`);
  const shown = rowSpend.filter((v) => v != null).length;
  if (shown !== a.byRow.size) out.push(`spend: ${shown} scorecard rows show spend but ${a.byRow.size} rows were assigned it`);

  a.byRow.forEach((v, name) => {
    const m = a.byRowMonth.get(name);
    if (!m) { out.push(`spend: ${name} has no monthly spend`); return; }
    if (m.length !== a.byMonth.length) out.push(`spend: ${name} has ${m.length} months, not ${a.byMonth.length}`);
    if (sum(m) !== toCents(v)) out.push(`spend: ${name}'s months ${shownAs(sum(m))} ≠ its spend ${shownAs(toCents(v))}`);
  });
  a.byRowMonth.forEach((_, name) => { if (!a.byRow.has(name)) out.push(`spend: ${name} has monthly spend but no total`); });
  // Spend is never negative, so no month's rows can hold more than the month.
  a.byMonth.forEach((v, i) => {
    let placed = 0;
    a.byRowMonth.forEach((m) => { const c = m[i]; if (c != null) placed += toCents(c); });
    const month = v == null ? 0 : toCents(v);
    if (placed > month) out.push(`spend: month ${i + 1}'s rows ${shownAs(placed)} exceed its spend ${shownAs(month)}`);
  });

  const seen = new Set<string>();
  for (const u of a.unmatched) {
    const k = keyOf(u.source);
    if (seen.has(k)) out.push(`spend: "${u.source}" is on the unmatched list twice`);
    seen.add(k);
    if (a.byRow.has(u.source)) out.push(`spend: "${u.source}" is both a row and unmatched`);
  }
  return out;
}

/**
 * Every Marketing Source the report's leads use, with how many leads and the
 * latest, for the spend editor's suggestions and its "not a Lead Docket name"
 * check. Names that differ only in case or spacing are one name there, as
 * they are when spend is matched.
 */
export async function listSourceNames(): Promise<{ source: string; channel: string; leads: number; last: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const L = leaddocketLeads;
  const count = sql<number>`COUNT(*)`;
  const rows = await db.select({ source: L.marketingSource, leads: count, last: sql<Date | string | null>`MAX(${L.leadDate})` })
    .from(L)
    .where(and(notBdFr, isNotNull(L.marketingSource), ne(L.marketingSource, "")))
    .groupBy(L.marketingSource)
    .orderBy(desc(count))
    .limit(1000);

  const byKey = new Map<string, { source: string; top: number; leads: number; last: number | null }>();
  for (const r of rows) {
    const source = clean(r.source);
    if (!source) continue;
    const leads = Number(r.leads) || 0;
    // mysql2 returns a Date (the pool reads as UTC); a bare string is UTC too,
    // and new Date() would read it in the server's Pacific zone.
    const t = r.last instanceof Date ? r.last.getTime()
      : r.last ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(r.last) ? r.last : r.last.replace(" ", "T") + "Z") : NaN;
    const last = Number.isFinite(t) ? t : null;
    const have = byKey.get(keyOf(source));
    if (!have) { byKey.set(keyOf(source), { source, top: leads, leads, last }); continue; }
    have.leads += leads;
    // The spelling most leads use is the one to suggest.
    if (leads > have.top) { have.top = leads; have.source = source; }
    if (last != null && (have.last == null || last > have.last)) have.last = last;
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source))
    .map((v) => ({ source: v.source, channel: channelOfSource(v.source), leads: v.leads, last: v.last == null ? null : new Date(v.last).toISOString() }));
}

/**
 * Set one name's spend for one month; null or 0 clears it. The name is found
 * case-insensitively (TiDB compares case-sensitively), so typing "walker
 * advertising" updates "Walker Advertising" instead of adding a case twin. It
 * is a one-row setSpendMany, so a name is matched by the same rule however it
 * was saved — and the same rule the report matches spend to rows by.
 */
export async function setSpendOne(month: string, source: string, amount: number | null, by: string): Promise<{ ok: true }> {
  const name = clean(source).slice(0, 255);
  if (!name) throw new Error("Enter a name for the spend.");
  await setSpendMany(month, [{ source: name, amount }], by);
  return { ok: true };
}

/** A month's rows by name key, oldest first, as setSpendMany and copySpend match them. */
type Stored = { id: number; cents: number };
const byName = (rows: { id: number; source: string; amount: string | number }[]) => {
  const out = new Map<string, Stored[]>();
  for (const r of rows) {
    const k = keyOf(clean(r.source));
    const list = out.get(k) ?? [];
    list.push({ id: r.id, cents: toCents(Number(r.amount)) });
    out.set(k, list);
  }
  return out;
};

/**
 * Save a pasted list for one month, all or nothing. A name given twice takes
 * its last amount; null or 0 clears it. Existing names are matched
 * case-insensitively and updated in place.
 */
export async function setSpendMany(
  month: string, rows: { source: string; amount: number | null }[], by: string,
): Promise<{ saved: number; cleared: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const want = new Map<string, { source: string; cents: number }>();
  for (const r of rows) {
    const source = clean(r.source).slice(0, 255);
    if (!source) continue;
    const k = keyOf(source);
    want.delete(k);   // re-insert, so the last spelling and amount win
    want.set(k, { source, cents: r.amount == null ? 0 : toCents(r.amount) });
  }
  if (!want.size) return { saved: 0, cleared: 0 };
  const who = by.slice(0, 255);

  return db.transaction(async (tx) => {
    const have = byName(await tx.select({ id: marketingSpend.id, source: marketingSpend.source, amount: marketingSpend.amount })
      .from(marketingSpend).where(eq(marketingSpend.month, month)).orderBy(marketingSpend.id));
    const drop: number[] = [];
    const add: { month: string; source: string; amount: string; updatedBy: string }[] = [];
    let saved = 0, cleared = 0;
    for (const [k, w] of Array.from(want.entries())) {
      const got = have.get(k) ?? [];
      if (!w.cents) {
        if (got.length) { got.forEach((g) => drop.push(g.id)); cleared++; }
        continue;
      }
      saved++;
      if (!got.length) { add.push({ month, source: w.source, amount: dollars(w.cents), updatedBy: who }); continue; }
      if (got[0].cents !== w.cents) {
        await tx.update(marketingSpend).set({ amount: dollars(w.cents), updatedBy: who }).where(eq(marketingSpend.id, got[0].id));
      }
      // Case twins the old editor could leave would otherwise be added on top.
      got.slice(1).forEach((g) => drop.push(g.id));
    }
    if (drop.length) await tx.delete(marketingSpend).where(inArray(marketingSpend.id, drop));
    if (add.length) await tx.insert(marketingSpend).values(add);
    return { saved, cleared };
  });
}

/**
 * Copy one month's spend into another: the names the target month doesn't
 * have yet. What's already entered there is kept unless overwrite is set.
 */
export async function copySpend(from: string, to: string, overwrite: boolean, by: string): Promise<{ copied: number; skipped: number }> {
  if (from === to) return { copied: 0, skipped: 0 };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const who = by.slice(0, 255);

  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: marketingSpend.id, month: marketingSpend.month, source: marketingSpend.source, amount: marketingSpend.amount })
      .from(marketingSpend).where(inArray(marketingSpend.month, [from, to])).orderBy(marketingSpend.id);
    // Case twins in the source month become one name with their sum — what the
    // report was counting for it.
    const src = new Map<string, { source: string; cents: number }>();
    for (const r of rows) {
      if (r.month !== from) continue;
      const source = clean(r.source);
      const s = src.get(keyOf(source)) ?? { source, cents: 0 };
      s.cents += toCents(Number(r.amount));
      src.set(keyOf(source), s);
    }
    const have = byName(rows.filter((r) => r.month === to));
    const drop: number[] = [];
    const add: { month: string; source: string; amount: string; updatedBy: string }[] = [];
    let copied = 0, skipped = 0;
    for (const [k, s] of Array.from(src.entries())) {
      if (!s.source || s.cents <= 0) continue;
      const got = have.get(k);
      if (!got) { add.push({ month: to, source: s.source, amount: dollars(s.cents), updatedBy: who }); copied++; continue; }
      if (!overwrite) { skipped++; continue; }
      await tx.update(marketingSpend).set({ amount: dollars(s.cents), updatedBy: who }).where(eq(marketingSpend.id, got[0].id));
      got.slice(1).forEach((g) => drop.push(g.id));
      copied++;
    }
    if (drop.length) await tx.delete(marketingSpend).where(inArray(marketingSpend.id, drop));
    if (add.length) await tx.insert(marketingSpend).values(add);
    return { copied, skipped };
  });
}
