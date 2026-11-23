import { describe, expect, it } from "vitest";
import { countMonthOf, matchSignups, monthOfTab, parseFlfTab, signupKind, type MatchLead } from "@shared/flfSignups";

describe("monthOfTab", () => {
  it("reads month tabs", () => {
    expect(monthOfTab("October 2026")).toBe("2026-10");
    expect(monthOfTab(" Sept 2019 ")).toBe("2019-09");
    expect(monthOfTab("Jan 2018")).toBe("2018-01");
  });
  it("skips every other tab", () => {
    for (const t of ["Totals", "Pivot 2026", "Welcome Letters", "Signed Client Later Dropped or Referred Out", "Current Month", "Mayday 2026"]) {
      expect(monthOfTab(t)).toBeNull();
    }
  });
});

describe("signupKind", () => {
  it("is referred out by outcome or referral status", () => {
    expect(signupKind("Referred out", "")).toBe("referred");
    expect(signupKind("Signed", "Lead/Client Referred out - Pending")).toBe("referred");
    expect(signupKind("Signed", "")).toBe("inHouse");
    expect(signupKind("", "")).toBe("inHouse");
  });
});

const HEAD = ["Source", "Lead Source", "Timestamp", "Name of Person Conducting Intake ", "Signed Up By", "Sign Up Date",
  "Signed Cases Referral Status", "Value", "Rank", " Lead Outcome", "Client's Name", "Best Call Back Number ", "Best Email Contact info?",
  "Case Type (Slip, Auto, Employment, W/C, Etc)", "Case Number"];

describe("parseFlfTab", () => {
  it("reads every row with a client name, by header", () => {
    const rows = [
      HEAD,
      ["GMB", "GMB 1900 South Norfolk Street Suite 35", "", "Ana", "Bo", "10/30/2026", "", "High", "A", "Signed", "Jenice Mariah Dawson", "(650) 609-8163", " J@X.com ", "Auto", "CASE-0156"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],   // a blank case-group row
      ["Walker", "", "", "", "", 46326, "Lead/Client Referred out", "", "", "Signed", "Cy Doe", "1-310-555-0100", "nope", "Slip", ""],
      ["Referral", "", "", "", "", "", "", "", "", "", "No Date", "", "", "", ""],
    ];
    const out = parseFlfTab(rows, "2026-10")!;
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ rowNo: 2, signDay: "2026-10-30", source: "GMB", kind: "inHouse", phoneKey: "6506098163", emailKey: "j@x.com", caseNumber: "CASE-0156", caseType: "Auto" });
    expect(out[1]).toMatchObject({ rowNo: 4, signDay: "2026-10-31", kind: "referred", phoneKey: "3105550100", emailKey: null });
    expect(out[2].signDay).toBeNull();
    expect(countMonthOf(out[2])).toBe("2026-10");
    expect(countMonthOf({ signDay: "2026-11-01", tabMonth: "2026-10" })).toBe("2026-11");
  });
  it("is null for a tab without a Client's Name header", () => {
    expect(parseFlfTab([["Total", 5]], "2026-10")).toBeNull();
  });
});

describe("matchSignups", () => {
  const lead = (leadId: number, clientName: string, phoneKey: string | null, day = "2026-11-02", email: string | null = null): MatchLead => ({ leadId, clientName, phoneKey, day, email });
  const s = (clientName: string, phoneKey: string | null, signDay = "2026-10-30", emailKey: string | null = null) => ({ clientName, phoneKey, signDay, emailKey });

  it("matches by phone first", () => {
    expect(matchSignups([s("Jenice Dawson", "6506098163")], [lead(1, "Jenice Mariah Dawson", "6506098163")])).toEqual([{ leadId: 1, by: "phone" }]);
  });
  it("settles a shared phone (passengers) by name", () => {
    const leads = [lead(1, "Ana Ruiz", "5550000000"), lead(2, "Luis Ruiz", "5550000000")];
    expect(matchSignups([s("Luis Ruiz", "5550000000"), s("Ana M Ruiz", "5550000000")], leads))
      .toEqual([{ leadId: 2, by: "phone+name" }, { leadId: 1, by: "phone" }]);
  });
  it("falls back to email, then name within 7 days", () => {
    expect(matchSignups([s("X", null, "2026-10-30", "a@b.co")], [lead(3, "Y", null, null as any, "A@B.co")])).toEqual([{ leadId: 3, by: "email" }]);
    expect(matchSignups([s("Bo  Diaz", null, "2026-10-30")], [lead(4, "bo diaz", null, "2026-11-05")])).toEqual([{ leadId: 4, by: "name+date" }]);
    expect(matchSignups([s("Bo Diaz", null, "2026-10-30")], [lead(4, "Bo Diaz", null, "2026-11-08")])).toEqual([null]);
  });
  it("links a lead to one sign-up at most", () => {
    expect(matchSignups([s("Ana", "5551112222"), s("Ana", "5551112222")], [lead(1, "Ana", "5551112222")]))
      .toEqual([{ leadId: 1, by: "phone" }, null]);
  });
});
