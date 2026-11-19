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

import { parseSignupLog, sheetDay, signupLogGroup } from "@shared/digitalSheet";

describe("FLF sign-up sheet (Current Month tab)", () => {
  const head = ["Source", "Lead Source", "Timestamp", "Name of Person Conducting Intake ", "Signed Up By", "Sign Up Date", "Value", " Lead Outcome", "Client's Name", "Case Type (Slip, Auto, Employment, W/C, Etc)"];
  const row = (source: string, lead: string, day: number | string, outcome: string, name: string) => [source, lead, null, "X", "Y", day, "Medium", outcome, name, "Auto"];
  const rows = [
    head,
    row("GMB", "GMB 5340 Alla Road Los Angeles", 46328, "Signed", "Ana Diaz"),
    row("GMB", "GMB San-pedro", 46330, "Referred out", "Ben Cho"),
    row("JFJ Website", "Justin For Justice Toll Free for Website", "11/3/2026", "Signed", "Cara Lee"),
    row("Walker", "Walker Advertising Contract 41", 46328, "Signed", "Dan Roe"),     // not digital
    row("FR Jezel", "", 46328, "Signed", "Eve Park"),                                  // a rep's, not digital
    row("GMB", "GMB Visalia", 46296, "Signed", "Old Month"),                           // October: outside the range
    [null, null, null, null, null, null, null, null, null, null],                      // a blank case-group row
  ];

  it("keeps GBP and website sign-ups in the range, split in-house / referred out, with counts", () => {
    const p = parseSignupLog(rows, { fromDay: "2026-11-01", toDay: "2026-11-19" })!;
    expect(p.inHouse.map((s) => s.name)).toEqual(["Ana Diaz", "Cara Lee"]);
    expect(p.referred.map((s) => s.name)).toEqual(["Ben Cho"]);
    expect(p.team.GBP).toEqual({ signedInHouse: 1, signedReferred: 1, signed: 2 });
    expect(p.team.SEO).toEqual({ signedInHouse: 1, signedReferred: 0, signed: 1 });
    expect(p.team.TOTAL).toEqual({ signedInHouse: 2, signedReferred: 1, signed: 3 });
    expect(p.inHouse[0]).toMatchObject({ source: "GMB 5340 Alla Road Los Angeles", caseValue: "Medium", caseType: "Auto" });
  });

  it("isn't fooled by a daily-summary tab", () => {
    expect(parseSignupLog([["GBP", 1, 2], ["SEO", 3, 4]])).toBeNull();
  });

  it("reads Excel day serials and typed dates", () => {
    expect(sheetDay(46327)).toBe("2026-11-01");
    expect(sheetDay(46328.5)).toBe("2026-11-02");
    expect(sheetDay("11/3/2026")).toBe("2026-11-03");
    expect(sheetDay("2026-11-04")).toBe("2026-11-04");
    expect(sheetDay("soon")).toBeNull();
  });

  it("only GMB and the website are digital", () => {
    expect(signupLogGroup("GMB", "")).toBe("GBP");
    expect(signupLogGroup("JFJ Website", "")).toBe("SEO");
    for (const s of ["Walker", "Referral", "FR Jezel", "BDR Miguel", "Intaker - JFJ", "Yelp"]) expect(signupLogGroup(s, "")).toBeNull();
  });
});
