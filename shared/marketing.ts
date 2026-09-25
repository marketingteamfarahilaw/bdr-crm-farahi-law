/**
 * Marketing Report names and groups that the server and the page must agree
 * on. The spend editor groups names exactly as the dashboard does, and the page
 * builds drill-downs from the same reason keys the server classifies by, so
 * these live here rather than in either side. Pure: no server imports.
 */

/** The row for leads whose Marketing Source is empty. It stays whole in both views. */
export const NO_SOURCE = "No source recorded";

/**
 * The row for leads credited to a BDR or FR rep — one row in both views, never a
 * row per rep (the Sign-ups Report breaks them down). Youssef had them left out,
 * then asked for them back as one row (2026-09-25).
 */
export const TEAM_CHANNEL = "BD/FR team";

/**
 * Lead Docket names a source per contract or listing — "Walker Advertising
 * Contract 26", "GMB 525 W Main St Visalia" — so the channel view groups those
 * into the vendor or channel they belong to.
 */
export const CHANNEL_RULES: [RegExp, string][] = [
  [/^walker advertising\b/i, "Walker Advertising"],
  [/^(gmb\b|google my business)/i, "Google Business Profile (GMB)"],   // Google's old name for it
  [/^intaker\b/i, "Intaker"],
  [/^justin\s*for\s*justice/i, "Justin For Justice"],   // also "JustinforJustice Website"
];
export const channelOfSource = (source: string) => {
  for (const [re, name] of CHANNEL_RULES) if (re.test(source)) return name;
  return source.replace(/\s+(contract|#)\s*\d+$/i, "").trim() || source;
};

/**
 * Why a lead did or didn't sign — one family per lead. The order is the order
 * the page stacks them in, signed first.
 */
export const REASON_KEYS = ["signed", "open", "referred", "lostThem", "noClaim", "wrongArea", "tooLate", "junk", "other"] as const;
export type ReasonKey = (typeof REASON_KEYS)[number];

export const REASON_LABEL: Record<ReasonKey, string> = {
  signed: "Signed",
  open: "Still open",
  referred: "Referred out, not signed",
  lostThem: "Chose another firm or went quiet",
  noClaim: "No viable claim",
  wrongArea: "Not a case we take",
  tooLate: "Past the deadline (SOL)",
  junk: "Junk or unreachable",
  other: "Other or no reason",
};

/** The families that are not a real, viable case. Everything else counts as viable. */
export const NOT_VIABLE: ReadonlySet<ReasonKey> = new Set<ReasonKey>(["junk", "noClaim", "wrongArea", "tooLate"]);
// The build target can't spread a Set, so drill-downs that need a list use this.
export const NOT_VIABLE_KEYS: ReasonKey[] = Array.from(NOT_VIABLE);
