/**
 * Where a lead ended up, in the digital marketing team's words — the columns
 * of their "Digital Marketing Team" table and the rows of their GBP outcome
 * summary — built on the Marketing Report's own scorecardBucket, so every
 * number the Digital Marketing Report shows adds back to the Marketing
 * Report's scorecard for the same leads.
 *
 * Pure. Shared by the report (server/digitalMarketing.ts) and the drill-down
 * (leadFilter.ts keepsTriple), so a clicked number's client list is exactly
 * the leads it counted.
 */
import { scorecardBucket } from "../signupsReport";
import { clean, keyOf } from "./common";

/**
 * The team table's columns. The same as the scorecard's, except that its
 * "Lost/ Not Interested" column holds Lead Docket's Lost leads, which the
 * scorecard (like the BD/FR team's sheet) counts under Rejected. So
 * Rejected + Lost/Not Interested here = Rejected + Not Interested there.
 */
export const DM_BUCKETS = ["open", "rejected", "referredOut", "lostNI", "signedReferred", "signedInHouse"] as const;
export type DmBucket = (typeof DM_BUCKETS)[number];
export const DM_BUCKET_LABEL: Record<DmBucket, string> = {
  open: "Open",
  rejected: "Rejected",
  referredOut: "Referred Out",
  lostNI: "Lost / Not Interested",
  signedReferred: "Signed Referred Out",
  signedInHouse: "Signed In-House",
};

const norm = (s: unknown) => keyOf(clean(s));

export function dmBucketOf(outcome: string | null, _status?: string | null): DmBucket {
  const b = scorecardBucket(outcome);
  if (b === "notInterested") return "lostNI";
  // The sync writes a Lost lead's outcome as its status, "Lost".
  if (b === "rejected" && norm(outcome) === "lost") return "lostNI";
  return b;
}

/** Lead Docket's "Pending Referral" status: still open, on its way to a referral firm. */
export const isPendingReferral = (status: string | null) => norm(status) === "pending referral";

/**
 * The GBP outcome summary's rows, one per lead. Pending Referral is split out
 * of Open, and the referred-out leads by where the referral stands (Lead
 * Docket's sub-status on a Referred lead):
 *   Pending Review …                              → Referred Pending Review
 *   Reviewing                                     → Referred Reviewing
 *   Declined, Rejected … Referral, Work Comp,
 *   Med Mal, No Follow-Up, Settled / Closed       → Referred Declined (the referral firm didn't take it)
 *   anything else, or none                        → Referred (other)
 *   signed by the referral firm (Signed Referred Out) → Referred Signed Up
 */
export const DM_OUTCOMES = [
  "open", "lostNI", "rejected", "referred", "pendingReferral", "referredDeclined",
  "referredPendingReview", "referredReviewing", "referredSignedUp", "signedInHouse",
] as const;
export type DmOutcome = (typeof DM_OUTCOMES)[number];
export const DM_OUTCOME_LABEL: Record<DmOutcome, string> = {
  open: "Open",
  lostNI: "Not Interested / Lost",
  rejected: "Rejected",
  referred: "Referred (other)",
  pendingReferral: "Pending Referral",
  referredDeclined: "Referred Declined",
  referredPendingReview: "Referred Pending Review",
  referredReviewing: "Referred Reviewing",
  referredSignedUp: "Referred Signed Up",
  signedInHouse: "Signed In-house",
};

export function dmOutcomeOf(outcome: string | null, status: string | null, subStatus: string | null): DmOutcome {
  const b = dmBucketOf(outcome, status);
  switch (b) {
    case "open": return isPendingReferral(status) ? "pendingReferral" : "open";
    case "signedReferred": return "referredSignedUp";
    case "referredOut": {
      const sub = norm(subStatus);
      if (sub.includes("pending review")) return "referredPendingReview";
      if (sub.startsWith("reviewing")) return "referredReviewing";
      if (/declin|reject|work comp|med mal|no follow|settled|closed/.test(sub)) return "referredDeclined";
      return "referred";
    }
    default: return b;
  }
}
