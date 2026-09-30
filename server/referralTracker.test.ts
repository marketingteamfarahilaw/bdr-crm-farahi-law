import { describe, expect, it } from "vitest";
import { REFERRAL_STATUSES, REFERRAL_STATUS_ENUM, referralStatus, storedStatusesFor } from "@shared/referralTracker";

describe("Referral-Friendly List statuses", () => {
  it("reads the sheet's old statuses as today's four", () => {
    expect(referralStatus("In Progress")).toBe("Appointment/Delivery Scheduled");
    expect(referralStatus("Demo Sent")).toBe("Appointment/Delivery Scheduled");
    expect(referralStatus("Successful Sent")).toBe("Successful");
    expect(referralStatus("Unsuccessful")).toBe("Unsuccessful");
    expect(referralStatus(null)).toBe("Pending");
  });

  it("keeps every current status as it is", () => {
    for (const s of REFERRAL_STATUSES) expect(referralStatus(s)).toBe(s);
  });

  it("filters a current status to the stored values that read as it", () => {
    expect(storedStatusesFor("Successful").sort()).toEqual(["Successful", "Successful Sent"]);
    expect(storedStatusesFor("Appointment/Delivery Scheduled").sort()).toEqual(["Appointment/Delivery Scheduled", "Demo Sent", "In Progress"]);
    expect(storedStatusesFor("Pending")).toEqual(["Pending"]);
  });

  it("never drops a value the column already holds", () => {
    for (const old of ["Successful Sent", "Demo Sent", "Pending", "Unsuccessful", "In Progress"]) {
      expect(REFERRAL_STATUS_ENUM).toContain(old);
    }
    for (const s of REFERRAL_STATUSES) expect(REFERRAL_STATUS_ENUM).toContain(s);
  });
});
