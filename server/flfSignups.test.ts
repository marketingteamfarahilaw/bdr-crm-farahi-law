import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_MAP, LD_SOURCE, channelForSheetSource, countMonthOf, matchSignups, monthOfTab, parseFlfTab, placeSignup, signupKind, type MatchLead,
} from "@shared/flfSignups";
import { channelOfSource } from "@shared/marketing";

describe("monthOfTab", () => {
  it("reads month tabs", () => {
    expect(monthOfTab("October 2026")).toBe("2026-10");
    expect(monthOfTab(" Sept 2019 ")).toBe("2019-09");
    expect(monthOfTab("Jan 2018")).toBe("2018-01");
    expect(monthOfTab("Februrary 2020")).toBe("2020-02");
  });
  it("skips every other tab", () => {
    for (const t of ["Totals", "Pivot 2026", "Welcome Letters", "Signed Client Later Dropped or Referred Out", "Current Month", "June April 2018", "2019 Total Sign Ups", "Pivot Table 1"]) {
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
      ["GMB", "GMB 1900 South Norfolk Street Suite 35", "", "Ana", "Bo", "10/30/2026", "", "High", "A", "Signed", "Pat Q Placeholder", "(555) 010-0001", " J@X.com ", "Auto", "CASE-0001"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],   // a blank case-group row
      ["Walker", "", "", "", "", 46326, "Lead/Client Referred out", "", "", "Signed", "Cy Doe", "1-310-555-0100", "nope", "Slip", ""],
      ["Referral", "", "", "", "", "", "", "", "", "", "No Date", "", "", "", ""],
    ];
    const out = parseFlfTab(rows, "2026-10")!;
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ rowNo: 2, signDay: "2026-10-30", source: "GMB", kind: "inHouse", phoneKey: "5550100001", emailKey: "j@x.com", caseNumber: "CASE-0001", caseType: "Auto" });
    expect(out[1]).toMatchObject({ rowNo: 4, signDay: "2026-10-31", kind: "referred", phoneKey: "3105550100", emailKey: null });
    expect(out[2].signDay).toBeNull();
    expect(countMonthOf(out[2])).toBe("2026-10");
    expect(countMonthOf({ signDay: "2026-11-01", tabMonth: "2026-10" })).toBe("2026-11");
    expect(countMonthOf({ signDay: "2026-09-28", tabMonth: "2026-10" })).toBe("2026-09");
    // A mistyped year counts in the tab's month.
    expect(countMonthOf({ signDay: "2033-06-02", tabMonth: "2023-06" })).toBe("2023-06");
    expect(countMonthOf({ signDay: "0204-04-10", tabMonth: "2024-04" })).toBe("2024-04");
  });
  it("reads the older tabs' headers", () => {
    const y2018 = [
      ["", "Name of Person Conducting Intake ", "We are excited to serve you. How did you hear about Farahi Law Firm? How did you find us?", "Outcome", "Potential Client's Name", "Best Call Back Number "],
      ["2/8/2018 14:30:13", "Intaker A", "a friend", "Signed", "Sam Sample", "555-010-0002"],
    ];
    expect(parseFlfTab(y2018, "2018-02")![0]).toMatchObject({ signDay: null, source: "a friend", leadSource: "", outcome: "Signed", clientName: "Sam Sample", phoneKey: "5550100002" });
    const y2020 = [
      ["Lead Source", "Timestamp", "Sign Up Date", "We are excited to serve you. How did you hear about Farahi Law Firm? How did you find us?", "Outcome", "Potential Client's Name"],
      ["Apex", "5/11/2020 19:53:09", "06/02/2020", "Apex Chat", "Signed", "Lee Example"],
    ];
    expect(parseFlfTab(y2020, "2020-06")![0]).toMatchObject({ signDay: "2020-06-02", source: "Apex", leadSource: "Apex Chat" });
  });
  it("is null for a tab without a Client's Name header", () => {
    expect(parseFlfTab([["Total", 5]], "2026-10")).toBeNull();
  });
});

describe("matchSignups", () => {
  const lead = (leadId: number, clientName: string, phoneKey: string | null, day = "2026-11-02", email: string | null = null): MatchLead => ({ leadId, clientName, phoneKey, day, email });
  const s = (clientName: string, phoneKey: string | null, signDay = "2026-10-30", emailKey: string | null = null) => ({ clientName, phoneKey, signDay, emailKey });

  it("matches by phone first", () => {
    expect(matchSignups([s("Pat Placeholder", "5550100001")], [lead(1, "Pat Q Placeholder", "5550100001")])).toEqual([{ leadId: 1, by: "phone" }]);
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

describe("channelForSheetSource", () => {
  const map = DEFAULT_SOURCE_MAP;
  it("maps column A by exact name or prefix, ignoring case and spaces", () => {
    expect(channelForSheetSource("Walker", map)).toBe("Walker Advertising");
    expect(channelForSheetSource(" walker  advertising contract 3", map)).toBe("Walker Advertising");
    expect(channelForSheetSource("FR Jezel", map)).toBe("BD/FR team");
    expect(channelForSheetSource("BDR Grace", map)).toBe("BD/FR team");
    expect(channelForSheetSource("GMB", map)).toBe("Google Business Profile (GMB)");
    expect(channelForSheetSource("Intaker - JFJ", map)).toBe("Intaker");
    expect(channelForSheetSource("Referral", map)).toBe(LD_SOURCE);
    expect(channelForSheetSource("Walker Employment Contract", map)).toBeNull();
    expect(channelForSheetSource("Frank's Body Shop", map)).toBeNull();   // "FR *" needs the space
  });
  it("prefers an exact line, then the longest prefix", () => {
    const m = [{ sheet: "Walker*", channel: "A" }, { sheet: "Walker Employment*", channel: "B" }, { sheet: "Walker", channel: "C" }];
    expect(channelForSheetSource("Walker", m)).toBe("C");
    expect(channelForSheetSource("Walker Employment Contract", m)).toBe("B");
    expect(channelForSheetSource("Walker X", m)).toBe("A");
  });
});

describe("placeSignup", () => {
  const place = (a: string, b: string, lead: Parameters<typeof placeSignup>[1] = null) =>
    placeSignup({ source: a, leadSource: b, signedUpBy: "" }, lead, DEFAULT_SOURCE_MAP, channelOfSource);
  it("keeps the linked lead's own source when it's in column A's channel", () => {
    expect(place("GMB", "GMB 1900 South Norfolk Street Suite 35", { marketingSource: "GMB 1900 South Norfolk Street Suite 350", teamRole: null, teamRep: null }))
      .toEqual({ marketingSource: "GMB 1900 South Norfolk Street Suite 350", teamRole: null, teamRep: null });
  });
  it("goes by column A when the lead says another channel", () => {
    expect(place("Walker", "", { marketingSource: "GMB 525 W Main St Visalia", teamRole: null, teamRep: null }).marketingSource).toBe("Walker Advertising");
  });
  it("uses column B when it is in the channel and there's no lead", () => {
    expect(place("GMB", "GMB 5340 Alla Road Los Angeles").marketingSource).toBe("GMB 5340 Alla Road Los Angeles");
  });
  it("puts a rep's sign-up on the BD/FR team row", () => {
    expect(place("FR Jezel", "Field Rep Jezel / Body Shop")).toEqual({ marketingSource: "Field Rep Jezel / Body Shop", teamRole: "FR", teamRep: "Jezel" });
    expect(place("BDR Grace", "", { marketingSource: "BDR Grace Lanayon", teamRole: "BDR", teamRep: "Grace Lanayon" }))
      .toEqual({ marketingSource: "BDR Grace", teamRole: "BDR", teamRep: "Grace Lanayon" });
  });
  it("gives a referral its lead's source, or 'Referral' with none", () => {
    expect(place("Referral", "Abrahan B", { marketingSource: "Existing Client", teamRole: null, teamRep: null }).marketingSource).toBe("Existing Client");
    expect(place("Referral", "Abrahan B").marketingSource).toBe("Referral");
  });
  it("counts an unmapped value under its own name", () => {
    expect(place("Avvo", "").marketingSource).toBe("Avvo");
    expect(place("", "")).toEqual({ marketingSource: null, teamRole: null, teamRep: null });
  });
});
