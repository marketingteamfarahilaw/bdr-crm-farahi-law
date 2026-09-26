import { describe, expect, it } from "vitest";
import { partnerKey } from "../scripts/migration/partner-key.mjs";

// The key decides which Lead Docket leads share a remembered partner, so a
// change here re-groups every answer already given (partner_aliases).
describe("partnerKey", () => {
  it("drops the rep and keeps the partner", () => {
    expect(partnerKey("Field Representative Lupe Campos /  Xtreme Auto Collision & Glass- Madera")).toBe("xtremeautocollisionglassmadera");
    expect(partnerKey("BDR Grace Lanayon / Fiesta Insurance")).toBe("fiestainsurance");
  });

  it("gives the same key however intake typed the same words", () => {
    expect(partnerKey("Valentz Auto Body Shop")).toBe(partnerKey("  VALENTZ auto-body shop "));
    expect(partnerKey("B&B Towing")).toBe(partnerKey("B and B Towing"));
  });

  it("is empty when only people are named", () => {
    expect(partnerKey("Employee Referral Malvin Rosales / Former Client Delmis Hayde Mendoza de Gonzalez")).toBe("");
    expect(partnerKey("Field Representative Jezel Mercado")).toBe("");
    expect(partnerKey("")).toBe("");
    expect(partnerKey(null)).toBe("");
  });

  it("keeps different partners apart", () => {
    expect(partnerKey("JW Collision")).not.toBe(partnerKey("referral from JW Collision"));
    expect(partnerKey("Golden State Body Shop")).not.toBe(partnerKey("Golden State Towing"));
  });
});
