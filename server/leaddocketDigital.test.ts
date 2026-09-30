import { describe, expect, it } from "vitest";
import { caseValueFrom, ensureDigitalColumns, normalizeCaseValue } from "../scripts/migration/leaddocket-digital.mjs";

describe("caseValueFrom", () => {
  it("reads a custom field object, whatever the label's case or spacing", () => {
    const lead = { Id: 1, CustomFields: [{ Name: "Injury", Value: "Neck" }, { Name: "  case VALUE ", Value: "high" }] };
    expect(caseValueFrom(lead)).toBe("High");
  });

  it("finds it nested in a section, with other label/value keys and option objects", () => {
    const lead = { Sections: [{ Title: "Case Info", Fields: [{ FieldName: "CaseValue", DisplayValue: { Id: 4, Name: "rank-x" } }] }] };
    expect(caseValueFrom(lead)).toBe("Rank X");
  });

  it("accepts a plain property named like the field", () => {
    expect(caseValueFrom({ CaseValue: "MEDIUM" })).toBe("Medium");
    expect(caseValueFrom({ caseValue: "Rank U" })).toBe("Rank U");
  });

  it("prefers the exact field over a label that only contains it", () => {
    const lead = { CustomFields: [{ Name: "Estimated Case Value", Value: "$40,000" }, { Name: "Case Value", Value: "Low" }] };
    expect(caseValueFrom(lead)).toBe("Low");
  });

  it("falls back to a label containing it, keeping an unknown value as written (40 characters at most)", () => {
    expect(caseValueFrom({ CustomFields: [{ Name: "Case Value Category", Value: "Very high — policy limits likely" }] })).toBe("Very high — policy limits likely");
    expect(caseValueFrom({ CaseValue: "x".repeat(60) })).toHaveLength(40);
  });

  it("is null when Lead Docket has none", () => {
    expect(caseValueFrom({ CustomFields: [{ Name: "Case Value", Value: "" }], CaseType: "Auto" })).toBeNull();
    expect(caseValueFrom(null)).toBeNull();
    expect(caseValueFrom({ Value: "High" })).toBeNull();
  });
});

describe("normalizeCaseValue", () => {
  it("maps the five picks case-insensitively", () => {
    expect(["low", " Medium ", "HIGH", "Rank X", "rankU"].map(normalizeCaseValue)).toEqual(["Low", "Medium", "High", "Rank X", "Rank U"]);
    expect(normalizeCaseValue(null)).toBeNull();
  });
});

describe("ensureDigitalColumns", () => {
  it("adds only what is missing", async () => {
    const ran: string[] = [];
    await ensureDigitalColumns(async (q) => {
      ran.push(q);
      return q.startsWith("SELECT") ? [{ name: "leadId" }, { name: "incidentDate" }] : [];
    });
    expect(ran.filter((q) => !q.startsWith("SELECT"))).toEqual([
      "ALTER TABLE leaddocket_leads ADD COLUMN `caseValue` VARCHAR(40) NULL",
      "ALTER TABLE leaddocket_leads ADD COLUMN `relatedLeadIds` VARCHAR(500) NULL",
    ]);
  });

  it("treats a column another process just added as done", async () => {
    await expect(ensureDigitalColumns(async (q) => {
      if (q.startsWith("SELECT")) return [];
      throw Object.assign(new Error("Duplicate column name"), { errno: 1060 });
    })).resolves.toBeUndefined();
  });
});
