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
 * The firm's own digital channels, as the digital marketing team reports them
 * (Youssef, 2026-09-30): Google Business Profile listings (GBP, Lead Docket's
 * "GMB …" sources), the SEO websites and landing pages of each brand, website
 * chat (Intaker), web search, email campaigns and directories, and the paid
 * ads — Local Services Ads, the firm's own PPC, social media and RND Worx's
 * Google Ads. Not digital: Walker Advertising (an outside vendor's call lines),
 * the BD/FR team, staff, referrals, existing clients, Felix Cedillo Marketing
 * and print.
 *
 * One pattern, matched against the lower-cased Marketing Source, both here and
 * in SQL (server/marketing/leadFilter.ts), so the page's numbers and the client
 * lists behind them can't disagree. Plain alternation, ^, ?, * and [..] only,
 * which JavaScript, MySQL and TiDB all read the same way. digitalGroupOf gives
 * every source this matches a group and returns null for every other one, so
 * the Marketing Report's "Digital only" switch and the Digital Marketing
 * Report count exactly the same leads.
 */
export const DIGITAL_SOURCE_PATTERN = [
  "gmb", "google my business", "google business profile", "^google",
  "website", "landing page", "web search", "search engine", "intaker",
  "justin *for *justice", "j4j california car accident", "kapwa", "ayuda california", "brain injury help",
  "labor law advocates", "wom[ae]n'?s rights? group", "motorcyclist", "collision repair us",
  "email campaign", "emailer", "avvo", "yelp",
  "local services ads", "ppc", "fb organic", "facebook", "instagram", "tiktok", "youtube", "rnd *worx",
  "800[^0-9]*738[^0-9]*0000",   // the JFJ toll-free number, however it is written (isTollFreeLine)
].join("|");
const DIGITAL_RE = new RegExp(DIGITAL_SOURCE_PATTERN);
/** A Marketing Source (as the report names its row) that is a digital channel. */
export const isDigitalSource = (source: string) =>
  source !== NO_SOURCE && source !== TEAM_CHANNEL && DIGITAL_RE.test(source.trim().toLowerCase());

/** The team's three channel groups, in the order their sheet lists them. */
export const DIGITAL_GROUPS = ["GBP", "SEO", "Ads"] as const;
export type DigitalGroup = (typeof DIGITAL_GROUPS)[number];
export const DIGITAL_GROUP_LABEL: Record<DigitalGroup, string> = { GBP: "GBP", SEO: "SEO / Website", Ads: "Ads" };
export const DIGITAL_GROUP_NAME: Record<DigitalGroup, string> = {
  GBP: "Google Business Profile", SEO: "SEO / Website", Ads: "Paid ads",
};
/** Monthly sign-up targets from the team's sheet. Ads has none. */
export const DIGITAL_TARGET: Record<DigitalGroup, number | null> = { GBP: 55, SEO: 20, Ads: null };

/** The SEO brands, in the sheet's order; each shows even in a month with no leads. */
export const OTHER_CHANNELS = "Other channels (Avvo, Yelp, Email)";
/**
 * Justin For Justice is two rows (Youssef, 2026-09-30). The toll-free number
 * 800-738-0000 is printed on the website and also on merch, welcome kits, the
 * emailer and soon billboards, so leads on that line can't be credited to the
 * website alone. It stays inside SEO / Website's totals (so they still match
 * the team's sheet), marked as a shared line whose attribution is uncertain.
 */
export const JFJ_WEBSITE = "Justin For Justice — website (form, chat, search)";
export const TOLL_FREE = "800-738-0000 toll-free line (shared: website, merch, welcome kits, emailer, billboards)";
export const TOLL_FREE_DIGITS = "8007380000";
/**
 * Whether a Lead Docket value names the firm's toll-free line: the number in
 * any format (compared on its digits, so "(800) 738-0000" and "1-800-738-0000"
 * match), or "toll free" alongside Justin For Justice.
 */
export function isTollFreeLine(value: string | null | undefined): boolean {
  const v = String(value ?? "");
  if (v.replace(/\D/g, "").includes(TOLL_FREE_DIGITS)) return true;
  return /toll[\s-]*free/i.test(v) && /justin|jfj|j4j/i.test(v);
}

export const SEO_BRANDS = [
  JFJ_WEBSITE, TOLL_FREE, "Ayuda California", "Brain Injury Help Center", "Kapwa Justice", "Labor Law Advocates",
  "Motorcyclist Attorney", "Women's Rights Group", "Collision Repair", "RND Website Pool", OTHER_CHANNELS,
] as const;
/** The paid campaigns, in the sheet's order; each shows even when paused. */
export const ADS_CAMPAIGNS = ["LSA", "Internal PPC", "Social Media", "RND Worx Google Ads"] as const;

/**
 * The office a GBP listing belongs to, from the address in its Lead Docket
 * name ("GMB 525 W Main St Visalia"). Tried in order; the "MA" listings first,
 * since they name a city another office shares.
 */
const GBP_LOCATIONS: [RegExp, string][] = [
  [/\bma bakersfield\b/, "MA Bakersfield"],
  [/\bma visalia\b/, "MA Visalia"],
  [/525 w(est)?\.? main\b|visalia/, "Visalia"],
  [/5340 alla\b/, "Los Angeles"],
  [/1010 crenshaw\b|crenshaw/, "Los Angeles (Crenshaw)"],
  [/5601 truxtun\b|3111 edison\b|bakersfield/, "Bakersfield"],
  [/4701 patrick henry\b|santa clara/, "Santa Clara"],
  [/14500 roscoe\b|panorama/, "Panorama"],
  [/222 w(est)?\.? 6th\b|san pedro/, "San Pedro"],
  [/22760 hawthorne\b|torrance/, "Torrance"],
  [/836 57th\b|sacramento/, "Sacramento"],
  [/lancaster/, "Lancaster"],
  [/1444 fulton\b|fresno/, "Fresno"],
  [/1900 s(outh)?\.? norfolk\b|san mateo/, "San Mateo"],
  [/san francisco/, "San Francisco"],
  [/los angeles/, "Los Angeles"],
];
const GBP_WORD = /\bgmb\b|google my business|google business profile/i;

/** "GBP Visalia" for a GBP source; "GBP (unspecified)" when it names no place. */
export function gbpLocationOf(source: string): string {
  const s = source.replace(/\s+/g, " ").trim();
  const low = s.toLowerCase();
  for (const [re, city] of GBP_LOCATIONS) if (re.test(low)) return `GBP ${city}`;
  // An address we don't know yet: the rest of the name, so it still gets a row of its own.
  const rest = s.replace(GBP_WORD, " ").replace(/\s+/g, " ").replace(/^[\s\-–:|,]+|[\s\-–:|,]+$/g, "");
  return rest ? `GBP ${rest}` : "GBP (unspecified)";
}

/** Tried in order after GBP; first match wins. Labels are the sheet's rows. */
const DIGITAL_RULES: [RegExp, DigitalGroup, string][] = [
  [/website pool/, "SEO", "RND Website Pool"],   // RND's leads from the pooled sites, not its Google Ads
  [/local services ads/, "Ads", "LSA"],
  [/ppc/, "Ads", "Internal PPC"],
  [/fb organic|facebook|instagram|tiktok|youtube/, "Ads", "Social Media"],
  [/rnd *worx/, "Ads", "RND Worx Google Ads"],
  [/kapwa/, "SEO", "Kapwa Justice"],
  [/ayuda california/, "SEO", "Ayuda California"],
  [/brain injury help/, "SEO", "Brain Injury Help Center"],
  [/labor law advocates/, "SEO", "Labor Law Advocates"],
  [/wom[ae]n'?s rights? group/, "SEO", "Women's Rights Group"],
  [/motorcyclist/, "SEO", "Motorcyclist Attorney"],
  [/collision repair us/, "SEO", "Collision Repair"],
  [/email campaign|emailer|avvo|yelp/, "SEO", OTHER_CHANNELS],
  // Justin For Justice is the firm's main site: its toll-free line, its chat
  // (Intaker, "All Source" included) and plain web search all land there.
  [/justin *for *justice|j4j california car accident|intaker|web search|search engine/, "SEO", JFJ_WEBSITE],
];

/**
 * Which digital group and row a Lead Docket Marketing Source counts in, or
 * null when it isn't a digital channel. The mapping Youssef confirmed on
 * 2026-09-30; GBP rows are the office the listing belongs to.
 */
export function digitalGroupOf(source: string): { group: DigitalGroup; label: string } | null {
  if (!isDigitalSource(source)) return null;
  const s = source.trim().toLowerCase();
  // "Motorcyclist Atty - GMB …" is a Google listing, whatever else its name says.
  if (GBP_WORD.test(s)) return { group: "GBP", label: gbpLocationOf(source) };
  if (isTollFreeLine(source)) return { group: "SEO", label: TOLL_FREE };
  for (const [re, group, label] of DIGITAL_RULES) if (re.test(s)) return { group, label };
  // ASSUMPTION: a Google-named source no rule above claims ("Google Ads …") is
  // paid search; any other website or landing page is SEO. None exist today.
  if (/^google.*\bads?\b/.test(s)) return { group: "Ads", label: "Other Google Ads" };
  return { group: "SEO", label: "Other websites" };
}

/**
 * In the Marketing Report's "Digital only" view, the rows are the digital
 * team's: each GBP office's listings add up as one GBP row, every SEO site as
 * Websites, directories and email as one row, and each paid campaign as its
 * own — the same grouping as digitalGroupOf, so the two reports agree.
 */
export const digitalChannelOf = (source: string) => {
  const g = digitalGroupOf(source);
  if (!g) return "Other digital";
  if (g.group === "GBP") return "Google Business Profile (GMB)";
  if (g.group === "SEO") return g.label === OTHER_CHANNELS ? "Email & directories" : "Websites";
  return g.label === "LSA" ? "Google Local Services Ads" : g.label;
};

/**
 * The firm's branded merchandise and print ("Justin - Note Pad and Post it",
 * Youssef 2026-09-30): not digital, but a known source, so the Audit tab lists
 * it as classified rather than as unexplained.
 */
export const MERCH = "Merch & print";
const MERCH_RE = /note ?pad|post[\s-]?it|\bmerch/i;

/** Every Marketing Source's category, for listings: a digital row, merch, or neither. */
export function sourceCategoryOf(source: string):
  | { kind: "digital"; group: DigitalGroup; label: string } | { kind: "merch"; label: string } | { kind: "other" } {
  const g = digitalGroupOf(source);
  if (g) return { kind: "digital", ...g };
  if (MERCH_RE.test(source)) return { kind: "merch", label: MERCH };
  return { kind: "other" };
}

/** Lead Docket's Case Value picks, in the sheet's order. */
export const CASE_VALUES = ["Low", "Medium", "High", "Rank X", "Rank U"] as const;
/** Where a lead with no Case Value in Lead Docket is counted. */
export const CASE_VALUE_NONE = "Not recorded yet";

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
