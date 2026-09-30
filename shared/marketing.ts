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
/**
 * The firm's own digital channels (Youssef, 2026-09-30): Google Business
 * listings, Google ads and search, websites and landing pages, website chat
 * (Intaker), web search, email campaigns, online directories, PPC and social,
 * plus Ayuda California and J4J California Car Accident. Not digital: Walker
 * Advertising (an outside lead vendor's call lines), the BD/FR team, staff,
 * referrals, existing clients, Felix Cedillo Marketing, RND Worx and print.
 *
 * One pattern, matched against the lower-cased Marketing Source, both here and
 * in SQL (server/marketing/leadFilter.ts), so the page's numbers and the client
 * lists behind them can't disagree. Plain alternation only, which JavaScript,
 * MySQL and TiDB all read the same way.
 */
export const DIGITAL_SOURCE_PATTERN =
  "gmb|^google|website|landing page|web search|search engine|local services ads|intaker|email campaign|avvo|yelp|ppc|fb organic|facebook|instagram|tiktok|youtube|ayuda california|j4j california car accident";
const DIGITAL_RE = new RegExp(DIGITAL_SOURCE_PATTERN);
/** A Marketing Source (as the report names its row) that is a digital channel. */
export const isDigitalSource = (source: string) =>
  source !== NO_SOURCE && source !== TEAM_CHANNEL && DIGITAL_RE.test(source.trim().toLowerCase());

/**
 * In the "Digital only" view, channels are the kind of digital channel, so
 * every website — and the chat on them (Intaker) — adds up as one Websites
 * row (Youssef, 2026-09-30). First match wins: a GMB listing is never Search.
 */
const DIGITAL_CHANNELS: [RegExp, string][] = [
  [/gmb|google my business|business profile/, "Google Business Profile (GMB)"],
  [/website|landing page|intaker|j4j california car accident|ayuda california/, "Websites"],
  [/web search|search engine|local services ads|ppc|^google/, "Search & ads"],
  [/email campaign/, "Email"],
  [/avvo|yelp/, "Online directories"],
  [/facebook|fb organic|instagram|tiktok|youtube/, "Social"],
];
export const digitalChannelOf = (source: string) => {
  const s = source.trim().toLowerCase();
  for (const [re, name] of DIGITAL_CHANNELS) if (re.test(s)) return name;
  return "Other digital";
};

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
