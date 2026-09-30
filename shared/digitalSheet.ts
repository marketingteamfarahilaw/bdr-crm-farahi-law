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
  team: { GBP: SheetTeamRow | null; SEO: SheetTeamRow | null; TOTAL: SheetTeamRow | null };
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
