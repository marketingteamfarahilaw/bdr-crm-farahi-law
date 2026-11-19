/**
 * Reading the digital marketing team's daily sheet ("DIGITAL MARKETING
 * DEPARTMENT — MTD PERFORMANCE SUMMARY", one tab per day named like 93026 for
 * Sep 30 2026) for the Audit tab's comparison with Lead Docket, and matching
 * its client names with the CRM's. Pure: the page parses the file in the
 * browser (xlsx) and hands the tab's cells here as rows of values.
 *
 * Lead Docket is the source of truth; the comparison only shows where the
 * sheet and Lead Docket disagree, so one of them can be corrected.
 */

import { digitalGroupOf, type DigitalGroup } from "./marketing";

export type Cell = string | number | boolean | null | undefined;

/** Lower-case letters and digits only — how the sheet's headers and labels are recognised. */
const key = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: Cell) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v: Cell) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? "").replace(/[,%$\s]/g, ""));
  return String(v ?? "").trim() && Number.isFinite(n) ? n : null;
};

/** The tab for a day, as the team names them: month, day, two-digit year, no leading zeros ("93026", "10126"). */
export const tabForDay = (day: string) => `${Number(day.slice(5, 7))}${Number(day.slice(8, 10))}${day.slice(2, 4)}`;

/** The team table's columns, by their header in the sheet. */
export const SHEET_COLUMNS = [
  ["leads", "totalleads", "Total Leads"],
  ["open", "open", "Open"],
  ["rejected", "rejected", "Rejected"],
  ["referredOut", "referredout", "Referred Out"],
  ["lostNI", "lostnotinterested", "Lost / Not Interested"],
  ["signedReferred", "signedreferredout", "Signed Referred Out"],
  ["unique", "signupuniquecount", "Sign-up Unique Count"],
  ["signedInHouse", "signedinhouse", "Signed In-House"],
  ["signed", "totalsigned", "Total Signed"],
  ["target", "target", "Target"],
  ["conversion", "leadvssignupconversion", "Conversion"],
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number][0];
export type SheetTeamRow = Partial<Record<SheetColumn, number>>;

export type SheetSignup = { source: string; caseValue: string; caseType: string; name: string };

export type ParsedSheet = {
  team: {
    GBP: SheetTeamRow | null; SEO: SheetTeamRow | null; TOTAL: SheetTeamRow | null;
    /** Only the FLF sign-up sheet has one (its Facebook / Instagram sign-ups); a daily tab has no Ads row. */
    Ads?: SheetTeamRow | null;
  };
  inHouse: SheetSignup[];
  referred: SheetSignup[];
  found: { team: boolean; inHouse: boolean; referred: boolean };
};

const findRow = (rows: Cell[][], test: (k: string) => boolean, from = 0) => {
  for (let i = from; i < rows.length; i++) if ((rows[i] ?? []).some((c) => test(key(c)))) return i;
  return -1;
};

/** A section of "Count | Lead Source | Case Value | Case Type | Client Name" rows under its title. */
function signupList(rows: Cell[][], title: string): { list: SheetSignup[]; found: boolean } {
  const at = findRow(rows, (k) => k.startsWith(title));
  if (at < 0) return { list: [], found: false };
  const head = findRow(rows, (k) => k === "clientname", at);
  if (head < 0 || head > at + 3) return { list: [], found: false };
  const cols = (rows[head] ?? []).map(key);
  const col = (k: string) => cols.indexOf(k);
  const [cName, cSource, cValue, cType] = [col("clientname"), col("leadsource"), col("casevalue"), col("casetype")];
  const list: SheetSignup[] = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    // The next section's title ends this one.
    if (r.some((c) => /details|summary|monitoring|performance/.test(key(c)) && num(c) == null)) break;
    const name = text(r[cName]);
    if (!name) continue;
    list.push({ name, source: text(r[cSource]), caseValue: text(r[cValue]), caseType: text(r[cType]) });
  }
  return { list, found: true };
}

/** The numbers and names the Audit tab compares, from one day's tab. */
export function parseSheet(rows: Cell[][]): ParsedSheet {
  const team: ParsedSheet["team"] = { GBP: null, SEO: null, TOTAL: null };
  const at = findRow(rows, (k) => k === "digitalmarketingteam");
  let foundTeam = false;
  if (at >= 0) {
    const head = findRow(rows, (k) => k === "totalleads", at);
    if (head >= 0 && head <= at + 3) {
      foundTeam = true;
      const cols = (rows[head] ?? []).map(key);
      const nameCol = cols.findIndex((k) => k === "name");
      for (let i = head + 1; i < Math.min(rows.length, head + 8); i++) {
        const r = rows[i] ?? [];
        const label = key(r[nameCol >= 0 ? nameCol : 1]);
        const which = label === "gbp" ? "GBP" : label.startsWith("seo") ? "SEO" : label === "total" ? "TOTAL" : null;
        if (!which) continue;
        const row: SheetTeamRow = {};
        for (const [k, header] of SHEET_COLUMNS) {
          const c = cols.indexOf(header);
          const v = c >= 0 ? num(r[c]) : null;
          // The sheet writes conversion as a fraction (0.283); the CRM as a percent (28.3).
          if (v != null) row[k] = k === "conversion" && v <= 1 ? Math.round(v * 1000) / 10 : v;
        }
        team[which] = row;
        if (which === "TOTAL") break;
      }
    }
  }
  const inHouse = signupList(rows, "inhousesignupdetails");
  const referred = signupList(rows, "signedreferredoutdetails");
  return { team, inHouse: inHouse.list, referred: referred.list, found: { team: foundTeam, inHouse: inHouse.found, referred: referred.found } };
}

// ── names ──

const RELATION = /\b(as the |as )?(mother|father|parent|guardian|grandmother|grandfather|aunt|uncle|niece|nephew|wife|husband|spouse|son|daughter|sister|brother)\b.*$/;
const SUFFIX = /\b(jr|sr|ii|iii|iv)\b/g;

/**
 * A client name as the reconciliation compares it: lower-case letters only,
 * without accents, suffixes (Jr, III) or a guardian's clause — "Ana Diaz as the
 * Mother of Leo Diaz" is Ana Diaz's line, and "Ana Diaz / Niece Mia /" too.
 */
export function nameKey(name: string): string {
  let s = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.split("/")[0];
  s = s.replace(RELATION, " ").replace(/[^a-z\s-]/g, " ").replace(/-/g, " ").replace(SUFFIX, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Whether two name keys are the same person: equal, or every word of the shorter in the longer (at least two words). */
export function sameName(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.split(" ").length <= b.split(" ").length ? [a, b] : [b, a];
  const sw = short.split(" "), lw = new Set(long.split(" "));
  return sw.length >= 2 && sw.every((w) => lw.has(w));
}

export type Reconciled<S, C> = { both: { sheet: S; crm: C }[]; onlySheet: S[]; onlyCrm: C[] };

/**
 * Pair the sheet's names with Lead Docket's, one to one: exact keys first,
 * then the looser sameName, so a family's several lines each find their own
 * lead rather than all claiming the first.
 */
export function reconcileNames<S extends { name: string }, C extends { name: string }>(sheet: S[], crm: C[]): Reconciled<S, C> {
  const s = sheet.map((x) => ({ x, k: nameKey(x.name), used: false }));
  const c = crm.map((x) => ({ x, k: nameKey(x.name), used: false }));
  const both: Reconciled<S, C>["both"] = [];
  for (const pass of [(a: string, b: string) => a === b, sameName]) {
    for (const a of s) {
      if (a.used) continue;
      const b = c.find((y) => !y.used && pass(a.k, y.k));
      if (b) { a.used = b.used = true; both.push({ sheet: a.x, crm: b.x }); }
    }
  }
  return { both, onlySheet: s.filter((a) => !a.used).map((a) => a.x), onlyCrm: c.filter((b) => !b.used).map((b) => b.x) };
}

// ── the audit's checks: the sheet against itself, and one list against Lead Docket ──

/** The sheet's status columns, which between them should hold every lead in Total Leads. */
const BUCKETS = ["open", "rejected", "referredOut", "lostNI", "signedReferred", "signedInHouse"] as const;

/**
 * Leads a sheet row counts in Total Leads but in no status column — the
 * manual's "no status bucket" leads. Negative when the columns hold more than
 * the total; null when the row lacks a total or every column.
 */
export function unbucketed(row: SheetTeamRow | null | undefined): number | null {
  if (!row || row.leads == null) return null;
  const vals = BUCKETS.map((k) => row[k]);
  if (vals.every((v) => v == null)) return null;
  return row.leads - vals.reduce<number>((s, v) => s + (v ?? 0), 0);
}

const srcKey = (s: string) => key(s).replace(/^gbp|^gmb/, "");

/**
 * Whether the sheet's Lead Source and Lead Docket's row name the same thing.
 * The sheet writes them by hand ("GBP Visalia", "Justin for Justice"), so it
 * is loose: equal, or one contained in the other, once spaces, case and a
 * leading GBP are set aside. A blank sheet source is never a difference.
 */
export function sameSource(sheet: string, crm: { label: string; source: string }) {
  const a = srcKey(sheet);
  if (!a) return true;
  return [crm.label, crm.source].some((c) => {
    const b = srcKey(c);
    return !!b && (a === b || a.includes(b) || b.includes(a));
  });
}

export type SignupKind = "inHouse" | "referred";
export type CrmSignup = { name: string; kind: SignupKind; label: string; source: string };

export type SignupAudit<C extends CrmSignup> = {
  /** Same person, same kind of sign-up. */
  agree: { sheet: SheetSignup & { kind: SignupKind }; crm: C }[];
  /** Same person, but in-house on one side and referred out on the other. */
  statusDiffers: { sheet: SheetSignup & { kind: SignupKind }; crm: C }[];
  /** Matched (either kind) but the sheet's Lead Source isn't Lead Docket's. */
  sourceDiffers: { sheet: SheetSignup & { kind: SignupKind }; crm: C }[];
  onlySheet: (SheetSignup & { kind: SignupKind })[];
  onlyCrm: C[];
};

/**
 * Both of the sheet's sign-up lists against all of Lead Docket's at once, so
 * a client the sheet lists as in-house and Lead Docket as referred out (or the
 * other way) is one status difference — not a name missing from each list.
 */
export function auditSignups<C extends CrmSignup>(sheet: { inHouse: SheetSignup[]; referred: SheetSignup[] }, crm: C[]): SignupAudit<C> {
  const all = [
    ...sheet.inHouse.map((s) => ({ ...s, kind: "inHouse" as const })),
    ...sheet.referred.map((s) => ({ ...s, kind: "referred" as const })),
  ];
  // Same-kind pairs first, so a family with one line of each kind pairs up as the lists say.
  const first = (["inHouse", "referred"] as const).map((k) =>
    reconcileNames(all.filter((s) => s.kind === k), crm.filter((c) => c.kind === k)));
  const rest = reconcileNames(first.flatMap((r) => r.onlySheet), first.flatMap((r) => r.onlyCrm));
  const pairs = [...first.flatMap((r) => r.both), ...rest.both];
  return {
    agree: pairs.filter((p) => p.sheet.kind === p.crm.kind),
    statusDiffers: pairs.filter((p) => p.sheet.kind !== p.crm.kind),
    sourceDiffers: pairs.filter((p) => !sameSource(p.sheet.source, p.crm)),
    onlySheet: rest.onlySheet,
    onlyCrm: rest.onlyCrm,
  };
}

// ─── The variance log's rows ──────────────────────────────────────────────────

export type VarianceKind = "total" | "unbucketed" | "status" | "onlySheet" | "onlyCrm" | "source" | "sync";
export type VarianceRow = { kind: VarianceKind; itemKey: string; name: string; detail: string };

/** What the comparison needs from the Digital Marketing Report: its GBP/SEO rows and its sign-ups. */
export type ReportForSheet = {
  team: ({ group: string } & Partial<Record<SheetColumn, number | null>>)[];
  signups: (CrmSignup & { group: string })[];
};
/** Why a name only on the sheet is missing from Lead Docket's sign-ups (server/sheetNames.ts). */
export type NameReason = { fix: "leaddocket" | "sheet" | "check"; reason: string };

const FIX_LABEL: Record<NameReason["fix"], string> = { leaddocket: "Fix in Lead Docket", sheet: "Fix the sheet", check: "Check" };
const count = (n: number) => n.toLocaleString("en-US");
const kindWord = (k: SignupKind) => (k === "inHouse" ? "in-house" : "referred out");

/**
 * The sheet's team rows beside the report's numbers for them: GBP, SEO, and
 * Ads when the sheet has an Ads row (the sign-up sheet does; a daily tab
 * doesn't), then TOTAL over those same groups.
 */
export function sheetTeamRows(sheet: ParsedSheet, report: ReportForSheet) {
  const withAds = sheet.team.Ads !== undefined;
  const groups = (withAds ? ["GBP", "SEO", "Ads"] : ["GBP", "SEO"]).map((g) => report.team.find((r) => r.group === g));
  const [gbp, seo, ads] = groups;
  const val = (r: (typeof groups)[number], k: SheetColumn) => (r?.[k] ?? null) as number | null;
  const both = (k: SheetColumn) => {
    if (k === "conversion") {
      const l = groups.reduce((n, r) => n + (val(r, "leads") ?? 0), 0);
      return l ? Math.round((groups.reduce((n, r) => n + (val(r, "signed") ?? 0), 0) / l) * 1000) / 10 : null;
    }
    const vs = groups.map((r) => val(r, k));
    return vs.some((v) => v == null) ? null : Math.round(vs.reduce<number>((n, v) => n + (v ?? 0), 0) * 10) / 10;
  };
  return [
    ["GBP", sheet.team.GBP, (k: SheetColumn) => val(gbp, k)],
    ["SEO / Website", sheet.team.SEO, (k: SheetColumn) => val(seo, k)],
    ...(withAds ? [["Ads", sheet.team.Ads ?? null, (k: SheetColumn) => val(ads, k)]] : []),
    [withAds ? "TOTAL (GBP + SEO + Ads)" : "TOTAL (GBP + SEO)", sheet.team.TOTAL, both],
  ] as [string, SheetTeamRow | null, (k: SheetColumn) => number | null][];
}

/**
 * Every difference between a day's sheet tab and the report, as the variance
 * log stores them. Shared by the Audit tab (an uploaded file) and the
 * scheduled marketing-sheet sync (server/marketingSheetSync.ts), so both log
 * the same differences in the same words.
 */
/** Lead Docket's sign-ups the sheet is matched against: a daily tab has no Ads row, so not Ads there. */
export function comparedSignups<C extends { group: string }>(sheet: ParsedSheet, report: { signups: C[] }): C[] {
  return sheet.team.Ads !== undefined ? report.signups : report.signups.filter((s) => s.group !== "Ads");
}

export function sheetVariances(
  sheet: ParsedSheet,
  report: ReportForSheet,
  opts: { explained?: Map<string, NameReason> | null; staleSync?: { lastSuccessAt: string | null; state: string } | null } = {},
): VarianceRow[] {
  const rows = sheetTeamRows(sheet, report);
  const audit = auditSignups(sheet, comparedSignups(sheet, report));
  const items: VarianceRow[] = [];
  for (const [name, s, crmOf] of rows) {
    for (const [k, , label] of SHEET_COLUMNS) {
      if (k === "conversion" || k === "target") continue;
      const a = s?.[k] ?? null, b = crmOf(k);
      if (a != null && b != null && a !== b) items.push({ kind: "total", itemKey: `${name}|${k}`, name: `${name} — ${label}`, detail: `Sheet ${count(a)} · Lead Docket ${count(b)}` });
    }
  }
  for (const [name, s] of rows) {
    const n = unbucketed(s);
    if (n != null && n !== 0) items.push({ kind: "unbucketed", itemKey: name, name, detail: n > 0 ? `${n} lead(s) in no status column on the sheet` : `Status columns hold ${-n} more than Total Leads` });
  }
  for (const b of audit.statusDiffers) items.push({ kind: "status", itemKey: nameKey(b.crm.name), name: b.crm.name, detail: `Sheet: ${kindWord(b.sheet.kind)} · Lead Docket: ${kindWord(b.crm.kind)}` });
  for (const s of audit.onlySheet) {
    const why = opts.explained?.get(s.name);
    items.push({ kind: "onlySheet", itemKey: nameKey(s.name), name: s.name, detail: why ? `${FIX_LABEL[why.fix]}: ${why.reason}` : `${kindWord(s.kind)} on the sheet; not found among Lead Docket's sign-ups` });
  }
  for (const c of audit.onlyCrm) items.push({ kind: "onlyCrm", itemKey: nameKey(c.name), name: c.name, detail: `${c.label} · ${kindWord(c.kind)} in Lead Docket; missing from the sheet` });
  for (const b of audit.sourceDiffers) items.push({ kind: "source", itemKey: nameKey(b.crm.name), name: b.crm.name, detail: `Sheet: ${b.sheet.source} · Lead Docket: ${b.crm.label}` });
  const st = opts.staleSync;
  if (st) items.push({ kind: "sync", itemKey: "leaddocket", name: "Lead Docket sync", detail: `Last synced ${st.lastSuccessAt ?? "never"} (${st.state})` });
  return items;
}

// ─── The FLF sign-up sheet (one row per sign-up, a "Current Month" tab) ───────

/** The sign-up sheet's tab: the team keeps the month's sign-ups on one tab. */
export const SIGNUP_LOG_TAB = "Current Month";

/**
 * Which digital group a sign-up's Source belongs to, or null when it isn't
 * digital marketing — by the Digital Marketing Report's own rules
 * (digitalGroupOf in shared/marketing.ts), so the sheet and Lead Docket are
 * counted the same way: GMB → GBP; JFJ Website, Intaker - JFJ, Yelp and the
 * JFJ brand sites (Ayuda California, Motorcyclist Attorney…) → SEO / Website;
 * Facebook and Instagram → Ads. Walker, referrals and the FR/BDR reps aren't
 * digital. The sheet's Source column decides; its Lead Source is read only
 * when Source is blank, since a rep's row can name any facility there.
 */
export function signupLogGroup(source: Cell, leadSource: Cell): DigitalGroup | null {
  const name = text(source) || text(leadSource);
  if (!name) return null;
  const g = digitalGroupOf(name);
  if (g) return g.group;
  // The sheet's short name for the firm's main site, which Lead Docket spells out ("Justin For Justice").
  return /\bjfj\b/i.test(name) ? "SEO" : null;
}

/** A sheet date — an Excel day serial, or text like 11/2/2026 or 2026-11-02 — as YYYY-MM-DD; null when unreadable. */
export function sheetDay(v: Cell): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel's day 0 is 1899-12-30; the time of day (a fraction) is dropped.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  }
  const t = text(v);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/**
 * The sign-up sheet read into the same shape as a daily tab, so the same
 * comparison runs on it: its digital sign-ups (GBP, SEO and Ads — see signupLogGroup) (Lead Outcome "Signed" is
 * in-house, "Referred out" referred out), dated within the range when one is
 * given, and the sign-up counts per group. It has no lead totals, so only the
 * sign-up columns are compared (the others stay empty and are skipped).
 * Returns null when the rows aren't this sheet (no Lead Outcome / Client's Name header).
 */
export function parseSignupLog(rows: Cell[][], range?: { fromDay: string; toDay: string }): ParsedSheet | null {
  const head = findRow(rows, (k) => k === "leadoutcome");
  if (head < 0) return null;
  const cols = (rows[head] ?? []).map(key);
  const col = (...ks: string[]) => cols.findIndex((c) => ks.includes(c));
  const c = {
    source: col("source"), leadSource: col("leadsource"), day: col("signupdate"), outcome: col("leadoutcome"),
    name: col("clientsname", "clientname"), value: col("value"), type: cols.findIndex((k) => k.startsWith("casetype")),
  };
  if (c.name < 0 || c.source < 0) return null;

  const inHouse: SheetSignup[] = [], referred: SheetSignup[] = [];
  const counts = { GBP: { signedInHouse: 0, signedReferred: 0 }, SEO: { signedInHouse: 0, signedReferred: 0 }, Ads: { signedInHouse: 0, signedReferred: 0 } };
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = text(r[c.name]);
    const outcome = key(r[c.outcome]);
    if (!name || !outcome) continue;   // the sheet's blank case-group rows
    const group = signupLogGroup(r[c.source], c.leadSource >= 0 ? r[c.leadSource] : null);
    if (!group) continue;
    if (range && c.day >= 0) {
      const day = sheetDay(r[c.day]);
      if (!day || day < range.fromDay || day > range.toDay) continue;
    }
    const s: SheetSignup = {
      name, source: text(c.leadSource >= 0 ? r[c.leadSource] : r[c.source]) || text(r[c.source]),
      caseValue: c.value >= 0 ? text(r[c.value]) : "", caseType: c.type >= 0 ? text(r[c.type]) : "",
    };
    if (outcome.startsWith("referred")) { referred.push(s); counts[group].signedReferred++; }
    else if (outcome.startsWith("signed")) { inHouse.push(s); counts[group].signedInHouse++; }
  }
  const row = (g: { signedInHouse: number; signedReferred: number }): SheetTeamRow =>
    ({ signedInHouse: g.signedInHouse, signedReferred: g.signedReferred, signed: g.signedInHouse + g.signedReferred });
  const groups = [counts.GBP, counts.SEO, counts.Ads];
  const total = { signedInHouse: groups.reduce((n, g) => n + g.signedInHouse, 0), signedReferred: groups.reduce((n, g) => n + g.signedReferred, 0) };
  return {
    team: { GBP: row(counts.GBP), SEO: row(counts.SEO), Ads: row(counts.Ads), TOTAL: row(total) },
    inHouse, referred,
    found: { team: true, inHouse: true, referred: true },
  };
}

/**
 * One sign-up on the FLF sign-up sheet, for the Digital Marketing Report's
 * "Sign-up sheet" tab. Phone and email are never read. `facts` holds the
 * intake case facts — the hard wall in CLAUDE.md — which the server sends
 * only to those allowed them (marketingCaseFacts).
 */
export type SignupSheetRow = {
  day: string | null; source: string; leadSource: string; group: DigitalGroup | null;
  intaker: string; signedUpBy: string; outcome: string; clientName: string;
  value: string; tier: string; caseType: string; referralStatus: string; caseNumber: string;
  facts: {
    liability: string; language: string; erVisit: string; firstMedical: string | null; sentTo: string;
    caseManager: string; investigator: string; referredAttorney: string; referralFee: string; activeStatus: string;
  } | null;
};

/** Every sign-up on the sheet's tab (blank case-group rows skipped), in sheet order. Null when the rows aren't this sheet. */
export function readSignupSheet(rows: Cell[][]): SignupSheetRow[] | null {
  const head = findRow(rows, (k) => k === "leadoutcome");
  if (head < 0) return null;
  const cols = (rows[head] ?? []).map(key);
  // A column by its header: exact, or for long headers ("Case Type (Slip, Auto, …)") the start of it.
  const at = (exact: string, starts = false) => cols.findIndex((c) => (starts ? c.startsWith(exact) : c === exact));
  const c = {
    source: at("source"), leadSource: at("leadsource"), day: at("signupdate"), intaker: at("nameofpersonconductingintake", true),
    signedUpBy: at("signedupby"), outcome: at("leadoutcome"), name: at("clientsname"), value: at("value"), tier: at("tier"),
    caseType: at("casetype", true), referralStatus: at("signedcasesreferralstatus", true), caseNumber: at("casenumber"),
    liability: at("acceptedordisputedliability", true), language: at("language"), erVisit: at("erucvisit", true),
    firstMedical: at("timetofirstmedical", true), sentTo: at("facilitynameuc", true), caseManager: at("cmassigned"),
    investigator: at("pdinvestigatorassigned", true), referredAttorney: at("referredattorney"), referralFee: at("referralfee"),
    activeStatus: at("activestatus"),
  };
  if (c.name < 0 || c.outcome < 0) return null;
  const get = (r: Cell[], i: number) => (i >= 0 ? text(r[i]) : "");
  const out: SignupSheetRow[] = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const clientName = get(r, c.name), outcome = get(r, c.outcome);
    if (!clientName || !outcome) continue;
    const fee = c.referralFee >= 0 ? r[c.referralFee] : null;
    out.push({
      day: c.day >= 0 ? sheetDay(r[c.day]) : null,
      source: get(r, c.source), leadSource: get(r, c.leadSource),
      group: signupLogGroup(r[c.source], c.leadSource >= 0 ? r[c.leadSource] : null),
      intaker: get(r, c.intaker), signedUpBy: get(r, c.signedUpBy), outcome, clientName,
      value: get(r, c.value), tier: get(r, c.tier), caseType: get(r, c.caseType),
      referralStatus: get(r, c.referralStatus), caseNumber: get(r, c.caseNumber),
      facts: {
        liability: get(r, c.liability), language: get(r, c.language), erVisit: get(r, c.erVisit),
        firstMedical: c.firstMedical >= 0 ? sheetDay(r[c.firstMedical]) : null, sentTo: get(r, c.sentTo),
        caseManager: get(r, c.caseManager), investigator: get(r, c.investigator), referredAttorney: get(r, c.referredAttorney),
        // A fraction on the sheet (0.33) is a percentage.
        referralFee: typeof fee === "number" && fee > 0 && fee < 1 ? `${Math.round(fee * 100)}%` : get(r, c.referralFee),
        activeStatus: get(r, c.activeStatus),
      },
    });
  }
  return out;
}
