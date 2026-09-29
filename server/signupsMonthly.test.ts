import { describe, expect, it } from "vitest";
import { buildMonthly, classifyLead, withRates } from "./signupsMonthly";

const lead = (o: Partial<Parameters<typeof classifyLead>[0]> = {}) =>
  ({ outcome: "Rejected", classification: "Auto", disposition: "N/A", facility: null, ...o });

describe("classifyLead", () => {
  it("counts an accepted case type as qualified and quality unless turned down for a quality reason", () => {
    expect(classifyLead(lead())).toMatchObject({ qualified: true, quality: true });
    expect(classifyLead(lead({ disposition: "No Injuries" }))).toMatchObject({ qualified: true, quality: false });
    expect(classifyLead(lead({ disposition: "Minimal PD" }))).toMatchObject({ qualified: true, quality: false });
    expect(classifyLead(lead({ disposition: "Gap in treatment" }))).toMatchObject({ qualified: true, quality: false });
    expect(classifyLead(lead({ disposition: "No treatment at all" }))).toMatchObject({ qualified: true, quality: false });
    expect(classifyLead(lead({ outcome: "Rejected - PD Leads Only", disposition: "Total Loss" }))).toMatchObject({ qualified: true, quality: false });
    // Liability isn't one of the firm's quality criteria.
    expect(classifyLead(lead({ disposition: "At fault" }))).toMatchObject({ qualified: true, quality: true });
  });

  it("isn't qualified outside the accepted case types, or when intake says it isn't a PI case", () => {
    expect(classifyLead(lead({ classification: "Workers Comp" }))).toMatchObject({ qualified: false, quality: false });
    expect(classifyLead(lead({ classification: "Other" }))).toMatchObject({ qualified: false });
    expect(classifyLead(lead({ disposition: "Not a PI case" }))).toMatchObject({ qualified: false, quality: false });
    for (const t of ["Semi / 18 Wheeler", "Slip and Fall", "Trip and Fall", "Dog Bite", "Personal Injury", "Pedestrian", "Motorcycle", "Bicycle", "Wrongful Death"])
      expect(classifyLead(lead({ classification: t })).qualified).toBe(true);
  });

  it("judges a sign-up by case type only, and splits in-house from referred out", () => {
    expect(classifyLead(lead({ outcome: "Signed", disposition: "Minimal PD" }))).toMatchObject({ signed: true, signedReferral: false, quality: true });
    expect(classifyLead(lead({ outcome: "Signed Referred Out", disposition: "Signed Up" }))).toMatchObject({ signed: false, signedReferral: true });
    expect(classifyLead(lead({ outcome: "Signed", classification: "Workers Comp" }))).toMatchObject({ signed: true, qualified: false });
  });

  it("names a partner when the referral text is filled", () => {
    expect(classifyLead(lead({ facility: "Randy's Towing" })).partnerNamed).toBe(true);
    expect(classifyLead(lead({ facility: "  " })).partnerNamed).toBe(false);
  });
});

describe("withRates", () => {
  it("uses the team sheet's formulas", () => {
    const r = withRates({ leads: 94, partnerNamed: 77, qualified: 58, quality: 36, signed: 39, signedReferral: 3 });
    expect(r).toMatchObject({ totalSigned: 42, pctPartnerNamed: 82, pctSignedToLeads: 45, pctQuality: 38, pctSignedToQuality: 108 });
    expect(withRates({ leads: 0, partnerNamed: 0, qualified: 0, quality: 0, signed: 0, signedReferral: 0 }).pctQuality).toBeNull();
  });
});

describe("buildMonthly", () => {
  // Pacific months: 2026-02-01 07:30 UTC is still January 31 in Los Angeles.
  const rows = [
    { leadDate: "2026-01-15T18:00:00Z", role: "FR", member: "Lupe Campos", ...lead({ facility: "Randy's Towing" }) },
    { leadDate: "2026-02-01T07:30:00Z", role: "FR", member: "Lupe Campos", ...lead({ outcome: "Signed" }) },
    { leadDate: "2026-03-03T18:00:00Z", role: "BDR", member: "Grace Lanayon", ...lead({ outcome: "Signed Referred Out" }) },
    { leadDate: "2026-03-04T18:00:00Z", role: "FR", member: "Genysys Sanchez", ...lead() },
    { leadDate: "2026-03-05T18:00:00Z", role: "Intake", member: "Malvin Rosales", ...lead() },
    { leadDate: "2025-12-31T18:00:00Z", role: "FR", member: "Lupe Campos", ...lead() },
  ];

  it("counts by Pacific month, January to this month, FR first, without Intake", () => {
    const m = buildMonthly(rows, 2026, "2026-03-20");
    expect(m.months.map((x) => x.label)).toEqual(["Jan", "Feb", "Mar"]);
    expect(m.months[2].current).toBe(true);
    expect(m.groups.map((g) => g.key)).toEqual(["FR", "BDR"]);
    const fr = m.groups[0];
    expect(fr.months[0]).toMatchObject({ leads: 2, signed: 1, partnerNamed: 1 });
    expect(fr.months[2].leads).toBe(1);
    expect(fr.total).toMatchObject({ leads: 3, signed: 1, totalSigned: 1 });
    expect(m.groups[1].total).toMatchObject({ leads: 1, signedReferral: 1, totalSigned: 1 });
    expect(m.years).toEqual([2026, 2025]);
  });

  it("applies the report's filters: current team, one role, one rep", () => {
    expect(buildMonthly(rows, 2026, "2026-03-20", { team: "current" }).groups[0].total.leads).toBe(2);
    expect(buildMonthly(rows, 2026, "2026-03-20", { role: "BDR" }).groups.map((g) => g.key)).toEqual(["BDR"]);
    const one = buildMonthly(rows, 2026, "2026-03-20", { member: "Lupe Campos" });
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0]).toMatchObject({ key: "Lupe Campos", label: "Lupe Campos" });
  });

  it("shows all twelve months of a past year", () => {
    const m = buildMonthly(rows, 2025, "2026-03-20");
    expect(m.months).toHaveLength(12);
    expect(m.months.some((x) => x.current)).toBe(false);
    expect(m.groups[0].months[11].leads).toBe(1);
  });
});
