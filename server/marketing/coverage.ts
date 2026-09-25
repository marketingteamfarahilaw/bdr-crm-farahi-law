/**
 * How much of Lead Docket the report has loaded, and how fresh it is.
 *
 * The history backfill (sync-leaddocket.mjs --backfill) fills leaddocket_leads
 * newest lead id first, so while it runs the report is complete only back to
 * some date. That date decides whether an older period — and every comparison
 * against one — can be trusted, so it has to be conservative. The oldest lead
 * stored says nothing: strays like lead 11001 sit far below the frontier, and
 * reading it that way had the page claiming 'complete back to Apr 29, 2023'
 * when the backfill had only reached January 2026.
 *
 * The frontier is the lowest lead id above which every lead is stored. The
 * backfill records it as cursorId at the end of each chunk; until it has, it is
 * estimated from how densely each block of 1,000 ids is filled.
 */
import { gte, sql } from "drizzle-orm";
import { getDb, getSetting } from "../db";
import { getStatus, type JobStatus } from "../dataSync";
import { leaddocketLeads } from "../../drizzle/schema";
import { monthBounds } from "./common";

export const LAG_DAYS = 30;   // 98.5% of this report's sign-ups happen within 30 days of the lead (1,214 of 1,233)

export type MonthState = "full" | "partial" | "none";

export type Coverage = {
  total: number; stored: number; remaining: number | null; at: string | null;
  complete: boolean;
  completeFrom: string | null;   // every lead created on/after this is loaded (approximate)
  method: "complete" | "cursor" | "frontier" | "none";
  trustedFrom: string | null;    // completeFrom + LAG_DAYS: a period starting on/after this is fully loaded, sign-ups included
  newestLeadAt: string | null;
  syncedAt: string | null;
  syncState: "idle" | "running" | "ok" | "partial" | "failed";
  backfillRunning: boolean;
  asOf: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 2 * 60 * 1000;
// Lead ids are issued in blocks of 1,000 here; a block with at least 900 stored
// counts as loaded. The rest of a block is leads deleted in Lead Docket.
const BLOCK = 1000;
const DENSE = 900;
// completeFrom is the latest creation date among this many of the lowest ids at
// the frontier, so one stray (lead 49346 was created in 2025) can't drag it back.
const EDGE = 25;

/** What the sync last wrote to app_settings 'leaddocket_marketing_coverage'. */
export type StoredCoverage = { total: number; stored: number; remaining: number | null; at: string | null; cursorId: number | null };

export function parseStored(raw: string | null): StoredCoverage {
  const out: StoredCoverage = { total: 0, stored: 0, remaining: null, at: null, cursorId: null };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return out;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    out.total = num(v.total) ?? 0;
    out.stored = num(v.stored) ?? 0;
    out.remaining = num(v.remaining);
    out.at = typeof v.at === "string" ? v.at : null;
    const cursor = num(v.cursorId);
    out.cursorId = cursor != null && cursor > 0 ? cursor : null;
  } catch { /* shown as unknown */ }
  return out;
}

/**
 * The lowest lead id the report can call loaded, from the count of stored leads
 * in each block of 1,000 ids (b = FLOOR(leadId / 1000)). The top block is
 * skipped — ids there are still being issued, so it is never full — and the walk
 * goes down while blocks are dense and consecutive. A missing block ends it,
 * since GROUP BY leaves out a block with nothing stored. Null when not even the
 * block below the top is loaded.
 */
export function frontierOf(buckets: { b: number; n: number }[]): number | null {
  const sorted = buckets
    .map((x) => ({ b: Number(x.b), n: Number(x.n) }))
    .filter((x) => Number.isFinite(x.b) && Number.isFinite(x.n))
    .sort((a, z) => z.b - a.b);
  let lowest: number | null = null;
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].n < DENSE || sorted[k].b !== sorted[k - 1].b - 1) break;
    lowest = sorted[k].b;
  }
  return lowest == null ? null : lowest * BLOCK;
}

/** A database timestamp as ISO. mysql2 returns Dates (timezone "Z"); a bare string is UTC too. */
export function toIso(v: Date | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The latest of some timestamps, as ISO; null when there are none. */
export function latest(values: (Date | string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) {
    const iso = toIso(v);
    if (iso && (!best || iso > best)) best = iso;
  }
  return best;
}

type SyncJob = Pick<JobStatus, "state" | "lastSuccessAt">;

/** The reads behind getCoverage — passed in so the steps can be tested without a database. */
export type CoverageReads = {
  setting(): Promise<string | null>;
  buckets(): Promise<{ b: number; n: number }[]>;
  /** createdDate of the EDGE lowest lead ids at or above `from`. */
  edgeDates(from: number): Promise<(Date | string | null)[]>;
  /** The newest createdDate among the leads this report counts (not BD/FR). */
  newestLead(): Promise<Date | string | null>;
  status(job: "leaddocket" | "leaddocket_history"): Promise<SyncJob>;
};

/**
 * Coverage from its reads: four small queries (the coverage setting, the
 * frontier's dates, the newest lead, and the blocks only while there is no
 * cursor) plus the two sync statuses. Once the backfill is complete there is
 * nothing to locate, so the frontier reads are skipped.
 */
export async function loadCoverage(reads: CoverageReads, now = new Date()): Promise<Coverage> {
  const [setting, newest, sync, history] = await Promise.all([
    reads.setting(),
    reads.newestLead(),
    reads.status("leaddocket"),
    reads.status("leaddocket_history"),
  ]);
  const s = parseStored(setting);
  const complete = s.remaining === 0;

  let method: Coverage["method"] = complete ? "complete" : "none";
  let completeFrom: string | null = null;
  if (!complete) {
    if (s.cursorId != null) {
      completeFrom = latest(await reads.edgeDates(s.cursorId));
      if (completeFrom) method = "cursor";
    }
    // Before the first chunk has recorded a cursor (or if it points past every
    // lead, which it shouldn't), estimate the frontier from block density.
    if (!completeFrom) {
      const f = frontierOf(await reads.buckets());
      if (f != null) {
        completeFrom = latest(await reads.edgeDates(f));
        if (completeFrom) method = "frontier";
      }
    }
  }
  const trustedFrom = completeFrom ? new Date(Date.parse(completeFrom) + LAG_DAYS * DAY_MS).toISOString() : null;

  // Both jobs read the newest leads first, so either one finishing means the
  // recent leads are current as of when it started.
  const asOf = latest([sync.lastSuccessAt, history.lastSuccessAt]) ?? now.toISOString();

  return {
    total: s.total, stored: s.stored, remaining: s.remaining, at: s.at,
    complete, completeFrom, method, trustedFrom,
    newestLeadAt: toIso(newest),
    syncedAt: toIso(sync.lastSuccessAt),
    syncState: sync.state,
    backfillRunning: history.state === "running",
    asOf,
  };
}

function dbReads(): CoverageReads {
  const L = leaddocketLeads;
  return {
    setting: () => getSetting("leaddocket_marketing_coverage"),
    async buckets() {
      const db = await getDb();
      if (!db) return [];
      // A primary-key scan that returns one row per 1,000 ids (about 51 today).
      // Grouped by the alias: drizzle writes the column bare in the select list
      // but table-qualified in GROUP BY, and TiDB rejects the two as different
      // expressions (only_full_group_by) — the live database failed this query.
      const rows = await db.select({ b: sql<number>`FLOOR(${L.leadId} / 1000)`.as("b"), n: sql<number>`COUNT(*)` })
        .from(L).groupBy(sql`b`).orderBy(sql`b DESC`);
      return rows.map((r) => ({ b: Number(r.b), n: Number(r.n) }));
    },
    async edgeDates(from) {
      const db = await getDb();
      if (!db) return [];
      // Any team: lead ids are issued firm-wide, so the BD/FR team's leads mark the frontier too.
      const rows = await db.select({ d: L.createdDate }).from(L).where(gte(L.leadId, from)).orderBy(L.leadId).limit(EDGE);
      return rows.map((r) => r.d);
    },
    async newestLead() {
      const db = await getDb();
      if (!db) return null;
      const [r] = await db.select({ d: sql<Date | string | null>`MAX(${L.createdDate})` }).from(L);
      return r?.d ?? null;
    },
    status: (job) => getStatus(job),
  };
}

const notKnown = (now = new Date()): Coverage => ({
  total: 0, stored: 0, remaining: null, at: null,
  complete: false, completeFrom: null, method: "none", trustedFrom: null,
  newestLeadAt: null, syncedAt: null, syncState: "idle", backfillRunning: false,
  asOf: now.toISOString(),
});

type CacheEntry = { at: number; value: Promise<Coverage> };
let cached: CacheEntry | null = null;

/**
 * Coverage for the dashboard, from module memory for 2 minutes: it changes only
 * when a sync writes, and the page asks on every range and view change. The
 * promise is what's cached, so loads that arrive together share one set of
 * reads. A failed read isn't cached, and shows as 'not known' — every period
 * then counts as not fully loaded — rather than taking the whole report down.
 */
export async function getCoverage(): Promise<Coverage> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const entry: CacheEntry = {
    at: now,
    value: loadCoverage(dbReads()).catch((e) => {
      if (cached === entry) cached = null;
      console.warn("[marketing] coverage unavailable:", e?.message ?? e);
      return notKnown();
    }),
  };
  cached = entry;
  return entry.value;
}

/** Forget the cached coverage (tests). */
export function clearCoverageCache() {
  cached = null;
}

export function periodLoaded(c: Coverage, from: Date): boolean {
  return c.complete || (c.trustedFrom != null && from >= new Date(c.trustedFrom));
}

/**
 * Each Pacific month's state, aligned to `months`: 'full' when a period starting
 * that month is loaded, sign-ups included; 'partial' when some of it is (the
 * frontier falls before its end); otherwise 'none'.
 */
export function monthStates(c: Coverage, months: string[]): MonthState[] {
  const from = c.completeFrom ? new Date(c.completeFrom).getTime() : null;
  return months.map((m) => {
    const { start, end } = monthBounds(m);
    if (periodLoaded(c, start)) return "full";
    return from != null && from < end.getTime() ? "partial" : "none";
  });
}
