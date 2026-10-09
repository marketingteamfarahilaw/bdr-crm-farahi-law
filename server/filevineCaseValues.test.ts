import { describe, expect, it } from "vitest";
import { fvCaseValue, phoneKeyOf, pickLead } from "./filevineCaseValues";

describe("fvCaseValue", () => {
  it("reads Filevine's picks as the report's values", () => {
    expect(fvCaseValue("High")).toBe("High");
    expect(fvCaseValue("High Value")).toBe("High");
    expect(fvCaseValue("  ")).toBeNull();
    expect(fvCaseValue(null)).toBeNull();
  });
});

describe("phoneKeyOf", () => {
  it("keeps the last ten digits", () => {
    expect(phoneKeyOf("+1 (818) 555-0123")).toBe("8185550123");
    expect(phoneKeyOf("555-0123")).toBeNull();
  });
});

describe("pickLead", () => {
  const at = "2026-09-10T00:00:00Z";
  it("takes the lead closest to the case, preferring a signed one", () => {
    expect(pickLead(at, [
      { leadId: 1, signedUpDate: null, createdDate: "2026-09-11T00:00:00Z", taken: false },
      { leadId: 2, signedUpDate: "2026-09-09T00:00:00Z", createdDate: "2026-09-01T00:00:00Z", taken: false },
    ])).toBe(2);
  });
  it("skips leads outside the window or already matched", () => {
    expect(pickLead(at, [
      { leadId: 1, signedUpDate: "2026-06-01T00:00:00Z", createdDate: null, taken: false },
      { leadId: 2, signedUpDate: "2026-09-10T00:00:00Z", createdDate: null, taken: true },
    ])).toBeNull();
  });
});
