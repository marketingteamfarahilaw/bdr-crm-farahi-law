import { describe, expect, it } from "vitest";
import { pickTab } from "./marketingSheetSync";
import { sheetVariances, type ParsedSheet, type ReportForSheet } from "@shared/digitalSheet";

describe("marketing sheet: which day's tab", () => {
  it("takes today's tab when it's there", () => {
    expect(pickTab(["111626", "111726", "111826"], "2026-11-18")).toEqual({ day: "2026-11-18", tab: "111826" });
  });
  it("falls back to the latest earlier day this month", () => {
    expect(pickTab(["111426", "111526"], "2026-11-18")).toEqual({ day: "2026-11-15", tab: "111526" });
  });
  it("never uses last month's tab — it is a different month to date", () => {
    expect(pickTab(["103026", "103126"], "2026-11-02")).toBeNull();
  });
  it("gives up after a week", () => {
    expect(pickTab(["11126"], "2026-11-20")).toBeNull();
  });
});

describe("marketing sheet: the variance log's rows", () => {
  const sheet: ParsedSheet = {
    team: { GBP: { leads: 10, signed: 3 }, SEO: { leads: 5, signed: 1 }, TOTAL: { leads: 15, signed: 4 } },
    inHouse: [{ name: "Maria Lopez", source: "GBP Visalia", caseValue: "", caseType: "" }, { name: "Only Sheet", source: "", caseValue: "", caseType: "" }],
    referred: [],
    found: { team: true, inHouse: true, referred: true },
  };
  const report: ReportForSheet = {
    team: [{ group: "GBP", leads: 11, signed: 3 }, { group: "SEO", leads: 5, signed: 1 }, { group: "Ads", leads: 40, signed: 9 }],
    signups: [
      { name: "Maria Lopez", kind: "inHouse", label: "GBP Visalia", source: "GBP Visalia", group: "GBP" },
      { name: "Ads Person", kind: "inHouse", label: "Google Ads", source: "Google Ads", group: "Ads" },
    ],
  };

  it("logs differing totals (GBP + SEO only) and names on one side, ignoring Ads", () => {
    const items = sheetVariances(sheet, report);
    expect(items.filter((i) => i.kind === "total").map((i) => i.name)).toEqual(["GBP — Total Leads", "TOTAL (GBP + SEO) — Total Leads"]);
    expect(items.find((i) => i.kind === "onlySheet")?.name).toBe("Only Sheet");
    expect(items.some((i) => i.kind === "onlyCrm")).toBe(false);   // the Ads sign-up isn't on the sheet by design
  });

  it("gives a name its reason, and flags a stale Lead Docket copy", () => {
    const items = sheetVariances(sheet, report, {
      explained: new Map([["Only Sheet", { fix: "leaddocket", reason: "not in Lead Docket" }]]),
      staleSync: { lastSuccessAt: null, state: "failed" },
    });
    expect(items.find((i) => i.kind === "onlySheet")?.detail).toBe("Fix in Lead Docket: not in Lead Docket");
    expect(items.find((i) => i.kind === "sync")?.detail).toBe("Last synced never (failed)");
  });
});
