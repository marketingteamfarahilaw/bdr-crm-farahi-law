/**
 * The Data audit as a styled Excel workbook (Youssef, 2026-10-08: "a premium
 * Excel file that looks like the report itself … export anything, or export
 * all with all the data and charts", with the period and its comparison).
 *
 * ExcelJS lays out and styles the sheets; the charts are real Excel charts
 * (DrawingML), added to the file afterwards because ExcelJS can't write them.
 * They read the Overview's own tables, so a number changed in Excel moves its
 * bar. Everything is imported only when someone exports.
 *
 * The workbook names clients, so its sheets say they're internal — as the page
 * itself, which only the BD/FR team (canSeeMarketing) opens.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { Workbook, Worksheet, Row, Fill } from "exceljs";
import type { AppRouter } from "../../../../server/routers";
import { DIGITAL_GROUP_LABEL, DIGITAL_GROUPS, MERCH } from "@shared/marketing";

type Out = inferRouterOutputs<AppRouter>["marketing"];
export type AuditData = NonNullable<Out["digitalAudit"]>;
export type Directory = NonNullable<Out["sourceDirectory"]>;

export const EXPORT_PARTS = [
  ["overview", "Overview & charts"],
  ["possiblyDigital", "Possibly digital"],
  ["possiblyNotDigital", "Possibly not digital"],
  ["tollFree", "Toll-free line"],
  ["teamCampaigns", "BD/FR leads on a campaign"],
  ["names", "Source names"],
  ["directory", "Sources directory"],
] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number][0];

export type AuditExport = {
  data: AuditData;
  directory: Directory | null;
  parts: ExportPart[];
  /** "Sep 1 – 30, 2026", "the last 12 months"… */
  period: string;
  /** The comparison period's words, when one is on. */
  compareLabel: string | null;
};

// The report's palette (Digital.css / index.css): charcoal, sun, warm greys on paper.
const C = { char: "262626", ink: "1C1C1C", ink2: "3A3A38", mute: "7B7A73", mute2: "A6A59E", sun: "F6CF4B", sunT: "FDF3CF", paper: "F4F3EF", line: "E4E2DA", ok: "2F7D4F", bad: "B4412F", white: "FFFFFF" };
const SERIF = "Georgia", SANS = "Calibri";
const fill = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + argb } });
const thin = { style: "thin" as const, color: { argb: "FF" + C.line } };

const groupName = (g: string | null) => (g && g in DIGITAL_GROUP_LABEL ? DIGITAL_GROUP_LABEL[g as keyof typeof DIGITAL_GROUP_LABEL] : g ?? "not digital");
const fmtN = (n: number) => n.toLocaleString("en-US");
const PT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
/** A lead's Pacific day as an Excel date (midnight UTC, so Excel shows that day wherever it's opened). */
const excelDay = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const [y, m, dd] = PT.format(d).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const DATE_FMT = "mmm d, yyyy";

// ── sheet furniture ──

/** The report's dark band: firm, title, period — and, where clients are named, the internal label. */
function banner(ws: Worksheet, cols: number, title: string, sub: string, names: boolean) {
  const band = (r: number, text: string, font: Partial<Row["font"]>, height: number, color = C.char) => {
    ws.mergeCells(r, 1, r, cols);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.font = font as any;
    cell.fill = fill(color);
    cell.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(r).height = height;
  };
  band(1, "FARAHI LAW  ·  MARKETING REPORT  ·  DATA AUDIT", { name: SANS, size: 9, bold: true, color: { argb: "FF" + C.sun } }, 22);
  band(2, title, { name: SERIF, size: 20, color: { argb: "FFFFFFFF" } }, 34);
  band(3, sub, { name: SANS, size: 10, color: { argb: "FFD9D8D2" } }, 20);
  if (names) band(4, "INTERNAL — contains client names. Lead Docket is the source of truth: fix a lead there and it moves here after the next sync.", { name: SANS, size: 9, bold: true, color: { argb: "FF" + C.ink } }, 18, C.sun);
  else band(4, "Lead Docket is the source of truth: fix a source there and it moves here after the next sync.", { name: SANS, size: 9, color: { argb: "FF" + C.ink2 } }, 18, C.paper);
}

function header(ws: Worksheet, r: number, labels: string[], numeric: Set<number> = new Set()) {
  const row = ws.getRow(r);
  labels.forEach((l, i) => {
    const cell = row.getCell(i + 1);
    cell.value = l;
    cell.font = { name: SANS, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(C.ink2);
    cell.alignment = { vertical: "middle", horizontal: numeric.has(i) ? "right" : "left", wrapText: true };
    cell.border = { bottom: thin };
  });
  row.height = 22;
}

function setup(ws: Worksheet, widths: number[], headerRow: number) {
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  ws.headerFooter = { oddFooter: "&L&8Farahi Law · Data audit&R&8Page &P of &N" };
}

const bodyFont = { name: SANS, size: 10, color: { argb: "FF" + C.ink } };
function styleBody(row: Row, cols: number, opts: { zebra?: boolean; numeric?: Set<number>; bold?: boolean; tint?: string; muted?: Set<number> } = {}) {
  for (let i = 1; i <= cols; i++) {
    const cell = row.getCell(i);
    const muted = opts.muted?.has(i - 1);
    cell.font = { ...bodyFont, bold: !!opts.bold, color: { argb: "FF" + (muted ? C.mute : C.ink) } };
    cell.border = { bottom: thin };
    cell.alignment = { vertical: "middle", horizontal: opts.numeric?.has(i - 1) ? "right" : "left" };
    if (opts.tint) cell.fill = fill(opts.tint);
    else if (opts.zebra) cell.fill = fill("FAFAF7");
  }
}

/** "▲ 4" / "▼ 2" / "no change" against the comparison. For these lists fewer is better, so up is red. */
function change(cur: number, prev: number | undefined) {
  if (prev == null) return { text: "", color: C.mute };
  const d = cur - prev;
  if (d === 0) return { text: "no change", color: C.mute };
  return { text: `${d > 0 ? "▲" : "▼"} ${fmtN(Math.abs(d))}${prev ? ` (${d > 0 ? "+" : "−"}${Math.round((Math.abs(d) / prev) * 100)}%)` : ""}`, color: d > 0 ? C.bad : C.ok };
}

// ── the overview, with its charts ──

type ChartSpec = {
  title: string;
  dir: "bar" | "col";
  stacked: boolean;
  cats: { col: number; r1: number; r2: number; values: string[] };
  series: { name: string; col: number; color: string; values: number[] }[];
  /** Where it sits: columns and rows, 0-based, from (inclusive) to (exclusive). */
  at: { c1: number; r1: number; c2: number; r2: number };
};

function overview(wb: Workbook, x: AuditExport): ChartSpec[] {
  const d = x.data, cmp = d.compare;
  const ws = wb.addWorksheet("Overview", { properties: { tabColor: { argb: "FF" + C.char } } });
  const COLS = 14;
  banner(ws, COLS, "Digital data audit", `${x.period}${x.compareLabel ? `  ·  compared with ${x.compareLabel}` : ""}  ·  exported ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, false);
  [2, 40, 13, 13, 15, 18, 2, 12, 12, 12, 12, 12, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const sum = (rows: { leads: number; signed: number }[]) => ({ leads: rows.reduce((a, r) => a + r.leads, 0), signed: rows.reduce((a, r) => a + r.signed, 0) });
  const panels = [
    { name: "Possibly digital", cur: sum(d.possiblyDigital), prev: cmp?.possiblyDigital },
    { name: "Possibly not digital", cur: sum(d.possiblyNotDigital), prev: cmp?.possiblyNotDigital },
    { name: "Toll-free line", cur: sum(d.tollFree), prev: cmp?.tollFree },
    { name: "BD/FR on a campaign", cur: sum(d.teamCampaigns), prev: cmp?.teamCampaigns },
  ];

  // KPI tiles, two columns each: label, big number, change.
  const tiles = [{ name: "Leads checked", cur: { leads: d.checked, signed: 0 }, prev: cmp ? { leads: cmp.checked, signed: 0 } : undefined, neutral: true }, ...panels];
  const tileCols = [[2, 2], [3, 4], [5, 6], [8, 10], [11, 13]];
  ws.getRow(6).height = 16; ws.getRow(7).height = 36; ws.getRow(8).height = 16; ws.getRow(9).height = 16;
  tiles.forEach((t, i) => {
    const [a, b] = tileCols[i];
    const put = (r: number, value: string | number, font: object, align: "left" = "left") => {
      if (b > a) ws.mergeCells(r, a, r, b);
      const cell = ws.getCell(r, a);
      cell.value = value;
      cell.font = font as any;
      cell.alignment = { vertical: "middle", horizontal: align, indent: 1 };
      for (let c = a; c <= b; c++) ws.getCell(r, c).fill = fill(C.paper);
    };
    const ch = change(t.cur.leads, t.prev?.leads);
    put(6, t.name.toUpperCase(), { name: SANS, size: 8, bold: true, color: { argb: "FF" + C.mute } });
    put(7, t.cur.leads, { name: SERIF, size: 24, color: { argb: "FF" + C.ink } });
    ws.getCell(7, a).numFmt = "#,##0";
    put(8, "neutral" in t ? `${x.compareLabel ? `vs ${fmtN(t.prev?.leads ?? 0)}` : "leads in the period"}` : `${fmtN(t.cur.signed)} signed`, { name: SANS, size: 9, color: { argb: "FF" + C.ink2 } });
    put(9, "neutral" in t ? "" : ch.text, { name: SANS, size: 9, bold: true, color: { argb: "FF" + ch.color } });
    for (let c = a; c <= b; c++) { ws.getCell(6, c).border = { top: { style: "medium", color: { argb: "FF" + C.char } } }; ws.getCell(9, c).border = { bottom: thin }; }
  });

  const charts: ChartSpec[] = [];
  let r = 12;
  const BLOCK = 18;
  /** A titled table in B..F with its chart in H..N beside it. */
  const block = (title: string, note: string, head: string[], rows: (string | number)[][], chart: (first: number, last: number) => Omit<ChartSpec, "at"> | null) => {
    ws.mergeCells(r, 2, r, 6);
    ws.getCell(r, 2).value = title;
    ws.getCell(r, 2).font = { name: SERIF, size: 14, color: { argb: "FF" + C.ink } };
    ws.getRow(r).height = 24;
    ws.mergeCells(r + 1, 2, r + 1, 6);
    ws.getCell(r + 1, 2).value = note;
    ws.getCell(r + 1, 2).font = { name: SANS, size: 9, italic: true, color: { argb: "FF" + C.mute } };
    ws.getCell(r + 1, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r + 1).height = 28;
    const h = r + 2;
    head.forEach((l, i) => {
      const cell = ws.getCell(h, 2 + i);
      cell.value = l;
      cell.font = { name: SANS, size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = fill(C.ink2);
      cell.alignment = { horizontal: i ? "right" : "left", vertical: "middle", wrapText: true };
    });
    ws.getRow(h).height = 26;
    rows.forEach((vals, j) => {
      const row = ws.getRow(h + 1 + j);
      vals.forEach((v, i) => { row.getCell(2 + i).value = v; if (typeof v === "number") row.getCell(2 + i).numFmt = "#,##0"; });
      for (let i = 0; i < head.length; i++) {
        const cell = row.getCell(2 + i);
        cell.font = { ...bodyFont, bold: i === 0 };
        cell.alignment = { horizontal: i ? "right" : "left", vertical: "middle" };
        cell.border = { bottom: thin };
        if (j % 2) cell.fill = fill("FAFAF7");
      }
    });
    if (!rows.length) {
      ws.getCell(h + 1, 2).value = "None in this period.";
      ws.getCell(h + 1, 2).font = { name: SANS, size: 10, italic: true, color: { argb: "FF" + C.mute } };
    }
    const spec = rows.length ? chart(h + 1, h + rows.length) : null;
    if (spec) charts.push({ ...spec, at: { c1: 7, r1: r - 1, c2: 14, r2: r - 1 + BLOCK - 1 } });
    r += Math.max(BLOCK, rows.length + 4);
    // Two tables and their charts to a printed page, so no chart is cut in half.
    if (++blocks % 2 === 0) ws.getRow(r - 1).addPageBreak();
  };
  let blocks = 0;
  const hasCmp = !!cmp;

  block("Flagged leads by section", hasCmp ? `This period against ${x.compareLabel}.` : "Leads in each list, and how many of them signed.",
    hasCmp ? ["Section", "This period", "Signed", x.compareLabel ?? "Before", "Change"] : ["Section", "Leads", "Signed", "Not signed"],
    panels.map((p) => hasCmp ? [p.name, p.cur.leads, p.cur.signed, p.prev?.leads ?? 0, change(p.cur.leads, p.prev?.leads).text] : [p.name, p.cur.leads, p.cur.signed, p.cur.leads - p.cur.signed]),
    (a, b) => ({
      title: "Flagged leads by section", dir: "bar", stacked: !hasCmp,
      cats: { col: 2, r1: a, r2: b, values: panels.map((p) => p.name) },
      series: hasCmp
        ? [{ name: "This period", col: 3, color: C.char, values: panels.map((p) => p.cur.leads) }, { name: x.compareLabel ?? "Before", col: 5, color: C.mute2, values: panels.map((p) => p.prev?.leads ?? 0) }]
        : [{ name: "Signed", col: 4, color: C.char, values: panels.map((p) => p.cur.signed) }, { name: "Not signed", col: 5, color: C.sun, values: panels.map((p) => p.cur.leads - p.cur.signed) }],
    }));

  const gain = DIGITAL_GROUPS.map((g) => ({ g, cur: d.wouldAdd.find((w) => w.group === g) ?? { leads: 0, signed: 0 }, prev: cmp?.wouldAdd.find((w) => w.group === g) }));
  block("If corrected, digital would gain", "Possibly-digital leads by the row they'd count in once their Marketing Source is fixed in Lead Docket.",
    hasCmp ? ["Row", "Leads", "Signed", x.compareLabel ?? "Before"] : ["Row", "Leads", "Signed"],
    gain.map((x2) => hasCmp ? [DIGITAL_GROUP_LABEL[x2.g], x2.cur.leads, x2.cur.signed, x2.prev?.leads ?? 0] : [DIGITAL_GROUP_LABEL[x2.g], x2.cur.leads, x2.cur.signed]),
    (a, b) => ({
      title: "If corrected, digital would gain", dir: "col", stacked: false,
      cats: { col: 2, r1: a, r2: b, values: gain.map((x2) => DIGITAL_GROUP_LABEL[x2.g]) },
      series: [
        { name: "Leads", col: 3, color: C.char, values: gain.map((x2) => x2.cur.leads) },
        { name: "Signed", col: 4, color: C.sun, values: gain.map((x2) => x2.cur.signed) },
        ...(hasCmp ? [{ name: x.compareLabel ?? "Before", col: 5, color: C.mute2, values: gain.map((x2) => x2.prev?.leads ?? 0) }] : []),
      ],
    }));

  const bySource = new Map<string, { leads: number; signed: number }>();
  for (const g of [...d.possiblyDigital, ...d.possiblyNotDigital, ...d.tollFree]) {
    const e = bySource.get(g.source) ?? { leads: 0, signed: 0 };
    e.leads += g.leads; e.signed += g.signed;
    bySource.set(g.source, e);
  }
  const top = Array.from(bySource, ([source, v]) => ({ source, ...v })).sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)).slice(0, 10);
  block("Marketing Sources most often flagged", "The ten Lead Docket Marketing Sources with the most leads across the three digital lists.",
    hasCmp ? ["Marketing Source", "Leads", "Signed", x.compareLabel ?? "Before"] : ["Marketing Source", "Leads", "Signed"],
    top.map((t) => hasCmp ? [t.source, t.leads, t.signed, cmp?.bySource[t.source] ?? 0] : [t.source, t.leads, t.signed]),
    (a, b) => ({
      title: "Marketing Sources most often flagged", dir: "bar", stacked: false,
      cats: { col: 2, r1: a, r2: b, values: top.map((t) => t.source) },
      series: [
        { name: "Leads", col: 3, color: C.char, values: top.map((t) => t.leads) },
        ...(hasCmp ? [{ name: x.compareLabel ?? "Before", col: 5, color: C.mute2, values: top.map((t) => cmp?.bySource[t.source] ?? 0) }] : []),
      ],
    }));

  const camps = d.teamCampaigns.slice(0, 10);
  block("BD/FR leads with a marketing campaign", "Credited to a rep, with a Lead Docket Campaign filled in. They count for the rep until the Marketing Source changes.",
    ["Campaign", "Leads", "Signed", "Not signed", "Would file as"],
    camps.map((t) => [t.campaign, t.leads, t.signed, t.leads - t.signed, t.kind === "Other" ? "not digital" : groupName(t.kind)]),
    (a, b) => ({
      title: "BD/FR leads with a campaign", dir: "bar", stacked: true,
      cats: { col: 2, r1: a, r2: b, values: camps.map((t) => t.campaign) },
      series: [
        { name: "Signed", col: 4, color: C.char, values: camps.map((t) => t.signed) },
        { name: "Not signed", col: 5, color: C.sun, values: camps.map((t) => t.leads - t.signed) },
      ],
    }));
  return charts;
}

// ── the lists ──

type Group = AuditData["possiblyDigital"][number];

function groupsSheet(wb: Workbook, x: AuditExport, name: string, title: string, about: string, groups: Group[], target: boolean, prev?: { leads: number; signed: number }) {
  const ws = wb.addWorksheet(name);
  const head = ["Marketing Source", "Evidence", target ? "Would count in" : "Counted in", "Client", "Lead date", "Outcome", "Signed", "Contact Source", "Campaign"];
  const COLS = head.length;
  const leads = groups.reduce((a, g) => a + g.leads, 0), signed = groups.reduce((a, g) => a + g.signed, 0);
  banner(ws, COLS, title, `${x.period}  ·  ${fmtN(leads)} leads, ${fmtN(signed)} signed${prev ? `  ·  ${x.compareLabel}: ${fmtN(prev.leads)} leads (${change(leads, prev.leads).text})` : ""}`, true);
  ws.mergeCells(5, 1, 5, COLS);
  ws.getCell(5, 1).value = about;
  ws.getCell(5, 1).font = { name: SANS, size: 9, italic: true, color: { argb: "FF" + C.mute } };
  ws.getCell(5, 1).alignment = { wrapText: true, vertical: "top", indent: 1 };
  ws.getRow(5).height = 30;
  const H = 6;
  header(ws, H, head);
  setup(ws, [34, 38, 22, 28, 13, 18, 8, 28, 30], H);
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  let r = H + 1;
  for (const g of groups) {
    const counts = g.group ? `${groupName(g.group)}${g.label ? ` · ${g.label}` : ""}` : "not digital";
    const row = ws.getRow(r++);
    row.values = [g.source, g.evidence, counts, `${fmtN(g.leads)} lead${g.leads === 1 ? "" : "s"} · ${fmtN(g.signed)} signed`];
    styleBody(row, COLS, { bold: true, tint: C.paper });
    for (const c of g.clients) {
      const cr = ws.getRow(r++);
      cr.values = [g.source, g.evidence, counts, c.name, excelDay(c.date), c.outcome || "—", c.signed ? "Yes" : "", c.contactSource ?? "", c.campaign ?? ""];
      cr.getCell(5).numFmt = DATE_FMT;
      cr.outlineLevel = 1;
      styleBody(cr, COLS, { muted: new Set([0, 1, 2]) });
      if (c.signed) cr.getCell(7).font = { ...bodyFont, bold: true, color: { argb: "FF" + C.ok } };
    }
    if (g.leads > g.clients.length) {
      const nr = ws.getRow(r++);
      nr.getCell(4).value = `… and ${fmtN(g.leads - g.clients.length)} more in Lead Docket`;
      nr.getCell(4).font = { ...bodyFont, italic: true, color: { argb: "FF" + C.mute } };
      nr.outlineLevel = 1;
    }
  }
  if (!groups.length) { ws.getCell(r, 1).value = "None in this period."; ws.getCell(r, 1).font = { ...bodyFont, italic: true, color: { argb: "FF" + C.mute } }; }
  else ws.autoFilter = { from: { row: H, column: 1 }, to: { row: r - 1, column: COLS } };
}

function teamSheet(wb: Workbook, x: AuditExport) {
  const d = x.data;
  const ws = wb.addWorksheet("BD-FR on a campaign");
  const head = ["Campaign", "Would file as", "Client", "Rep", "Role", "Lead date", "Outcome", "Signed", "Contact Source"];
  const COLS = head.length;
  const leads = d.teamCampaigns.reduce((a, g) => a + g.leads, 0), signed = d.teamCampaigns.reduce((a, g) => a + g.signed, 0);
  const prev = d.compare?.teamCampaigns;
  banner(ws, COLS, "BD/FR leads with a marketing campaign", `${x.period}  ·  ${fmtN(leads)} leads, ${fmtN(signed)} signed${prev ? `  ·  ${x.compareLabel}: ${fmtN(prev.leads)} leads (${change(leads, prev.leads).text})` : ""}`, true);
  ws.mergeCells(5, 1, 5, COLS);
  ws.getCell(5, 1).value = "Credited to a BDR or Field Rep, with Lead Docket's Campaign filled in. They count for the rep, not the campaign; where the lead really came in on its own, change its Marketing Source in Lead Docket.";
  ws.getCell(5, 1).font = { name: SANS, size: 9, italic: true, color: { argb: "FF" + C.mute } };
  ws.getCell(5, 1).alignment = { wrapText: true, vertical: "top", indent: 1 };
  ws.getRow(5).height = 30;
  const H = 6;
  header(ws, H, head);
  setup(ws, [36, 18, 28, 22, 8, 13, 18, 8, 28], H);
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  let r = H + 1;
  for (const t of d.teamCampaigns) {
    const kind = t.kind === "Other" ? "not digital" : groupName(t.kind);
    const row = ws.getRow(r++);
    row.values = [t.campaign, kind, `${fmtN(t.leads)} lead${t.leads === 1 ? "" : "s"} · ${fmtN(t.signed)} signed`];
    styleBody(row, COLS, { bold: true, tint: C.paper });
    for (const c of t.clients) {
      const cr = ws.getRow(r++);
      cr.values = [t.campaign, kind, c.name, c.rep, c.role, excelDay(c.date), c.outcome || "—", c.signed ? "Yes" : "", c.contactSource ?? ""];
      cr.getCell(6).numFmt = DATE_FMT;
      cr.outlineLevel = 1;
      styleBody(cr, COLS, { muted: new Set([0, 1]) });
      if (c.signed) cr.getCell(8).font = { ...bodyFont, bold: true, color: { argb: "FF" + C.ok } };
    }
  }
  if (!d.teamCampaigns.length) { ws.getCell(r, 1).value = "No BD/FR lead carries a campaign in this period."; ws.getCell(r, 1).font = { ...bodyFont, italic: true, color: { argb: "FF" + C.mute } }; }
  else ws.autoFilter = { from: { row: H, column: 1 }, to: { row: r - 1, column: COLS } };
}

function namesSheet(wb: Workbook, x: AuditExport) {
  const h = x.data.hygiene;
  const ws = wb.addWorksheet("Source names");
  const COLS = 6;
  banner(ws, COLS, "Lead Docket source names", "All time  ·  names only, no clients", false);
  [16, 34, 46, 10, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  let r = 6;
  const section = (title: string, note: string, head: string[], rows: (string | number | Date | null)[][]) => {
    ws.mergeCells(r, 1, r, COLS);
    ws.getCell(r, 1).value = title;
    ws.getCell(r, 1).font = { name: SERIF, size: 14, color: { argb: "FF" + C.ink } };
    ws.getRow(r++).height = 24;
    ws.mergeCells(r, 1, r, COLS);
    ws.getCell(r, 1).value = note;
    ws.getCell(r, 1).font = { name: SANS, size: 9, italic: true, color: { argb: "FF" + C.mute } };
    r++;
    const numeric = new Set(head.map((l, i) => (l === "Leads" ? i : -1)).filter((i) => i >= 0));
    header(ws, r++, head, numeric);
    rows.forEach((v, j) => {
      const row = ws.getRow(r++);
      row.values = v;
      styleBody(row, head.length, { zebra: j % 2 === 1, numeric });
      v.forEach((val, i) => { if (val instanceof Date) row.getCell(i + 1).numFmt = DATE_FMT; if (typeof val === "number") row.getCell(i + 1).numFmt = "#,##0"; });
    });
    if (!rows.length) { ws.getCell(r, 1).value = "None."; ws.getCell(r++, 1).font = { ...bodyFont, italic: true, color: { argb: "FF" + C.mute } }; }
    r += 2;
  };
  section("Names per digital row", "Which Marketing Sources roll up into each GBP office, SEO brand and ad campaign. Several names for one row can be merged in Lead Docket.",
    ["Group", "Row", "Marketing Source", "Leads", "First lead", "Last lead"],
    DIGITAL_GROUPS.flatMap((g) => h.perRow.filter((p) => p.group === g).flatMap((p) => p.names.map((n) => [DIGITAL_GROUP_LABEL[g], p.label, n.source, n.leads, excelDay(n.first), excelDay(n.last)]))));
  section("Names that look digital but aren't counted", "No digital row claims them. If one is a digital channel, tell the CRM team so it gets a row.",
    ["Marketing Source", "Leads", "First lead", "Last lead"], h.lookDigital.map((n) => [n.source, n.leads, excelDay(n.first), excelDay(n.last)]));
  if (h.merch.length) section(`Known, not digital: ${MERCH}`, "The firm's merch and print.", ["Marketing Source", "Leads", "First lead", "Last lead"], h.merch.map((n) => [n.source, n.leads, excelDay(n.first), excelDay(n.last)]));
  section("Near-duplicate names", "The same letters and digits, one name inside another, or the same first 12 letters.",
    ["Kind", "Rows", "Names", "Leads"], h.duplicates.map((dd) => [dd.exact ? "Same name, spelled differently" : "Probably the same", dd.rows.join(" / "), dd.names.map((n) => `${n.source} (${fmtN(n.leads)})`).join("  ·  "), dd.leads]));
}

function directorySheets(wb: Workbook, x: AuditExport) {
  const dir = x.directory;
  if (!dir) return;
  const tables = [
    ["marketing", "Directory - Marketing", "Marketing Sources", "How each lead is credited — the field every marketing report counts by."],
    ["contact", "Directory - Contact", "Contact Sources", "How the lead reached the firm (phone, web form, chat, walk-in…)."],
    ["campaign", "Directory - Campaigns", "Campaigns", "Lead Docket's campaign field."],
  ] as const;
  for (const [key, sheet, title, note] of tables) {
    const rows = dir[key];
    const ws = wb.addWorksheet(sheet);
    const withCat = key === "marketing";
    const head = ["Name", "Leads", "Signed", "Sign-up rate", "First lead", "Last lead", ...(withCat ? ["Filed in the CRM as", "Detail"] : [])];
    const COLS = head.length;
    banner(ws, COLS, `Lead Docket ${title.toLowerCase()}`, `All time, all teams  ·  ${fmtN(rows.length)} names  ·  ${note}`, false);
    const H = 6;
    header(ws, H, head, new Set([1, 2, 3]));
    setup(ws, [46, 10, 10, 12, 14, 14, ...(withCat ? [22, 34] : [])], H);
    rows.forEach((d2, j) => {
      const row = ws.getRow(H + 1 + j);
      row.values = [d2.name, d2.leads, d2.signed, d2.leads ? d2.signed / d2.leads : null, excelDay(d2.first), excelDay(d2.last), ...(withCat ? [d2.category, d2.detail && d2.detail !== d2.name ? d2.detail : ""] : [])];
      styleBody(row, COLS, { zebra: j % 2 === 1, numeric: new Set([1, 2, 3]) });
      row.getCell(2).numFmt = "#,##0"; row.getCell(3).numFmt = "#,##0"; row.getCell(4).numFmt = "0.0%";
      row.getCell(5).numFmt = DATE_FMT; row.getCell(6).numFmt = DATE_FMT;
    });
    if (rows.length) ws.autoFilter = { from: { row: H, column: 1 }, to: { row: H + rows.length, column: COLS } };
  }
}

// ── charts, written into the file as DrawingML ──

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const colL = (n: number) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const ref = (sheet: string, col: number, r1: number, r2 = r1) => `'${sheet.replace(/'/g, "''")}'!$${colL(col)}$${r1}${r2 !== r1 ? `:$${colL(col)}$${r2}` : ""}`;
const txt = (size: number, color: string, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${SANS}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function chartXml(sheet: string, s: ChartSpec) {
  const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = (vals: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
  const horizontal = s.dir === "bar";
  const ser = s.series.map((x, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>` +
    `<c:tx><c:v>${xmlEsc(x.name)}</c:v></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${x.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>` +
    `<c:dLbls><c:numFmt formatCode="#,##0;;" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txt(800, s.stacked && x.color === C.char ? "FFFFFF" : C.ink2)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` +
    `<c:cat><c:strRef><c:f>${ref(sheet, s.cats.col, s.cats.r1, s.cats.r2)}</c:f>${strCache(s.cats.values)}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${ref(sheet, x.col, s.cats.r1, s.cats.r2)}</c:f>${numCache(x.values)}</c:numRef></c:val></c:ser>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="0"><a:solidFill><a:srgbClr val="${C.ink}"/></a:solidFill><a:latin typeface="${SERIF}"/></a:rPr><a:t>${xmlEsc(s.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/><c:barChart><c:barDir val="${s.dir}"/><c:grouping val="${s.stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${ser}` +
    `<c:gapWidth val="${s.stacked ? 55 : 80}"/>${s.stacked ? '<c:overlap val="100"/>' : '<c:overlap val="-10"/>'}<c:axId val="5001"/><c:axId val="5002"/></c:barChart>` +
    `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></c:spPr>${txt(900, C.ink2)}<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt(800, C.mute)}<c:crossAx val="5001"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>` +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txt(900, C.ink2)}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="${SANS}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>`;
}

const anchor = (s: ChartSpec, i: number) =>
  `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${s.at.c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.at.r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
  `<xdr:to><xdr:col>${s.at.c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${s.at.r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
  `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
  `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
  `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

/** Adds the charts to one sheet of a finished .xlsx (the sheet must have no other drawing). */
export async function addCharts(buf: ArrayBuffer | Uint8Array, sheetFile: string, sheetName: string, charts: ChartSpec[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  if (!charts.length) return zip.generateAsync({ type: "uint8array" });
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  charts.forEach((s, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(sheetName, s)));
  zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${charts.map(anchor).join("")}</xdr:wsDr>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")}</Relationships>`);

  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const relsXml = (await zip.file(relsPath)?.async("string")) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(relsPath, relsXml.replace("</Relationships>", `<Relationship Id="rIdChartDrawing" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));

  const sheetPath = `xl/worksheets/${sheetFile}`;
  let sheetXml = await zip.file(sheetPath)!.async("string");
  if (!/xmlns:r=/.test(sheetXml.slice(0, 600))) sheetXml = sheetXml.replace("<worksheet ", `<worksheet xmlns:r="${R}" `);
  // <drawing> goes after the page setup and before any legacy drawing, table parts or extensions.
  const before = ["<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"]
    .map((t) => sheetXml.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  sheetXml = sheetXml.slice(0, before) + `<drawing r:id="rIdChartDrawing"/>` + sheetXml.slice(before);
  zip.file(sheetPath, sheetXml);

  let types = await zip.file("[Content_Types].xml")!.async("string");
  const add = [`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)].join("");
  types = types.replace("</Types>", add + "</Types>");
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ── the workbook ──

/** The chosen parts as an .xlsx. The Overview, when included, is the first sheet and carries the charts. */
export async function buildAuditWorkbook(x: AuditExport): Promise<Uint8Array> {
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Farahi Law CRM";
  wb.created = new Date();
  wb.title = `Data audit — ${x.period}`;
  const d = x.data, cmp = d.compare;
  const want = new Set(x.parts);
  let charts: ChartSpec[] = [];
  if (want.has("overview")) charts = overview(wb, x);
  if (want.has("possiblyDigital")) groupsSheet(wb, x, "Possibly digital", "Possibly mis-registered digital leads",
    "Marketing Source isn't digital (or is empty) while Lead Docket's other fields — Contact Source, campaign, UTM, referring URL or keywords — say the lead came in digitally. Not counted as digital until the Marketing Source is corrected in Lead Docket.",
    d.possiblyDigital, true, cmp?.possiblyDigital);
  if (want.has("possiblyNotDigital")) groupsSheet(wb, x, "Possibly not digital", "Digital sources that may not be digital",
    "Credited to a digital Marketing Source while the Contact Source says the lead came another way — a Walker line, staff, an existing client, a partner.",
    d.possiblyNotDigital, false, cmp?.possiblyNotDigital);
  if (want.has("tollFree")) groupsSheet(wb, x, "Toll-free line", "The 800-738-0000 toll-free line",
    "The number is on the Justin For Justice website and on merch, welcome kits, the emailer and billboards, so these leads can't be credited to the website alone.",
    d.tollFree, false, cmp?.tollFree);
  if (want.has("teamCampaigns")) teamSheet(wb, x);
  if (want.has("names")) namesSheet(wb, x);
  if (want.has("directory")) directorySheets(wb, x);
  const buf = await wb.xlsx.writeBuffer();
  if (!want.has("overview")) return new Uint8Array(buf as ArrayBuffer);
  const ov = wb.getWorksheet("Overview")!;
  return addCharts(buf as ArrayBuffer, `sheet${ov.id}.xml`, "Overview", charts);
}

/** Builds the file and hands it to the browser. */
export async function downloadAuditWorkbook(x: AuditExport, fileName: string) {
  const bytes = await buildAuditWorkbook(x);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
