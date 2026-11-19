import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import xlsx from "xlsx";
import { readSignupSheet } from "@shared/digitalSheet";

const HEAD = ["Source", "Lead Source", "Timestamp", "Name of Person Conducting Intake ", "Signed Up By", "Sign Up Date", "90 Day Drop Date",
  "Signed Cases Referral Status", "CM Assigned", "PD/Investigator Assigned", "Value", "Rank", " Lead Outcome", "Client's Name",
  "Best Call Back Number ", "Best Email Contact info?", "TIER", "Active Status", "Case Type (Slip, Auto, Employment, W/C, Etc)",
  "Accepted or Disputed Liability", "Language", "ER/UC Visit? (Yes/No)", "Time To First Medical (Exact Date)", "Facility Name (UC/ER sent to)",
  "Referred Attorney", "Referral Fee", "Case Number"];
const ROWS = [
  HEAD,
  ["GMB", "GMB Visalia", 46328.4, "Ana I", "Malvin Rosales", 46328, 46420, "", "Paulina Vargas", "Enrique Avila", "High", null, "Signed", "Ana Diaz",
    "559-000-0000", "ana@example.com", "Tier 1", "", "Auto", "Accepted", "Spanish", "Yes, to ER", 46327, "Kaiser", "", "", "CASE-0001"],
  ["Walker", "Walker 41", 46329.1, "Ben I", "Felix Cedillo", 46329, 46421, "Lead Referred out - Successful", "", "", "Medium", null, "Referred out", "Ben Cho",
    "213-000-0000", "ben@example.com", "Tier 2", "", "PI", "Disputed", "English", "No", null, "", "Avrek Law", 0.33, "CASE-0002"],
  Array(HEAD.length).fill(null),   // a blank case-group row
];

describe("FLF sign-up sheet tab", () => {
  it("reads every sign-up with its case facts apart, and never phone or email", () => {
    const rows = readSignupSheet(ROWS)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "2026-11-02", source: "GMB", group: "GBP", signedUpBy: "Malvin Rosales", intaker: "Ana I",
      outcome: "Signed", clientName: "Ana Diaz", value: "High", tier: "Tier 1", caseType: "Auto", caseNumber: "CASE-0001" });
    expect(rows[0].facts).toMatchObject({ liability: "Accepted", erVisit: "Yes, to ER", firstMedical: "2026-11-01", sentTo: "Kaiser", caseManager: "Paulina Vargas" });
    expect(rows[1]).toMatchObject({ group: null, outcome: "Referred out", referralStatus: "Lead Referred out - Successful" });
    expect(rows[1].facts).toMatchObject({ referredAttorney: "Avrek Law", referralFee: "33%" });
    const all = JSON.stringify(rows);
    expect(all).not.toMatch(/example\.com|559-000|213-000/);
  });

  it("sends only digital marketing's sign-ups, and case facts only to roles allowed them", async () => {
    const file = path.join(os.tmpdir(), `signup-sheet-test-${Date.now()}.xlsx`);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(ROWS), "Current Month");
    vi.doMock("./googleSheets", () => ({
      SHEETS: { marketing: { id: "abc", label: "FLF Sign-up Sheet (Current Month)" } },
      downloadWorkbook: async () => { xlsx.writeFile(wb, file); return { file, bytes: 1 }; },
    }));
    const { getSignupSheet } = await import("./signupSheet");
    const bd = await getSignupSheet({ fresh: true, caseFacts: false });
    // The GMB sign-up only; the Walker one is counted but its name never sent.
    expect(bd.sheetTotal).toBe(2);
    expect(bd.rows.map((r) => r.clientName)).toEqual(["Ana Diaz"]);
    expect(JSON.stringify(bd)).not.toMatch(/Ben Cho|Avrek/);
    expect(bd.caseFacts).toBe(false);
    expect(bd.rows.every((r) => r.facts === null)).toBe(true);
    expect(JSON.stringify(bd)).not.toMatch(/Kaiser|Accepted|Paulina/);
    const admin = await getSignupSheet({ fresh: false, caseFacts: true });
    expect(admin.rows[0].facts).toMatchObject({ sentTo: "Kaiser", caseManager: "Paulina Vargas" });
    vi.doUnmock("./googleSheets");
  });
});
