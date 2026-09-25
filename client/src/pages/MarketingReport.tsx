/**
 * Marketing Report — every lead the firm takes in Lead Docket, by the marketing
 * source that brought it, laid out like the Sign-ups Report (same styles, same
 * counting). It covers every Lead Docket lead; the BD/FR team's are one row,
 * "BD/FR team", whose numbers equal the Sign-ups Report's. Private: only
 * canSeeMarketing opens it; the server enforces the same.
 *
 * This file is the page's order and state; each panel lives in ./marketing/.
 * Every clickable number hands a DrillLink to openDrill, and the one clients
 * window below shows the leads behind it.
 */
import { useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Inbox, CheckCircle2, DollarSign, Download, Loader2, Trophy, Percent, TrendingUp, Info, Megaphone, ArrowUpRight, Users,
} from "lucide-react";
import { canSeeMarketing } from "@shared/permissions";
import { REASON_KEYS, REASON_LABEL } from "@shared/marketing";
import type { DrillLink, RowRef } from "../../../server/marketing/common";
import {
  Big, DateInput, fmt, hueStyle, initials, iso, monthLabel, monthShort, presets, rangeLabel,
} from "./SignupsDashboard";
import "./SignupsDashboard.css";
import { scopeOf, usd, type Group } from "./marketing/shared";
import { CoverageBanner, FreshnessLine, loadedLabel, whenLabel } from "./marketing/Freshness";
import {
  BigWithDelta, CompareAccordion, MonthsCard, MoverCard, VsControl, compareDefault, conversionNote, type CompareChoice,
} from "./marketing/Compare";
import { AlertsAccordion, Attention } from "./marketing/Attention";
import { Scorecard } from "./marketing/Scorecard";
import { MonthGrid } from "./marketing/MonthGrid";
import { WhyAccordion, WhyNotSigned } from "./marketing/WhyNotSigned";
import { Routes } from "./marketing/Routes";
import { SPEND_EDITOR_ID, SpendAccordion, SpendEditor } from "./marketing/SpendEditor";
import { Clients, LeadList, LoadFailed } from "./marketing/Clients";
import "./marketing/MarketingReport.css";

type Out = inferRouterOutputs<AppRouter>["marketing"];
type Data = NonNullable<Out["dashboard"]>;

const FLOOR = "2020-01-01";   // "All time" starts here; nothing earlier to compare with
// The router caps a drill's case-type and campaign lists at 50 spellings.
const MAX_VARIANTS = 50;

const scrollToSpend = () => document.getElementById(SPEND_EDITOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** A Pacific instant's calendar day, 'yyyy-MM-dd' — comparable with the range's from/to. */
const pacificDay = (isoTime: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoTime));

/** A row's clients: signed first (with the toggle), or all of them. */
const rowDrill = (row: RowRef, status?: "signed" | "all"): DrillLink => ({ title: row.name, scope: scopeOf(row), ...(status ? { status } : {}) });

type Input = { from: string; to: string; group: Group; compare: CompareChoice };
const sameInput = (a: Input, b: Input) => a.from === b.from && a.to === b.to && a.group === b.group && a.compare === b.compare;

/** An open clients window, with the range of the numbers it was opened from — a month-grid cell's month is only in that range. */
type OpenDrill = { link: DrillLink; from: string; to: string };

export default function MarketingReport() {
  const { user } = useAuth();
  const allowed = canSeeMarketing(user?.email);
  const today = new Date();
  // Opens on the current month, like the Sign-ups Report.
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  // Channels group Lead Docket's per-contract and per-listing sources ("Walker Advertising Contract 26").
  const [group, setGroup] = useState<Group>("channel");
  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;
  const [cmp, setCmp] = useState<CompareChoice>(() => compareDefault(activePreset));
  const [drill, setDrill] = useState<OpenDrill | null>(null);
  // All time has nothing before it, whatever was picked for the last range.
  const allTime = from <= FLOOR;
  const compare: CompareChoice = allTime ? "off" : cmp;
  const input: Input = { from, to, group, compare };
  const { data, isLoading, isFetching, isPlaceholderData, isError, refetch } = trpc.marketing.dashboard.useQuery(
    input,
    { enabled: allowed, placeholderData: (prev) => prev },
  );
  // placeholderData keeps the last numbers on screen while a new period, grouping or comparison loads. Until the
  // new ones arrive, the labels, drills and export must describe the numbers shown — a Sep cell asked for with
  // August's dates finds nobody — so they read the input those numbers were fetched for, not the controls.
  const [settled, setSettled] = useState(input);
  if (data && !isPlaceholderData && !sameInput(settled, input)) setSettled(input);
  const view = data && isPlaceholderData ? settled : input;
  const openDrill = (link: DrillLink) => setDrill({ link, from: view.from, to: view.to });

  if (!allowed) {
    return (
      <div className="sr"><div className="sr-canvas"><div className="sr-inner">
        <section className="sr-hero"><h1>Marketing report</h1><p className="sr-lead">This report is private.</p></section>
      </div></div></div>
    );
  }

  // The window's note when the leads it lists reach back past what Lead Docket has loaded. A month-grid cell
  // lists only its month, so that month's first day is where it starts, not the range's.
  const cov = data?.coverage;
  const loadingNoteOf = (d: OpenDrill) => {
    const m = d.link.scope.month;
    const start = m && `${m}-01` > d.from ? `${m}-01` : d.from;
    return cov && !cov.complete && cov.completeFrom && start < pacificDay(cov.completeFrom)
      ? `Leads before ${loadedLabel(cov) ?? "the loaded history"} are still loading.`
      : undefined;
  };

  return (
    <div className="sr">
      <div className="sr-canvas">
        <div className="sr-inner">
          <div className="sr-top">
            <div className="sr-seg" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.label} className={p.label === activePreset ? "on" : ""}
                  onClick={() => { setFrom(p.from); setTo(p.to); setCmp(compareDefault(p.label)); }}>{p.label}</button>
              ))}
            </div>
            <div className="sr-seg" role="group" aria-label="Group by">
              <button className={group === "channel" ? "on" : ""} onClick={() => setGroup("channel")}>Channels</button>
              <button className={group === "source" ? "on" : ""} onClick={() => setGroup("source")}>Sources</button>
            </div>
            <VsControl value={cmp} onChange={setCmp} allTime={allTime} />
            <span className="sr-dates">
              <DateInput value={from} onChange={setFrom} label="From" />
              –
              <DateInput value={to} onChange={setTo} label="To" />
            </span>
            {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          </div>

          <section className="sr-hero mk-hero">
            <div className="sr-hero-top">
              <div>
                <h1>Marketing report</h1>
                <p className="sr-lead">
                  Every Lead Docket lead by marketing source · {rangeLabel(view.from, view.to)}
                  {data?.compare ? ` · compared with ${data.compare.label}` : ""}
                  {data && <FreshnessLine c={data.coverage} />}
                </p>
              </div>
              <div className="sr-actions">
                <button className="sr-btn2" onClick={() => data && exportSummary(data, view.from, view.to)} disabled={!data}><Download /> Export summary</button>
              </div>
            </div>
            {data && <CoverageBanner c={data.coverage} />}
            {data && <HeroBottom data={data} onDrill={openDrill} />}
          </section>

          {!data && isError ? (
            <div className="sr-panel"><LoadFailed what="the report" onRetry={() => refetch()} /></div>
          ) : isLoading || !data ? (
            <div className="sr-features">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 270 }} />)}</div>
          ) : (
            <Report data={data} from={view.from} to={view.to} group={view.group} onDrill={openDrill} />
          )}

          {drill && (
            <Clients key={JSON.stringify(drill)} drill={drill.link} from={drill.from} to={drill.to} loadingNote={loadingNoteOf(drill)}
              onClose={() => setDrill(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

/** The summary CSV: the page's numbers, block by block (the clients window exports the clients themselves). */
function exportSummary(data: Data, from: string, to: string) {
  // Quoted, and a leading = + - @ defused so a spreadsheet won't run a Lead Docket name as a formula.
  const q = (s: unknown) => {
    const v = String(s ?? "");
    return `"${(/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;
  };
  const c = data.compare;
  const cov = data.coverage;
  const prevOf = (name: string) => (c && Object.prototype.hasOwnProperty.call(c.byName, name) ? c.byName[name] : null);
  const cmpHead = c ? ",Prev leads,Prev signed,Change in signed,Prev conversion %" : "";
  const cmpCells = (name: string, signed: number) => {
    if (!c) return [];
    const p = prevOf(name);
    return [p?.leads ?? 0, p?.signed ?? 0, signed - (p?.signed ?? 0), p ? p.conversion : ""];
  };
  // Spend entered for a name with no leads here is still in the Spend total, so it gets a line, as on the
  // scorecard, and the Spend column adds up to the total's.
  const unmatched = data.spendUnmatched;
  const unmatchedSum = Math.round(unmatched.reduce((a, u) => a + u.amount, 0) * 100) / 100;

  const lines = [
    `Marketing report,${from} to ${to},every Lead Docket lead (BD/FR team as one row)`, "",
    "Summary,Value",
    `Leads,${data.totals.leads}`, `Signed,${data.totals.signed}`, `Conversion,${data.totals.conversion}%`,
    `Spend,${data.totals.spend ?? ""}`, `Cost per lead,${data.totals.costPerLead ?? ""}`, `Cost per sign-up,${data.totals.costPerSignup ?? ""}`,
    ...(c ? [`Compared with,${q(c.label + (c.partial ? " (not fully loaded yet)" : ""))}`] : []),
    `Lead Docket complete back to,${q(loadedLabel(cov) ?? (cov.complete ? "complete" : "not known yet"))}`,
    `Synced,${q(cov.syncedAt ? whenLabel(cov.syncedAt, new Date(), true) : "")}`, "",
    `Source,Leads,Open,Rejected,Referred Out,Not Interested,Signed Referred Out,Signed In-House,Signed,Conversion %,Spend,Cost per lead,Cost per sign-up${cmpHead}`,
    ...data.sources.map((s) => [
      q(s.name), s.leads, s.open, s.rejected, s.referredOut, s.notInterested, s.signedReferred, s.signedInHouse, s.signed, s.conversion,
      s.spend ?? "", s.costPerLead ?? "", s.costPerSignup ?? "", ...cmpCells(s.name, s.signed),
    ].join(",")),
    // Rows that had leads in the earlier period and none now, so the changes add up to the total's.
    ...(c ? c.gone.map((g) => [q(g.name), 0, 0, 0, 0, 0, 0, 0, 0, 0, "", "", "", ...cmpCells(g.name, 0)].join(",")) : []),
    ...(unmatched.length ? [[
      q(`Spend with no matching leads: ${unmatched.map((u) => u.source).join("; ")}`),
      "", "", "", "", "", "", "", "", "", unmatchedSum, "", "", ...(c ? ["", "", "", ""] : []),
    ].join(",")] : []),
    "",
    ["Sign-ups by month", ...data.months.map(monthShort), "Total"].map(q).join(","),
    ...data.sources.filter((s) => s.signed).map((s) => [q(s.name), ...s.cells, s.signed].join(",")), "",
    ["Why leads didn't sign", "Leads", ...REASON_KEYS.map((k) => REASON_LABEL[k])].map(q).join(","),
    ...data.why.rows.map((r) => [q(r.name), r.leads, ...REASON_KEYS.map((k) => r.by[k])].join(",")), "",
    "Contact route,Leads,Signed,Conversion %,Not viable,Chose another firm or went quiet",
    ...data.routes.rows.map((r) => [q(r.name), r.leads, r.signed, r.conversion, r.notViable, r.lostThem].join(",")),
    `Contact Source same as Marketing Source,${data.routes.sameAsSource}%`, "",
    "Case type,Leads,Signed,Conversion %",
    ...data.caseTypes.map((ct) => [q(ct.name), ct.leads, ct.signed, ct.conversion].join(",")), "",
    "Campaign,Source,Leads,Signed,Conversion %",
    ...data.campaigns.map((cp) => [q(cp.name), q(cp.source), cp.leads, cp.signed, cp.conversion].join(",")),
    "", `Needs attention,Level`,
    ...data.alerts.map((a) => [q(a.text), a.level].join(",")),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `marketing-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function HeroBottom({ data, onDrill }: { data: Data; onDrill: (d: DrillLink) => void }) {
  const total = data.totals.leads;
  const c = data.compare;
  const signedSources = data.sources.filter((s) => s.signed > 0);
  const [a, b] = signedSources;
  const rest = data.totals.signed - (a?.signed ?? 0) - (b?.signed ?? 0);
  const share = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "0%");
  const segments = [
    a && { label: `${a.name} signed`, n: a.signed, cls: "sr-s-dark" },
    b && { label: `${b.name} signed`, n: b.signed, cls: "sr-s-sun" },
    { label: "Other sources signed", n: rest, cls: "sr-s-hatch" },
    { label: "Not signed", n: total - data.totals.signed, cls: "sr-s-line" },
  ].filter((s): s is { label: string; n: number; cls: string } => !!s && s.n > 0);
  const vs = { partial: !!c?.partial, vsLabel: c?.label ?? null };

  return (
    <div className="sr-hero-bot">
      <div className="sr-segbar">
        {segments.length === 0 ? <p className="sr-nil">No leads in this period.</p> : segments.map((s) => (
          // On a phone a long name is cut to fit (MarketingReport.css), so the hover names it in full.
          <div key={s.label} className="sr-sg" style={{ flex: `${s.n} 1 0` }} title={`${s.label}: ${fmt(s.n)} leads`}>
            <span className="sr-sl">{s.label}</span>
            <span className={`sr-sb ${s.cls}`}>{share(s.n)}</span>
          </div>
        ))}
      </div>
      <div className="sr-bigs mk-cmp-bigs">
        <BigWithDelta n={fmt(total)} label="Leads" icon={<Inbox />} cur={total} prev={c?.totals.leads} kind="count" {...vs}
          onClick={() => onDrill({ title: "All leads", scope: {}, status: "all" })} />
        <BigWithDelta n={fmt(data.totals.signed)} label="Signed" icon={<CheckCircle2 />} cur={data.totals.signed} prev={c?.totals.signed} kind="count" {...vs}
          onClick={() => onDrill({ title: "All leads", scope: {}, status: "signed" })} />
        {data.totals.costPerSignup != null
          // A part month's spend counts in full, so cost is compared only between whole months.
          ? <BigWithDelta n={usd(data.totals.costPerSignup)} label="Per sign-up" icon={<DollarSign />} cur={data.totals.costPerSignup}
              prev={c?.costComparable ? c.totals.costPerSignup : undefined} kind="money" invert {...vs} />
          : <Big n={fmt(data.totals.sources)} label="Sources" icon={<Megaphone />} />}
      </div>
    </div>
  );
}

function Report({ data, from, to, group, onDrill }: {
  data: Data; from: string; to: string; group: Group; onDrill: (d: DrillLink) => void;
}) {
  const noun = group === "channel" ? "channel" : "source";
  const avg = data.totals.conversion;
  const c = data.compare;
  const top = data.sources.find((s) => s.signed > 0);
  const minLeads = data.totals.leads >= 500 ? 25 : 8;
  const converter = data.sources.filter((s) => s.leads >= minLeads).sort((a, b) => b.conversion - a.conversion)[0];
  const R = 70, CIRC = 2 * Math.PI * R;
  const insightIcons = [Trophy, Percent, Users, DollarSign, Info, TrendingUp];
  // Months whose leads Lead Docket hasn't fully loaded yet, oldest first, for the panels' notes.
  const loadingMonths = data.months.filter((_, i) => (data.coverage.months[i] ?? "full") !== "full").map(monthLabel);

  return (
    <>
      <Attention alerts={data.alerts} vsLabel={c && !c.partial ? c.label : null} onDrill={onDrill} onSpend={scrollToSpend} />

      <Scorecard rows={data.sources} totals={data.totals} label={rangeLabel(from, to)} group={group}
        compare={c} gone={c?.gone ?? []} unmatched={data.spendUnmatched}
        notes={[data.partialNote].filter((s): s is string => !!s)} onDrill={onDrill} onSpend={scrollToSpend} />

      <div className="sr-features">
        {c && !c.partial && c.mover ? (
          <MoverCard mover={c.mover} vsLabel={c.label} onDrill={onDrill}
            clickable={data.sources.some((s) => s.name === c.mover!.name)} />
        ) : top ? (
          <div className="sr-spot" style={hueStyle(top.name)}>
            <span className="sr-spot-tag">Top {noun}</span>
            <div className="sr-spot-ini">{initials(top.name)}</div>
            <div className="sr-spot-foot">
              <div><b>{top.name}</b><i>{top.conversion}% of {fmt(top.leads)} leads signed</i></div>
              <span className="sr-spot-pill">{fmt(top.signed)} signed</span>
            </div>
          </div>
        ) : (
          <div className="sr-card"><div className="sr-bh"><h2>Top {noun}</h2></div><p className="sr-nil">No sign-ups in this period.</p></div>
        )}

        <MonthsCard monthly={data.monthly} compare={c} pace={data.pace} states={data.coverage.months} />

        <div className="sr-card">
          <div className="sr-bh"><h2>Conversion</h2></div>
          <div className="sr-ring">
            <svg viewBox="0 0 164 164">
              <circle className="trk" cx="82" cy="82" r={R} />
              {avg > 0 && <circle className="val" cx="82" cy="82" r={R} strokeDasharray={`${(CIRC * Math.min(avg, 100)) / 100} ${CIRC}`} />}
            </svg>
            <div className="sr-ring-c"><b>{avg}%</b><span>of leads signed</span></div>
          </div>
          <p className="sr-dial-note">
            {conversionNote(avg, c, converter ? `${converter.name} converts best, at ${converter.conversion}%.` : "The share of leads that signed.")}
          </p>
        </div>

        <div className="sr-card">
          <div className="sr-bh">
            <h2>Spend</h2>
            <button className="sr-arr" aria-label="Enter spend" onClick={scrollToSpend}><ArrowUpRight /></button>
          </div>
          <div className="sr-kv"><span className="n">{usd(data.totals.spend ?? 0)}</span><span className="u">entered for<br />these months</span></div>
          {data.totals.spend ? (
            <div className="mk-costs">
              <div><b>{usd(data.totals.costPerLead, true)}</b><i>per lead</i></div>
              <div><b>{usd(data.totals.costPerSignup, true)}</b><i>per sign-up</i></div>
            </div>
          ) : <p className="sr-nil">Enter each source's monthly spend to see what a lead and a sign-up cost.</p>}
        </div>
      </div>

      <div className="sr-board">
        <div style={{ minWidth: 0 }}>
          <MonthGrid grid={data.grid} months={data.months} monthStates={data.coverage.months} loadedLabel={loadedLabel(data.coverage)}
            group={group} avg={avg} onDrill={onDrill} />
          <WhyNotSigned why={data.why} avg={avg} loadingMonths={loadingMonths} onDrill={onDrill} />
          <Routes routes={data.routes} avg={avg} loadingMonths={loadingMonths} onDrill={onDrill} />
          <CaseTypes data={data} group={group} onDrill={onDrill} />
          <Campaigns data={data} onDrill={onDrill} />
        </div>

        <aside>
          <div className="sr-panel sr-queue">
            <div className="sr-panel-h"><h2>Executive briefing</h2><span className="sr-qn">{data.insights.length}</span></div>
            <div className="sr-qis">
              {data.insights.length === 0 ? <p className="sr-nil">No leads in this period.</p> : data.insights.map((text, n) => {
                const Icon = insightIcons[n % insightIcons.length];
                return <div key={n} className="sr-qi"><span className="sr-qi-ic"><Icon /></span><p>{text}</p></div>;
              })}
            </div>
          </div>
          <div className="sr-panel">
            <div className="sr-panel-h"><h2>How these numbers are built</h2></div>
            <details className="sr-acc">
              <summary><span>Where leads come from</span></summary>
              <p>
                Every lead the firm takes in Lead Docket, read by the same sync as the Sign-ups Report. A lead's source is its
                Marketing Source. Leads credited to a BDR or FR representative are one row, "BD/FR team" — the same leads and
                sign-ups the Sign-ups Report breaks down by rep. Malvin Rosales (Intake) isn't BD/FR, so his leads count under
                his own source. "No source recorded" means intake left Marketing Source empty.
              </p>
            </details>
            <details className="sr-acc">
              <summary><span>When a lead counts as signed</span></summary>
              <p>When it has a sign-up date, even if the case later closed. Signed leads count in the month they signed; the rest in the month they came in — the same as the Sign-ups Report.</p>
            </details>
            <SpendAccordion />
            <WhyAccordion why={data.why} />
            <CompareAccordion />
            <AlertsAccordion />
          </div>
        </aside>
      </div>

      <SpendEditor months={data.months} group={group} rows={data.sources} unmatched={data.spendUnmatched} />
      <LeadList from={from} to={to} rows={data.sources} noun={noun} />
    </>
  );
}

/** A number that opens its clients; plain text when there are none or the list can't be asked for. */
function Clickable({ drill, onDrill, title, children }: {
  drill: DrillLink | null; onDrill: (d: DrillLink) => void; title: string; children: ReactNode;
}) {
  if (!drill) return <>{children}</>;
  return <button type="button" className="mk-rp-btn" title={title} onClick={(e) => { e.stopPropagation(); onDrill(drill); }}>{children}</button>;
}

const see = (n: number) => (n === 1 ? "See this client" : `See these ${fmt(n)} clients`);

/** Case types by row: the biggest rows × the biggest types, then every type in an accordion. */
function CaseTypes({ data, group, onDrill }: { data: Data; group: Group; onDrill: (d: DrillLink) => void }) {
  const noun = group === "channel" ? "channel" : "source";
  const m = data.caseMatrix;
  const last = m.types.length - 1;   // 'All other': everything but the shown types
  const rowOf = (name: string): RowRef => data.sources.find((s) => s.name === name) ?? { name, members: [] };
  const typeScope = (i: number) => {
    const v = m.typeVariants[i] ?? [];
    if (v.length > MAX_VARIANTS) return null;
    return i === last ? { notCaseTypes: v } : { caseTypes: v };
  };
  const typeTitle = (i: number) => (i === last ? "All other case types" : m.types[i]);
  const typeDrill = (i: number): DrillLink | null => {
    const s = typeScope(i);
    return s ? { title: typeTitle(i), scope: s, status: "all" } : null;
  };
  const cellDrill = (row: RowRef, i: number): DrillLink | null => {
    const s = typeScope(i);
    return s ? { title: row.name, chips: [typeTitle(i)], scope: { ...scopeOf(row), ...s }, status: "all" } : null;
  };
  const cell = (v: { leads: number; signed: number }, drill: DrillLink | null) => (
    v.leads
      ? <Clickable drill={drill} onDrill={onDrill} title={see(v.leads)}><b>{v.signed}</b><i> / {v.leads}</i></Clickable>
      : <span className="mk-dot">·</span>
  );
  const avg = data.totals.conversion;

  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Case types by {noun}</h2></div></div>
      <p className="sr-sub">Sign-ups of all leads, for the ten biggest {noun}s and six biggest case types. Click a number or a case type for its clients.</p>
      {m.rows.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
        <div className="sr-scroll">
          <table className="sr-t mk-matrix" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>{group === "channel" ? "Channel" : "Source"}</th>
                {m.types.map((t, i) => (
                  <th key={t} className="num">
                    {m.all[i]?.leads ? <Clickable drill={typeDrill(i)} onDrill={onDrill} title={see(m.all[i].leads)}>{t}</Clickable> : t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="mk-all">
                <td className="mk-all-name">All {noun}s</td>
                {m.all.map((v, i) => <td key={i} className="num">{cell(v, typeDrill(i))}</td>)}
              </tr>
              {m.rows.map((r) => {
                const row = rowOf(r.name);
                return (
                  <tr key={r.name}>
                    <td>
                      <Clickable drill={rowDrill(row)} onDrill={onDrill} title={`See ${r.name}'s clients`}>
                        <b style={{ color: "var(--ink)", fontWeight: 600 }}>{r.name}</b>
                      </Clickable>
                    </td>
                    {r.cells.map((v, i) => <td key={i} className="num">{cell(v, cellDrill(row, i))}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.caseTypes.length > 0 && (
        <details className="sr-acc mk-rp-acc">
          <summary><span>All {data.caseTypes.length} case types</span></summary>
          <div className="sr-scroll">
            <table className="sr-t" style={{ minWidth: 460 }}>
              <thead><tr><th>Case type</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th></tr></thead>
              <tbody>
                {data.caseTypes.map((ct) => {
                  const drill: DrillLink | null = ct.variants.length <= MAX_VARIANTS ? { title: ct.name, scope: { caseTypes: ct.variants }, status: "all" } : null;
                  return (
                    <tr key={ct.name}>
                      <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{ct.name}</b></td>
                      <td className="num"><Clickable drill={ct.leads ? drill : null} onDrill={onDrill} title={see(ct.leads)}>{fmt(ct.leads)}</Clickable></td>
                      <td className="num"><span className="sr-score">{fmt(ct.signed)}</span></td>
                      <td><span className={`sr-badge ${ct.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{ct.conversion}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

const CAMPAIGNS_SHOWN = 10;

/** Lead Docket's Campaign field, hidden when no lead in the period has one. */
function Campaigns({ data, onDrill }: { data: Data; onDrill: (d: DrillLink) => void }) {
  const [all, setAll] = useState(false);
  if (data.campaigns.length === 0) return null;
  const avg = data.totals.conversion;
  const shown = all ? data.campaigns : data.campaigns.slice(0, CAMPAIGNS_SHOWN);
  const rowOf = (name: string): RowRef => data.sources.find((s) => s.name === name) ?? { name, members: [] };
  const drillOf = (cp: Data["campaigns"][number]): DrillLink | null =>
    cp.variants.length <= MAX_VARIANTS
      ? { title: cp.source, chips: [cp.name], scope: { ...scopeOf(rowOf(cp.source)), campaigns: cp.variants } }
      : null;

  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Campaigns</h2><span className="sr-count">{data.campaigns.length}</span></div></div>
      <p className="sr-sub">
        Lead Docket's Campaign field{data.campaigns.length >= 30 ? " — the 30 with the most leads" : ""}. Click one for its clients.
      </p>
      <div className="sr-scroll">
        <table className="sr-t" style={{ minWidth: 640 }}>
          <thead><tr><th>Campaign</th><th>Source</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th></tr></thead>
          <tbody>
            {shown.map((cp) => {
              const drill = drillOf(cp);
              return (
                <tr key={cp.source + "|" + cp.name} className={drill ? "sr-click" : ""} title={drill ? `See the clients from ${cp.name}` : undefined}
                  onClick={drill ? () => onDrill(drill) : undefined}>
                  <td>
                    <Clickable drill={drill} onDrill={onDrill} title={`See the clients from ${cp.name}`}>
                      <b style={{ color: "var(--ink)", fontWeight: 600 }}>{cp.name}</b>
                    </Clickable>
                  </td>
                  <td className="mk-muted">{cp.source}</td>
                  <td className="num">{fmt(cp.leads)}</td>
                  <td className="num"><span className="sr-score">{fmt(cp.signed)}</span></td>
                  <td><span className={`sr-badge ${cp.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{cp.conversion}%</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.campaigns.length > CAMPAIGNS_SHOWN && (
        <div className="mk-rp-more">
          <button type="button" className="sr-link-btn" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${data.campaigns.length}`}</button>
        </div>
      )}
    </div>
  );
}
