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

  it("counts sources as the report does: GMB, JFJ sites and brands, Intaker, Yelp, Facebook, Instagram", () => {
    expect(signupLogGroup("GMB", "")).toBe("GBP");
    for (const s of ["JFJ Website", "Intaker - JFJ", "Yelp", "Ayuda California", "Motorcyclist Attorney", "Justin For Justice", "JFJ"]) expect(signupLogGroup(s, "")).toBe("SEO");
    for (const s of ["Facebook", "Instagram", "Google Ads", "Billboard", "JFJ Billboard"]) expect(signupLogGroup(s, "")).toBe("Ads");
    expect(signupLogGroup("Emailer", "")).toBe("SEO");
    for (const s of ["Walker", "Referral", "FR Jezel", "BDR Miguel"]) expect(signupLogGroup(s, "")).toBeNull();
    // A rep's row is the rep's, whatever facility its Lead Source names.
    expect(signupLogGroup("FR Jezel", "Body Shop Website")).toBeNull();
    // A blank Source falls back to the Lead Source.
    expect(signupLogGroup("", "GMB San-pedro")).toBe("GBP");
  });

  it("adds an Ads row for social sign-ups, and TOTAL covers it", () => {
    const p = parseSignupLog([...rows, row("Facebook", "FB Lead Form", 46329, "Signed", "Fay Wong"), row("Instagram", "", 46330, "Referred out", "Gus Ng")],
      { fromDay: "2026-11-01", toDay: "2026-11-19" })!;
    expect(p.team.Ads).toEqual({ signedInHouse: 1, signedReferred: 1, signed: 2 });
    expect(p.team.TOTAL).toEqual({ signedInHouse: 3, signedReferred: 2, signed: 5 });
  });
});

import { comparedSignups, sheetTeamRows } from "@shared/digitalSheet";

describe("the comparison with an Ads row", () => {
  const report: ReportForSheet = {
    team: [{ group: "GBP", signed: 3 }, { group: "SEO", signed: 2 }, { group: "Ads", signed: 4 }],
    signups: [
      { name: "A", kind: "inHouse", label: "GBP Visalia", source: "GMB Visalia", group: "GBP" },
      { name: "B", kind: "inHouse", label: "Social Media", source: "Facebook", group: "Ads" },
    ],
  };
  const daily: ParsedSheet = { team: { GBP: { signed: 3 }, SEO: { signed: 2 }, TOTAL: { signed: 5 } }, inHouse: [], referred: [], found: { team: true, inHouse: true, referred: true } };
  const log: ParsedSheet = { ...daily, team: { ...daily.team, Ads: { signed: 4 }, TOTAL: { signed: 9 } } };

  it("a daily tab still leaves Ads out", () => {
    expect(sheetTeamRows(daily, report).map(([n]) => n)).toEqual(["GBP", "SEO / Website", "TOTAL (GBP + SEO)"]);
    expect(comparedSignups(daily, report).map((s) => s.name)).toEqual(["A"]);
  });
  it("the sign-up sheet compares Ads too, and its TOTAL includes them", () => {
    const rows = sheetTeamRows(log, report);
    expect(rows.map(([n]) => n)).toEqual(["GBP", "SEO / Website", "Ads", "TOTAL (GBP + SEO + Ads)"]);
    expect(rows[3][2]("signed")).toBe(9);
    expect(comparedSignups(log, report).map((s) => s.name)).toEqual(["A", "B"]);
    expect(sheetVariances(log, report).filter((v) => v.kind === "total")).toEqual([]);
  });
});
