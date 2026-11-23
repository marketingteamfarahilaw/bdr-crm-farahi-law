/**
 * The Marketing Report's "Data audit" view: the FLF Sign Up sheet against
 * Lead Docket (the sign-ups they disagree on, any month, every channel), leads
 * Lead Docket may have credited to the wrong source, and the source names to
 * clean up. Nothing here changes a number; it says where the sheet or Lead
 * Docket needs fixing. xlsx is imported only for an export, so it never weighs
 * on the page's first load.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, FileSpreadsheet, Info, Loader2, Printer, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { DrillLink } from "../../../../server/marketing/common";
import { trpc } from "@/lib/trpc";
import { DIGITAL_GROUP_LABEL, DIGITAL_GROUPS } from "@shared/marketing";
import { fmt, leadDay, rangeLabel } from "../SignupsDashboard";
import { LoadError } from "../signups/LoadError";
import type { DigitalData } from "../DigitalMarketingReport";
import { VsControl, type CompareChoice } from "../marketing/Compare";
import { AuditBars, AuditGainChart } from "./Charts";
import { EXPORT_PARTS, downloadAuditWorkbook, type ExportPart } from "./auditExcel";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Scope = "period" | "12m" | "all";

export function AuditView({ from, to, report }: { from: string; to: string; report: DigitalData | null; onDrill: (d: DrillLink) => void }) {
  // How far back, and what to compare with: the comparison is for "This period" only, as on the rest of the report.
  const [scope, setScope] = useState<Scope>("period");
  const [cmp, setCmp] = useState<CompareChoice>("prev");
  const compare: CompareChoice = scope === "period" ? cmp : "off";
  const q = trpc.marketing.digitalAudit.useQuery({ from, to, scope, compare }, { placeholderData: (prev) => prev });
  return (
    <>
      <p className="sr-note">
        <Info /> <span>
          <b>Sign-ups come from the FLF Sign Up sheet; every other lead from Lead Docket.</b> This page never changes a number. Where the two disagree, one of them
          needs correcting — the sheet, or the lead in Lead Docket. A fix shows here after the next sync of either.
        </span>
      </p>
      <AuditOverview q={q} from={from} to={to} scope={scope} onScope={setScope} cmp={compare} onCmp={setCmp} />
      <FlfReconcile to={to} />
      <Misregistered q={q} from={from} to={to} scope={scope} />
      <SourceDirectory />
    </>
  );
}

// ── 1. the FLF Sign Up sheet against Lead Docket ──

type ListKey = "missingInLd" | "missingFromSheet" | "differs";
const LISTS: [ListKey, string, string][] = [
  ["missingInLd", "Missing in Lead Docket", "On the FLF sheet, but no Lead Docket lead matches it by phone, email or name. The report still counts the sign-up, under the sheet's channel. Add the lead in Lead Docket, or correct the phone or name on either side."],
  ["missingFromSheet", "Missing from FLF sheet", "Lead Docket marks it signed this month, but no row on the FLF sheet is linked to it. The report doesn't count it as a sign-up. Add it to the sheet, or correct its outcome in Lead Docket."],
  ["differs", "Date or channel differs", "On both, but Lead Docket has a different sign-up date or channel, or doesn't show it as signed. The report goes by the sheet; correct whichever side is wrong."],
];
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayText = (d: string | null) => (d ? rangeLabel(d, d) : "—");
const MATCHED_BY: Record<string, string> = { phone: "phone", "phone+name": "phone and name", email: "email", "name+date": "name and date" };

/**
 * The FLF Sign Up History sheet against Lead Docket, for any month: the three
 * lists of flfAudit.ts. Lists clients by name, as the report's drill-downs do.
 */
function FlfReconcile({ to }: { to: string }) {
  const [month, setMonth] = useState(to.slice(0, 7));
  useEffect(() => setMonth(to.slice(0, 7)), [to]);
  const [digital, setDigital] = useState(false);
  const [list, setList] = useState<ListKey>("missingInLd");
  const q = trpc.marketing.flfReconcile.useQuery({ month, digital }, { placeholderData: (prev) => prev });
  const d = q.data;

  const exportXlsx = async () => {
    if (!d) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.missingInLd.map((r) => ({
      Client: r.name, "Sign-up date (sheet)": r.day ?? "", "Source (sheet)": r.sheetSource, "Lead Source (sheet)": r.leadSource,
      "Counted under": r.channel, Outcome: r.kind, "Case type": r.caseType, "Signed up by": r.signedUpBy,
    }))), "Missing in Lead Docket");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.missingFromSheet.map((r) => ({
      Client: r.name, "Lead Docket lead": r.leadId, "Signed (Lead Docket)": r.day ?? "", Channel: r.channel, "Marketing Source": r.source,
      Rep: r.rep ?? "", Outcome: r.outcome,
    }))), "Missing from FLF sheet");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.differs.map((r) => ({
      Client: r.name, "Lead Docket lead": r.leadId, "Matched by": MATCHED_BY[r.matchedBy] ?? r.matchedBy,
      "Signed (sheet)": r.sheetDay ?? "", "Signed (Lead Docket)": r.notSignedInLd ? "not signed" : r.ldDay ?? "",
      "Channel (sheet)": r.sheetChannel, "Channel (Lead Docket)": r.ldChannel, "Lead Docket status": r.ldStatus,
    }))), "Differs");
    XLSX.writeFile(wb, `flf-sheet-vs-lead-docket-${month}${digital ? "-digital" : ""}.xlsx`);
  };

  const rows = d ? d[list] : [];
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>FLF Sign Up sheet vs Lead Docket — {monthLabel(month)}</h2>{q.isFetching && <Loader2 size={13} className="sr-spin" />}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="month" className="sr-input" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          <div className="sr-seg" role="group" aria-label="Channels">
            <button className={!digital ? "on" : ""} onClick={() => setDigital(false)}>All channels</button>
            <button className={digital ? "on" : ""} onClick={() => setDigital(true)}>Digital only</button>
          </div>
          <button className="sr-btn2" disabled={!d} onClick={() => void exportXlsx()}><Download /> Excel</button>
        </div>
      </div>
      <SheetSync />
      <p className="sr-sub">
        The Marketing Report counts sign-ups from the FLF Sign Up History sheet and leads that never signed from Lead Docket. Each sheet row is linked to its
        Lead Docket lead by phone, then email, then name within 7 days of signing. These are the sign-ups the two disagree on
        {d ? <> — of the sheet's <b>{fmt(d.totals.sheet)}</b> sign-ups in {monthLabel(month)}, <b>{fmt(d.totals.matched)}</b> are linked to a lead.</> : "."}
      </p>
      {q.isError ? <LoadError what="the FLF sheet comparison" message={q.error.message} onRetry={() => void q.refetch()} />
        : !d ? <div className="sr-skel" style={{ height: 160 }} />
        : (
          <>
            <div className="dm-kpis">
              {LISTS.map(([k, label]) => (
                <button key={k} type="button" className={`dm-kpi${list === k ? " hl" : ""}`} onClick={() => setList(k)} aria-pressed={list === k}>
                  <b>{fmt(d.totals[k])}</b><span>{label}</span>
                </button>
              ))}
            </div>
            <p className="sr-sub">{LISTS.find(([k]) => k === list)![2]}</p>
            {rows.length === 0 ? <p className="sr-nil">Nothing here for {monthLabel(month)}.</p> : (
              <div className="sr-scroll">
                {list === "missingInLd" && (
                  <table className="sr-t dm-t" style={{ minWidth: 900 }}>
                    <thead><tr><th>Client</th><th>Signed (sheet)</th><th>Source (sheet)</th><th>Lead Source (sheet)</th><th>Counted under</th><th>Outcome</th><th>Case type</th><th>Signed up by</th></tr></thead>
                    <tbody>{d.missingInLd.map((r) => (
                      <tr key={r.id}><td className="l"><b>{r.name}</b></td><td className="nowrap">{dayText(r.day)}</td><td>{r.sheetSource || <span className="muted">blank</span>}</td>
                        <td>{r.leadSource}</td><td>{r.channel}</td><td className="nowrap">{r.kind}</td><td>{r.caseType}</td><td>{r.signedUpBy}</td></tr>
                    ))}</tbody>
                  </table>
                )}
                {list === "missingFromSheet" && (
                  <table className="sr-t dm-t" style={{ minWidth: 820 }}>
                    <thead><tr><th>Client</th><th>Signed (Lead Docket)</th><th>Channel</th><th>Marketing Source</th><th>Rep</th><th>Outcome</th><th className="num">Lead</th></tr></thead>
                    <tbody>{d.missingFromSheet.map((r) => (
                      <tr key={r.leadId}><td className="l"><b>{r.name}</b></td><td className="nowrap">{dayText(r.day)}</td><td>{r.channel}</td><td>{r.source}</td>
                        <td>{r.rep ?? <span className="muted">—</span>}</td><td className="nowrap">{r.outcome}</td><td className="num muted">{r.leadId}</td></tr>
                    ))}</tbody>
                  </table>
                )}
                {list === "differs" && (
                  <table className="sr-t dm-t" style={{ minWidth: 980 }}>
                    <thead><tr><th>Client</th><th>Signed (sheet)</th><th>Signed (Lead Docket)</th><th>Channel (sheet)</th><th>Channel (Lead Docket)</th><th>Lead Docket status</th><th>Linked by</th></tr></thead>
                    <tbody>{d.differs.map((r) => (
                      <tr key={r.id}>
                        <td className="l"><b>{r.name}</b></td>
                        <td className="nowrap">{dayText(r.sheetDay)}</td>
                        <td className="nowrap">{r.notSignedInLd ? <span className="sr-badge sr-b-bad">Not signed</span> : r.dateDiffers ? <b>{dayText(r.ldDay)}</b> : dayText(r.ldDay)}</td>
                        <td>{r.sheetChannel}</td>
                        <td>{r.channelDiffers ? <b>{r.ldChannel}</b> : r.ldChannel}</td>
                        <td>{r.ldStatus}</td>
                        <td className="nowrap muted">{MATCHED_BY[r.matchedBy] ?? r.matchedBy}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
    </div>
  );
}

/**
 * Sync the FLF Sign Up History sheet now: the same job that runs every 30
 * minutes (server/marketingSheetSync.ts).
 */
function SheetSync() {
  const utils = trpc.useUtils();
  const status = trpc.marketing.sheetSyncStatus.useQuery(undefined, {
    // Poll while it runs so the result shows without a refresh.
    refetchInterval: (q) => ((q.state.data as any)?.state === "running" ? 3000 : 60_000),
  });
  const s = status.data;
  const running = s?.state === "running";
  // When a run finishes, the lists and the report's numbers may have changed.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void utils.marketing.flfReconcile.invalidate();
      void utils.marketing.dashboard.invalidate();
      if (s?.state === "ok") toast.success("FLF Sign Up sheet synced.");
      else if (s?.state === "failed") toast.error("The sheet sync failed — see the message under the button.");
    }
    wasRunning.current = running;
  }, [running]);
  const sync = trpc.marketing.syncSheet.useMutation({
    onSuccess: (r) => {
      if (r.alreadyRunning) toast.info("The sheet is already syncing.");
      void utils.marketing.sheetSyncStatus.invalidate();
    },
    onError: (e) => toast.error(e.message || "Couldn't start the sheet sync."),
  });
  const busy = running || sync.isPending;
  const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "never");
  return (
    <div className="dm-drop" style={{ marginBottom: 10 }}>
      <RefreshCw size={20} aria-hidden />
      <span style={{ flex: 1, minWidth: 180 }}>
        <b>FLF Sign Up History sheet</b> · syncs every 30 minutes (every month once a day)
        {s && <> · last synced <b>{ago(s.lastSuccessAt)}</b></>}
        {s?.summary && s.state === "ok" && <span className="sr-sub" style={{ display: "block", margin: "2px 0 0" }}>{s.summary}</span>}
        {s?.error && s.state === "failed" && <span style={{ display: "block", marginTop: 2, color: "var(--bad)" }}>{s.error}</span>}
      </span>
      <button className="sr-btn2" onClick={() => sync.mutate()} disabled={busy}>
        {busy ? <Loader2 className="sr-spin" /> : <RefreshCw />} {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

// ── 2. mis-registered leads, and 3. source names ──

type AuditQuery = { data?: AuditData | null; isLoading: boolean; isFetching: boolean; isError: boolean; error: { message: string } | null; refetch: () => unknown };

// ── 0. the overview: tiles, charts, the comparison and the Excel export ──

const sumOf = (rows: { leads: number; signed: number }[]) => ({ leads: rows.reduce((a, r) => a + r.leads, 0), signed: rows.reduce((a, r) => a + r.signed, 0) });

/** "▲ 4 (+25%)" against the comparison. These are lists to clear, so fewer is better: up is red. */
function Change({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev == null) return null;
  const d = cur - prev;
  if (d === 0) return <span className="muted">no change</span>;
  return <span className={d > 0 ? "dm-diff-bad" : "dm-diff-ok"}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}{prev ? ` (${d > 0 ? "+" : "−"}${Math.round((Math.abs(d) / prev) * 100)}%)` : ""}</span>;
}

function AuditOverview({ q, from, to, scope, onScope, cmp, onCmp }: {
  q: AuditQuery; from: string; to: string; scope: Scope; onScope: (s: Scope) => void; cmp: CompareChoice; onCmp: (c: CompareChoice) => void;
}) {
  const { data, isLoading, isFetching, isError, error, refetch } = q;
  const c = data?.compare ?? null;
  const vs = c ? c.label : null;
  const panels = data ? [
    { name: "Possibly digital", ...sumOf(data.possiblyDigital), prev: c?.possiblyDigital.leads },
    { name: "Possibly not digital", ...sumOf(data.possiblyNotDigital), prev: c?.possiblyNotDigital.leads },
    { name: "Toll-free line", ...sumOf(data.tollFree), prev: c?.tollFree.leads },
    { name: "BD/FR on a digital campaign", ...sumOf(data.teamCampaigns), prev: c?.teamCampaigns.leads },
  ] : [];
  const gain = data ? DIGITAL_GROUPS.map((g) => {
    const w = data.wouldAdd.find((x) => x.group === g);
    return { name: DIGITAL_GROUP_LABEL[g], leads: w?.leads ?? 0, signed: w?.signed ?? 0, prev: c?.wouldAdd.find((x) => x.group === g)?.leads ?? null };
  }) : [];
  const bySource = new Map<string, { leads: number; signed: number }>();
  for (const g of data ? [...data.possiblyDigital, ...data.possiblyNotDigital, ...data.tollFree] : []) {
    const e = bySource.get(g.source) ?? { leads: 0, signed: 0 };
    e.leads += g.leads; e.signed += g.signed;
    bySource.set(g.source, e);
  }
  const top = Array.from(bySource, ([name, v]) => ({ name, ...v, prev: c ? c.bySource[name] ?? 0 : null }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name)).slice(0, 8);

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Overview</h2>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="sr-seg" role="group" aria-label="How far back">
            {([["period", "This period"], ["12m", "Last 12 months"], ["all", "All time"]] as const).map(([v, l]) => (
              <button key={v} className={scope === v ? "on" : ""} onClick={() => onScope(v)}>{l}</button>
            ))}
          </div>
          <VsControl value={cmp} onChange={onCmp} allTime={scope !== "period"} />
          <ExportMenu from={from} to={to} scope={scope} compare={cmp} disabled={!data} />
        </div>
      </div>
      <p className="sr-sub">
        {scopeLabel(scope, from, to)}{vs ? <> · compared with <b>{vs}</b></> : scope !== "period" ? " · the comparison is for a single period" : ""}.
        {" "}Every list below is something to fix in Lead Docket, so fewer is better: a rise shows in red.
      </p>
      {!data ? (isError && !isLoading ? <LoadError what="the audit" message={error?.message} onRetry={() => refetch()} /> : <div className="sr-skel" style={{ height: 220 }} />) : (
        <>
          <div className="dm-kpis">
            <div className="dm-kpi"><b>{fmt(data.checked)}</b><span>leads checked{c ? <> · {fmt(c.checked)} in {vs}</> : null}</span></div>
            {panels.map((p) => (
              <div key={p.name} className="dm-kpi"><b>{fmt(p.leads)}</b><span>{p.name} · {fmt(p.signed)} signed {c && <Change cur={p.leads} prev={p.prev} />}</span></div>
            ))}
          </div>
          <div className="dm-grid2" style={{ marginTop: 12 }}>
            <div>
              <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)" }}>Flagged leads by list{vs ? ` — this period and ${vs}` : " — signed and not"}</h3>
              <AuditBars rows={panels} compareLabel={vs} label="Flagged leads in each list" />
            </div>
            <div>
              <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)" }}>If corrected, digital would gain</h3>
              <AuditGainChart rows={gain} compareLabel={vs} />
            </div>
          </div>
          {top.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 className="sr-sub" style={{ fontWeight: 600, color: "var(--ink)" }}>Marketing Sources most often flagged</h3>
              <AuditBars rows={top} compareLabel={vs} label="The Marketing Sources with the most flagged leads" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Export Excel: everything, or one part — always with every client, not just the page's first 100. */
function ExportMenu({ from, to, scope, compare, disabled }: { from: string; to: string; scope: Scope; compare: CompareChoice; disabled: boolean }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const run = async (parts: ExportPart[], slug: string) => {
    setBusy(true);
    const id = toast.loading("Building the Excel file…");
    try {
      const [data, directory] = await Promise.all([
        utils.marketing.digitalAudit.fetch({ from, to, scope, compare, full: true }),
        parts.includes("directory") ? utils.marketing.sourceDirectory.fetch() : Promise.resolve(null),
      ]);
      if (!data) throw new Error("no data");
      const period = scopeLabel(scope, from, to);
      const when = scope === "period" ? `${from}-to-${to}` : scope;
      await downloadAuditWorkbook({ data, directory: directory ?? null, parts, period, compareLabel: data.compare?.label ?? null }, `data-audit-${slug}-${when}.xlsx`);
      toast.success("Excel file downloaded.", { id });
    } catch {
      toast.error("Couldn't build the Excel file.", { id });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="sr-btn1" disabled={disabled || busy}>{busy ? <Loader2 size={14} className="sr-spin" /> : <Download size={14} />} Export Excel <ChevronDown size={13} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => run(EXPORT_PARTS.map(([k]) => k), "all")}><b>Everything</b>&nbsp;— every sheet, with charts</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Or one part</DropdownMenuLabel>
        {EXPORT_PARTS.map(([k, label]) => (
          <DropdownMenuItem key={k} onSelect={() => run([k], k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()))}>{label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Misregistered({ q, from, to, scope }: { q: AuditQuery; from: string; to: string; scope: Scope }) {
  const { data, isLoading, isFetching, isError, error, refetch } = q;
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
          <div className="sr-ttl"><h2>Possibly mis-registered digital leads</h2>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {data && <button className="sr-btn2" onClick={() => printIntakeReport(data, scopeLabel(scope, from, to))} title="A printable to-do list for the intake team — choose Save as PDF"><Printer size={14} /> Report for intake</button>}
            {data && <button className="sr-btn2" onClick={() => excelIntakeReport(data, scopeLabel(scope, from, to)).catch(() => toast.error("Couldn't build the Excel file."))} title="The intake report as a spreadsheet, with a Decision column to fill in"><FileSpreadsheet size={14} /> Excel</button>}
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
          <TeamCampaigns rows={data.teamCampaigns} scope={scope} from={from} to={to} />
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

type TeamRow = AuditData["teamCampaigns"][number];

/** BD/FR leads whose Lead Docket Campaign is filled in — to review, not recount: the rep keeps the credit until the Marketing Source changes. */
function TeamCampaigns({ rows, scope, from, to }: { rows: TeamRow[]; scope: Scope; from: string; to: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const leads = rows.reduce((a, r) => a + r.leads, 0), signed = rows.reduce((a, r) => a + r.signed, 0);
  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["Campaign,Files as,Client,Rep,Role,Date,Outcome,Signed,Contact Source"];
    for (const r of rows) for (const c of r.clients) lines.push([q(r.campaign), q(r.kind), q(c.name), q(c.rep), c.role, c.date ? c.date.slice(0, 10) : "", q(c.outcome), c.signed ? "yes" : "", q(c.contactSource ?? "")].join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bdfr-campaign-leads-${scope === "period" ? `${from}-to-${to}` : scope}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <h2>BD/FR leads with a digital marketing campaign</h2>
        {rows.length > 0 && <button className="sr-btn2" onClick={exportCsv}><FileSpreadsheet size={14} /> Export</button>}
      </div>
      <p className="sr-sub">
        Leads credited to a BDR or Field Rep whose Lead Docket <b>Campaign</b> is one of digital marketing's (GBP, the website, ads, the toll-free line) — {fmt(leads)} leads, {fmt(signed)} signed. They count for
        the rep, not the campaign. Often that's right (a rep's client calls the toll-free number they were given; the intake notes say so). Where the
        lead really came in on its own, change its Marketing Source in Lead Docket and it moves after the next sync.
      </p>
      {!rows.length ? <p className="sr-nil">No BD/FR lead carries a digital marketing campaign in this period.</p> : (
        <div className="sr-scroll">
          <table className="sr-t dm-t" style={{ minWidth: 640 }}>
            <thead><tr><th>Campaign in Lead Docket</th><th>Would file as</th><th className="num">Leads</th><th className="num">Signed</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.campaign;
                return (
                  <Fragment key={r.campaign}>
                    <tr className="sr-click" onClick={() => setOpen(isOpen ? null : r.campaign)}>
                      <td className="l"><b>{r.campaign}</b></td>
                      <td className="nowrap">{r.kind === "Other" ? <span className="muted">not a digital campaign</span> : r.kind in DIGITAL_GROUP_LABEL ? DIGITAL_GROUP_LABEL[r.kind as keyof typeof DIGITAL_GROUP_LABEL] : r.kind}</td>
                      <td className="num">{fmt(r.leads)}</td>
                      <td className="num">{fmt(r.signed)}</td>
                      <td className="num"><button className="dm-cell" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the clients`}><ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : undefined }} /></button></td>
                    </tr>
                    {isOpen && (
                      <tr className="dm-sub-row">
                        <td colSpan={5}>
                          <table className="sr-t dm-t sr-leads">
                            <thead><tr><th>Client</th><th>Rep</th><th>Date</th><th>Outcome</th><th>Contact Source</th></tr></thead>
                            <tbody>
                              {r.clients.map((c) => (
                                <tr key={c.id}>
                                  <td className="client"><b>{c.name}</b></td>
                                  <td className="nowrap">{c.rep}{c.role ? <span className="muted"> · {c.role}</span> : null}</td>
                                  <td className="nowrap">{leadDay(c.date)}</td>
                                  <td className="nowrap"><span className={`sr-badge ${c.signed ? "sr-b-ok" : "sr-b-grey"}`}>{c.outcome || "—"}</span></td>
                                  <td>{c.contactSource ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {r.leads > r.clients.length && <p className="dm-foot">The newest {fmt(r.clients.length)} of {fmt(r.leads)}.</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
        </div>
        <div className="sr-panel">
          <div className="sr-panel-h"><div className="sr-ttl"><h2>Near-duplicate names</h2><span className="sr-count">{h.duplicates.length}</span></div></div>
          <p className="sr-sub">Spellings that involve a digital marketing source: the same letters and digits, one name inside another, or the same first 12 letters. Ones that land in different rows first.</p>
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

// ── 4. every source in Lead Docket, shareable as a PDF ──

type Directory = NonNullable<inferRouterOutputs<AppRouter>["marketing"]["sourceDirectory"]>;
type DirRow = Directory["marketing"][number];
const DIR_TABLES = [
  ["marketing", "Marketing Sources", "How each lead is credited — the field every marketing report counts by."],
  ["contact", "Contact Sources", "How the lead reached the firm (phone, web form, chat, walk-in…)."],
  ["campaign", "Campaigns", "Lead Docket's campaign field."],
] as const;

function SourceDirectory() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof DIR_TABLES)[number][0]>("marketing");
  const { data, isLoading, isFetching, isError, error, refetch } = trpc.marketing.sourceDirectory.useQuery(undefined, { enabled: open, staleTime: 5 * 60_000 });
  const t = DIR_TABLES.find((x) => x[0] === tab)!;
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Lead Docket sources directory</h2>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
        {open && data && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="sr-seg" role="group" aria-label="Which field">
              {DIR_TABLES.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l} ({data[k].length})</button>)}
            </div>
            <button className="sr-btn2" onClick={() => printDirectory(data)}><Printer size={14} /> Save as PDF</button>
          </div>
        )}
      </div>
      <p className="sr-sub">
        Digital marketing's Marketing Sources (and the toll-free line) ever used in Lead Docket, and the Contact Sources and Campaigns of its leads, all time,
        with lead and sign-up counts and where this CRM files each one. Walker, the BD/FR team, staff and merch aren't listed. Names and counts only — no clients — so it's safe to share. <b>Save as PDF</b> prints all three lists; choose
        "Save as PDF" as the printer.
      </p>
      {!open ? (
        <button className="sr-btn2" onClick={() => setOpen(true)}><ChevronDown size={14} /> Show the directory</button>
      ) : !data ? (
        isError && !isLoading ? <LoadError what="the sources directory" message={error?.message} onRetry={() => refetch()} /> : <div className="sr-skel" style={{ height: 160 }} />
      ) : (
        <>
          <p className="sr-sub">{t[2]}</p>
          <div style={{ maxHeight: 640, overflow: "auto" }}>
            <table className="sr-t dm-t">
              <thead><tr><th>{t[1].replace(/s$/, "")}</th><th className="num">Leads</th><th className="num">Signed</th><th>First – last lead</th>{tab === "marketing" && <th>Filed in the CRM as</th>}</tr></thead>
              <tbody>
                {data[tab].map((r) => (
                  <tr key={r.name}>
                    <td className="l"><b>{r.name}</b></td>
                    <td className="num">{fmt(r.leads)}</td>
                    <td className="num">{fmt(r.signed)}</td>
                    <td className="nowrap">{span(r)}</td>
                    {tab === "marketing" && <td>{r.category}{r.detail && r.detail !== r.name ? <span className="sr-sub"> · {r.detail}</span> : null}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const scopeLabel = (scope: Scope, from: string, to: string) =>
  scope === "period" ? rangeLabel(from, to) : scope === "12m" ? "the last 12 months" : "all time";

/**
 * The audit as a to-do list for the intake team (Youssef, 2026-10-01: "create
 * a report to send to Malvin, intake team"): the leads whose Marketing Source
 * may need changing in Lead Docket, each with a box to tick. It names clients,
 * so it says it's internal. Only Lead Docket's own fields appear — what intake
 * itself entered — and no CRM facility or partner data, so it stays on intake's
 * side of the BD/FR wall.
 */
function printIntakeReport(d: AuditData, period: string) {
  const w = window.open("", "_blank");
  if (!w) { toast.error("Allow pop-ups for this site to save the PDF."); return; }
  const box = '<span class="box"></span>';
  const team = d.teamCampaigns.filter((t) => t.kind !== "Other");
  const count = (rows: { leads: number; signed: number }[]) => rows.reduce((a, r) => [a[0] + r.leads, a[1] + r.signed], [0, 0]);
  const [tl, ts] = count(team), [dl, ds] = count(d.possiblyDigital), [nl, ns] = count(d.possiblyNotDigital);
  const kindLabel = (k: string) => (k in DIGITAL_GROUP_LABEL ? DIGITAL_GROUP_LABEL[k as keyof typeof DIGITAL_GROUP_LABEL] : k);
  const rows = (clients: { name: string; date: string | null; outcome: string; signed: boolean; contactSource: string | null; campaign?: string | null; rep?: string; role?: string }[], withRep: boolean, choices: [string, string]) =>
    `<table><thead><tr><th>Client</th>${withRep ? "<th>Credited to</th>" : ""}<th>Date</th><th>Outcome</th><th>Contact Source</th>${withRep ? "" : "<th>Campaign</th>"}<th class="c">${esc(choices[0])}</th><th class="c">${esc(choices[1])}</th></tr></thead><tbody>${
      clients.map((c) => `<tr><td><b>${esc(c.name)}</b></td>${withRep ? `<td>${esc(c.rep ?? "")}${c.role ? ` <span class="m">${esc(c.role)}</span>` : ""}</td>` : ""}<td class="d">${esc(leadDay(c.date))}</td><td>${c.signed ? `<b>${esc(c.outcome)}</b>` : esc(c.outcome || "—")}</td><td>${esc(c.contactSource ?? "—")}</td>${withRep ? "" : `<td>${esc(c.campaign ?? "—")}</td>`}<td class="c">${box}</td><td class="c">${box}</td></tr>`).join("")
    }</tbody></table>`;
  const more = (g: { leads: number; clients: unknown[] }) => (g.leads > g.clients.length ? `<p class="m">Showing the newest ${fmt(g.clients.length)} of ${fmt(g.leads)} — the rest are in the CRM.</p>` : "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lead Docket attribution review — ${esc(period)}</title><style>
    @page { size: letter landscape; margin: 12mm; }
    body { font: 10px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1c1c1e; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 18px 0 4px; border-bottom: 2px solid #1c1c1e; padding-bottom: 3px; break-after: avoid; }
    h3 { font-size: 11px; margin: 12px 0 3px; break-after: avoid; } h3 span, .m { font-weight: 400; color: #666; }
    .meta { color: #666; margin-bottom: 8px; } .conf { display: inline-block; background: #fdecea; color: #a1281c; border-radius: 4px; padding: 2px 6px; font-weight: 600; }
    .kpis { display: flex; gap: 10px; margin: 10px 0; } .kpis div { border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; } .kpis b { display: block; font-size: 15px; }
    .how { background: #f5f5f7; border-radius: 6px; padding: 8px 12px; margin: 6px 0 4px; } .how li { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; } th { text-align: left; font-size: 9px; text-transform: uppercase; color: #666; border-bottom: 1px solid #bbb; padding: 3px 4px; }
    td { padding: 3px 4px; border-bottom: 1px solid #eee; vertical-align: top; } tr { break-inside: avoid; } .d { white-space: nowrap; } .c { text-align: center; width: 70px; }
    .box { display: inline-block; width: 10px; height: 10px; border: 1px solid #555; border-radius: 2px; } .nil { color: #666; font-style: italic; }
  </style></head><body>
    <h1>Lead Docket attribution review</h1>
    <div class="meta">Farahi Law · for the Intake team · leads from ${esc(period)} · generated ${esc(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }))} Pacific · <span class="conf">Internal — contains client names</span></div>
    <div class="kpis">
      <div><b>${fmt(tl)}</b>BD/FR leads on a marketing campaign · ${fmt(ts)} signed</div>
      <div><b>${fmt(dl)}</b>possibly digital, not credited · ${fmt(ds)} signed</div>
      <div><b>${fmt(nl)}</b>credited digital, maybe not · ${fmt(ns)} signed</div>
    </div>
    <div class="how"><b>What we need:</b> for each lead below, check how the client really found us and tick one box.
      <ul>
        <li>If the Marketing Source in Lead Docket is wrong, change it there. The CRM picks it up on the next sync — nothing needs changing anywhere else.</li>
        <li>A rep or partner who actually referred the client keeps the credit, even if the client then called the website or toll-free number.</li>
        <li>Going forward: ask every caller "How did you hear about us?" and record the rep or partner only when one sent them.</li>
      </ul>
    </div>

    <h2>1. Leads credited to a BDR or Field Rep that came in on a marketing campaign</h2>
    <p class="m">Lead Docket's Campaign says the call came through a marketing line or site, but the Marketing Source is a rep, so the lead counts for the rep, not the campaign.</p>
    ${team.length ? team.map((t) => `<h3>${esc(t.campaign)} <span>· would count as ${esc(kindLabel(t.kind))} · ${fmt(t.leads)} leads · ${fmt(t.signed)} signed</span></h3>${rows(t.clients, true, ["Rep referred — keep", "Came on own — change"])}${more(t)}`).join("") : '<p class="nil">None in this period.</p>'}

    <h2>2. Leads that look digital but aren't credited to a digital source</h2>
    <p class="m">The Marketing Source isn't digital (or is empty), but the Contact Source, campaign or web link says the client came in online.</p>
    ${d.possiblyDigital.length ? d.possiblyDigital.map((g) => `<h3>${esc(g.source)} <span>· ${esc(g.evidence)} · would count as ${esc(g.group ? DIGITAL_GROUP_LABEL[g.group] : "")} · ${fmt(g.leads)} leads · ${fmt(g.signed)} signed</span></h3>${rows(g.clients, false, ["Correct as is", "Change source"])}${more(g)}`).join("") : '<p class="nil">None in this period.</p>'}

    <h2>3. Leads credited to a digital source that may have come another way</h2>
    <p class="m">The Marketing Source is digital, but the Contact Source says otherwise (a Walker line, staff, an existing client, a partner…).</p>
    ${d.possiblyNotDigital.length ? d.possiblyNotDigital.map((g) => `<h3>${esc(g.source)} <span>· ${esc(g.evidence)} · ${fmt(g.leads)} leads · ${fmt(g.signed)} signed</span></h3>${rows(g.clients, false, ["Correct as is", "Change source"])}${more(g)}`).join("") : '<p class="nil">None in this period.</p>'}
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  let done = false;
  const go = () => { if (done) return; done = true; try { w.focus(); w.print(); } catch { /* the window was closed */ } };
  w.onload = go;
  setTimeout(go, 600);
}

/**
 * The intake report as a workbook: a summary tab and one tab per section,
 * one row per lead with a blank Decision and Notes column for intake to fill
 * in. Same leads as the printed report; xlsx loads only when asked for.
 */
async function excelIntakeReport(d: AuditData, period: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const day = (iso: string | null) => (iso ? leadDay(iso) : "");
  const team = d.teamCampaigns.filter((t) => t.kind !== "Other");
  const sum = (rows: { leads: number; signed: number }[]) => rows.reduce((a, r) => [a[0] + r.leads, a[1] + r.signed], [0, 0]);
  const [tl, ts] = sum(team), [dl, ds] = sum(d.possiblyDigital), [nl, ns] = sum(d.possiblyNotDigital);

  const summary = XLSX.utils.aoa_to_sheet([
    ["Lead Docket attribution review — for the Intake team"],
    ["Leads from", period],
    ["Generated", new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " Pacific"],
    ["INTERNAL — contains client names"],
    [],
    ["Section", "Leads", "Signed"],
    ["1. BD/FR leads on a marketing campaign", tl, ts],
    ["2. Look digital, not credited to a digital source", dl, ds],
    ["3. Credited digital, may have come another way", nl, ns],
    [],
    ["What to do"],
    ["For each lead, check how the client really found us and fill in Decision (Keep / Change)."],
    ["If the Marketing Source in Lead Docket is wrong, change it there; the CRM picks it up on the next sync."],
    ["A rep or partner who actually referred the client keeps the credit, even if the client then called the website or toll-free number."],
  ]);
  summary["!cols"] = [{ wch: 52 }, { wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summary, "Summary");

  const sheet = (name: string, head: string[], rows: (string | number)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    if (rows.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  const kindLabel = (k: string) => (k in DIGITAL_GROUP_LABEL ? DIGITAL_GROUP_LABEL[k as keyof typeof DIGITAL_GROUP_LABEL] : k);

  sheet("1 BD-FR campaign leads",
    ["Campaign", "Would count as", "Client", "Credited to", "Role", "Date", "Outcome", "Signed", "Contact Source", "Decision (Keep rep / Change)", "Notes"],
    team.flatMap((t) => t.clients.map((c) => [t.campaign, kindLabel(t.kind), c.name, c.rep, c.role, day(c.date), c.outcome, c.signed ? "Yes" : "", c.contactSource ?? "", "", ""])),
    [38, 14, 28, 22, 6, 13, 18, 7, 30, 26, 30]);
  const groupRows = (gs: Group[]) => gs.flatMap((g) => g.clients.map((c) => [g.source, g.evidence, g.group ? DIGITAL_GROUP_LABEL[g.group] + (g.label ? ` · ${g.label}` : "") : "", c.name, day(c.date), c.outcome, c.signed ? "Yes" : "", c.contactSource ?? "", c.campaign ?? "", "", ""]));
  const groupHead = (target: string) => ["Marketing Source in Lead Docket", "Evidence", target, "Client", "Date", "Outcome", "Signed", "Contact Source", "Campaign", "Decision (Keep / Change)", "Notes"];
  const groupWidths = [34, 34, 22, 28, 13, 18, 7, 30, 30, 24, 30];
  sheet("2 Possibly digital", groupHead("Would count as"), groupRows(d.possiblyDigital), groupWidths);
  sheet("3 Possibly not digital", groupHead("Counted as"), groupRows(d.possiblyNotDigital), groupWidths);

  const safe = period.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  XLSX.writeFile(wb, `intake-attribution-review-${safe}.xlsx`);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A clean print-only page of all three lists, so the browser's "Save as PDF" gives the team a document. */
function printDirectory(d: Directory) {
  const w = window.open("", "_blank");
  if (!w) { toast.error("Allow pop-ups for this site to save the PDF."); return; }
  const total = (rows: DirRow[]) => rows.reduce((a, r) => [a[0] + r.leads, a[1] + r.signed], [0, 0]);
  // Marketing Sources grouped by where the CRM files them, biggest group first.
  const groups = new Map<string, DirRow[]>();
  for (const r of d.marketing) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  const ordered = Array.from(groups.entries()).sort((a, b) => total(b[1])[0] - total(a[1])[0]);
  const table = (rows: DirRow[], withDetail: boolean) => `<table><thead><tr><th>Name</th><th class="n">Leads</th><th class="n">Signed</th><th>First – last lead</th>${withDetail ? "<th>CRM row</th>" : ""}</tr></thead><tbody>${
    rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="n">${fmt(r.leads)}</td><td class="n">${fmt(r.signed)}</td><td class="d">${esc(span(r))}</td>${withDetail ? `<td>${esc(r.detail && r.detail !== r.name ? r.detail : "")}</td>` : ""}</tr>`).join("")
  }</tbody></table>`;
  const [ml, msg] = total(d.marketing);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lead Docket Sources Directory</title><style>
    @page { size: letter; margin: 14mm 12mm; }
    body { font: 10px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1c1c1e; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 18px 0 4px; border-bottom: 2px solid #1c1c1e; padding-bottom: 3px; break-after: avoid; }
    h3 { font-size: 11px; margin: 12px 0 3px; break-after: avoid; } h3 span { font-weight: 400; color: #666; }
    .meta { color: #666; margin-bottom: 10px; } .kpis { display: flex; gap: 10px; margin: 8px 0 4px; }
    .kpis div { border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; } .kpis b { display: block; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; } th { text-align: left; font-size: 9px; text-transform: uppercase; color: #666; border-bottom: 1px solid #bbb; padding: 3px 4px; }
    td { padding: 2px 4px; border-bottom: 1px solid #eee; vertical-align: top; } tr { break-inside: avoid; } .n { text-align: right; white-space: nowrap; } .d { white-space: nowrap; color: #555; }
    .note { color: #555; margin: 2px 0 6px; } .pb { break-before: page; }
  </style></head><body>
    <h1>Lead Docket Sources Directory</h1>
    <div class="meta">Farahi Law · digital marketing's Marketing Sources, and the Contact Sources and Campaigns of its leads, in Lead Docket, all time · generated ${esc(new Date(d.generated).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }))} Pacific · names and counts only, no client data</div>
    <div class="kpis"><div><b>${fmt(d.marketing.length)}</b>Marketing Sources</div><div><b>${fmt(d.contact.length)}</b>Contact Sources</div><div><b>${fmt(d.campaign.length)}</b>Campaigns</div><div><b>${fmt(ml)}</b>leads · ${fmt(msg)} signed</div></div>
    <h2>1. Marketing Sources, by where the CRM files them</h2>
    <p class="note">The field every marketing report counts by. "Digital" rows are what the Digital Marketing Report counts; "Other" is everything else (vendors, referrals, staff…), shown with the channel it rolls up into.</p>
    ${ordered.map(([cat, rows]) => { const [l, s] = total(rows); return `<h3>${esc(cat)} <span>· ${rows.length} names · ${fmt(l)} leads · ${fmt(s)} signed</span></h3>${table(rows, true)}`; }).join("")}
    <h2 class="pb">2. Contact Sources</h2><p class="note">How each lead reached the firm.</p>${table(d.contact, false)}
    <h2 class="pb">3. Campaigns</h2><p class="note">Lead Docket's campaign field.</p>${table(d.campaign, false)}
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // document.write doesn't always fire onload, so print once on whichever comes first.
  let done = false;
  const go = () => { if (done) return; done = true; try { w.focus(); w.print(); } catch { /* the window was closed */ } };
  w.onload = go;
  setTimeout(go, 600);
}
