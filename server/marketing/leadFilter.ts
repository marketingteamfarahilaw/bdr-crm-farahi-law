// Guard: subStatus is an intake case fact (CLAUDE.md's hard wall). Callers pass caseFacts =
// marketingCaseFacts(role); when false, reasons are never filtered on, searched, returned or exported.
/**
 * The clients behind any number on the Marketing Report, and their export.
 *
 * A drill-down has to show exactly the number that was clicked. Counting it in
 * SQL would mean re-writing scorecardBucket, isSigned and reasonOf as SQL, and
 * TiDB compares text case-sensitively, so the two would drift. Instead the
 * query groups the matching leads by (outcome, status, subStatus) — about 150
 * groups at most — and classifies each group with the very functions the
 * dashboard counts with. The total is the sum of the groups kept, and the rows
 * are fetched by those same groups with null-safe equality, so whatever the
 * collation does to the grouping it also does to the match.
 *
 * Two round trips per request, as before: the GROUP BY replaced the COUNT(*).
 */
import { and, desc, gte, inArray, lt, lte, notInArray, sql, type Column, type SQL } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "../db";
import { leaddocketLeads } from "../../drizzle/schema";
import { isSigned, scorecardBucket } from "../signupsReport";
import {
  NO_SOURCE, TEAM_CHANNEL, TZ, bdFrOnly, clean, isBdFr, keyOf, monthBounds, monthOf, notBdFr, rowNameOf, sourceOf,
  type DrillScope, type ReasonKey, type ScoreBucket,
} from "./common";
import { reasonOf } from "./reasons";

export type LeadQuery = DrillScope & {
  from: Date; to: Date;
  status: "all" | "signed" | "open";   // 'open' keeps its current meaning: not signed
  search?: string; limit: number; withWhy?: boolean;
  caseFacts?: boolean;   // false: nothing that reveals a lead's rejection reason
};

export type LeadListRow = {
  id: number; name: string; caseType: string; source: string;
  campaign: string | null; contact: string | null;
  date: string | null; createdAt: string | null; signedAt: string | null;
  outcome: string; status: string | null; reason: string | null;
  signed: boolean; city: string | null; intakeBy: string | null;
  rep: string | null;   // "FR Lupe Campos" for a lead in the BD/FR team row
};

export type WhyRow = { reason: string; family: ReasonKey; n: number };

const L = leaddocketLeads;

/** How the Why panel names a lead with no sub-status; a drill on that label means NULL or empty. */
export const NO_REASON = "No reason recorded";

/** The scorecard's column names, in its order — for the export's "Scorecard column". */
export const BUCKET_LABEL: Record<ScoreBucket, string> = {
  open: "Open",
  rejected: "Rejected",
  referredOut: "Referred Out",
  notInterested: "Not Interested",
  signedReferred: "Signed Referred Out",
  signedInHouse: "Signed In-House",
};

/** Exports stop here; beyond it the browser struggles and the dates should be narrowed instead. */
export const EXPORT_CAP = 50_000;

// ── the triple classifier (pure) ──

/** One GROUP BY group: every lead with this exact outcome, status and sub-status. */
export type Triple = { outcome: string | null; status: string | null; subStatus: string | null; n: number };

/** The filters that depend on where a lead ended up, which SQL can't judge the way the dashboard does. */
export type OutcomeFilter = Pick<LeadQuery, "status" | "bucket" | "reasons" | "subStatus">;

const reasonText = (subStatus: string | null) => clean(subStatus) || NO_REASON;

/**
 * Whether anything narrows by outcome. An empty list narrows nothing, as
 * elsewhere in the scope; a sub-status narrows whenever it is given, because ''
 * is how the Why panel asks for the leads with no reason recorded.
 */
export function hasOutcomeFilter(q: OutcomeFilter) {
  return (q.status ?? "all") !== "all" || !!q.bucket || !!q.reasons?.length || q.subStatus != null;
}

/**
 * Whether a group belongs in the drill-down, judged with the dashboard's own
 * isSigned, scorecardBucket and reasonOf. The sub-status match ignores case and
 * spacing, like the Why panel's reason list it is clicked from; '' (or the
 * panel's "No reason recorded") means NULL or blank.
 */
export function keepsTriple(t: Pick<Triple, "outcome" | "status" | "subStatus">, q: OutcomeFilter): boolean {
  const signed = isSigned(t.outcome);
  if (q.status === "signed" && !signed) return false;
  if (q.status === "open" && signed) return false;
  const bucket = scorecardBucket(t.outcome);
  if (q.bucket && bucket !== q.bucket) return false;
  if (q.reasons?.length && !q.reasons.includes(reasonOf(bucket, t.status, t.subStatus))) return false;
  if (q.subStatus != null && keyOf(reasonText(t.subStatus)) !== keyOf(reasonText(q.subStatus))) return false;
  return true;
}

/**
 * The unsigned groups' sub-statuses, largest first, each with its reason
 * family. Spellings that differ only in case are one reason, shown with the
 * commonest spelling.
 */
export function whyOf(kept: Triple[], top = 8): WhyRow[] {
  const by = new Map<string, WhyRow & { best: number }>();
  for (const t of kept) {
    if (isSigned(t.outcome) || !t.n) continue;
    const reason = reasonText(t.subStatus);
    const family = reasonOf(scorecardBucket(t.outcome), t.status, t.subStatus);
    const k = keyOf(reason) + "|" + family;
    const have = by.get(k);
    if (!have) { by.set(k, { reason, family, n: t.n, best: t.n }); continue; }
    have.n += t.n;
    if (t.n > have.best) { have.best = t.n; have.reason = reason; }
  }
  return Array.from(by.values())
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
    .slice(0, top)
    .map(({ reason, family, n }) => ({ reason, family, n }));
}

/** Which groups a drill-down keeps, their total (= the number clicked) and, on request, why they didn't sign. */
export function classifyTriples(groups: Triple[], q: OutcomeFilter, withWhy = false) {
  const kept = groups.filter((t) => keepsTriple(t, q));
  const total = kept.reduce((a, t) => a + t.n, 0);
  return { kept, total, why: withWhy ? whyOf(kept) : null };
}

/**
 * How to fetch the kept groups' rows: nothing extra when every group is kept,
 * otherwise whichever list is shorter — the kept groups, or NOT the dropped
 * ones. Every row is in exactly one group, so the two are the same set.
 */
export function tripleChoice(kept: Triple[], all: Triple[]): { not: boolean; triples: Triple[] } | null {
  if (kept.length >= all.length) return null;
  const keep = new Set(kept);
  const dropped = all.filter((t) => !keep.has(t));
  return dropped.length < kept.length ? { not: true, triples: dropped } : { not: false, triples: kept };
}

// ── SQL ──

const blank = (col: Column) => sql`(${col} IS NULL OR TRIM(${col}) = '')`;

/** Values → a match on the column; '' stands for NULL or empty, as in DrillScope. */
function inList(col: Column, values: string[]): SQL | undefined {
  const vals = Array.from(new Set(values.map((v) => String(v ?? "").trim())));
  const named = vals.filter(Boolean);
  const parts: SQL[] = [];
  if (named.length) parts.push(inArray(sql`TRIM(${col})`, named));
  if (vals.includes("")) parts.push(blank(col));
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` OR `)})`;
}

/** Everything but these values. NULL counts as '' — out only when '' is listed. */
function notInList(col: Column, values: string[]): SQL | undefined {
  const vals = Array.from(new Set(values.map((v) => String(v ?? "").trim())));
  const named = vals.filter(Boolean);
  const parts: SQL[] = [];
  if (named.length) parts.push(sql`(${notInArray(sql`TRIM(${col})`, named)} OR ${col} IS NULL)`);
  if (vals.includes("")) parts.push(sql`(${col} IS NOT NULL AND TRIM(${col}) <> '')`);
  return parts.length ? and(...parts) : undefined;
}

/**
 * The dashboard's own WHERE (the range) plus the scope, the month and the
 * search. Every scope field narrows; an empty list narrows nothing.
 */
export function scopeWhere(q: DrillScope & { from: Date; to: Date; search?: string; caseFacts?: boolean }): SQL {
  const conds: (SQL | undefined)[] = [gte(L.leadDate, q.from), lte(L.leadDate, q.to)];
  // A lead's row is its cleaned Marketing Source, so match trimmed; "No source" is NULL or blank.
  // A BDR or FR rep's lead is the "BD/FR team" row, whatever its Marketing Source says —
  // so a named source never picks one up ("BDR Grace Lanayon" is a rep, not a source).
  if (q.source === TEAM_CHANNEL) conds.push(bdFrOnly);
  else if (q.source === NO_SOURCE) conds.push(notBdFr, blank(L.marketingSource));
  else if (q.source?.trim()) conds.push(notBdFr, sql`TRIM(${L.marketingSource}) = ${q.source.trim()}`);
  if (q.sources?.length) conds.push(notBdFr, inList(L.marketingSource, q.sources));
  if (q.contactSources?.length) conds.push(inList(L.contactSource, q.contactSources));
  if (q.caseTypes?.length) conds.push(inList(L.caseType, q.caseTypes));
  if (q.notCaseTypes?.length) conds.push(notInList(L.caseType, q.notCaseTypes));
  if (q.campaigns?.length) conds.push(inList(L.campaign, q.campaigns));
  if (q.month) {
    const { start, end } = monthBounds(q.month);
    conds.push(gte(L.leadDate, start), lt(L.leadDate, end));
  }
  // TiDB compares text case-sensitively, so 'garcia' missed 'Garcia' (as server/crmDb.ts does).
  const term = clean(q.search).toLowerCase();
  if (term) {
    const p = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    // Searching the reason would reveal it, so it is searched only for those who may see it.
    const cols = [L.clientName, L.caseType, L.campaign, L.marketingSource, L.contactSource, ...(q.caseFacts === false ? [] : [L.subStatus]), L.city];
    conds.push(sql`(${sql.join(cols.map((c) => sql`LOWER(${c}) LIKE ${p}`), sql` OR `)})`);
  }
  return and(...conds)!;
}

/** The kept groups as SQL, with <=> so NULLs match (see tripleChoice). */
export function tripleWhere(kept: Triple[], all: Triple[]): SQL | undefined {
  const c = tripleChoice(kept, all);
  if (!c) return undefined;
  const any = sql`(${sql.join(c.triples.map((t) =>
    sql`(${L.outcome} <=> ${t.outcome} AND ${L.status} <=> ${t.status} AND ${L.subStatus} <=> ${t.subStatus})`), sql` OR `)})`;
  return c.not ? sql`NOT ${any}` : any;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function groupsOf(db: Db, where: SQL): Promise<Triple[]> {
  const rows = await db
    .select({ outcome: L.outcome, status: L.status, subStatus: L.subStatus, n: sql<number>`COUNT(*)` })
    .from(L).where(where).groupBy(L.outcome, L.status, L.subStatus);
  return rows.map((r) => ({ outcome: r.outcome, status: r.status, subStatus: r.subStatus, n: Number(r.n) || 0 }));
}

const LIST_COLS = {
  leadId: L.leadId, clientName: L.clientName, caseType: L.caseType, marketingSource: L.marketingSource,
  campaign: L.campaign, contactSource: L.contactSource, leadDate: L.leadDate, createdDate: L.createdDate,
  signedUpDate: L.signedUpDate, outcome: L.outcome, status: L.status, subStatus: L.subStatus, city: L.city, intakeBy: L.intakeBy,
  teamRole: L.teamRole, teamRep: L.teamRep,
};

const isoOf = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export function toListRow(r: {
  leadId: number; clientName: string | null; caseType: string | null; marketingSource: string | null;
  campaign: string | null; contactSource: string | null; leadDate: Date | null; createdDate: Date | null;
  signedUpDate: Date | null; outcome: string | null; status: string | null; subStatus: string | null;
  city: string | null; intakeBy: string | null; teamRole: string | null; teamRep: string | null;
}): LeadListRow {
  return {
    id: r.leadId,
    name: clean(r.clientName) || `Lead ${r.leadId}`,
    caseType: clean(r.caseType) || "Not recorded",
    source: sourceOf(r),
    campaign: clean(r.campaign) || null,
    contact: clean(r.contactSource) || null,
    date: isoOf(r.leadDate),
    createdAt: isoOf(r.createdDate),
    signedAt: isoOf(r.signedUpDate),
    outcome: clean(r.outcome),
    status: clean(r.status) || null,
    reason: clean(r.subStatus) || null,
    signed: isSigned(r.outcome),
    city: clean(r.city) || null,
    intakeBy: clean(r.intakeBy) || null,
    rep: repOf(r),
  };
}

/** "FR Lupe Campos" for a BDR or FR rep's lead, else null. */
export const repOf = (r: { teamRole: string | null; teamRep: string | null }) =>
  isBdFr(r.teamRole) ? `${r.teamRole} ${clean(r.teamRep)}`.trim() : null;

/** The clients behind a number: filtered, newest first, a page at a time. */
export async function getMarketingLeads(query: LeadQuery): Promise<{ total: number; rows: LeadListRow[]; why: WhyRow[] | null }> {
  const q = withoutCaseFacts(query);
  const db = await getDb();
  if (!db) return { total: 0, rows: [], why: q.withWhy ? [] : null };
  const where = scopeWhere(q);
  const list = (w: SQL) => db.select(LIST_COLS).from(L).where(w).orderBy(desc(L.leadDate), desc(L.leadId)).limit(q.limit);

  // Nothing to classify: the groups only give the total (and the reasons), so both go at once.
  if (!hasOutcomeFilter(q)) {
    const [groups, rows] = await Promise.all([groupsOf(db, where), list(where)]);
    const { total, why } = classifyTriples(groups, q, !!q.withWhy);
    return { total, rows: rows.map(listRowFor(q)), why };
  }
  const groups = await groupsOf(db, where);
  const { kept, total, why } = classifyTriples(groups, q, !!q.withWhy);
  if (!kept.length) return { total: 0, rows: [], why };
  const rows = await list(and(where, tripleWhere(kept, groups))!);
  return { total, rows: rows.map(listRowFor(q)), why };
}

/**
 * For someone who may not see intake case facts: no filtering by reason (the
 * count would reveal it), no reasons breakdown. Their rows lose the reason in listRowFor.
 */
function withoutCaseFacts<T extends { caseFacts?: boolean; reasons?: ReasonKey[]; subStatus?: string; withWhy?: boolean }>(q: T): T {
  if (q.caseFacts !== false) return q;
  return { ...q, reasons: undefined, subStatus: undefined, withWhy: false };
}
const listRowFor = (q: { caseFacts?: boolean }) => (r: Parameters<typeof toListRow>[0]): LeadListRow => {
  const row = toListRow(r);
  return q.caseFacts === false ? { ...row, reason: null } : row;
};

// ── export ──

/** One CSV cell, quoted. A leading = + - @ tab or CR is defused with ' so Excel won't run it as a formula. */
export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
}

export const EXPORT_HEAD = [
  "Lead ID", "Client", "Came in", "Signed", "Counted in month", "Marketing Source", "Channel", "Contact Source",
  "Campaign", "Case Type", "Status", "Reason", "Scorecard column", "City", "County", "State", "Intake by",
];

export type ExportRow = {
  leadId: number; clientName: string | null; createdDate: Date | null; signedUpDate: Date | null; leadDate: Date | null;
  marketingSource: string | null; contactSource: string | null; campaign: string | null; caseType: string | null;
  status: string | null; subStatus: string | null; outcome: string | null;
  city: string | null; county: string | null; state: string | null; intakeBy: string | null;
  teamRole: string | null; teamRep: string | null;
};

const EXPORT_COLS = {
  leadId: L.leadId, clientName: L.clientName, createdDate: L.createdDate, signedUpDate: L.signedUpDate, leadDate: L.leadDate,
  marketingSource: L.marketingSource, contactSource: L.contactSource, campaign: L.campaign, caseType: L.caseType,
  status: L.status, subStatus: L.subStatus, outcome: L.outcome, city: L.city, county: L.county, state: L.state, intakeBy: L.intakeBy,
  teamRole: L.teamRole, teamRep: L.teamRep,
};

const pacific = (d: Date | null, f: string) => (d ? formatInTimeZone(new Date(d), TZ, f) : "");

/** One lead as the export's cells, dates in Pacific time like the page. */
export function exportCells(r: ExportRow): (string | number)[] {
  const signed = isSigned(r.outcome);
  const source = sourceOf(r);
  const rep = repOf(r);
  // leadDate is the sign-up date for a signed lead and the day it came in otherwise, so it
  // stands in for whichever of the two dates Lead Docket left empty.
  const cameIn = r.createdDate ?? (signed ? null : r.leadDate);
  const signedOn = r.signedUpDate ?? (signed ? r.leadDate : null);
  return [
    r.leadId,
    clean(r.clientName),
    pacific(cameIn, "yyyy-MM-dd HH:mm"),
    pacific(signedOn, "yyyy-MM-dd"),
    r.leadDate ? monthOf(new Date(r.leadDate)) : "",
    rep ? `${source} · ${rep}` : source,
    rowNameOf(source, "channel"),
    clean(r.contactSource),
    clean(r.campaign),
    clean(r.caseType),
    clean(r.status),
    clean(r.subStatus),
    BUCKET_LABEL[scorecardBucket(r.outcome)],
    clean(r.city),
    clean(r.county),
    clean(r.state),
    clean(r.intakeBy),
  ];
}

/** The file: a UTF-8 BOM so Excel keeps accents, a header, CRLF lines. */
export function toCsv(rows: ExportRow[], caseFacts = true): string {
  const lines = [EXPORT_HEAD, ...rows.map((r) => exportCells(caseFacts ? r : { ...r, subStatus: null }))].map((cells) => cells.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Every client behind a number, as CSV — the same WHERE and groups as the list, up to EXPORT_CAP. */
export async function exportMarketingLeads(query: Omit<LeadQuery, "limit" | "withWhy">): Promise<{ csv: string; rows: number; capped: boolean }> {
  const q = withoutCaseFacts(query);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const where = scopeWhere(q);
  const select = (w: SQL, limit: number) =>
    db.select(EXPORT_COLS).from(L).where(w).orderBy(desc(L.leadDate), desc(L.leadId)).limit(limit);

  if (!hasOutcomeFilter(q)) {
    // One over the cap tells us whether it was hit, without a count.
    const rows = await select(where, EXPORT_CAP + 1);
    const capped = rows.length > EXPORT_CAP;
    const out = capped ? rows.slice(0, EXPORT_CAP) : rows;
    return { csv: toCsv(out, q.caseFacts !== false), rows: out.length, capped };
  }
  const groups = await groupsOf(db, where);
  const { kept, total } = classifyTriples(groups, q);
  if (!kept.length) return { csv: toCsv([], q.caseFacts !== false), rows: 0, capped: false };
  const rows = await select(and(where, tripleWhere(kept, groups))!, EXPORT_CAP);
  return { csv: toCsv(rows, q.caseFacts !== false), rows: rows.length, capped: total > EXPORT_CAP };
}
