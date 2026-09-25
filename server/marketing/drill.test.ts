import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { NOT_VIABLE_KEYS, NO_SOURCE, REASON_KEYS, clean, derive, keyOf } from "./common";
import { reasonOf } from "./reasons";
import {
  EXPORT_HEAD, NO_REASON, classifyTriples, csvCell, exportCells, hasOutcomeFilter, keepsTriple, scopeWhere, toCsv,
  toListRow, tripleChoice, tripleWhere, whyOf, type ExportRow, type Triple,
} from "./leadFilter";

// A small seeded generator, so a failure reproduces.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const OUTCOMES = [
  "Signed", "signed", "Signed Referred Out", "Referral Accepted", "Referred Out", "Rejected", "Rejected - PD Leads Only",
  "Lost", "Closed", "Not Interested", "Open", "Under Review", "Chase", null, "",
];
const STATUSES = ["Rejected", "Lost", "Referred", "Signed Up", "Chase", "Under Review", null, ""];
const SUBS = [
  "At Fault", "at fault", " At  fault ", "No Injuries", "Hired Another Attorney", "SOL", "Spam", "Wrong Number",
  "Med Mal", "No Longer Interested", "Something new", null, "", "   ",
];
const SOURCES = ["Walker Advertising Contract 26", "Walker Advertising Contract 31", "Web Search", "GMB Visalia", null, ""];

type Synthetic = { leadDate: Date; outcome: string | null; status: string | null; subStatus: string | null; marketingSource: string | null };

function synthetic(n: number, seed = 7): Synthetic[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  return Array.from({ length: n }, () => ({
    leadDate: new Date(Date.UTC(2026, 7 + Math.floor(r() * 2), 1 + Math.floor(r() * 27), 18)),
    outcome: pick(OUTCOMES), status: pick(STATUSES), subStatus: pick(SUBS), marketingSource: pick(SOURCES),
  }));
}

/** What SQL's GROUP BY outcome, status, subStatus returns for these rows (case-sensitive, as TiDB). */
function groupBy(rows: Synthetic[]): Triple[] {
  const by = new Map<string, Triple>();
  for (const l of rows) {
    const k = JSON.stringify([l.outcome, l.status, l.subStatus]);
    const t = by.get(k) ?? { outcome: l.outcome, status: l.status, subStatus: l.subStatus, n: 0 };
    t.n++;
    by.set(k, t);
  }
  return Array.from(by.values());
}

describe("the triple classifier", () => {
  it("filters by signed, not signed and all", () => {
    const signed = { outcome: "Signed", status: "Signed Up", subStatus: null };
    const lost = { outcome: "Lost", status: "Lost", subStatus: "Hired Another Attorney" };
    expect(keepsTriple(signed, { status: "signed" })).toBe(true);
    expect(keepsTriple(lost, { status: "signed" })).toBe(false);
    expect(keepsTriple(signed, { status: "open" })).toBe(false);
    expect(keepsTriple(lost, { status: "open" })).toBe(true);
    expect(keepsTriple(signed, { status: "all" })).toBe(true);
    expect(keepsTriple(lost, { status: "all" })).toBe(true);
  });

  it("filters by scorecard column, with Lost and Closed in Rejected", () => {
    expect(keepsTriple({ outcome: "Lost", status: null, subStatus: null }, { status: "all", bucket: "rejected" })).toBe(true);
    expect(keepsTriple({ outcome: "Closed", status: null, subStatus: null }, { status: "all", bucket: "rejected" })).toBe(true);
    expect(keepsTriple({ outcome: "Signed Referred Out", status: null, subStatus: null }, { status: "all", bucket: "signedReferred" })).toBe(true);
    expect(keepsTriple({ outcome: "Signed Referred Out", status: null, subStatus: null }, { status: "all", bucket: "signedInHouse" })).toBe(false);
    // A bucket and a status that can't both hold keep nothing.
    expect(keepsTriple({ outcome: "Signed", status: null, subStatus: null }, { status: "open", bucket: "signedInHouse" })).toBe(false);
  });

  it("treats a missing outcome as an open, unsigned lead", () => {
    const t = { outcome: null, status: null, subStatus: null };
    expect(keepsTriple(t, { status: "all", bucket: "open" })).toBe(true);
    expect(keepsTriple(t, { status: "open" })).toBe(true);
    expect(keepsTriple(t, { status: "signed" })).toBe(false);
    expect(keepsTriple(t, { status: "all", reasons: ["open"] })).toBe(true);
    expect(keepsTriple(t, { status: "all", reasons: ["signed"] })).toBe(false);
  });

  it("filters by reason family with the dashboard's reasonOf", () => {
    expect(keepsTriple({ outcome: "Referred Out", status: "Referred", subStatus: null }, { status: "all", reasons: ["referred"] })).toBe(true);
    expect(keepsTriple({ outcome: "Not Interested", status: null, subStatus: null }, { status: "all", reasons: ["lostThem"] })).toBe(true);
    expect(keepsTriple({ outcome: "Signed", status: null, subStatus: "At fault" }, { status: "all", reasons: ["noClaim"] })).toBe(false);
    // Rejected leads go wherever reasonOf sends them, and nowhere else.
    for (const sub of SUBS) {
      const t = { outcome: "Rejected", status: "Rejected", subStatus: sub };
      const family = reasonOf("rejected", t.status, t.subStatus);
      for (const k of REASON_KEYS) expect(keepsTriple(t, { status: "all", reasons: [k] })).toBe(k === family);
    }
  });

  it("matches a sub-status ignoring case and spacing, and 'No reason recorded' as empty", () => {
    const q = { status: "all" as const, subStatus: "at fault" };
    expect(keepsTriple({ outcome: "Rejected", status: "Rejected", subStatus: "At Fault" }, q)).toBe(true);
    expect(keepsTriple({ outcome: "Rejected", status: "Rejected", subStatus: " At  fault " }, q)).toBe(true);
    expect(keepsTriple({ outcome: "Rejected", status: "Rejected", subStatus: "At fault, no injuries" }, q)).toBe(false);
    expect(keepsTriple({ outcome: "Rejected", status: "Rejected", subStatus: null }, q)).toBe(false);
    // The Why panel asks for "No reason recorded" as '' — that must narrow to the empty ones, not to nothing.
    for (const asked of [NO_REASON, "", "  "]) {
      const none = { status: "all" as const, subStatus: asked };
      expect(keepsTriple({ outcome: "Lost", status: "Lost", subStatus: null }, none)).toBe(true);
      expect(keepsTriple({ outcome: "Lost", status: "Lost", subStatus: "  " }, none)).toBe(true);
      expect(keepsTriple({ outcome: "Lost", status: "Lost", subStatus: "SOL" }, none)).toBe(false);
    }
    // No sub-status asked for keeps every one.
    expect(keepsTriple({ outcome: "Lost", status: "Lost", subStatus: "SOL" }, { status: "all" })).toBe(true);
  });

  it("knows when nothing narrows by outcome", () => {
    expect(hasOutcomeFilter({ status: "all" })).toBe(false);
    expect(hasOutcomeFilter({ status: "all", reasons: [] })).toBe(false);
    expect(hasOutcomeFilter({ status: "open" })).toBe(true);
    expect(hasOutcomeFilter({ status: "all", bucket: "open" })).toBe(true);
    expect(hasOutcomeFilter({ status: "all", reasons: ["junk"] })).toBe(true);
    expect(hasOutcomeFilter({ status: "all", subStatus: "SOL" })).toBe(true);
    expect(hasOutcomeFilter({ status: "all", subStatus: "" })).toBe(true);
  });

  it("returns nothing for no data", () => {
    expect(classifyTriples([], { status: "all" }, true)).toEqual({ kept: [], total: 0, why: [] });
    expect(classifyTriples([], { status: "signed", bucket: "rejected" })).toEqual({ kept: [], total: 0, why: null });
  });
});

describe("reconciliation with the scorecard", () => {
  const rows = synthetic(3000);
  const groups = groupBy(rows);
  // The dashboard classifies each lead through derive(); the drill classifies the groups.
  const leads = derive(rows, ["2026-08", "2026-09"], "channel");
  const count = (f: (l: (typeof leads)[number]) => boolean) => leads.filter(f).length;
  const drill = (q: Parameters<typeof classifyTriples>[1]) => classifyTriples(groups, q).total;

  it("every scorecard column's drill equals the column", () => {
    const buckets = ["open", "rejected", "referredOut", "notInterested", "signedReferred", "signedInHouse"] as const;
    let sum = 0;
    for (const b of buckets) {
      const n = drill({ status: "all", bucket: b });
      expect(n).toBe(count((l) => l.bucket === b));
      sum += n;
    }
    expect(sum).toBe(leads.length);
    expect(drill({ status: "all" })).toBe(leads.length);
  });

  it("Total Signed and not signed add back to Total Leads", () => {
    const signed = drill({ status: "signed" });
    expect(signed).toBe(count((l) => l.signed));
    expect(signed + drill({ status: "open" })).toBe(leads.length);
    expect(drill({ status: "signed", bucket: "signedReferred" }) + drill({ status: "signed", bucket: "signedInHouse" })).toBe(signed);
  });

  it("reason families partition the leads, as the Why panel counts them", () => {
    let sum = 0;
    for (const k of REASON_KEYS) {
      const n = drill({ status: "all", reasons: [k] });
      expect(n).toBe(count((l) => reasonOf(l.bucket, l.status, l.subStatus) === k));
      sum += n;
    }
    expect(sum).toBe(leads.length);
    expect(drill({ status: "all", reasons: NOT_VIABLE_KEYS }))
      .toBe(count((l) => NOT_VIABLE_KEYS.includes(reasonOf(l.bucket, l.status, l.subStatus))));
  });

  it("a sub-status drill equals the leads with that reason", () => {
    expect(drill({ status: "all", subStatus: "At Fault" })).toBe(count((l) => keyOf(clean(l.subStatus)) === "at fault"));
    expect(drill({ status: "all", subStatus: NO_REASON })).toBe(count((l) => !clean(l.subStatus)));
    expect(drill({ status: "all", subStatus: "" })).toBe(count((l) => !clean(l.subStatus)));
  });

  it("each Why-panel reason bar's drill (sub-status + family) equals the bar", () => {
    // How server/marketing/reasons.ts counts a Top reason: family | keyOf(clean(sub-status) or NO_REASON).
    const bars = new Map<string, { reason: string; family: (typeof REASON_KEYS)[number]; n: number }>();
    for (const l of leads) {
      const family = reasonOf(l.bucket, l.status, l.subStatus);
      const reason = clean(l.subStatus) || NO_REASON;
      const k = family + "|" + keyOf(reason);
      const b = bars.get(k) ?? { reason, family, n: 0 };
      b.n++;
      bars.set(k, b);
    }
    bars.forEach((b) => {
      // WhyNotSigned.tsx sends '' for "No reason recorded".
      const subStatus = b.reason === NO_REASON ? "" : b.reason;
      expect(drill({ status: "all", subStatus, reasons: [b.family] })).toBe(b.n);
    });
  });

  it("a month-less scope over no data, and a filter nothing meets, both give zero", () => {
    expect(classifyTriples([], { status: "all", bucket: "open" }).total).toBe(0);
    expect(drill({ status: "open", bucket: "signedInHouse" })).toBe(0);
    expect(drill({ status: "all", subStatus: "No such reason" })).toBe(0);
  });

  it("the reasons block covers exactly the unsigned leads", () => {
    const all = whyOf(groups, Infinity);
    expect(all.reduce((a, w) => a + w.n, 0)).toBe(count((l) => !l.signed));
    expect(whyOf(groups)).toHaveLength(Math.min(8, all.length));
    expect(all.every((w, i) => i === 0 || all[i - 1].n >= w.n)).toBe(true);
  });
});

describe("whyOf", () => {
  it("merges spellings, keeps families apart, skips signed and names the empty reason", () => {
    const why = whyOf([
      { outcome: "Rejected", status: "Rejected", subStatus: "At Fault", n: 5 },
      { outcome: "Rejected", status: "Rejected", subStatus: "at fault", n: 2 },
      { outcome: "Signed", status: "Signed Up", subStatus: "At Fault", n: 9 },
      { outcome: "Open", status: "Chase", subStatus: null, n: 3 },
      { outcome: "Open", status: "Chase", subStatus: "", n: 1 },
      { outcome: "Referred Out", status: "Referred", subStatus: "At Fault", n: 1 },
    ]);
    const fault = why.filter((w) => keyOf(w.reason) === "at fault");
    expect(fault.find((w) => w.family === reasonOf("rejected", "Rejected", "At Fault"))).toMatchObject({ reason: "At Fault", n: 7 });
    expect(fault.find((w) => w.family === "referred")).toMatchObject({ n: 1 });
    expect(why.find((w) => w.reason === NO_REASON)).toEqual({ reason: NO_REASON, family: "open", n: 4 });
    expect(why.reduce((a, w) => a + w.n, 0)).toBe(12);
  });
});

describe("tripleChoice", () => {
  const all: Triple[] = Array.from({ length: 5 }, (_, i) => ({ outcome: `o${i}`, status: null, subStatus: null, n: 1 }));

  it("adds nothing when every group is kept", () => {
    expect(tripleChoice(all, all)).toBeNull();
  });

  it("lists whichever side is shorter", () => {
    expect(tripleChoice([all[0]], all)).toEqual({ not: false, triples: [all[0]] });
    expect(tripleChoice(all.slice(1), all)).toEqual({ not: true, triples: [all[0]] });
  });

  it("matches groups null-safely", () => {
    const dialect = new MySqlDialect();
    expect(tripleWhere(all, all)).toBeUndefined();
    const keep = dialect.sqlToQuery(tripleWhere([all[0]], all)!);
    expect(keep.sql).toBe("((`leaddocket_leads`.`outcome` <=> ? AND `leaddocket_leads`.`status` <=> ? AND `leaddocket_leads`.`subStatus` <=> ?))");
    expect(keep.params).toEqual(["o0", null, null]);
    expect(dialect.sqlToQuery(tripleWhere(all.slice(1), all)!).sql.startsWith("NOT ((")).toBe(true);
  });
});

describe("scopeWhere", () => {
  const dialect = new MySqlDialect();
  const range = { from: new Date("2026-09-01T07:00:00Z"), to: new Date("2026-09-25T06:59:59Z") };
  const render = (q: Parameters<typeof scopeWhere>[0]) => dialect.sqlToQuery(scopeWhere(q));
  const col = (c: string) => "`leaddocket_leads`.`" + c + "`";

  it("searches case-insensitively and treats % and _ literally", () => {
    const { sql, params } = render({ ...range, search: "  GARCIA " });
    expect(sql).toContain(`LOWER(${col("clientName")}) LIKE ?`);
    expect(sql).toContain(`LOWER(${col("subStatus")}) LIKE ?`);
    expect(sql).toContain(`LOWER(${col("contactSource")}) LIKE ?`);
    expect(params).toContain("%garcia%");
    expect(render({ ...range, search: "50%_off" }).params).toContain("%50\\%\\_off%");
  });

  it("matches No source as NULL or blank", () => {
    expect(render({ ...range, source: NO_SOURCE }).sql).toContain(`(${col("marketingSource")} IS NULL OR TRIM(${col("marketingSource")}) = '')`);
  });

  it("reads '' in a list as NULL or blank", () => {
    const { sql, params } = render({ ...range, contactSources: ["Web Chat", ""] });
    expect(sql).toContain(`TRIM(${col("contactSource")}) in (?)`);
    expect(sql).toContain(`${col("contactSource")} IS NULL OR TRIM(${col("contactSource")}) = ''`);
    expect(params).toContain("Web Chat");
  });

  it("keeps NULL case types in 'All other' unless '' is listed", () => {
    const without = render({ ...range, notCaseTypes: ["Auto Accident"] }).sql;
    expect(without).toContain(`${col("caseType")} IS NULL)`);
    expect(without).not.toContain("IS NOT NULL");
    const withBlank = render({ ...range, notCaseTypes: ["Auto Accident", ""] }).sql;
    expect(withBlank).toContain(`(${col("caseType")} IS NOT NULL AND TRIM(${col("caseType")}) <> '')`);
    expect(render({ ...range, notCaseTypes: [""] }).sql).not.toContain("not in");
  });

  it("ignores empty lists", () => {
    expect(render({ ...range, sources: [], caseTypes: [], campaigns: [] }).sql).toBe(render(range).sql);
  });

  it("adds the Pacific month", () => {
    const { params } = render({ ...range, month: "2026-09" });
    // drizzle hands timestamps to the driver as UTC text.
    expect(params).toEqual(expect.arrayContaining(["2026-09-01 07:00:00.000", "2026-10-01 07:00:00.000"]));
  });
});

describe("csvCell", () => {
  it("quotes and escapes", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
  });

  it("defuses formulas", () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s)).toBe(`"'${s}"`);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("x=1")).toBe('"x=1"');
  });
});

describe("the export file", () => {
  const base: ExportRow = {
    leadId: 101, clientName: "  Maria  Garcia ", createdDate: new Date("2026-09-01T06:30:00Z"), signedUpDate: null,
    leadDate: new Date("2026-09-01T06:30:00Z"), marketingSource: "Walker Advertising Contract 26", contactSource: "Web Chat",
    campaign: null, caseType: "Auto Accident", status: "Lost", subStatus: "Hired Another Attorney", outcome: "Lost",
    city: "Fresno", county: "Fresno", state: "CA", intakeBy: "Malvin Rosales",
  };

  it("writes dates in Pacific time and names the channel and column", () => {
    const cells = exportCells(base);
    expect(cells).toHaveLength(EXPORT_HEAD.length);
    expect(cells).toEqual([
      101, "Maria Garcia", "2026-08-31 23:30", "", "2026-08", "Walker Advertising Contract 26", "Walker Advertising", "Web Chat",
      "", "Auto Accident", "Lost", "Hired Another Attorney", "Rejected", "Fresno", "Fresno", "CA", "Malvin Rosales",
    ]);
  });

  it("falls back to the lead date for a missing sign-up or came-in date", () => {
    const signed = exportCells({ ...base, outcome: "Signed", createdDate: null, leadDate: new Date("2026-09-03T20:00:00Z") });
    expect(signed[2]).toBe("");
    expect(signed[3]).toBe("2026-09-03");
    expect(signed[12]).toBe("Signed In-House");
    const open = exportCells({ ...base, outcome: null, createdDate: null, marketingSource: " " });
    expect(open[2]).toBe("2026-08-31 23:30");
    expect(open[5]).toBe(NO_SOURCE);
    expect(open[6]).toBe(NO_SOURCE);
    expect(open[12]).toBe("Open");
  });

  it("starts with a BOM and a header, and defuses formulas in names", () => {
    const csv = toCsv([{ ...base, clientName: "=cmd|' /C calc'!A0" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [head, row, end] = csv.slice(1).split("\r\n");
    expect(head).toBe(EXPORT_HEAD.map((h) => `"${h}"`).join(","));
    expect(row.startsWith(`"101","'=cmd|' /C calc'!A0",`)).toBe(true);
    expect(end).toBe("");
  });

  it("is just the header when there are no rows", () => {
    expect(toCsv([]).slice(1).split("\r\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("toListRow", () => {
  it("fills the gaps the way the page shows them", () => {
    const r = toListRow({
      leadId: 5, clientName: null, caseType: " ", marketingSource: null, campaign: "", contactSource: null,
      leadDate: new Date("2026-09-02T17:00:00Z"), createdDate: null, signedUpDate: null, outcome: "Rejected",
      status: "Rejected", subStatus: " At fault ", city: null, intakeBy: null,
    });
    expect(r).toMatchObject({
      id: 5, name: "Lead 5", caseType: "Not recorded", source: NO_SOURCE, campaign: null, contact: null,
      date: "2026-09-02T17:00:00.000Z", createdAt: null, signedAt: null, reason: "At fault", signed: false,
    });
  });
});
