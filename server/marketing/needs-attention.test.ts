import { describe, expect, it } from "vitest";
import { buildAlerts, type Alert, type QuietRow } from "./alerts";
import { NO_SOURCE, derive, pct, type DrillLink, type Lead } from "./common";
import type { Comparison } from "./compare";
import type { Coverage } from "./coverage";

const NOW = new Date("2026-09-24T19:00:00Z");
const SEP_1 = new Date("2026-09-01T07:00:00Z");   // Pacific midnight
const DAY = 86_400_000;
const MONTHS = ["2026-09"];

const cov = (over: Partial<Coverage> = {}): Coverage => ({
  total: 50_000, stored: 50_000, remaining: 0, at: null,
  complete: true, completeFrom: null, method: "complete", trustedFrom: null,
  newestLeadAt: null, syncedAt: NOW.toISOString(), syncState: "ok", backfillRunning: false,
  asOf: NOW.toISOString(),
  ...over,
});

type Row = Parameters<typeof buildAlerts>[0]["rows"][number];
const row = (name: string, leads: number, signed: number, over: Partial<Row> = {}): Row => ({
  name, members: name === NO_SOURCE ? [] : [name], leads, signed, open: 0,
  conversion: pct(signed, leads), spend: null, costPerSignup: null, ...over,
});
const totalsOf = (rows: Row[], over: Partial<Parameters<typeof buildAlerts>[0]["totals"]> = {}) => {
  const leads = rows.reduce((a, r) => a + r.leads, 0), signed = rows.reduce((a, r) => a + r.signed, 0);
  // Spend is entered by default so the 'enter spend' nudge stays out of tests about other rules.
  return { leads, signed, open: 0, conversion: pct(signed, leads), spend: 1000, costPerSignup: null, ...over };
};

const cmp = (byName: Record<string, [number, number]>, over: Partial<Comparison> = {}): Comparison => ({
  mode: "prev", from: "2026-08-01", to: "2026-08-24", label: "Aug 1–24", partial: false, loadedFrom: null,
  totals: { leads: 0, signed: 0, conversion: 0, spend: null, costPerLead: null, costPerSignup: null },
  costComparable: false,
  byName: Object.fromEntries(Object.entries(byName).map(([k, [leads, signed]]) => [k, { leads, signed, conversion: pct(signed, leads) }])),
  gone: [], monthly: [], mover: null, insights: [],
  ...over,
});

type Input = Parameters<typeof buildAlerts>[0];
const run = (over: Partial<Input> = {}) => {
  const rows = over.rows ?? [];
  return buildAlerts({
    leads: [], rows, totals: totalsOf(rows), compare: null, quiet: [], coverage: cov(),
    now: NOW, rangeFrom: SEP_1, rangeInProgress: false, minLeads: 8, ...over,
  });
};
const keys = (a: Alert[]) => a.map((x) => x.key);
const find = (a: Alert[], key: string) => a.find((x) => x.key === key);

describe("a. swing vs the comparison", () => {
  it("flags sign-ups at exactly max(0.3E, 2√E), and not one short of it", () => {
    // E = 6: 2√6 ≈ 4.9, so a fall of 5 is the smallest that counts.
    const hit = run({ rows: [row("Walker Advertising", 60, 1)], compare: cmp({ "Walker Advertising": [60, 6] }) });
    const a = find(hit, "swing:signed:Walker Advertising")!;
    expect(a).toMatchObject({ level: "bad", text: "Walker Advertising sign-ups down 5 (6 → 1) vs Aug 1–24." });
    expect(a.drill).toEqual({ title: "Walker Advertising", scope: { sources: ["Walker Advertising"] }, status: "signed" });
    expect(keys(run({ rows: [row("Walker Advertising", 60, 2)], compare: cmp({ "Walker Advertising": [60, 6] }) }))).not.toContain("swing:signed:Walker Advertising");
  });

  it("needs a prior value of 6 sign-ups or 15 leads", () => {
    expect(keys(run({ rows: [row("X", 10, 0)], compare: cmp({ X: [10, 5] }) })).filter((k) => k.startsWith("swing"))).toEqual([]);
    expect(keys(run({ rows: [row("X", 4, 0)], compare: cmp({ X: [14, 0] }) })).filter((k) => k.startsWith("swing"))).toEqual([]);
    // E = 15 leads: max(4.5, 7.75) → a fall of 8 counts.
    expect(keys(run({ rows: [row("X", 7, 0)], compare: cmp({ X: [15, 0] }) }))).toContain("swing:leads:X");
  });

  it("uses the 30% bar once it is the larger, and calls a rise good", () => {
    // E = 100: max(30, 20) = 30.
    expect(find(run({ rows: [row("Web", 70, 0)], compare: cmp({ Web: [100, 0] }) }), "swing:leads:Web")).toMatchObject({
      level: "bad", text: "Web leads down 30 (100 → 70) vs Aug 1–24.", drill: { status: "all" },
    });
    expect(keys(run({ rows: [row("Web", 71, 0)], compare: cmp({ Web: [100, 0] }) }))).not.toContain("swing:leads:Web");
    expect(find(run({ rows: [row("Web", 130, 0)], compare: cmp({ Web: [100, 0] }) }), "swing:leads:Web")?.level).toBe("good");
  });

  it("says a row once, preferring its sign-ups", () => {
    const a = run({ rows: [row("W", 50, 5)], compare: cmp({ W: [100, 20] }) });
    expect(keys(a).filter((k) => k.startsWith("swing"))).toEqual(["swing:signed:W"]);
  });

  it("keeps at most 3, drops first", () => {
    const rows = [row("A", 100, 40), row("B", 100, 40), row("C", 100, 1), row("D", 100, 2)];
    const a = run({ rows, compare: cmp({ A: [100, 10], B: [100, 10], C: [100, 20], D: [100, 20] }) });
    const sw = a.filter((x) => x.key.startsWith("swing"));
    expect(sw).toHaveLength(3);
    expect(sw.map((x) => x.level)).toEqual(["bad", "bad", "good"]);
  });

  it("counts a row with no leads this period as zero, with nothing to open", () => {
    const c = cmp({ Billboard: [40, 12] }, { gone: [{ name: "Billboard", members: ["Billboard"], leads: 40, signed: 12 }] });
    const a = find(run({ rows: [], compare: c }), "swing:signed:Billboard")!;
    expect(a.text).toBe("Billboard sign-ups down 12 (12 → 0) vs Aug 1–24. No leads at all this period.");
    expect(a.drill).toBeUndefined();
  });

  it("leaves 'No source recorded' to the housekeeping alert", () => {
    expect(keys(run({ rows: [row(NO_SOURCE, 100, 40)], compare: cmp({ [NO_SOURCE]: [100, 10] }) })).filter((k) => k.startsWith("swing"))).toEqual([]);
  });
});

describe("b. conversion drop", () => {
  it("needs a fall of 5 points", () => {
    // 2,000 leads a side makes z large, so only the 5-point bar decides.
    const hit = run({ rows: [row("G", 2000, 500)], compare: cmp({ G: [2000, 600] }) });
    expect(find(hit, "conv:G")).toMatchObject({
      level: "warn", text: "G converts at 25%, down from 30% in Aug 1–24 (2,000 leads this period).",
      drill: { title: "G", scope: { sources: ["G"] }, status: "all" },
    });
    expect(keys(run({ rows: [row("G", 2000, 501)], compare: cmp({ G: [2000, 600] }) }))).not.toContain("conv:G");
  });

  it("needs z ≤ −2", () => {
    // 400 leads a side, 120 signed before: 94 now is z ≈ −2.08, 95 is z ≈ −1.99. Neither is a
    // sign-up swing (a fall of 26 against a bar of 36), so only the z bar decides.
    const at = (signed: number) => run({ rows: [row("G", 400, signed)], compare: cmp({ G: [400, 120] }) });
    expect(keys(at(94))).toEqual(["conv:G"]);
    expect(keys(at(95))).toEqual([]);
  });

  it("needs 30 leads on both sides", () => {
    // 5 of 30 → 0 of 30 is z ≈ −2.3 and no swing (5 prior sign-ups is under the 6 needed).
    expect(keys(run({ rows: [row("G", 30, 0)], compare: cmp({ G: [30, 5] }) }))).toContain("conv:G");
    expect(keys(run({ rows: [row("G", 29, 0)], compare: cmp({ G: [30, 5] }) }))).not.toContain("conv:G");
    expect(keys(run({ rows: [row("G", 30, 0)], compare: cmp({ G: [29, 5] }) }))).not.toContain("conv:G");
  });

  it("isn't repeated for a row whose sign-ups already fell", () => {
    const a = run({ rows: [row("G", 100, 2)], compare: cmp({ G: [100, 30] }) });
    expect(keys(a)).toContain("swing:signed:G");
    expect(keys(a)).not.toContain("conv:G");
  });
});

describe("comparison rules are silent when the comparison is partial or off", () => {
  const rows = [row("W", 100, 2, { spend: 500, costPerSignup: 250 })];
  const byName = { W: [100, 30] as [number, number] };
  const costly = { totals: { leads: 100, signed: 30, conversion: 30, spend: 1000, costPerLead: 10, costPerSignup: 100 }, costComparable: true };
  const totals = totalsOf(rows, { costPerSignup: 250 });

  it("fires with a loaded comparison", () => {
    const a = run({ rows, totals, compare: cmp(byName, costly) });
    expect(keys(a)).toEqual(expect.arrayContaining(["swing:signed:W", "cost"]));
  });

  it("is silent when partial", () => {
    const a = run({ rows, totals, compare: cmp(byName, { ...costly, partial: true }) });
    expect(keys(a).filter((k) => /^(swing|conv|cost)/.test(k))).toEqual([]);
  });

  it("is silent when off", () => {
    const a = run({ rows, totals, compare: null });
    expect(keys(a).filter((k) => /^(swing|conv|cost)/.test(k))).toEqual([]);
  });

  it("partial also silences conversion drops", () => {
    const c = cmp({ G: [2000, 600] }, { partial: true });
    expect(keys(run({ rows: [row("G", 2000, 400)], compare: c }))).not.toContain("conv:G");
  });
});

describe("c. gone quiet", () => {
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
  const q = (source: string, n: number, daysAgo: number): QuietRow => ({ source, n, last: ago(daysAgo) });

  it("flags a listing with about 4 leads a week and none in 9 days", () => {
    const a = run({ quiet: [q("GMB 5340 Alla Road Los Angeles", 36, 9)] });
    expect(a).toEqual([{
      key: "quiet:gmb 5340 alla road los angeles", level: "bad", asOfSync: true,
      text: "GMB 5340 Alla Road Los Angeles: no leads for 9 days; it averages about 4 a week. Check the listing.",
    }]);
  });

  it("fires at rate × days = 5 with the minimum 20 leads, and not just before", () => {
    // 20 / 63 a day × 15.75 days = 5.
    expect(keys(run({ quiet: [q("GMB 1 Main St", 20, 15.75)] }))).toEqual(["quiet:gmb 1 main st"]);
    expect(keys(run({ quiet: [q("GMB 1 Main St", 20, 15.7)] }))).toEqual([]);
  });

  it("skips units with fewer than 20 leads in 63 days", () => {
    expect(keys(run({ quiet: [q("GMB 1 Main St", 19, 60)] }))).toEqual([]);
  });

  it("skips a listing that is still active", () => {
    expect(keys(run({ quiet: [q("GMB 1 Main St", 60, 0.5)] }))).toEqual([]);
  });

  it("waits two days even for a busy channel", () => {
    // 630 in 63 days = 10 a day: 1.99 days is 19.9 leads missed, still too soon.
    expect(keys(run({ quiet: [q("Web Search", 630, 1.99)] }))).toEqual([]);
    expect(find(run({ quiet: [q("Web Search", 630, 2)] }), "quiet:web search")?.text)
      .toBe("Web Search: no leads for 2 days; it averages about 10 a day. Check it is still running.");
  });

  it("judges Walker and Intaker as channels, since their contract numbers roll over", () => {
    // Two contracts of 12 each: neither alone reaches 20, the channel does.
    const a = run({ quiet: [q("Walker Advertising Contract 25", 12, 30), q("Walker Advertising Contract 26", 12, 16)] });
    expect(keys(a)).toEqual(["quiet:walker advertising"]);
    // A new contract still bringing leads keeps the channel from looking quiet.
    expect(keys(run({ quiet: [q("Walker Advertising Contract 25", 30, 30), q("Walker Advertising Contract 26", 3, 1)] }))).toEqual([]);
  });

  it("keeps each listing separate", () => {
    const a = run({ quiet: [q("GMB 1 Main St", 12, 30), q("GMB 2 Oak Ave", 12, 30)] });
    expect(keys(a)).toEqual([]);
  });

  it("skips unsourced, referrals, existing clients and employees", () => {
    const a = run({ quiet: [q(NO_SOURCE, 200, 30), q("Referral - Attorney", 200, 30), q("Existing Client", 200, 30), q("Employee", 200, 30)] });
    expect(a).toEqual([]);
  });

  it("measures the silence to the last sync, not to now", () => {
    // Last lead 9 days before now, but the last sync was 5 days ago: only 4 silent days.
    const a = run({ quiet: [q("GMB 1 Main St", 36, 9)], coverage: cov({ asOf: ago(5).toISOString() }) });
    expect(a).toEqual([]);
  });

  it("is skipped until Lead Docket history covers the whole 63 days", () => {
    const quiet = [q("GMB 1 Main St", 36, 9)];
    expect(run({ quiet, coverage: cov({ complete: false, trustedFrom: ago(62).toISOString() }) })).toEqual([]);
    expect(keys(run({ quiet, coverage: cov({ complete: false, trustedFrom: ago(64).toISOString() }) }))).toEqual(["quiet:gmb 1 main st"]);
  });
});

describe("d. spend with no sign-ups", () => {
  const rows = [row("Google Local Services Ads", 14, 0, { spend: 1200 })];

  it("is bad once the period is over, amber while it runs", () => {
    expect(find(run({ rows }), "nosign:Google Local Services Ads")).toMatchObject({
      level: "bad",
      text: "Google Local Services Ads: $1,200 entered, no sign-ups this period (14 leads).",
      drill: { title: "Google Local Services Ads", scope: { sources: ["Google Local Services Ads"] }, status: "all" },
    });
    expect(find(run({ rows, rangeInProgress: true }), "nosign:Google Local Services Ads")).toMatchObject({
      level: "warn", text: "Google Local Services Ads: $1,200 entered, no sign-ups yet this period (14 leads).",
    });
  });

  it("needs spend above 0 and no sign-ups", () => {
    expect(keys(run({ rows: [row("A", 14, 0, { spend: 0 })] }))).not.toContain("nosign:A");
    expect(keys(run({ rows: [row("A", 14, 1, { spend: 500 })] }))).not.toContain("nosign:A");
  });

  it("stays off while the period's leads are still loading", () => {
    // History trusted from Feb 21, 2026 (loaded back to Jan 22, plus the 30-day sign-up lag).
    const loading = cov({ complete: false, remaining: 9_000, method: "cursor", completeFrom: "2026-01-22T08:00:00.000Z", trustedFrom: "2026-02-21T08:00:00.000Z" });
    const key = "nosign:Google Local Services Ads";
    // Nov 2025: a few stray leads loaded, none signed yet — its sign-ups just aren't in.
    expect(keys(run({ rows, coverage: loading, rangeFrom: new Date("2025-11-01T07:00:00Z") }))).not.toContain(key);
    // January: leads partly loaded, sign-ups not yet.
    expect(keys(run({ rows, coverage: loading, rangeFrom: new Date("2026-01-01T08:00:00Z") }))).not.toContain(key);
    // A month past trustedFrom is loaded, so the alert stands.
    expect(find(run({ rows, coverage: loading, rangeFrom: new Date("2026-03-01T08:00:00Z") }), key)?.level).toBe("bad");
    // And once the backfill is complete, any period is.
    expect(find(run({ rows, rangeFrom: new Date("2025-11-01T07:00:00Z") }), key)?.level).toBe("bad");
  });
});

describe("e. cost per sign-up", () => {
  const c = (costComparable: boolean) => cmp({}, { costComparable, label: "Jul 1–31, 2026", totals: { leads: 0, signed: 0, conversion: 0, spend: 4000, costPerLead: null, costPerSignup: 400 } });
  it("warns at a 25% rise, not below", () => {
    expect(find(run({ totals: totalsOf([], { costPerSignup: 500 }), compare: c(true) }), "cost"))
      .toMatchObject({ level: "warn", text: "Cost per sign-up rose 25% on Jul 1–31, 2026 ($400 → $500)." });
    expect(keys(run({ totals: totalsOf([], { costPerSignup: 499.99 }), compare: c(true) }))).not.toContain("cost");
  });
  it("needs comparable costs", () => {
    expect(keys(run({ totals: totalsOf([], { costPerSignup: 900 }), compare: c(false) }))).not.toContain("cost");
  });
});

describe("f. still open", () => {
  const lead = (status: string, outcome: string | null = null): Lead => derive([{
    leadDate: new Date("2026-09-10T18:00:00Z"), createdDate: new Date("2026-09-10T18:00:00Z"), signedUpDate: null,
    outcome, status, subStatus: null, caseType: null, marketingSource: "Web", contactSource: null, campaign: null,
  }], MONTHS, "channel")[0];

  it("warns from 5 open leads, naming the biggest statuses", () => {
    const leads = [lead("Chase"), lead("Chase"), lead("Chase"), lead("Under Review"), lead("Under Review"), lead("Assigned"), lead("Closed", "Rejected")];
    const a = find(run({ leads, totals: totalsOf([], { open: 6 }) }), "open")!;
    expect(a).toMatchObject({ level: "warn", text: "6 leads from this period are still open (Chase 3, Under Review 2) — worth a push from intake." });
    expect(a.drill).toEqual({ title: "All leads", chips: ["Open"], scope: { bucket: "open" }, status: "all" });
    expect(keys(run({ leads, totals: totalsOf([], { open: 4 }) }))).not.toContain("open");
  });
});

describe("g. former recommendations", () => {
  it("asks for spend when none is entered, and jumps to the editor", () => {
    const rows = [row("Web", 10, 2)];
    expect(find(run({ rows, totals: totalsOf(rows, { spend: null }) }), "spend")).toEqual({
      key: "spend", level: "warn", action: "spend", text: "Enter each channel's monthly spend below to see cost per sign-up.",
    });
    expect(keys(run({ rows, totals: totalsOf(rows, { spend: 300 }) }))).not.toContain("spend");
  });

  it("flags unsourced leads from 5% of all", () => {
    const at = (n: number) => { const rows = [row("Web", 100 - n, 20), row(NO_SOURCE, n, 0)]; return run({ rows }); };
    expect(find(at(5), "unsourced")).toMatchObject({
      text: "5 leads (5%) have no Marketing Source, so no channel gets the credit — ask intake to fill it in on every new lead.",
      drill: { title: NO_SOURCE, scope: { source: NO_SOURCE }, status: "all" },
    });
    expect(keys(at(4))).not.toContain("unsourced");
  });

  it("names rows with plenty of leads converting at under half the firm's rate", () => {
    // Firm rate 21 of 115 = 18.3%, half of it 9.1%; minLeads 8 → rows need 16 leads.
    const rows = [row("Good", 64, 18), row("Weak", 16, 1), row("Tiny", 15, 0), row("Half", 20, 2)];
    const a = find(run({ rows }), "weak")!;
    expect(a.text).toBe("Review lead quality from Weak — it converts at under half the firm's rate of 18.3%.");
    expect(a.drill).toMatchObject({ title: "Weak", status: "all" });
  });
});

describe("ordering and edge cases", () => {
  it("sorts bad, then warn, then good", () => {
    const rows = [row("Up", 100, 40), row("Paid", 20, 0, { spend: 800 }), row("Down", 100, 1)];
    // minLeads is set high so the lead-quality nudge stays out of it.
    const a = run({ rows, compare: cmp({ Up: [100, 10], Down: [100, 20] }), totals: totalsOf(rows, { open: 9 }), minLeads: 500 });
    expect(a.map((x) => x.level)).toEqual(["bad", "bad", "warn", "good"]);
    expect(keys(a)).toEqual(["swing:signed:Down", "nosign:Paid", "open", "swing:signed:Up"]);
  });

  it("returns nothing for an empty period", () => {
    expect(run({ totals: totalsOf([], { spend: null }) })).toEqual([]);
  });
});

describe("reconciliation: each alert's drill opens exactly the number it states", () => {
  // A small period built the way the dashboard builds it: derive(), then the scorecard tally.
  const raw: { outcome: string | null; status: string; source: string }[] = [];
  const add = (n: number, outcome: string | null, status: string, source: string) => { for (let k = 0; k < n; k++) raw.push({ outcome, status, source }); };
  add(4, "Signed", "Signed", "Walker Advertising Contract 26");
  add(30, null, "Chase", "Walker Advertising Contract 26");
  add(8, "Rejected", "Closed", "Walker Advertising Contract 27");
  add(14, null, "Under Review", "Google Local Services Ads");
  add(6, "Signed", "Signed", "GMB 1 Main St");
  add(9, null, "Chase", "");
  const leads = derive(raw.map((r, n) => ({
    leadDate: new Date(Date.parse("2026-09-02T18:00:00Z") + n * 3_600_000), createdDate: null, signedUpDate: null,
    outcome: r.outcome, status: r.status, subStatus: null, caseType: null, marketingSource: r.source, contactSource: null, campaign: null,
  })), MONTHS, "channel");

  const byName = new Map<string, Row>();
  const totals = { leads: 0, signed: 0, open: 0, conversion: 0, spend: null as number | null, costPerSignup: null as number | null };
  for (const l of leads) {
    const r = byName.get(l.name) ?? row(l.name, 0, 0, { members: [] });
    r.leads++; if (l.signed) r.signed++; if (l.bucket === "open") r.open++;
    if (l.source !== NO_SOURCE && !r.members.includes(l.source)) r.members.push(l.source);
    byName.set(l.name, r);
    totals.leads++; if (l.signed) totals.signed++; if (l.bucket === "open") totals.open++;
  }
  const rows = Array.from(byName.values()).map((r) => ({ ...r, conversion: pct(r.signed, r.leads) }));
  rows.find((r) => r.name === "Google Local Services Ads")!.spend = 1200;
  totals.conversion = pct(totals.signed, totals.leads);
  totals.spend = 1200;

  // What the leads endpoint would return for a drill, from the same classifiers.
  const opened = (d: DrillLink) => leads.filter((l) =>
    (d.scope.source == null || l.source === d.scope.source)
    && (d.scope.sources == null || d.scope.sources.includes(l.source))
    && (d.scope.bucket == null || l.bucket === d.scope.bucket)
    && (d.status !== "signed" || l.signed)).length;

  const alerts = buildAlerts({
    leads, rows, totals,
    compare: cmp({ "Walker Advertising": [60, 15] }),
    quiet: [], coverage: cov(), now: NOW, rangeFrom: SEP_1, rangeInProgress: false, minLeads: 8,
  });

  it("produces the alerts this period should", () => {
    expect(keys(alerts)).toEqual(expect.arrayContaining(["swing:signed:Walker Advertising", "nosign:Google Local Services Ads", "open", "unsourced"]));
  });

  it("matches every drill to the count in its sentence", () => {
    const stated: Record<string, (t: string) => number> = {
      "swing:signed:Walker Advertising": (t) => Number(/→ (\d+)\)/.exec(t)![1]),
      "nosign:Google Local Services Ads": (t) => Number(/\((\d+) leads?\)/.exec(t)![1]),
      open: (t) => Number(/^(\d+) leads?/.exec(t)![1]),
      unsourced: (t) => Number(/^(\d+) leads?/.exec(t)![1]),
    };
    for (const a of alerts) {
      if (!a.drill || !stated[a.key]) continue;
      expect(opened(a.drill), a.key).toBe(stated[a.key](a.text));
    }
  });

  it("still-open equals the scorecard's Open TOTAL", () => {
    const a = find(alerts, "open")!;
    expect(opened(a.drill!)).toBe(totals.open);
    expect(a.text.startsWith(`${totals.open} leads`)).toBe(true);
  });
});
