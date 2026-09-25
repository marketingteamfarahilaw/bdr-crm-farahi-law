import { describe, expect, it } from "vitest";
import { NO_SOURCE, channelOfSource, type RowRef } from "./common";
import { assignSpend, checkSpend, partialMonths, spendNotes, type SpendAssignment, type SpendRow } from "./spend";
import { parseSpendPaste } from "../../shared/marketingSpendPaste";

const cents = (n: number | null | undefined) => (n == null ? 0 : Math.round(n * 100));
const sumCents = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + cents(x), 0);
const cellsOf = (a: SpendAssignment, rows: RowRef[]) => rows.map((r) => a.byRow.get(r.name) ?? null);

/** Every reconciliation property the dashboard relies on, asserted in cents. */
function expectReconciles(a: SpendAssignment, rows: RowRef[], spend: SpendRow[], months: string[]) {
  const inRange = spend.filter((s) => months.includes(s.month));
  const rowSpend = cellsOf(a, rows);
  expect(checkSpend(a, rowSpend)).toEqual([]);
  expect(sumCents(rowSpend) + sumCents(a.unmatched.map((u) => u.amount))).toBe(cents(a.total));
  expect(sumCents(a.byMonth)).toBe(cents(a.total));
  expect(cents(a.total)).toBe(sumCents(inRange.map((s) => s.amount)));
  a.byRow.forEach((v, name) => expect(sumCents(a.byRowMonth.get(name) ?? [])).toBe(cents(v)));
}

describe("assignSpend — Channel view", () => {
  const months = ["2026-08", "2026-09"];
  const rows: RowRef[] = [
    { name: "Walker Advertising", members: ["Walker Advertising Contract 26", "Walker Advertising Contract 31"] },
    { name: "Google Business Profile (GMB)", members: ["GMB 525 W Main St Visalia"] },
    { name: "Web Search", members: ["Web Search"] },
    { name: NO_SOURCE, members: [] },
  ];

  it("puts spend on a contract with no leads into its channel's row", () => {
    const spend: SpendRow[] = [
      { month: "2026-09", source: "Walker Advertising Contract 99", amount: 1200 },   // no leads this period
      { month: "2026-09", source: "Walker Advertising Contract 26", amount: 800 },
      { month: "2026-08", source: "walker advertising", amount: 500 },               // channel-level, other case
      { month: "2026-09", source: "GMB 1 Main St", amount: 300.33 },
      { month: "2026-09", source: "Google My Business", amount: 100 },
    ];
    const a = assignSpend(spend, rows, "channel", months);
    expect(a.byRow.get("Walker Advertising")).toBe(2500);
    expect(a.byRowMonth.get("Walker Advertising")).toEqual([500, 2000]);
    expect(a.byRow.get("Google Business Profile (GMB)")).toBe(400.33);
    expect(a.byRow.has("Web Search")).toBe(false);
    expect(a.byMonth).toEqual([500, 2400.33]);
    expect(a.unmatched).toEqual([]);
    expect(a.total).toBe(2900.33);
    expectReconciles(a, rows, spend, months);
  });

  it("lists a vendor with no leads at all as unmatched", () => {
    const noWalker = rows.filter((r) => r.name !== "Walker Advertising");
    const spend: SpendRow[] = [
      { month: "2026-09", source: "Walker Advertising Contract 99", amount: 1200 },
      { month: "2026-09", source: "Web Search", amount: 50 },
    ];
    const a = assignSpend(spend, noWalker, "channel", months);
    expect(a.unmatched).toEqual([{ source: "Walker Advertising Contract 99", amount: 1200, why: "noLeads" }]);
    expect(a.byRow.get("Web Search")).toBe(50);
    expect(a.total).toBe(1250);
    expectReconciles(a, noWalker, spend, months);
  });
});

describe("assignSpend — Source view", () => {
  const months = ["2026-09"];
  const rows: RowRef[] = [
    { name: "Walker Advertising Contract 26", members: ["Walker Advertising Contract 26"] },
    { name: "GMB 1 Main St", members: ["GMB 1 Main St"] },
    { name: "gmb 1 main st", members: ["gmb 1 main st"] },
    { name: NO_SOURCE, members: [] },
  ];

  it("gives spend to the first of two rows that differ only in case, never both", () => {
    const spend: SpendRow[] = [{ month: "2026-09", source: "GMB 1 MAIN ST", amount: 200 }];
    const a = assignSpend(spend, rows, "source", months);
    expect(a.byRow.get("GMB 1 Main St")).toBe(200);
    expect(a.byRow.has("gmb 1 main st")).toBe(false);
    expect(cellsOf(a, rows)).toEqual([null, 200, null, null]);
    expectReconciles(a, rows, spend, months);
  });

  it("lists channel-level spend as unmatched, with the channel reason", () => {
    const spend: SpendRow[] = [
      { month: "2026-09", source: "Walker Advertising", amount: 4500 },
      { month: "2026-09", source: "Walker Advertising Contract 26", amount: 900 },
      { month: "2026-09", source: "Billboard I-5", amount: 1000 },
    ];
    const a = assignSpend(spend, rows, "source", months);
    expect(a.byRow.get("Walker Advertising Contract 26")).toBe(900);
    expect(a.unmatched).toEqual([
      { source: "Walker Advertising", amount: 4500, why: "channel" },
      { source: "Billboard I-5", amount: 1000, why: "noLeads" },
    ]);
    expect(a.total).toBe(6400);
    expectReconciles(a, rows, spend, months);
  });

  it("sums unmatched case twins once, spelled as the latest month has it", () => {
    const m2 = ["2026-08", "2026-09"];
    const spend: SpendRow[] = [
      { month: "2026-08", source: "billboard  i-5", amount: 100 },
      { month: "2026-09", source: "Billboard I-5", amount: 50.1 },
      { month: "2026-08", source: "BILLBOARD I-5", amount: 0.2 },
    ];
    const a = assignSpend(spend, rows, "source", m2);
    expect(a.unmatched).toEqual([{ source: "Billboard I-5", amount: 150.3, why: "noLeads" }]);
    expect(a.byMonth).toEqual([100.2, 50.1]);
    expectReconciles(a, rows, spend, m2);
  });
});

describe("assignSpend — edges", () => {
  const rows: RowRef[] = [{ name: "Web Search", members: ["Web Search"] }];

  it("is empty and still reconciles with no spend", () => {
    const a = assignSpend([], rows, "channel", ["2026-08", "2026-09"]);
    expect(a.byRow.size).toBe(0);
    expect(a.byMonth).toEqual([null, null]);
    expect(a.unmatched).toEqual([]);
    expect(a.total).toBe(0);
    expect(checkSpend(a, [null])).toEqual([]);
  });

  it("handles no months and no rows", () => {
    const a = assignSpend([{ month: "2026-09", source: "Web Search", amount: 10 }], [], "source", []);
    expect(a.total).toBe(0);
    expect(a.byMonth).toEqual([]);
    expect(checkSpend(a, [])).toEqual([]);
  });

  it("ignores months outside the range and $0 rows", () => {
    const spend: SpendRow[] = [
      { month: "2026-07", source: "Web Search", amount: 999 },
      { month: "2026-09", source: "Web Search", amount: 0 },
      { month: "2026-09", source: "Nobody", amount: 0 },
      { month: "2026-09", source: "Web Search", amount: 25 },
    ];
    const a = assignSpend(spend, rows, "source", ["2026-09"]);
    expect(a.byRow.get("Web Search")).toBe(25);
    expect(a.unmatched).toEqual([]);
    expect(a.total).toBe(25);
  });

  it("adds cents without float drift", () => {
    const spend: SpendRow[] = Array.from({ length: 10 }, () => ({ month: "2026-09", source: "Web Search", amount: 0.1 }));
    const a = assignSpend(spend, rows, "source", ["2026-09"]);
    expect(a.byRow.get("Web Search")).toBe(1);
    expect(a.total).toBe(1);
  });
});

describe("assignSpend — every dollar lands in exactly one place", () => {
  // A small seeded generator, so a failure reproduces.
  const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pool = [
    "Walker Advertising Contract 26", "Walker Advertising Contract 99", "walker advertising", "Walker Advertising",
    "GMB 525 W Main St Visalia", "gmb 525 w main st visalia", "Google My Business", "Intaker Chat", "Intaker",
    "JustinforJustice Website", "Web Search", "WEB SEARCH", "Facebook Contract 2", "Facebook", "Billboard I-5", NO_SOURCE,
  ];

  for (const group of ["channel", "source"] as const) {
    it(`reconciles to the cent in ${group} view`, () => {
      const r = rng(group === "channel" ? 7 : 11);
      for (let trial = 0; trial < 60; trial++) {
        const months = ["2026-07", "2026-08", "2026-09"];
        // The scorecard's rows: some sources with leads, named the way the dashboard names them.
        const withLeads = pool.filter(() => r() < 0.5);
        const byName = new Map<string, RowRef>();
        for (const s of withLeads) {
          const name = group === "channel" && s !== NO_SOURCE ? channelOfSource(s) : s;
          const row = byName.get(name) ?? { name, members: [] };
          if (s !== NO_SOURCE) row.members.push(s);
          byName.set(name, row);
        }
        const rows = Array.from(byName.values());
        const spend: SpendRow[] = Array.from({ length: Math.floor(r() * 25) }, () => ({
          month: ["2026-06", ...months][Math.floor(r() * 4)],
          source: pool[Math.floor(r() * pool.length)],
          amount: Math.round(r() * 500_000) / 100,
        }));
        const a = assignSpend(spend, rows, group, months);
        expectReconciles(a, rows, spend, months);
        // No two rows share a name key, so case twins never double up.
        const keys = Array.from(a.byRow.keys()).map((k) => k.toLowerCase());
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  }
});

describe("checkSpend", () => {
  const rows: RowRef[] = [{ name: "A", members: ["A"] }, { name: "B", members: ["B"] }];
  const spend: SpendRow[] = [
    { month: "2026-09", source: "A", amount: 100 },
    { month: "2026-09", source: "Z", amount: 40 },
  ];

  it("reports a row whose spend went missing from the scorecard", () => {
    const a = assignSpend(spend, rows, "source", ["2026-09"]);
    expect(checkSpend(a, [null, null]).length).toBeGreaterThan(0);
  });

  it("reports spend counted twice", () => {
    const a = assignSpend(spend, rows, "source", ["2026-09"]);
    expect(checkSpend(a, [100, 100]).length).toBeGreaterThan(0);
  });

  it("reports months that don't add up to their row", () => {
    const a = assignSpend(spend, rows, "source", ["2026-09"]);
    a.byRowMonth.set("A", [90]);
    expect(checkSpend(a, [100, null])).toEqual(expect.arrayContaining([expect.stringContaining("A's months")]));
  });
});

describe("partialMonths", () => {
  it("flags the month a range stops short in", () => {
    expect(partialMonths("2026-09-01", "2026-09-24")).toEqual([{ month: "2026-09", covered: 24, days: 30 }]);
  });
  it("is empty for a whole month", () => {
    expect(partialMonths("2026-08-01", "2026-08-31")).toEqual([]);
  });
  it("checks both ends of a longer range", () => {
    expect(partialMonths("2026-01-15", "2026-03-10")).toEqual([
      { month: "2026-01", covered: 17, days: 31 },
      { month: "2026-03", covered: 10, days: 31 },
    ]);
  });
  it("knows February and leap years", () => {
    expect(partialMonths("2028-02-01", "2028-02-29")).toEqual([]);
    expect(partialMonths("2026-02-01", "2026-02-27")).toEqual([{ month: "2026-02", covered: 27, days: 28 }]);
  });
  it("covers the middle of one month", () => {
    expect(partialMonths("2026-09-10", "2026-09-24")).toEqual([{ month: "2026-09", covered: 15, days: 30 }]);
  });
  it("ignores bad input", () => {
    expect(partialMonths("2026-09-24", "2026-09-01")).toEqual([]);
    expect(partialMonths("", "2026-09-01")).toEqual([]);
  });
});

describe("spendNotes", () => {
  const rows: RowRef[] = [{ name: "Web Search", members: ["Web Search"] }];

  it("explains a partial month that has spend ('This month')", () => {
    const months = ["2026-09"];
    const a = assignSpend([{ month: "2026-09", source: "Web Search", amount: 12000 }], rows, "channel", months);
    const { partialNote, insights } = spendNotes(a, partialMonths("2026-09-01", "2026-09-24"), ["full"], months, { today: "2026-09-24" });
    expect(partialNote).toBe(
      "September's spend counts in full, but this range covers 24 of its 30 days, so its cost per sign-up runs high until the month ends.",
    );
    expect(insights[0]).toBe(partialNote);
  });

  it("doesn't promise a finished month will catch up", () => {
    const months = ["2026-08"];
    const a = assignSpend([{ month: "2026-08", source: "Web Search", amount: 500 }], rows, "channel", months);
    expect(spendNotes(a, partialMonths("2026-08-01", "2026-08-24"), ["full"], months, { today: "2026-09-25" }).partialNote).toBe(
      "August's spend counts in full, but this range covers 24 of its 31 days, so its cost per sign-up runs high.",
    );
  });

  it("says nothing for a whole month ('Last month')", () => {
    const months = ["2026-08"];
    const a = assignSpend([{ month: "2026-08", source: "Web Search", amount: 500 }], rows, "channel", months);
    expect(spendNotes(a, partialMonths("2026-08-01", "2026-08-31"), ["full"], months)).toEqual({ partialNote: null, insights: [] });
  });

  it("only mentions months with spend entered", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const a = assignSpend([{ month: "2026-03", source: "Web Search", amount: 500 }], rows, "channel", months);
    const { partialNote } = spendNotes(a, partialMonths("2026-01-15", "2026-03-10"), ["partial", "partial", "full"], months, { today: "2026-03-10" });
    expect(partialNote).toBe(
      "March's spend counts in full, but this range covers 10 of its 31 days, so its cost per sign-up runs high until the month ends.",
    );
    expect(spendNotes(assignSpend([], rows, "channel", months), [], ["none", "none", "none"], months).partialNote).toBeNull();
  });

  it("warns when a month with spend is still loading", () => {
    const months = ["2026-01", "2026-02"];
    const a = assignSpend([{ month: "2026-01", source: "Web Search", amount: 500 }], rows, "channel", months);
    expect(spendNotes(a, [], ["partial", "full"], months).partialNote)
      .toBe("January 2026's leads are still loading, so its cost per sign-up is too high for now.");
    const b = assignSpend([
      { month: "2026-01", source: "Web Search", amount: 500 },
      { month: "2026-02", source: "Web Search", amount: 500 },
    ], rows, "channel", months);
    expect(spendNotes(b, [], ["partial", "none"], months).partialNote)
      .toBe("Leads for January 2026 and February 2026 are still loading, so their cost per sign-up is too high for now.");
    // Coverage not known yet: no month is called loading.
    expect(spendNotes(b, [], [], months)).toEqual({ partialNote: null, insights: [] });
  });

  it("names the year when the range crosses one", () => {
    const months = ["2025-12", "2026-01"];
    const a = assignSpend([{ month: "2025-12", source: "Web Search", amount: 500 }], rows, "channel", months);
    expect(spendNotes(a, partialMonths("2025-12-15", "2026-01-31"), ["full", "full"], months).partialNote)
      .toBe("December 2025's spend counts in full, but this range covers 17 of its 31 days, so its cost per sign-up runs high.");
  });

  it("adds a briefing line for spend that matches no row", () => {
    const months = ["2026-09"];
    const a = assignSpend([{ month: "2026-09", source: "Walker Advertising Contract 99", amount: 1200 }], rows, "channel", months);
    expect(spendNotes(a, [], ["full"], months).insights)
      .toEqual(["$1,200 of spend (Walker Advertising Contract 99) matches no channel with leads this period."]);
    const s = assignSpend([{ month: "2026-09", source: "Walker Advertising", amount: 4500.5 }],
      [{ name: "Walker Advertising Contract 26", members: [] }], "source", months);
    expect(spendNotes(s, [], ["full"], months, { group: "source" }).insights)
      .toEqual(["$4,500.50 of spend (Walker Advertising) was entered for a whole channel, so only the Channels view sets it against leads."]);
  });
});

describe("parseSpendPaste", () => {
  it("reads tab- and comma-separated lines, with $ and thousands commas", () => {
    const p = parseSpendPaste("Walker Advertising, $4,500\nGMB 525 W Main St Visalia\t1,200\n");
    expect(p.rows).toEqual([
      { line: 1, source: "Walker Advertising", amount: 4500 },
      { line: 2, source: "GMB 525 W Main St Visalia", amount: 1200 },
    ]);
    expect(p.bad).toEqual([]);
  });

  it("keeps a name that contains a comma whole", () => {
    expect(parseSpendPaste("Smith, Jones & Co, 1,200").rows).toEqual([{ line: 1, source: "Smith, Jones & Co", amount: 1200 }]);
  });

  it("reads semicolons, cents, CRLF, quotes and spacing", () => {
    const p = parseSpendPaste('Intaker; 99.5\r\n"Walker Advertising, LLC",$ 3,000.25\r\n  Web   Search \t 10  ');
    expect(p.rows).toEqual([
      { line: 1, source: "Intaker", amount: 99.5 },
      { line: 2, source: "Walker Advertising, LLC", amount: 3000.25 },
      { line: 3, source: "Web Search", amount: 10 },
    ]);
  });

  it("skips blank lines and lists unreadable ones with their line number", () => {
    const p = parseSpendPaste("Source\tAmount\n\n   \nWalker 4500\n\t4500\nBillboard, -50\nFacebook, 0\nHuge, 99,999,999");
    expect(p.rows).toEqual([{ line: 7, source: "Facebook", amount: 0 }]);
    expect(p.bad).toEqual([
      { line: 1, text: "Source\tAmount" },
      { line: 4, text: "Walker 4500" },
      { line: 5, text: "4500" },
      { line: 6, text: "Billboard, -50" },
      { line: 8, text: "Huge, 99,999,999" },
    ]);
  });

  it("won't split an amount at its own thousands comma", () => {
    const p = parseSpendPaste(
      "Google Ads $2,500\nWalker Advertising Contract 26 1,500\nWalker 4,500\nBig 2,500,000.50\n" +
      "Google Ads\t$2,500\nGoogle Ads, $2,500\nContract 26, 500\nContract 26,1500\n\"Contract 26\",500",
    );
    expect(p.bad).toEqual([
      { line: 1, text: "Google Ads $2,500" },
      { line: 2, text: "Walker Advertising Contract 26 1,500" },
      { line: 3, text: "Walker 4,500" },
      { line: 4, text: "Big 2,500,000.50" },
    ]);
    expect(p.rows).toEqual([
      { line: 5, source: "Google Ads", amount: 2500 },
      { line: 6, source: "Google Ads", amount: 2500 },
      { line: 7, source: "Contract 26", amount: 500 },
      { line: 8, source: "Contract 26", amount: 1500 },
      { line: 9, source: "Contract 26", amount: 500 },
    ]);
  });

  it("is empty for empty text", () => {
    expect(parseSpendPaste("")).toEqual({ rows: [], bad: [] });
  });
});
