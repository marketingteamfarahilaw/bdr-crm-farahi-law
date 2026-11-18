import { describe, expect, it } from "vitest";
import { auditSignups, nameKey, parseSheet, reconcileNames, sameName, sameSource, tabForDay, unbucketed, type Cell } from "@shared/digitalSheet";

// The team's layout, with placeholder names.
const rows: Cell[][] = [
  [], [null, "DIGITAL MARKETING DEPARTMENT"], [null, "MTD PERFORMANCE SUMMARY"], [],
  [null, "DIGITAL MARKETING TEAM"],
  [null, "Name", "Total Leads", "Open", "Rejected", "Referred Out", "Lost/ Not Interested", "Signed Referred Out", "Sign-up Unique Count", "Signed In-House", "Total Signed", "Target", "Lead vs Sign Up \nConversion"],
  [null, "GBP", 106, 4, 39, 26, 7, 8, 24, 22, 30, 55, 0.2830188679],
  [null, "SEO/ Website", 72, 6, 18, 21, 6, 1, 9, 10, 11, 20, 0.1527777778],
  [null, "TOTAL", 178, 10, 57, 47, 13, 9, 33, 32, 41, 75, 0.2303370787],
  [],
  [null, "In-House Signup Details  "],
  [null, "Count", "Lead Source", "Case Value", "Case Type", "Client Name", "Case Number"],
  [null, 1, " GBP Visalia", "Medium", "Auto", "Ana Placeholder", "CASE-1"],
  [null, 1, "Justin for Justice", "High", "Auto", " Ben Example Jr", "CASE-2"],
  [], [null, 2],
  [null, "Signed Referred Out Details  "],
  [null, "Count", "Lead Source", "Case Value", "Case Type", "Client Name", "Case Number"],
  [null, 1, " GBP Visalia", "Low", "Auto", "Cara Sample as the Mother of Dee Sample", "CASE-3"],
  [null, 1],
  [null, "SEO/ WEBSITE PERFORMANCE MONITORING"],
  [null, "MTD Leads"], [null, 73],
];

describe("parseSheet", () => {
  const p = parseSheet(rows);
  it("reads the Digital Marketing Team table", () => {
    expect(p.found.team).toBe(true);
    expect(p.team.GBP).toMatchObject({ leads: 106, open: 4, rejected: 39, referredOut: 26, lostNI: 7, signedReferred: 8, unique: 24, signedInHouse: 22, signed: 30, target: 55, conversion: 28.3 });
    expect(p.team.SEO).toMatchObject({ leads: 72, signed: 11 });
    expect(p.team.TOTAL?.leads).toBe(178);
  });
  it("reads both sign-up lists, stopping at the next section", () => {
    expect(p.inHouse.map((s) => s.name)).toEqual(["Ana Placeholder", "Ben Example Jr"]);
    expect(p.inHouse[0]).toMatchObject({ source: "GBP Visalia", caseValue: "Medium", caseType: "Auto" });
    expect(p.referred).toHaveLength(1);
  });
  it("says what it couldn't find", () => {
    expect(parseSheet([[null, "something else"]]).found).toEqual({ team: false, inHouse: false, referred: false });
  });
});

describe("names", () => {
  it("names the tab for a day as the team does", () => {
    expect(tabForDay("2026-09-30")).toBe("93026");
    expect(tabForDay("2026-10-01")).toBe("10126");
  });
  it("compares names without case, accents, suffixes or a guardian's clause", () => {
    expect(nameKey("  José  Pérez-Luna JR ")).toBe("jose perez luna");
    expect(nameKey("Cara Sample as the Mother of Dee Sample")).toBe("cara sample");
    expect(nameKey("Eli Test / Niece Fay /")).toBe("eli test");
    expect(sameName("ben example", "ben q example")).toBe(true);
    expect(sameName("ben", "ben example")).toBe(false);
  });
  it("pairs one to one, exact first", () => {
    const sheet = [{ name: "Cara Sample" }, { name: "Cara Sample as the Mother of Dee Sample" }, { name: "Only In Sheet" }];
    const crm = [{ name: "Cara Sample" }, { name: "cara sample" }, { name: "Only In Ld" }];
    const r = reconcileNames(sheet, crm);
    expect(r.both).toHaveLength(2);
    expect(r.onlySheet.map((x) => x.name)).toEqual(["Only In Sheet"]);
    expect(r.onlyCrm.map((x) => x.name)).toEqual(["Only In Ld"]);
  });
});

describe("unbucketed", () => {
  it("is zero when the status columns hold every lead", () => {
    expect(unbucketed(parseSheet(rows).team.GBP)).toBe(0);   // 4+39+26+7+8+22 = 106
  });
  it("counts the leads a row leaves in no column", () => {
    expect(unbucketed(parseSheet(rows).team.SEO)).toBe(10);  // 6+18+21+6+1+10 = 62 of 72
  });
  it("says nothing without a total or any column", () => {
    expect(unbucketed(null)).toBeNull();
    expect(unbucketed({ open: 3 })).toBeNull();
    expect(unbucketed({ leads: 5 })).toBeNull();
  });
});

describe("sameSource", () => {
  const crm = { label: "GBP Visalia", source: "GMB - Visalia Office" };
  it("matches the sheet's hand-written names loosely", () => {
    expect(sameSource(" GBP Visalia", crm)).toBe(true);
    expect(sameSource("Visalia", crm)).toBe(true);
    expect(sameSource("Justin for Justice", { label: "Justin For Justice — website (form, chat, search)", source: "Justin For Justice" })).toBe(true);
  });
  it("flags a different source, but never a blank one", () => {
    expect(sameSource("GBP Fresno", crm)).toBe(false);
    expect(sameSource("", crm)).toBe(true);
  });
});

describe("auditSignups", () => {
  const s = (name: string, source = "") => ({ name, source, caseValue: "", caseType: "" });
  const c = (name: string, kind: "inHouse" | "referred", label = "GBP Visalia") => ({ name, kind, label, source: label });
  const a = auditSignups(
    { inHouse: [s("Ana Placeholder", "GBP Visalia"), s("Ben Example"), s("Gus Ghost")], referred: [s("Cara Sample", "GBP Fresno")] },
    [c("Ana Placeholder", "inHouse"), c("Ben Example", "referred"), c("Cara Sample", "referred"), c("Dee Only", "inHouse")],
  );
  it("pairs the same kind as agreeing", () => {
    expect(a.agree.map((p) => p.crm.name).sort()).toEqual(["Ana Placeholder", "Cara Sample"]);
  });
  it("reports in-house on the sheet but referred in Lead Docket once, as a status difference", () => {
    expect(a.statusDiffers.map((p) => [p.sheet.name, p.sheet.kind, p.crm.kind])).toEqual([["Ben Example", "inHouse", "referred"]]);
  });
  it("flags a matched lead whose source differs", () => {
    expect(a.sourceDiffers.map((p) => p.sheet.name)).toEqual(["Cara Sample"]);
  });
  it("leaves only the truly unmatched on either side", () => {
    expect(a.onlySheet.map((x) => x.name)).toEqual(["Gus Ghost"]);
    expect(a.onlyCrm.map((x) => x.name)).toEqual(["Dee Only"]);
  });
});
