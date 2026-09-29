import { describe, expect, it } from "vitest";
import { mergedFields } from "./facilityMerge";

const keep = { id: 1, name: "Randy's Towing", phone: "(559) 555-0101", phone2: null, phone3: null, city: "Fresno", contactName: "", notes: "Great partner",
  partnerStatus: "prospect", totalCalls: 3, moneyInvested: "20.00", lastContactDate: new Date("2026-09-01T12:00:00Z"), priorityPartner: 0 };
const drop = { id: 2, name: "Randys Towing Inc", phone: "559-555-0101", phone2: "559-555-0199", phone3: null, city: "Clovis", contactName: "Ana", notes: "Call Ana first",
  partnerStatus: "active_partner", totalCalls: 2, moneyInvested: "5.50", lastContactDate: new Date("2026-09-20T12:00:00Z"), priorityPartner: 1, website: "randys.example" };

describe("mergedFields", () => {
  const out = mergedFields(keep, drop);

  it("keeps the kept facility's values and fills only its blanks", () => {
    expect(out.city).toBeUndefined();               // Fresno stays
    expect(out.contactName).toBe("Ana");
    expect(out.website).toBe("randys.example");
  });

  it("pools the phone numbers, one per number", () => {
    expect(out.phone).toBeUndefined();              // the same number written two ways
    expect(out.phone2).toBe("559-555-0199");
    expect(out.phone3).toBeUndefined();
  });

  it("keeps both notes, adds up calls and money, takes the later contact and the stronger status", () => {
    expect(out.notes).toBe("Great partner\n\n[From Randys Towing Inc] Call Ana first");
    expect(out.totalCalls).toBe(5);
    expect(out.moneyInvested).toBe("25.50");
    expect(out.lastContactDate).toEqual(drop.lastContactDate);
    expect(out.partnerStatus).toBe("active_partner");
    expect(out.priorityPartner).toBe(1);
  });

  it("never overrides a do-not-use flag or repeats a note already there", () => {
    const o = mergedFields({ ...keep, partnerStatus: "do_not_use", notes: "Great partner. Call Ana first" }, drop);
    expect(o.partnerStatus).toBeUndefined();
    expect(o.notes).toBeUndefined();
  });
});
