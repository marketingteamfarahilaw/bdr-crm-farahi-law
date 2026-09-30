import { describe, expect, it } from "vitest";
import { ensureLiabilityColumns, liabilityStatusFrom, phoneKey } from "../scripts/migration/leaddocket-liability.mjs";

describe("liabilityStatusFrom", () => {
  it("reads a custom field object, whatever the label's case or spacing", () => {
    const lead = { Id: 1, CustomFields: [
      { Name: "Injury", Value: "Neck" },
      { Name: "  status of LIABILITY during-intake ", Value: "Accepted" },
    ] };
    expect(liabilityStatusFrom(lead)).toBe("Accepted");
  });

  it("finds it nested in a section, with other label/value keys", () => {
    const lead = { Sections: [{ Title: "Incident Info", Fields: [
      { FieldName: "StatusOfLiabilityDuringIntake", DisplayValue: { Id: 4, Name: "Disputed" } },
    ] }] };
    expect(liabilityStatusFrom(lead)).toBe("Disputed");
  });

  it("accepts a plain property named like the field", () => {
    expect(liabilityStatusFrom({ StatusOfLiabilityDuringIntake: "Pending police report" })).toBe("Pending police report");
  });

  it("prefers the exact field over a looser liability label", () => {
    const lead = { CustomFields: [
      { Name: "Liability", Value: "loose" },
      { Name: "Liability status", Value: "closer" },
      { Name: "Status of Liability During Intake", Value: "exact" },
    ] };
    expect(liabilityStatusFrom(lead)).toBe("exact");
  });

  it("ignores coverage and case-type labels, and blanks", () => {
    const lead = {
      PracticeArea: { Id: 2, Name: "Product Liability" },
      CustomFields: [
        { Name: "Liability Insurance Carrier", Value: "Geico" },
        { Name: "Status of Liability During Intake", Value: "" },
      ],
    };
    expect(liabilityStatusFrom(lead)).toBeNull();
    expect(liabilityStatusFrom(null)).toBeNull();
  });
});

describe("phoneKey", () => {
  it("keeps the last ten digits", () => {
    expect(phoneKey("+1 (213) 555-0100")).toBe("2135550100");
    expect(phoneKey("555-0100")).toBeNull();
  });
});

describe("ensureLiabilityColumns", () => {
  it("adds only what is missing", async () => {
    const ran: string[] = [];
    await ensureLiabilityColumns(async (q) => {
      ran.push(q);
      if (q.includes("information_schema.COLUMNS")) return [{ name: "leadId" }, { name: "phoneKey" }];
      if (q.includes("information_schema.STATISTICS")) return [{ name: "leaddocket_leads_phoneKey" }];
      return [];
    });
    const alters = ran.filter((q) => !q.startsWith("SELECT"));
    expect(alters).toEqual(["ALTER TABLE leaddocket_leads ADD COLUMN `liabilityStatus` VARCHAR(255) NULL"]);
  });

  it("treats a column another process just added as done", async () => {
    await expect(ensureLiabilityColumns(async (q) => {
      if (q.startsWith("SELECT")) return [];
      throw Object.assign(new Error("Duplicate column name"), { errno: 1060 });
    })).resolves.toBeUndefined();
  });
});
