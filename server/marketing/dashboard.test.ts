/**
 * getMarketingDashboard end to end, on synthetic leads: every panel it composes
 * must add back to the scorecard (no '[marketing] reconcile' warning), in both
 * views and every comparison mode, and the comparison's totals must be what the
 * earlier range shows when it is picked on its own. The database reads are
 * replaced; everything else is the real code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import type { LeadRow } from "./common";
import type { Coverage } from "./coverage";
import type { SpendRow } from "./spend";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],     // what the main query returns for the range asked
  all: [] as unknown[],      // every lead, for the comparison's own read
  spend: [] as SpendRow[],
  priorCalls: 0,
}));

// The main query is the only select left once the loaders below are replaced.
vi.mock("../db", () => {
  const chain = { from: () => chain, where: () => Promise.resolve(state.rows) };
  return { getDb: async () => ({ select: () => chain }), getSetting: async () => null };
});
vi.mock("../dataSync", () => ({ getStatus: async () => null }));
vi.mock("./spend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./spend")>();
  return { ...mod, loadSpend: async (months: string[]) => state.spend.filter((s) => months.includes(s.month)) };
});
vi.mock("./coverage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./coverage")>();
  const complete: Coverage = {
    total: 50_000, stored: 50_000, remaining: 0, at: null, complete: true, completeFrom: null, method: "complete",
    trustedFrom: null, newestLeadAt: "2026-09-24T20:00:00.000Z", syncedAt: "2026-09-24T21:00:00.000Z",
    syncState: "ok", backfillRunning: false, asOf: "2026-09-24T21:00:00.000Z",
  };
  return { ...mod, getCoverage: async () => complete };
});
vi.mock("./alerts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./alerts")>();
  return { ...mod, loadQuiet: async () => [] };
});
vi.mock("./compare", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./compare")>();
  const { monthsBetween } = await import("./common");
  return {
    ...mod,
    loadPrior: async (range: { from: Date; to: Date }, group: "channel" | "source") => {
      state.priorCalls++;
      const rows = (state.all as LeadRow[]).filter((r) => r.leadDate && r.leadDate >= range.from && r.leadDate <= range.to);
      return mod.tallyPrior(rows, monthsBetween(range.from, range.to), group);
    },
  };
});

import { getMarketingDashboard } from "../marketingReport";

const TZ = "America/Los_Angeles";
const day = (d: string) => ({ from: fromZonedTime(`${d}T00:00:00`, TZ), to: fromZonedTime(`${d}T23:59:59.999`, TZ) });
const rangeOf = (from: string, to: string) => ({ from: day(from).from, to: day(to).to });

/** A small deterministic generator, so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const SOURCES = [
  "Walker Advertising Contract 26", "Walker Advertising Contract 27", "walker advertising contract 27", "GMB 525 W Main St Visalia",
  "GMB Fresno", "Intaker - JFJ", "JustinforJustice Website", "Existing Client", "Television", "Yelp", null, "",
];
const OUTCOMES: [string, string, string | null][] = [
  ["Signed", "Signed Up", "Signed Agreement/Welcome Letter Sent - Via Email"],
  ["Signed Referred Out", "Referred", "Signed Up"],
  ["Referred Out", "Referred", "Med Mal"],
  ["Rejected", "Rejected", "Spam"],
  ["Rejected", "Rejected", "No Injury"],
  ["Lost", "Lost", "Hired another attorney"],
  ["Not Interested", "Not Interested", null],
  ["Chase", "Chase", "Continued Attempt"],
  ["Under Review", "Under Review", "N/A"],
];
const CASES = ["Auto Accident", "auto accident", "Slip and Fall", "Dog Bite", "Work Comp", "Premises", "Motorcycle", "Other", null, "  "];
const CONTACTS = ["Google My Business", "Web Form", "Phone Call", "Unknown", null, "Walk In", "Existing Client"];
const CAMPAIGNS = [null, null, "Summer TV", "summer tv", "GLSA Fresno"];

function makeLeads(n: number, seed: number): LeadRow[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const start = day("2025-06-01").from.getTime();
  const end = day("2026-09-24").to.getTime();
  const out: LeadRow[] = [];
  for (let i = 0; i < n; i++) {
    const leadDate = new Date(start + r() * (end - start));
    const [outcome, status, subStatus] = pick(OUTCOMES);
    const signed = outcome === "Signed" || outcome === "Signed Referred Out";
    const created = new Date(leadDate.getTime() - (signed ? r() * 20 : 0) * 86_400_000);
    out.push({
      leadDate, createdDate: created, signedUpDate: signed ? leadDate : null,
      outcome, status, subStatus, caseType: pick(CASES), marketingSource: pick(SOURCES),
      contactSource: pick(CONTACTS), campaign: pick(CAMPAIGNS),
    } as LeadRow);
  }
  return out;
}

const ALL = makeLeads(4000, 7);
const SPEND: SpendRow[] = [
  { month: "2026-08", source: "Walker Advertising Contract 26", amount: 4500 },
  { month: "2026-08", source: "Walker Advertising", amount: 1200.5 },            // the channel itself
  { month: "2026-09", source: "Walker Advertising Contract 99", amount: 800 },    // a contract with no leads yet
  { month: "2026-09", source: "GMB Fresno", amount: 300.25 },
  { month: "2026-09", source: "Billboard on 99", amount: 2000 },                 // no leads at all
  { month: "2025-09", source: "Television", amount: 5000 },
  { month: "2026-07", source: "yelp", amount: 150 },
];

async function load(from: string, to: string, group: "channel" | "source", compare: "prev" | "yoy" | "off", today = "2026-09-24") {
  const range = rangeOf(from, to);
  state.rows = ALL.filter((l) => l.leadDate && l.leadDate >= range.from && l.leadDate <= range.to);
  state.all = ALL;
  state.spend = SPEND;
  const d = await getMarketingDashboard(range, { group, from, to, compare, today });
  if (!d) throw new Error("no dashboard");
  return d;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); state.priorCalls = 0; });
afterEach(() => { warn.mockRestore(); });
const reconcileWarnings = () => warn.mock.calls.filter((c: unknown[]) => c[0] === "[marketing] reconcile");

describe("getMarketingDashboard", () => {
  const ranges: [string, string, string, "prev" | "yoy" | "off"][] = [
    ["this month vs previous", "2026-09-01", "2026-09-24", "prev"],
    ["last month vs previous", "2026-08-01", "2026-08-31", "prev"],
    ["year to date vs last year", "2026-01-01", "2026-09-24", "yoy"],
    ["mid-month range vs the days before", "2026-09-10", "2026-09-24", "prev"],
    ["all time", "2020-01-01", "2026-09-24", "prev"],
    ["no comparison", "2026-06-01", "2026-09-24", "off"],
  ];
  for (const [what, from, to, compare] of ranges) {
    for (const group of ["channel", "source"] as const) {
      it(`reconciles: ${what}, ${group}s`, async () => {
        const d = await load(from, to, group, compare);
        expect(reconcileWarnings()).toEqual([]);
        // The scorecard: rows add to TOTAL, columns add to leads.
        const t = d.totals;
        expect(d.sources.reduce((a, s) => a + s.leads, 0)).toBe(t.leads);
        expect(d.sources.reduce((a, s) => a + s.signed, 0)).toBe(t.signed);
        expect(t.open + t.rejected + t.referredOut + t.notInterested + t.signedReferred + t.signedInHouse).toBe(t.leads);
        expect(d.insights.length).toBeLessThanOrEqual(7);
        expect(d.coverage.months).toHaveLength(d.months.length);
        expect(d.caseMatrix.typeVariants).toHaveLength(d.caseMatrix.types.length);
        expect(d.caseMatrix.all).toHaveLength(d.caseMatrix.types.length);
        expect(d.caseMatrix.all.reduce((a, v) => a + v.leads, 0)).toBe(t.leads);
      });
    }
  }

  it("All time never reads an earlier period", async () => {
    const d = await load("2020-01-01", "2026-09-24", "channel", "prev");
    expect(d.compare).toBeNull();
    expect(state.priorCalls).toBe(0);
  });

  it("the comparison's totals are what the earlier range shows on its own", async () => {
    for (const group of ["channel", "source"] as const) {
      const now = await load("2026-09-01", "2026-09-24", group, "prev");
      expect(now.compare?.label).toBe("Aug 1–24");
      const then = await load("2026-08-01", "2026-08-24", group, "off");
      expect(now.compare?.totals.leads).toBe(then.totals.leads);
      expect(now.compare?.totals.signed).toBe(then.totals.signed);
      for (const s of then.sources) expect(now.compare?.byName[s.name]?.signed).toBe(s.signed);
    }
  });

  it("puts every dollar on one row or the unmatched line", async () => {
    const d = await load("2026-08-01", "2026-09-24", "channel", "off");
    const rows = d.sources.reduce((a, s) => a + Math.round((s.spend ?? 0) * 100), 0);
    const lost = d.spendUnmatched.reduce((a, u) => a + Math.round(u.amount * 100), 0);
    expect(rows + lost).toBe(Math.round((d.totals.spend ?? 0) * 100));
    expect(d.totals.spendMatched).toBe(rows / 100);
    // A new contract with no leads still counts toward its vendor in the Channels view.
    expect(d.sources.find((s) => s.name === "Walker Advertising")?.spend).toBe(4500 + 1200.5 + 800);
    expect(d.spendUnmatched.map((u) => u.source)).toEqual(["Billboard on 99"]);
    // Aug 1 – Sep 24 covers only part of September, whose spend counts in full.
    expect(d.partialNote).toMatch(/September's spend counts in full/);
  });

  it("gives case types and campaigns every spelling they group", async () => {
    const d = await load("2026-01-01", "2026-09-24", "channel", "off");
    const auto = d.caseTypes.find((c) => c.name.toLowerCase() === "auto accident");
    expect(auto?.variants.sort()).toEqual(["Auto Accident", "auto accident"]);
    const blank = d.caseTypes.find((c) => c.name === "Not recorded");
    expect(blank?.variants).toEqual([""]);
    const tv = d.campaigns.find((c) => c.name.toLowerCase() === "summer tv");
    expect(tv?.variants.length).toBeGreaterThanOrEqual(1);
    // 'All other' excludes exactly the shown types' spellings.
    const last = d.caseMatrix.typeVariants[d.caseMatrix.types.length - 1];
    expect(last.sort()).toEqual(d.caseMatrix.typeVariants.slice(0, -1).flat().sort());
  });

  it("keeps each campaign to one scorecard row, so its drill-down lists every lead it counts", async () => {
    const at = day("2026-09-10").from;
    const lead = (marketingSource: string, campaign: string, signed = false) => ({
      leadDate: at, createdDate: at, signedUpDate: signed ? at : null,
      outcome: signed ? "Signed" : "Lost", status: signed ? "Signed Up" : "Lost", subStatus: null,
      caseType: "Auto Accident", marketingSource, contactSource: "Web Form", campaign,
    } as LeadRow);
    const rows = [
      // Case twins: two rows in the Sources view, one channel in the Channels view.
      ...[0, 1, 2].map((i) => lead("Walker Advertising Contract 27", "Fall Push", i === 0)),
      ...[0, 1, 2].map(() => lead("walker advertising contract 27", "fall push")),
      // No channel rule matches these, so they stay two rows in both views.
      ...[0, 1].map(() => lead("Yelp", "Fall Push")),
      ...[0, 1].map(() => lead("yelp", "Fall Push")),
    ];
    for (const group of ["source", "channel"] as const) {
      state.rows = rows; state.all = rows; state.spend = [];
      const d = await getMarketingDashboard(rangeOf("2026-09-01", "2026-09-30"), { group, from: "2026-09-01", to: "2026-09-30", compare: "off", today: "2026-09-24" });
      if (!d) throw new Error("no dashboard");
      for (const cp of d.campaigns) {
        const row = d.sources.find((s) => s.name === cp.source);
        expect(row, `${group}: ${cp.source}`).toBeDefined();
        // What the page's drill-down asks for: that row's members, any of the campaign's spellings.
        const listed = rows.filter((l) => row!.members.includes(l.marketingSource!) && cp.variants.includes(l.campaign!));
        expect(cp.leads, `${group}: ${cp.source} / ${cp.name}`).toBe(listed.length);
      }
      expect(d.campaigns.reduce((a, c) => a + c.leads, 0)).toBe(rows.length);
      const sizes = d.campaigns.map((c) => c.leads).sort();
      expect(sizes).toEqual(group === "source" ? [2, 2, 3, 3] : [2, 2, 6]);
    }
  });

  it("drops recommendations for alerts and returns every panel", async () => {
    const d = await load("2026-09-01", "2026-09-24", "channel", "prev");
    expect(d).not.toHaveProperty("recommendations");
    for (const k of ["why", "grid", "routes", "compare", "pace", "alerts", "coverage", "spendUnmatched", "partialMonths"]) {
      expect(d).toHaveProperty(k);
    }
    expect(d.pace?.month).toBe("2026-09");
  });

  it("sends no rejection reasons to someone who may not see intake case facts", async () => {
    const range = rangeOf("2026-09-01", "2026-09-24");
    state.rows = ALL.filter((l) => l.leadDate && l.leadDate >= range.from && l.leadDate <= range.to);
    state.all = ALL;
    state.spend = SPEND;
    const full = await load("2026-09-01", "2026-09-24", "channel", "prev");
    const d = (await getMarketingDashboard(range, { group: "channel", from: "2026-09-01", to: "2026-09-24", compare: "prev", today: "2026-09-24", caseFacts: false }))!;
    expect(full.caseFacts).toBe(true);
    expect(d.caseFacts).toBe(false);
    expect(d.why).toBeNull();
    expect(d.grid.rows.every((r) => r.notViableCells.every((v) => v === 0))).toBe(true);
    expect(d.grid.monthly.every((m) => m.notViable === 0)).toBe(true);
    expect(d.routes.rows.every((r) => r.notViable === 0 && r.lostThem === 0)).toBe(true);
    // Everything else is the same report.
    expect(d.totals).toEqual(full.totals);
    expect(d.sources).toEqual(full.sources);
    for (const line of full.why?.insights ?? []) expect(d.insights).not.toContain(line);
  });
});
