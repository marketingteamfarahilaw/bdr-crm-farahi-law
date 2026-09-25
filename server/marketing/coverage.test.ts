import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never the real database or sync state: getCoverage's own reads go through these.
const db = vi.hoisted(() => ({ setting: vi.fn(), status: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => null, getSetting: db.setting }));
vi.mock("../dataSync", () => ({ getStatus: db.status }));

import {
  LAG_DAYS, clearCoverageCache, frontierOf, getCoverage, loadCoverage, monthStates, parseStored, periodLoaded, toIso,
  type Coverage, type CoverageReads,
} from "./coverage";
import { monthsBetween } from "./common";
import { loadedLabel, whenLabel } from "../../client/src/pages/marketing/Freshness";

const DAY = 24 * 60 * 60 * 1000;

const cov = (over: Partial<Coverage> = {}): Coverage => ({
  total: 50012, stored: 7336, remaining: 42676, at: null,
  complete: false, completeFrom: null, method: "none", trustedFrom: null,
  newestLeadAt: null, syncedAt: null, syncState: "ok", backfillRunning: false,
  asOf: "2026-09-24T04:18:00.000Z",
  ...over,
});
/** Coverage complete back to `from`, with trustedFrom LAG_DAYS later, as getCoverage builds it. */
const from = (iso: string, over: Partial<Coverage> = {}) =>
  cov({ completeFrom: new Date(iso).toISOString(), trustedFrom: new Date(Date.parse(iso) + LAG_DAYS * DAY).toISOString(), method: "cursor", ...over });

// Blocks of 1,000 ids as the database has them in Sept 2026: the top block still
// filling, the backfill down to the 43xxx block, a half-read block under it, and
// strays far below (lead 11001).
const BUCKETS = [
  { b: 50, n: 12 }, { b: 49, n: 998 }, { b: 48, n: 990 }, { b: 47, n: 950 }, { b: 46, n: 901 }, { b: 45, n: 995 },
  { b: 44, n: 990 }, { b: 43, n: 960 }, { b: 42, n: 310 }, { b: 41, n: 40 }, { b: 30, n: 7 }, { b: 11, n: 1 },
];

describe("frontierOf", () => {
  it("skips the top block and walks down the dense ones", () => {
    expect(frontierOf(BUCKETS)).toBe(43000);
  });

  it("doesn't depend on the order the rows come in", () => {
    expect(frontierOf([...BUCKETS].reverse())).toBe(43000);
    expect(frontierOf([BUCKETS[5], BUCKETS[0], BUCKETS[11], BUCKETS[2], ...BUCKETS.slice(6, 11), BUCKETS[1], BUCKETS[3], BUCKETS[4]])).toBe(43000);
  });

  it("skips the top block even when it looks full", () => {
    expect(frontierOf([{ b: 51, n: 999 }, { b: 50, n: 400 }])).toBeNull();
    expect(frontierOf([{ b: 51, n: 999 }, { b: 50, n: 999 }])).toBe(50000);
  });

  it("stops at a missing block — GROUP BY leaves out an empty one", () => {
    expect(frontierOf([{ b: 50, n: 5 }, { b: 49, n: 990 }, { b: 47, n: 990 }, { b: 46, n: 990 }])).toBe(49000);
  });

  it("ignores dense-looking strays below the frontier", () => {
    expect(frontierOf([{ b: 50, n: 5 }, { b: 49, n: 990 }, { b: 48, n: 300 }, { b: 12, n: 950 }, { b: 11, n: 990 }])).toBe(49000);
  });

  it("counts 900 as dense and 899 as not", () => {
    expect(frontierOf([{ b: 50, n: 5 }, { b: 49, n: 900 }, { b: 48, n: 899 }])).toBe(49000);
    expect(frontierOf([{ b: 50, n: 5 }, { b: 49, n: 899 }])).toBeNull();
  });

  it("is null with nothing or only the top block", () => {
    expect(frontierOf([])).toBeNull();
    expect(frontierOf([{ b: 50, n: 12 }])).toBeNull();
  });

  it("takes counts that arrive as strings (MySQL BIGINT)", () => {
    const asStrings = BUCKETS.map((x) => ({ b: String(x.b), n: String(x.n) })) as unknown as { b: number; n: number }[];
    expect(frontierOf(asStrings)).toBe(43000);
  });
});

describe("parseStored", () => {
  it("reads what the sync writes, cursor included", () => {
    expect(parseStored(JSON.stringify({ total: 50012, stored: 7336, remaining: 42676, at: "2026-09-24T03:00:00.000Z", cursorId: 42788 })))
      .toEqual({ total: 50012, stored: 7336, remaining: 42676, at: "2026-09-24T03:00:00.000Z", cursorId: 42788 });
  });

  it("falls back to unknown on anything else", () => {
    const none = { total: 0, stored: 0, remaining: null, at: null, cursorId: null };
    expect(parseStored(null)).toEqual(none);
    expect(parseStored("")).toEqual(none);
    expect(parseStored("{not json")).toEqual(none);
    expect(parseStored("null")).toEqual(none);
    expect(parseStored(JSON.stringify({ cursorId: "42788" })).cursorId).toBeNull();
    expect(parseStored(JSON.stringify({ cursorId: 0 })).cursorId).toBeNull();
    expect(parseStored(JSON.stringify({ remaining: 0 })).remaining).toBe(0);
  });
});

describe("toIso", () => {
  it("reads database timestamps as UTC", () => {
    expect(toIso(new Date("2026-09-24T02:07:00Z"))).toBe("2026-09-24T02:07:00.000Z");
    expect(toIso("2026-09-24 02:07:00")).toBe("2026-09-24T02:07:00.000Z");
    expect(toIso("2026-09-24T02:07:00.000Z")).toBe("2026-09-24T02:07:00.000Z");
    expect(toIso(null)).toBeNull();
    expect(toIso("nonsense")).toBeNull();
  });
});

/** Fake reads over the Sept 2026 state, counting every query. */
function fakeReads(over: {
  setting?: object | string | null;
  buckets?: { b: number; n: number }[];
  edges?: Record<number, (Date | string | null)[]>;
  newest?: Date | string | null;
  sync?: { state: Coverage["syncState"]; lastSuccessAt: string | null };
  history?: { state: Coverage["syncState"]; lastSuccessAt: string | null };
} = {}) {
  const calls = { setting: 0, buckets: 0, edgeDates: [] as number[], newest: 0, status: 0 };
  const setting = over.setting === undefined ? { total: 50012, stored: 7336, remaining: 42676, at: "2026-09-24T03:00:00.000Z" } : over.setting;
  // 25 leads from the frontier: mostly mid-January, one stray from 2025 and one with no date.
  const edge43000 = [
    ...Array.from({ length: 22 }, (_, k) => new Date(Date.parse("2026-01-20T18:00:00Z") + k * 3_600_000)),
    new Date("2025-06-02T17:00:00Z"), null, new Date("2026-01-22T08:00:00Z"),
  ];
  const edges = over.edges ?? { 43000: edge43000, 42788: [new Date("2026-01-14T19:30:00Z"), new Date("2026-01-14T21:00:00Z")] };
  const reads: CoverageReads = {
    setting: async () => { calls.setting++; return setting == null || typeof setting === "string" ? setting : JSON.stringify(setting); },
    buckets: async () => { calls.buckets++; return over.buckets ?? BUCKETS; },
    edgeDates: async (f) => { calls.edgeDates.push(f); return edges[f] ?? []; },
    newestLead: async () => { calls.newest++; return over.newest === undefined ? new Date("2026-09-24T02:07:00Z") : over.newest; },
    status: async (job) => {
      calls.status++;
      return job === "leaddocket"
        ? over.sync ?? { state: "ok", lastSuccessAt: "2026-09-24T04:18:00.000Z" }
        : over.history ?? { state: "running", lastSuccessAt: "2026-09-24T03:00:00.000Z" };
    },
  };
  const queries = () => calls.setting + calls.buckets + calls.edgeDates.length + calls.newest;
  return { reads, calls, queries };
}

describe("loadCoverage", () => {
  const NOW = new Date("2026-09-24T05:00:00Z");

  it("estimates the frontier from the blocks until the backfill records a cursor", async () => {
    const { reads, calls, queries } = fakeReads();
    const c = await loadCoverage(reads, NOW);
    expect(c.method).toBe("frontier");
    expect(calls.edgeDates).toEqual([43000]);
    // The latest of the 25, not the stray from 2025 or the frontier lead's own date.
    expect(c.completeFrom).toBe("2026-01-22T08:00:00.000Z");
    expect(c.trustedFrom).toBe("2026-02-21T08:00:00.000Z");
    expect(c.complete).toBe(false);
    expect({ total: c.total, stored: c.stored, remaining: c.remaining }).toEqual({ total: 50012, stored: 7336, remaining: 42676 });
    expect(queries()).toBeLessThanOrEqual(4);
    expect(calls.status).toBe(2);
  });

  it("uses the recorded cursor without reading the blocks", async () => {
    const { reads, calls, queries } = fakeReads({ setting: { total: 50012, stored: 7336, remaining: 42676, cursorId: 42788 } });
    const c = await loadCoverage(reads, NOW);
    expect(c.method).toBe("cursor");
    expect(calls.buckets).toBe(0);
    expect(calls.edgeDates).toEqual([42788]);
    expect(c.completeFrom).toBe("2026-01-14T21:00:00.000Z");
    expect(queries()).toBe(3);
  });

  it("the cursor's date is no later than the frontier estimate", async () => {
    const frontier = await loadCoverage(fakeReads().reads, NOW);
    const cursor = await loadCoverage(fakeReads({ setting: { total: 50012, remaining: 42676, cursorId: 42788 } }).reads, NOW);
    expect(cursor.completeFrom! <= frontier.completeFrom!).toBe(true);
  });

  it("falls back to the blocks if the cursor finds no dated lead", async () => {
    const { reads, calls } = fakeReads({ setting: { total: 50012, remaining: 42676, cursorId: 99999 } });
    const c = await loadCoverage(reads, NOW);
    expect(calls.edgeDates).toEqual([99999, 43000]);
    expect(c.method).toBe("frontier");
    expect(c.completeFrom).toBe("2026-01-22T08:00:00.000Z");
  });

  it("is complete, with nothing to locate, once nothing remains", async () => {
    const { reads, calls, queries } = fakeReads({ setting: { total: 50012, stored: 50012, remaining: 0, cursorId: 12 } });
    const c = await loadCoverage(reads, NOW);
    expect(c).toMatchObject({ complete: true, method: "complete", completeFrom: null, trustedFrom: null });
    expect(calls.buckets).toBe(0);
    expect(calls.edgeDates).toEqual([]);
    expect(queries()).toBe(2);
    expect(periodLoaded(c, new Date("2020-01-01T08:00:00Z"))).toBe(true);
  });

  it("knows nothing on an empty table", async () => {
    const { reads } = fakeReads({ setting: null, buckets: [], newest: null, sync: { state: "idle", lastSuccessAt: null }, history: { state: "idle", lastSuccessAt: null } });
    const c = await loadCoverage(reads, NOW);
    expect(c).toMatchObject({ total: 0, stored: 0, remaining: null, complete: false, method: "none", completeFrom: null, trustedFrom: null, newestLeadAt: null, syncedAt: null });
    expect(c.asOf).toBe(NOW.toISOString());
    expect(periodLoaded(c, new Date("2026-09-01T07:00:00Z"))).toBe(false);
  });

  it("reports the regular sync, the backfill and the newest lead", async () => {
    const { reads } = fakeReads();
    const c = await loadCoverage(reads, NOW);
    expect(c.syncedAt).toBe("2026-09-24T04:18:00.000Z");
    expect(c.syncState).toBe("ok");
    expect(c.backfillRunning).toBe(true);
    expect(c.newestLeadAt).toBe("2026-09-24T02:07:00.000Z");
    // The later of the two jobs' last successes.
    expect(c.asOf).toBe("2026-09-24T04:18:00.000Z");
    const later = await loadCoverage(fakeReads({ history: { state: "ok", lastSuccessAt: "2026-09-24T04:40:00.000Z" } }).reads, NOW);
    expect(later.asOf).toBe("2026-09-24T04:40:00.000Z");
    expect(later.backfillRunning).toBe(false);
  });
});

describe("periodLoaded", () => {
  const c = from("2026-01-22T08:00:00Z");   // Jan 22, midnight Pacific

  it("trusts a period only from LAG_DAYS after completeFrom", () => {
    expect(LAG_DAYS).toBe(30);
    expect(c.trustedFrom).toBe("2026-02-21T08:00:00.000Z");
    expect(periodLoaded(c, new Date("2026-02-21T08:00:00Z"))).toBe(true);
    expect(periodLoaded(c, new Date("2026-02-21T07:59:59.999Z"))).toBe(false);
    expect(periodLoaded(c, new Date("2026-01-22T08:00:00Z"))).toBe(false);   // leads loaded, sign-ups not yet
    expect(periodLoaded(c, new Date("2026-09-01T07:00:00Z"))).toBe(true);
  });

  it("trusts everything once complete, and nothing when coverage isn't known", () => {
    expect(periodLoaded(cov({ complete: true, method: "complete" }), new Date("2019-01-01T08:00:00Z"))).toBe(true);
    expect(periodLoaded(cov(), new Date("2026-09-01T07:00:00Z"))).toBe(false);
  });
});

describe("monthStates", () => {
  const months = monthsBetween(new Date("2025-12-15T20:00:00Z"), new Date("2026-09-24T20:00:00Z"));

  it("gives today's shape: Mar–Sep full, Jan–Feb partial, Dec none", () => {
    expect(months).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(monthStates(from("2026-01-22T08:00:00Z"), months))
      .toEqual(["none", "partial", "partial", "full", "full", "full", "full", "full", "full", "full"]);
  });

  it("is full from the month trustedFrom opens", () => {
    // completeFrom Jan 30 → trustedFrom Mar 1, midnight Pacific (08:00 UTC).
    const c = from("2026-01-30T08:00:00Z");
    expect(c.trustedFrom).toBe("2026-03-01T08:00:00.000Z");
    expect(monthStates(c, ["2026-01", "2026-02", "2026-03"])).toEqual(["partial", "partial", "full"]);
    const later = cov({ completeFrom: c.completeFrom, trustedFrom: "2026-03-01T08:00:00.001Z" });
    expect(monthStates(later, ["2026-02", "2026-03", "2026-04"])).toEqual(["partial", "partial", "full"]);
  });

  it("uses Pacific month ends for partial", () => {
    // Jan 31, 11:59:59 pm Pacific still reaches into January; Feb 1, midnight doesn't.
    expect(monthStates(from("2026-02-01T07:59:59Z"), ["2025-12", "2026-01", "2026-02"])).toEqual(["none", "partial", "partial"]);
    expect(monthStates(from("2026-02-01T08:00:00Z"), ["2025-12", "2026-01", "2026-02"])).toEqual(["none", "none", "partial"]);
  });

  it("is all full when complete, all none when unknown, and aligned to months", () => {
    expect(monthStates(cov({ complete: true, method: "complete" }), months)).toEqual(months.map(() => "full"));
    expect(monthStates(cov(), months)).toEqual(months.map(() => "none"));
    expect(monthStates(from("2026-01-22T08:00:00Z"), [])).toEqual([]);
  });

  it("never goes backwards: none, then partial, then full", () => {
    const span = monthsBetween(new Date("2024-01-15T20:00:00Z"), new Date("2026-12-15T20:00:00Z"));
    const rank = { none: 0, partial: 1, full: 2 } as const;
    for (let t = Date.parse("2024-01-01T00:00:00Z"); t < Date.parse("2027-01-01T00:00:00Z"); t += 5 * DAY + 3_600_000 * 7) {
      const states = monthStates(from(new Date(t).toISOString()), span);
      expect(states).toHaveLength(span.length);
      for (let k = 1; k < states.length; k++) expect(rank[states[k]]).toBeGreaterThanOrEqual(rank[states[k - 1]]);
      // Only the months the 30-day margin reaches into can be partial.
      expect(states.filter((s) => s === "partial").length).toBeLessThanOrEqual(3);
    }
  });
});

describe("getCoverage", () => {
  beforeEach(() => {
    clearCoverageCache();
    db.setting.mockReset().mockResolvedValue(JSON.stringify({ total: 50012, stored: 50012, remaining: 0 }));
    db.status.mockReset().mockImplementation(async (job: string) =>
      job === "leaddocket" ? { state: "ok", lastSuccessAt: "2026-09-24T04:18:00.000Z" } : { state: "idle", lastSuccessAt: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("serves repeat loads from memory for 2 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T05:00:00Z"));
    const [a, b] = await Promise.all([getCoverage(), getCoverage()]);
    expect(a).toBe(b);
    expect(a.complete).toBe(true);
    expect(a.syncedAt).toBe("2026-09-24T04:18:00.000Z");
    expect(db.setting).toHaveBeenCalledTimes(1);
    expect(db.status).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-09-24T05:01:59Z"));
    await getCoverage();
    expect(db.setting).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-24T05:02:00Z"));
    await getCoverage();
    expect(db.setting).toHaveBeenCalledTimes(2);
  });

  it("shows unknown coverage on a failed read, and doesn't keep it", async () => {
    db.setting.mockRejectedValueOnce(new Error("connection reset"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = await getCoverage();
    expect(c).toMatchObject({ complete: false, method: "none", completeFrom: null, trustedFrom: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const again = await getCoverage();
    expect(again.complete).toBe(true);
    expect(db.setting).toHaveBeenCalledTimes(2);
  });
});

describe("Freshness labels", () => {
  const now = new Date("2026-09-24T05:00:00Z");   // Sep 23, 10:00 pm Pacific

  it("says how far back, in Pacific days, with 'about'", () => {
    expect(loadedLabel(from("2026-01-22T08:00:00Z"))).toBe("about Jan 22, 2026");
    expect(loadedLabel(from("2026-01-23T05:00:00Z"))).toBe("about Jan 22, 2026");   // 9 pm Pacific on the 22nd
    expect(loadedLabel(cov({ complete: true, method: "complete" }))).toBeNull();
    expect(loadedLabel(cov())).toBeNull();
  });

  it("gives times in Pacific, with the day when it isn't today", () => {
    expect(whenLabel("2026-09-24T04:18:00Z", now)).toBe("9:18 pm");
    expect(whenLabel("2026-09-23T14:05:00Z", now)).toBe("7:05 am");
    expect(whenLabel("2026-09-23T06:59:00Z", now)).toBe("Sep 22, 11:59 pm");
    expect(whenLabel("2026-09-24T04:18:00Z", now, true)).toBe("Sep 23, 9:18 pm");
    expect(whenLabel("2025-12-31T20:00:00Z", now)).toBe("Dec 31, 2025, 12:00 pm");
    expect(whenLabel("nonsense", now)).toBe("");
  });
});
