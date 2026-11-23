/**
 * The FLF Sign Up History sheet: the sign-up record intake keeps, one tab per
 * month ("October 2026"), back to 2018. The Marketing Report counts and dates
 * its sign-ups from here; Lead Docket stays the record of leads that never
 * signed, because the sheet lists sign-ups only.
 *
 * Pure: reading a tab and matching its rows to Lead Docket leads. The sync that
 * stores them is server/flfSignups.ts.
 */
import { sheetDay, type Cell } from "./digitalSheet";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The month a tab holds, "2026-10" for "October 2026" (or "Oct 2026"), or null
 * for every other tab — totals, pivots, welcome letters, the dropped-clients tab.
 */
export function monthOfTab(name: string): string | null {
  const m = name.trim().toLowerCase().match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (!m) return null;
  // By the first three letters, so "Sept" and the sheet's own "Februrary 2020" still read.
  const i = m[1].length < 3 ? -1 : MONTHS.findIndex((full) => full.startsWith(m[1].slice(0, 3)));
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** Lower-case letters and digits only — how the headers are recognised. */
const key = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: Cell) => String(v ?? "").replace(/\s+/g, " ").trim();

/** A phone as Lead Docket keys it: digits only, the last ten. */
export const phoneKeyOf = (v: Cell) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
/** A name as the matcher compares it: lower-cased, letters, digits and single spaces. */
export const nameKeyOf = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export const emailKeyOf = (v: Cell) => {
  const e = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

/**
 * Signed in-house or signed referred out. Referred out: Lead Outcome "Referred
 * out", or a Signed Cases Referral Status starting "Lead/Client Referred out".
 * Every other client row is an in-house sign-up, so the two add up to the tab.
 */
export function signupKind(outcome: string, referralStatus: string): "inHouse" | "referred" {
  const o = key(outcome), r = key(referralStatus);
  return o.startsWith("referred") || r.startsWith("leadclientreferredout") ? "referred" : "inHouse";
}

export type FlfSignup = {
  /** The month tab the row is on, "2026-10". */
  tabMonth: string;
  /** Its row in the tab, 1-based as the sheet numbers it. */
  rowNo: number;
  /** Sign Up Date (F) as a calendar day — decides the month it counts in. Null when blank or unreadable. */
  signDay: string | null;
  source: string; leadSource: string; intaker: string; signedUpBy: string;
  referralStatus: string; outcome: string; kind: "inHouse" | "referred";
  value: string; rank: string; clientName: string; caseType: string; caseNumber: string;
  phoneKey: string | null; emailKey: string | null;
};

/**
 * Every client row of a month tab — a row counts only when Client's Name is
 * filled. Columns are found by their header, so a column moving in an older
 * tab doesn't shift the rest. Null when the tab has no Client's Name header.
 */
export function parseFlfTab(rows: Cell[][], tabMonth: string): FlfSignup[] | null {
  // "Potential Client's Name" on the tabs before July 2020.
  const isName = (k: string) => k === "clientsname" || k === "clientname" || k === "potentialclientsname";
  const head = rows.slice(0, 10).findIndex((r) => (r ?? []).some((c) => isName(key(c))));
  if (head < 0) return null;
  const cols = (rows[head] ?? []).map(key);
  // Exact header, or the start of a long one ("Case Type (Slip, Auto, …)").
  const at = (k: string, starts = false) => cols.findIndex((c) => (starts ? c.startsWith(k) : c === k));
  // Tabs before 2021 have no Source column: "Lead Source" in column A, or (2018)
  // only the "How did you hear about Farahi Law Firm?" answer; no Sign Up Date
  // in 2018, so the Timestamp's day stands in; "Outcome" for "Lead Outcome".
  const heard = at("weareexcitedtoserveyouhowdidyouhear", true);
  const source = at("source") >= 0 ? at("source") : at("leadsource") >= 0 ? at("leadsource") : heard;
  const c = {
    source, leadSource: at("source") >= 0 ? at("leadsource") : heard >= 0 && heard !== source ? heard : -1,
    intaker: at("nameofpersonconductingintake", true),
    signedUpBy: at("signedupby"), day: at("signupdate") >= 0 ? at("signupdate") : at("timestamp"),
    referralStatus: at("signedcasesreferralstatus", true),
    value: at("value"), rank: at("rank"), outcome: at("leadoutcome") >= 0 ? at("leadoutcome") : at("outcome"),
    name: cols.findIndex(isName),
    phone: at("bestcallbacknumber", true), email: at("bestemail", true), caseType: at("casetype", true), caseNumber: at("casenumber"),
  };
  const get = (r: Cell[], i: number) => (i >= 0 ? text(r[i]) : "");
  const out: FlfSignup[] = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const clientName = get(r, c.name);
    if (!clientName) continue;
    const outcome = get(r, c.outcome), referralStatus = get(r, c.referralStatus);
    out.push({
      tabMonth, rowNo: i + 1,
      signDay: c.day >= 0 ? sheetDay(r[c.day]) : null,
      source: get(r, c.source), leadSource: get(r, c.leadSource), intaker: get(r, c.intaker), signedUpBy: get(r, c.signedUpBy),
      referralStatus, outcome, kind: signupKind(outcome, referralStatus),
      value: get(r, c.value), rank: get(r, c.rank), clientName, caseType: get(r, c.caseType), caseNumber: get(r, c.caseNumber),
      phoneKey: c.phone >= 0 ? phoneKeyOf(r[c.phone]) : null,
      emailKey: c.email >= 0 ? emailKeyOf(r[c.email]) : null,
    });
  }
  return out;
}

/** The month a sign-up counts in: its Sign Up Date's, or the tab's when the date is blank. */
export const countMonthOf = (s: Pick<FlfSignup, "signDay" | "tabMonth">) => s.signDay?.slice(0, 7) ?? s.tabMonth;

/** A Lead Docket lead as the matcher sees it. `day` is its Pacific sign-up (or lead) day. */
export type MatchLead = { leadId: number; clientName: string | null; phoneKey: string | null; email?: string | null; day: string | null };
export type MatchedBy = "phone" | "phone+name" | "email" | "name+date";

/** Whole days between two calendar days. */
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Which name of several is this client's: the same name, else one whose words
 * all appear in the other ("Ana Ruiz" and "Ana M Ruiz"). Null when none or
 * more than one does.
 */
function byName<T extends { clientName: string | null }>(name: string, among: T[]): T | null {
  const n = nameKeyOf(name);
  const exact = among.filter((l) => nameKeyOf(l.clientName) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const words = new Set(n.split(" "));
  const within = among.filter((l) => {
    const w = nameKeyOf(l.clientName).split(" ").filter(Boolean);
    if (!w.length) return false;
    const lw = new Set(w);
    return w.every((x) => words.has(x)) || Array.from(words).every((x) => lw.has(x));
  });
  return within.length === 1 ? within[0] : null;
}

/**
 * Link each sign-up to its Lead Docket lead. Keys in order, stopping at the
 * first that settles it: phone (last ten digits), email, then name with a
 * sign-up date within 7 days. Passengers share a caller's phone, so a phone
 * with several leads is settled by name among them. A lead is linked to one
 * sign-up at most; the earlier rows claim first.
 */
export function matchSignups<S extends Pick<FlfSignup, "clientName" | "phoneKey" | "emailKey" | "signDay">>(
  signups: S[], leads: MatchLead[],
): ({ leadId: number; by: MatchedBy } | null)[] {
  const byPhone = new Map<string, MatchLead[]>(), byEmail = new Map<string, MatchLead[]>(), byNameKey = new Map<string, MatchLead[]>();
  const add = (m: Map<string, MatchLead[]>, k: string | null | undefined, l: MatchLead) => { if (k) m.set(k, [...(m.get(k) ?? []), l]); };
  for (const l of leads) {
    add(byPhone, l.phoneKey, l);
    add(byEmail, emailKeyOf(l.email ?? null), l);
    add(byNameKey, nameKeyOf(l.clientName), l);
  }
  const used = new Set<number>();
  const free = (ls: MatchLead[] | undefined) => (ls ?? []).filter((l) => !used.has(l.leadId));
  return signups.map((s) => {
    let hit: { leadId: number; by: MatchedBy } | null = null;
    const phone = free(s.phoneKey ? byPhone.get(s.phoneKey) : undefined);
    if (phone.length === 1) hit = { leadId: phone[0].leadId, by: "phone" };
    else if (phone.length > 1) {
      const l = byName(s.clientName, phone);
      if (l) hit = { leadId: l.leadId, by: "phone+name" };
    }
    if (!hit && s.emailKey) {
      const email = free(byEmail.get(s.emailKey));
      const l = email.length === 1 ? email[0] : byName(s.clientName, email);
      if (l) hit = { leadId: l.leadId, by: "email" };
    }
    if (!hit && s.signDay) {
      const near = free(byNameKey.get(nameKeyOf(s.clientName))).filter((l) => l.day && daysApart(l.day, s.signDay!) <= 7);
      if (near.length === 1) hit = { leadId: near[0].leadId, by: "name+date" };
    }
    if (hit) used.add(hit.leadId);
    return hit;
  });
}

// ── where a sign-up is counted: column A → the report's channel ──────────────

/** A mapping's channel meaning "the linked Lead Docket lead's own Marketing Source" (the sheet says only "Referral"). */
export const LD_SOURCE = "(Lead Docket's source)";
/** The BD/FR team row's channel, as shared/marketing.ts names it. */
const TEAM = "BD/FR team";

/**
 * One line of the mapping: a column-A value — exact, ignoring case and spaces,
 * or a prefix when it ends in "*" — and the report channel it counts under.
 */
export type SourceMapEntry = { sheet: string; channel: string };

/**
 * What column A says → the report's channel, from how the linked Lead Docket
 * leads of 2026 are named (Walker → Walker Advertising for 614 of 650, and so
 * on). Referrals are split in Lead Docket (FLF Employee, Existing Client, a
 * referrer's name) but one word on the sheet, so they take their lead's own
 * source. Settings can override any line; a value with no line is counted
 * under its own name.
 */
export const DEFAULT_SOURCE_MAP: SourceMapEntry[] = [
  { sheet: "BDR *", channel: TEAM },
  { sheet: "FR *", channel: TEAM },
  { sheet: "Walker", channel: "Walker Advertising" },
  { sheet: "Walker Advertising*", channel: "Walker Advertising" },
  { sheet: "GMB*", channel: "Google Business Profile (GMB)" },
  { sheet: "JFJ Website", channel: "Justin For Justice" },
  { sheet: "Intaker*", channel: "Intaker" },
  { sheet: "Kapwa Justice", channel: "Kapwa Justice Website" },
  { sheet: "Referral", channel: LD_SOURCE },
];

const mapKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The mapped channel for a column-A value, or null when no line covers it. Exact lines win over prefixes, longer prefixes over shorter. */
export function channelForSheetSource(a: string, map: SourceMapEntry[]): string | null {
  const k = mapKey(a);
  if (!k) return null;
  const exact = map.find((e) => !e.sheet.trim().endsWith("*") && mapKey(e.sheet) === k);
  if (exact) return exact.channel;
  const prefixes = map
    .filter((e) => e.sheet.trim().endsWith("*"))
    // A space before the * is kept: "FR *" is FR and a name, never "Frank's Body Shop".
    .map((e) => ({ p: e.sheet.trim().slice(0, -1).toLowerCase().replace(/\s+/g, " ").trimStart(), channel: e.channel }))
    .filter((e) => e.p && k.startsWith(e.p))
    .sort((x, y) => y.p.length - x.p.length);
  return prefixes[0]?.channel ?? null;
}

/** The linked lead's fields the placement uses. */
export type LinkedLead = { marketingSource: string | null; teamRole: string | null; teamRep: string | null } | null;

/**
 * Where a sign-up is reported, as Lead Docket fields: the Marketing Source the
 * report reads (its row in the source view; its channel through
 * channelOfSource) and, for a BD/FR rep's, teamRole and teamRep.
 *
 * The channel is column A's, through the mapping. Within that channel the
 * most specific name that still belongs to it is kept — the linked lead's own
 * source ("GMB 1900 South Norfolk Street Suite 350"), else column B — so the
 * source view lines sign-ups up with the leads they came from.
 */
export function placeSignup(
  s: Pick<FlfSignup, "source" | "leadSource" | "signedUpBy">,
  lead: LinkedLead,
  map: SourceMapEntry[],
  channelOf: (source: string) => string,
): { marketingSource: string | null; teamRole: string | null; teamRep: string | null } {
  const a = s.source.trim(), b = s.leadSource.trim();
  const mapped = channelForSheetSource(a, map);
  const fromLead = () => ({ marketingSource: lead?.marketingSource?.trim() || null, teamRole: lead?.teamRole ?? null, teamRep: lead?.teamRep ?? null });

  if (mapped === TEAM) {
    const role = /^bdr\b/i.test(a) ? "BDR" : "FR";
    // Lead Docket's full name for the rep when the lead is theirs; else the sheet's ("FR Jezel" → "Jezel").
    const rep = lead && (lead.teamRole === "BDR" || lead.teamRole === "FR") && lead.teamRep ? lead.teamRep : a.replace(/^(bdr|fr)\s+/i, "");
    return { marketingSource: b || a, teamRole: role, teamRep: rep };
  }
  if (mapped === LD_SOURCE || (!a && lead)) {
    if (lead) return fromLead();
    return { marketingSource: a || b || null, teamRole: null, teamRep: null };
  }
  if (!a) return { marketingSource: b || null, teamRole: null, teamRep: null };

  const channel = mapped ?? channelOf(a);
  const leadSource = lead && lead.teamRole !== "BDR" && lead.teamRole !== "FR" ? lead.marketingSource?.trim() : "";
  const name = leadSource && channelOf(leadSource) === channel ? leadSource : b && channelOf(b) === channel ? b : channel;
  return { marketingSource: name, teamRole: null, teamRep: null };
}
