import { describe, expect, it } from "vitest";
import { accidentKeys } from "./signupsReport";

// The scorecard's "Sign-up Unique Count": one accident's driver and passengers
// are one case. Shaped like a BDR's September 2026 (names made up).
const lead = (id: number, externalId: string | null, relatedLeadIds: string | null, incidentDate: string | null = null, phone: string | null = null) =>
  ({ id, externalId, relatedLeadIds, incidentDate, phone });
const cases = (leads: ReturnType<typeof lead>[]) => new Set(accidentKeys(leads)).size;

describe("accidentKeys", () => {
  it("counts a linked family, a linked couple and a single client as three cases", () => {
    expect(cases([
      lead(1, "100", null, "2026-09-01", "5550000001"),                 // alone
      lead(2, "200", "202", "2026-09-18", "5550000002"),                // family of four, linked in a chain
      lead(3, "202", "200,203", "2026-09-18", "5550000002"),
      lead(4, "203", "202,204", "2026-09-18", "5550000002"),
      lead(5, "204", "203", "2026-09-18", "5550000002"),
      lead(6, "300", "301", "2026-09-14", "5550000003"),                // a couple, different phones
      lead(7, "301", "300", "2026-09-14", "5550000004"),
    ])).toBe(3);
  });

  it("joins two passengers through a driver who isn't in the list", () => {
    expect(cases([lead(1, "401", "400"), lead(2, "402", "400")])).toBe(1);
  });

  it("joins unlinked sign-ups from the same accident day and phone, and nothing looser", () => {
    expect(cases([
      lead(1, "500", null, "2026-08-05", "(555) 000-0005"),
      lead(2, "501", null, "2026-08-05", "5550000005"),
      lead(3, "502", null, "2026-08-06", "5550000005"),                // same phone, another accident
      lead(4, "503", null, "2026-08-05", null),                        // same day, no phone
      lead(5, null, null, "2026-08-05", null),                          // entered by hand
    ])).toBe(4);
  });
});
