/**
 * The Marketing Report's "Data audit" view: the team's daily sheet against
 * Lead Docket, leads Lead Docket may have credited to the wrong source, and
 * the source names to clean up. Lead Docket is the source of truth — nothing
 * here changes a number; it says where the sheet or Lead Docket needs fixing.
 *
 * The sheet is read in the browser: xlsx is imported only when a file is
 * chosen, so it never weighs on the page's first load.
 */
import { Fragment, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, FileSpreadsheet, Info, Loader2, Upload } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { DrillLink } from "../../../../server/marketing/common";
import { trpc } from "@/lib/trpc";
import { DIGITAL_GROUP_LABEL, DIGITAL_GROUPS, MERCH } from "@shared/marketing";
import { SHEET_COLUMNS, parseSheet, reconcileNames, tabForDay, type Cell, type ParsedSheet, type SheetColumn } from "@shared/digitalSheet";
import { fmt, leadDay, pct1, rangeLabel } from "../SignupsDashboard";
import { LoadError } from "../signups/LoadError";
import type { DigitalData } from "../DigitalMarketingReport";

type Scope = "period" | "12m" | "all";

export function AuditView({ from, to, report }: { from: string; to: string; report: DigitalData | null; onDrill: (d: DrillLink) => void }) {
  return (
    <>
      <p className="sr-note">
        <Info /> <span>
          <b>Lead Docket is the source of truth.</b> This page never changes a number. Where the team's sheet and Lead Docket disagree, one of them
          needs correcting — usually the sheet, or a lead's Marketing Source in Lead Docket. A lead fixed in Lead Docket moves on this report after the next sync.
        </span>
      </p>
      <SheetCompare to={to} report={report} />
      <Misregistered from={from} to={to} />
    </>
  );
}

// ── 1. the team's sheet against Lead Docket ──

type Loaded = { file: string; tabs: string[]; tab: string; parsed: ParsedSheet; buf: ArrayBuffer };

async function readTab(buf: ArrayBuffer, tab: string): Promise<ParsedSheet> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", sheets: [tab] });
  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[tab], { header: 1, raw: true, defval: null, blankrows: true });
  return parseSheet(rows);
}

function SheetCompare({ to, report }: { to: string; report: DigitalData | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const open = async (f: File) => {
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const XLSX = await import("xlsx");
      // Tab names first (cheap), then only the one tab: the workbook holds a tab per day.
      const tabs = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames;
      const want = tabForDay(to);
      const tab = tabs.includes(want) ? want : tabs[tabs.length - 1];
      if (!tab) throw new Error("The file has no sheets.");
      if (tab !== want) toast.info(`No tab named ${want} for ${rangeLabel(to, to)}; showing ${tab}. Pick another tab if needed.`);
      setLoaded({ file: f.name, tabs, tab, parsed: await readTab(buf, tab), buf });
    } catch (e) {
      toast.error(e instanceof Error ? `Couldn't read the sheet: ${e.message}` : "Couldn't read the sheet.");
    } finally {
      setBusy(false);
    }
  };
  const pickTab = async (tab: string) => {
    if (!loaded) return;
    setBusy(true);
    try { setLoaded({ ...loaded, tab, parsed: await readTab(loaded.buf, tab) }); } finally { setBusy(false); }
  };

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}><h2>The team's daily sheet vs Lead Docket</h2></div>
      <p className="sr-sub">
        Upload the "MTD Performance Summary" workbook. The tab for the period's last day ({tabForDay(to)}) is compared with this report for {rangeLabel(from0(to), to)} —
        the team's table and the names in its In-House Signup Details and Signed Referred Out Details. Pick the month-to-date period above to match the sheet.
      </p>
      <div className={`dm-drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void open(f); }}>
        <FileSpreadsheet size={22} aria-hidden />
        <span style={{ flex: 1, minWidth: 180 }}>{loaded ? <><b>{loaded.file}</b> · tab</> : "Drop the .xlsx here, or"}</span>
        {loaded && (
          <select className="sr-input" value={loaded.tab} onChange={(e) => void pickTab(e.target.value)} aria-label="Sheet tab">
            {[...loaded.tabs].reverse().map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button className="sr-btn2" onClick={() => input.current?.click()} disabled={busy}>{busy ? <Loader2 className="sr-spin" /> : <Upload />} {loaded ? "Another file" : "Choose file"}</button>
        <input ref={input} type="file" accept=".xlsx,.xlsm,.xls" hidden aria-label="The team's sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ""; }} />
      </div>
      {loaded && !report && <p className="sr-nil" style={{ marginTop: 12 }}><Loader2 size={13} className="sr-spin" /> Loading Lead Docket's numbers…</p>}
      {loaded && report && <Comparison sheet={loaded.parsed} report={report} />}
    </div>
  );
}
/** The first of the month of a day: the sheet is month to date. */
const from0 = (to: string) => to.slice(0, 8) + "01";

const CRM_KEY: Record<SheetColumn, (r: DigitalData["team"][number]) => number | null> = {
  leads: (r) => r.leads, open: (r) => r.open, rejected: (r) => r.rejected, referredOut: (r) => r.referredOut, lostNI: (r) => r.lostNI,
  signedReferred: (r) => r.signedReferred, unique: (r) => r.unique, signedInHouse: (r) => r.signedInHouse, signed: (r) => r.signed,
  target: (r) => r.target, conversion: (r) => r.conversion,
};

function Comparison({ sheet, report }: { sheet: ParsedSheet; report: DigitalData }) {
  const gbp = report.team.find((r) => r.group === "GBP")!;
  const seo = report.team.find((r) => r.group === "SEO")!;
  // The sheet's TOTAL is GBP + SEO; it has no Ads row.
  const both = (k: SheetColumn) => {
    if (k === "conversion") { const l = gbp.leads + seo.leads; return l ? Math.round(((gbp.signed + seo.signed) / l) * 1000) / 10 : null; }
    const a = CRM_KEY[k](gbp), b = CRM_KEY[k](seo);
    return a == null || b == null ? null : Math.round((a + b) * 10) / 10;
  };
  const rows: [string, ParsedSheet["team"]["GBP"], (k: SheetColumn) => number | null][] = [
    ["GBP", sheet.team.GBP, (k) => CRM_KEY[k](gbp)],
    ["SEO / Website", sheet.team.SEO, (k) => CRM_KEY[k](seo)],
    ["TOTAL (GBP + SEO)", sheet.team.TOTAL, both],
  ];
  const lists = [
    { title: "In-house sign-ups", sheet: sheet.inHouse, crm: report.signups.filter((s) => s.kind === "inHouse" && s.group !== "Ads"), found: sheet.found.inHouse },
    { title: "Signed referred out", sheet: sheet.referred, crm: report.signups.filter((s) => s.kind === "referred" && s.group !== "Ads"), found: sheet.found.referred },
  ];
  return (
    <div style={{ marginTop: 14 }}>
      {!sheet.found.team ? <p className="sr-nil">This tab has no "Digital Marketing Team" table.</p> : (
        <div className="sr-scroll">
          <table className="sr-t dm-t" style={{ minWidth: 980 }}>
            <thead>
              <tr><th>Row</th>{SHEET_COLUMNS.map(([k, , label]) => <th key={k} className="num">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(([name, s, crm]) => (
                <tr key={name}>
                  <td className="l"><b>{name}</b><small className="muted" style={{ display: "block", fontSize: 11 }}>sheet · Lead Docket</small></td>
                  {SHEET_COLUMNS.map(([k]) => {
                    const a = s?.[k] ?? null, b = crm(k);
                    const diff = a != null && b != null ? Math.round((b - a) * 10) / 10 : null;
                    const fmtV = (v: number | null) => (v == null ? "—" : k === "conversion" ? pct1(v) : fmt(v));
                    return (
                      <td key={k} className="num">
                        {fmtV(a)} · {fmtV(b)}
                        {diff != null && diff !== 0 && <span className="dm-diff-bad" style={{ display: "block" }}>{diff > 0 ? "+" : "−"}{k === "conversion" ? `${Math.abs(diff).toFixed(1)} pts` : fmt(Math.abs(diff))}</span>}
                        {diff === 0 && <span className="dm-diff-ok" style={{ display: "block" }}>✓</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dm-foot">
        Differences are Lead Docket minus the sheet. Two are by definition: the CRM counts Pending Referral leads as Open (the sheet counts them as
        Referred Out), and a lead counts in the day of its sign-up if signed, otherwise the day it came in. The CRM's unique count needs the accident
        date and linked leads, which fill in as Lead Docket re-reads leads.
      </p>

      {lists.map((l) => {
        const r = reconcileNames(l.sheet, l.crm);
        return (
          <div key={l.title} style={{ marginTop: 18 }}>
            <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
              {l.title}: {fmt(l.sheet.length)} on the sheet, {fmt(l.crm.length)} in Lead Docket (GBP + SEO)
            </h3>
            {!l.found ? <p className="sr-nil">This tab has no list for it.</p> : (
              <div className="dm-names">
                <NameCol title="In both" n={r.both.length} tone="ok">
                  {r.both.map((b, i) => <li key={i}>{b.crm.name}<i>{b.crm.label}{b.sheet.source && b.sheet.source !== b.crm.label ? ` · sheet: ${b.sheet.source}` : ""}</i></li>)}
                </NameCol>
                <NameCol title="Only on the sheet" n={r.onlySheet.length} tone="bad">
                  {r.onlySheet.map((s, i) => <li key={i}>{s.name}<i>{[s.source, s.caseType, s.caseValue].filter(Boolean).join(" · ")} — check its Marketing Source, status and sign-up date in Lead Docket</i></li>)}
                </NameCol>
                <NameCol title="Only in Lead Docket" n={r.onlyCrm.length} tone="bad">
                  {r.onlyCrm.map((c) => <li key={c.id}>{c.name}<i>{c.label} · signed {leadDay(c.date)} — missing from the sheet</i></li>)}
                </NameCol>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NameCol({ title, n, tone, children }: { title: string; n: number; tone: "ok" | "bad"; children: ReactNode }) {
  return (
    <div>
      <h3>{title}<span className={`sr-badge ${n === 0 ? "sr-b-grey" : tone === "ok" ? "sr-b-ok" : "sr-b-bad"}`}>{fmt(n)}</span></h3>
      {n === 0 ? <p className="sr-nil" style={{ marginTop: 6 }}>None.</p> : <ul>{children}</ul>}
    </div>
  );
}

// ── 2. mis-registered leads, and 3. source names ──

function Misregistered({ from, to }: { from: string; to: string }) {
  const [scope, setScope] = useState<Scope>("period");
  const { data, isLoading, isFetching, isError, error, refetch } = trpc.marketing.digitalAudit.useQuery({ from, to, scope }, { placeholderData: (prev) => prev });
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
          <div className="sr-ttl"><h2>Possibly mis-registered digital leads</h2>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
          <div className="sr-seg" role="group" aria-label="How far back">
            {([["period", "This period"], ["12m", "Last 12 months"], ["all", "All time"]] as const).map(([v, l]) => (
              <button key={v} className={scope === v ? "on" : ""} onClick={() => setScope(v)}>{l}</button>
            ))}
          </div>
        </div>
        <p className="sr-sub">
          Leads whose Marketing Source isn't digital (or is empty) while Lead Docket's other fields — Contact Source, campaign, UTM, referring URL or
          keywords — say they came in digitally. A lead through one of Walker's call lines never counts: Walker runs its own ads. BD/FR leads are the
          team's and aren't checked. None of these are counted as digital until the Marketing Source is corrected in Lead Docket.
        </p>
        {!data ? (isError && !isLoading ? <LoadError what="the audit" message={error?.message} onRetry={() => refetch()} /> : <div className="sr-skel" style={{ height: 160 }} />) : (
          <>
            <div className="dm-kpis">
              {data.wouldAdd.map((w) => (
                <div key={w.group} className="dm-kpi"><b>+{fmt(w.leads)}</b><span>{DIGITAL_GROUP_LABEL[w.group]} leads if corrected · +{fmt(w.signed)} signed</span></div>
              ))}
              <div className="dm-kpi"><b>{fmt(data.checked)}</b><span>leads checked</span></div>
            </div>
            <AuditGroups rows={data.possiblyDigital} empty="Nothing found — every lead with digital evidence has a digital Marketing Source." target />
          </>
        )}
      </div>

      {data && (
        <>
          <div className="sr-panel">
            <div className="sr-panel-h"><h2>Digital sources that may not be digital</h2></div>
            <p className="sr-sub">Leads credited to a digital Marketing Source whose Contact Source says they came another way — a Walker line, staff, an existing client, a partner.</p>
            <AuditGroups rows={data.possiblyNotDigital} empty="None found." />
          </div>
          <div className="sr-panel">
            <div className="sr-panel-h"><h2>The 800-738-0000 toll-free line <span className="dm-tag warn">shared line — attribution uncertain</span></h2></div>
            <p className="sr-sub">
              The number is on the Justin For Justice website and also on merch, welcome kits, the emailer and soon billboards, so these leads can't be
              credited to the website alone. Its Marketing Source leads count under SEO / Website for now, as on the team's sheet.
            </p>
            <AuditGroups rows={data.tollFree} empty="No leads on the toll-free line." />
          </div>
          <Hygiene h={data.hygiene} />
        </>
      )}
    </>
  );
}

type AuditData = NonNullable<inferRouterOutputs<AppRouter>["marketing"]["digitalAudit"]>;
type Group = AuditData["possiblyDigital"][number];

function AuditGroups({ rows, empty, target }: { rows: Group[]; empty: string; target?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <p className="sr-nil">{empty}</p>;
  return (
    <div className="sr-scroll">
      <table className="sr-t dm-t" style={{ minWidth: 720 }}>
        <thead><tr><th>Marketing Source in Lead Docket</th><th>Evidence</th><th>{target ? "Would count in" : "Counted in"}</th><th className="num">Leads</th><th className="num">Signed</th><th /></tr></thead>
        <tbody>
          {rows.map((g) => {
            const k = g.source + "|" + g.evidence;
            const isOpen = open === k;
            return (
              <Fragment key={k}>
                <tr className="sr-click" onClick={() => setOpen(isOpen ? null : k)}>
                  <td className="l"><b>{g.source}</b></td>
                  <td>← {g.evidence}</td>
                  <td className="nowrap">{g.group ? `${DIGITAL_GROUP_LABEL[g.group]}${g.label ? ` · ${g.label}` : ""}` : <span className="muted">not digital</span>}</td>
                  <td className="num">{fmt(g.leads)}</td>
                  <td className="num">{fmt(g.signed)}</td>
                  <td className="num"><button className="dm-cell" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the clients`}><ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : undefined }} /></button></td>
                </tr>
                {isOpen && (
                  <tr className="dm-sub-row">
                    <td colSpan={6}>
                      <table className="sr-t dm-t sr-leads">
                        <thead><tr><th>Client</th><th>Date</th><th>Outcome</th><th>Contact Source</th><th>Campaign</th></tr></thead>
                        <tbody>
                          {g.clients.map((c) => (
                            <tr key={c.id}>
                              <td className="client"><b>{c.name}</b></td><td className="nowrap">{leadDay(c.date)}</td>
                              <td className="nowrap"><span className={`sr-badge ${c.signed ? "sr-b-ok" : "sr-b-grey"}`}>{c.outcome || "—"}</span></td>
                              <td>{c.contactSource ?? "—"}</td><td>{c.campaign ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {g.leads > g.clients.length && <p className="dm-foot">The newest {fmt(g.clients.length)} of {fmt(g.leads)}.</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Hyg = AuditData["hygiene"];
const span = (n: { first: string | null; last: string | null }) => (n.first ? `${leadDay(n.first)} – ${leadDay(n.last)}` : "");

function Hygiene({ h }: { h: Hyg }) {
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>Lead Docket source names per row</h2></div>
        <p className="sr-sub">
          All time: which Lead Docket Marketing Sources roll up into each GBP office, SEO brand and ad campaign. Where a row has several names for one
          thing (e.g. "Justin For Justice Toll Free for Website" and "JustinforJustice Website"), the team can merge them in Lead Docket.
        </p>
        {DIGITAL_GROUPS.map((g) => {
          const rows = h.perRow.filter((r) => r.group === g);
          if (!rows.length) return null;
          return (
            <div key={g} style={{ marginTop: 10 }}>
              <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)" }}>{DIGITAL_GROUP_LABEL[g]}</h3>
              <table className="sr-t dm-t">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td className="l" style={{ width: "30%" }}><b>{r.label}</b>{r.names.length > 1 && <span className="dm-tag warn">{r.names.length} names</span>}</td>
                      <td><div className="dm-srclist">{r.names.map((n) => <span key={n.source} className="dm-src" title={span(n)}>{n.source}<i>{fmt(n.leads)}</i></span>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <div className="dm-grid2">
        <div className="sr-panel">
          <div className="sr-panel-h"><div className="sr-ttl"><h2>Names that look digital but aren't counted</h2><span className="sr-count">{h.lookDigital.length}</span></div></div>
          <p className="sr-sub">No digital row claims them. If one is a digital channel, tell the CRM team so it gets a row.</p>
          <NameTable rows={h.lookDigital} empty="None." />
          {h.merch.length > 0 && (
            <>
              <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)", marginTop: 12 }}>Known, not digital: {MERCH}</h3>
              <NameTable rows={h.merch} empty="None." />
            </>
          )}
        </div>
        <div className="sr-panel">
          <div className="sr-panel-h"><div className="sr-ttl"><h2>Near-duplicate names</h2><span className="sr-count">{h.duplicates.length}</span></div></div>
          <p className="sr-sub">The same letters and digits, one name inside another, or the same first 12 letters. Ones that land in different rows first.</p>
          {h.duplicates.length === 0 ? <p className="sr-nil">None.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflow: "auto" }}>
              {h.duplicates.map((d, i) => (
                <div key={i} className="dm-kpi" style={{ gap: 6 }}>
                  <span>{d.exact ? "Same name, spelled differently" : "Probably the same"} · {fmt(d.leads)} leads · {d.rows.join(" / ")}
                    {d.rows.length > 1 && <span className="dm-tag warn">different rows</span>}</span>
                  <div className="dm-srclist">{d.names.map((n) => <span key={n.source} className="dm-src" title={span(n)}>{n.source}<i>{fmt(n.leads)}</i></span>)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function NameTable({ rows, empty }: { rows: Hyg["lookDigital"]; empty: string }) {
  if (!rows.length) return <p className="sr-nil">{empty}</p>;
  return (
    <table className="sr-t dm-t">
      <thead><tr><th>Marketing Source</th><th className="num">Leads</th><th>First – last lead</th></tr></thead>
      <tbody>{rows.map((n) => <tr key={n.source}><td className="l"><b>{n.source}</b></td><td className="num">{fmt(n.leads)}</td><td className="nowrap">{span(n)}</td></tr>)}</tbody>
    </table>
  );
}
