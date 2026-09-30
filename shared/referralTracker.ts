// Referral-Friendly List statuses — imported by both client and server.
//
// The team works with four statuses (Youssef, 2026-09-30). Rows from the old
// Google Sheet still carry the sheet's five; they are not rewritten in the
// database, only read as their new equivalent, and saved in the new form the
// next time someone edits them.

export const REFERRAL_STATUSES = [
  "Pending",
  "Appointment/Delivery Scheduled",
  "Successful",
  "Unsuccessful",
] as const;
export type ReferralStatus = typeof REFERRAL_STATUSES[number];

/** Every value the status column can hold: the four above plus the sheet's
 *  old ones, which stay in the enum so existing rows remain valid. */
export const REFERRAL_STATUS_ENUM = [
  "Successful Sent",
  "Demo Sent",
  "Pending",
  "Unsuccessful",
  "In Progress",
  "Appointment/Delivery Scheduled",
  "Successful",
] as const;

// "Demo Sent" (the client's demographics went to the facility) is a referral in
// flight, like "In Progress", so it reads as scheduled rather than done.
const LEGACY: Record<string, ReferralStatus> = {
  "In Progress": "Appointment/Delivery Scheduled",
  "Demo Sent": "Appointment/Delivery Scheduled",
  "Successful Sent": "Successful",
};

/** A stored status as one of the four the team uses. */
export function referralStatus(stored: string | null | undefined): ReferralStatus {
  const s = String(stored ?? "");
  if ((REFERRAL_STATUSES as readonly string[]).includes(s)) return s as ReferralStatus;
  return LEGACY[s] ?? "Pending";
}

/** The stored values that read as `status` — for filtering old and new rows alike. */
export function storedStatusesFor(status: ReferralStatus): (typeof REFERRAL_STATUS_ENUM)[number][] {
  return REFERRAL_STATUS_ENUM.filter((s) => referralStatus(s) === status);
}
