import { describe, expect, it } from "vitest";
import { partnerKey, partnerPart } from "../scripts/migration/partner-key.mjs";

// The key decides which Lead Docket leads share a remembered partner, so a
// change here re-groups every answer already given (partner_aliases).
describe("partnerKey", () => {
  it("drops the rep and keeps the partner", () => {
    expect(partnerKey("Field Representative Lupe Campos /  Xtreme Auto Collision & Glass- Madera")).toBe("xtremeautocollisionglassmadera");
    expect(partnerKey("BDR Grace Lanayon / Fiesta Insurance")).toBe("fiestainsurance");
  });

  it("drops former reps too, who are on no list", () => {
    expect(partnerKey("Field Representative Monica Valles / Valenz Autobody")).toBe("valenzautobody");
    expect(partnerKey("Field Representative Arden Burrows / FLF Employee Malvin Rosales / Regino Auto Body Shop")).toBe("reginoautobodyshop");
    expect(partnerKey("Neighbor of Genysys Sanchez")).toBe("");
    expect(partnerKey("Field Representative Genysys Sanchez personal lead")).toBe("");
  });

  it("keeps the partner when the rep is named in the same breath", () => {
    expect(partnerKey("Field Rep Lupe Campos - Xtreme Auto Collision")).toBe("xtremeautocollision");
    expect(partnerKey("Lupe Campos from Valley Towing")).toBe("valleytowing");
    expect(partnerKey("Referred by Jezel Mercado, JW Collision")).toBe("jwcollision");
  });

  it("gives the same key however intake typed the same words", () => {
    expect(partnerKey("Valentz Auto Body Shop")).toBe(partnerKey("  VALENTZ auto-body shop "));
    expect(partnerKey("B&B Towing")).toBe(partnerKey("B and B Towing"));
    expect(partnerKey("referral from JW Collision")).toBe(partnerKey("JW Collision"));
  });

  it("is empty when only people, or nothing, are named", () => {
    expect(partnerKey("Employee Referral Malvin Rosales / Former Client Delmis Hayde Mendoza de Gonzalez")).toBe("");
    expect(partnerKey("Former Client Ignacio Hernandez")).toBe("");
    expect(partnerKey("Field Representative Jezel Mercado")).toBe("");
    expect(partnerKey("N/A")).toBe("");
    expect(partnerKey("Lupe Campos BC")).toBe("");
    expect(partnerKey("")).toBe("");
    expect(partnerKey(null)).toBe("");
  });

  it("leaves partner names alone", () => {
    expect(partnerKey("Fromm Auto Body")).toBe("frommautobody");
    expect(partnerKey("BC Auto Body")).toBe("bcautobody");
    expect(partnerPart("The Body Shop of Yuba City")).toBe("The Body Shop of Yuba City");
    expect(partnerPart("Yazmin Chairez with Cali Dream Insurance")).toBe("Yazmin Chairez with Cali Dream Insurance");
  });

  it("keeps different partners apart", () => {
    expect(partnerKey("Golden State Body Shop")).not.toBe(partnerKey("Golden State Towing"));
  });
});
