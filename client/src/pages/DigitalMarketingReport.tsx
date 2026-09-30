/**
 * Digital Marketing Report — the digital team's daily "MTD Performance
 * Summary" sheet, live from Lead Docket, as two views of the Marketing Report
 * (Youssef, 2026-09-30: "apply to marketing report page"): "Digital MTD
 * summary" (this file's tabs) and "Data audit" (./digital/Audit). The
 * Marketing Report owns the period, so it carries across views; the view and
 * the tab live in the address (?view=digital&tab=gbp).
 *
 * The server (server/digitalMarketing.ts) counts exactly as the Marketing
 * Report does; every count in the team table opens the clients behind it in
 * the Marketing Report's own clients window, whose total is the number clicked.
 */
import { useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import type { DrillLink, DrillScope } from "../../../server/marketing/common";
import { trpc } from "@/lib/trpc";
import { LeadDocketSyncButton } from "@/components/DataSyncPanel";
import {
  CheckCircle2, Download, Inbox, Info, Loader2, Percent, Target,
} from "lucide-react";
import {
  CASE_VALUES, DIGITAL_GROUP_LABEL, DIGITAL_GROUP_NAME, OTHER_CHANNELS, TOLL_FREE, JFJ_WEBSITE, type DigitalGroup,
} from "@shared/marketing";
import { Big, DateInput, HBar, fmt, leadDay, monthShort, pct1, presets, rangeLabel } from "./SignupsDashboard";
import { LoadError } from "./signups/LoadError";
import { Clients } from "./marketing/Clients";
import { delta, usd } from "./marketing/shared";
import { CumulativeChart, MonthlyChart, QualityChart } from "./digital/Charts";
import { AuditView } from "./digital/Audit";
import "./digital/Digital.css";

export type DigitalData = NonNullable<inferRouterOutputs<AppRouter>["marketing"]["digital"]>;
type TeamRow = DigitalData["team"][number];
type Total = DigitalData["total"];
type LabelRow = DigitalData["brands"][number];

export type PageView = "all" | "digital" | "audit";
const VIEWS: [PageView, string][] = [["all", "All marketing"], ["digital", "Digital MTD summary"], ["audit", "Data audit"]];

/** How many of the period's leads the audit thinks Lead Docket may have credited to the wrong source, both ways. */
function useAuditCount(from: string, to: string) {
  const { data } = trpc.marketing.digitalAudit.useQuery({ from, to, scope: "period" }, { placeholderData: (prev) => prev, staleTime: 60_000 });
  if (!data) return null;
  return data.possiblyDigital.reduce((a, g) => a + g.leads, 0) + data.possiblyNotDigital.reduce((a, g) => a + g.leads, 0);
}

/** All marketing | Digital MTD summary | Data audit — the Marketing Report's top-level switch, with the audit's count. */
export function ViewSwitch({ view, onView, from, to }: { view: PageView; onView: (v: PageView) => void; from: string; to: string }) {
  const count = useAuditCount(from, to);
  return (
    <div className="sr-seg dm-views" role="tablist" aria-label="Report view">
      {VIEWS.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => onView(v)}>
          {label}
          {v === "audit" && count ? <span className="dm-count-badge" title="Leads this period that may be credited to the wrong source">{fmt(count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "gbp", label: "Google Business Profile" },
  { id: "seo", label: "SEO / Website" },
  { id: "ads", label: "Ads" },
  { id: "signups", label: "Sign-ups" },
  { id: "trends", label: "Quality & trends" },
] as const;
export type DigitalTab = (typeof TABS)[number]["id"];
export const tabOf = (t: string | null): DigitalTab => TABS.find((x) => x.id === t)?.id ?? "overview";

/** A count as a button that opens its clients — plain text when there is nothing to open. */
function Cell({ n, drill, onDrill, what }: { n: number; drill: DrillLink | null; onDrill: (d: DrillLink) => void; what: string }) {
  if (!drill || n === 0) return <>{fmt(n)}</>;
  return <button type="button" className="dm-cell" onClick={() => onDrill(drill)} title={`See the ${fmt(n)} ${what}`} aria-label={`${fmt(n)} ${what} — see the clients`}>{fmt(n)}</button>;
}

/** A change against the previous period, as the Marketing Report words it. */
function Delta({ cur, prev, kind }: { cur: number | null; prev: number | null; kind: "count" | "pct" }) {
  const d = delta(cur, prev, kind);
  return <span className={`sr-tdelta ${d.tone === "ok" ? "up" : d.tone === "bad" ? "down" : ""}`} title="Against the previous period of the same length">{d.text}</span>;
}

const GROUP_ORDER: DigitalGroup[] = ["GBP", "SEO", "Ads"];

type ViewProps = {
  view: "digital" | "audit";
  onView: (v: PageView) => void;
  from: string; to: string;
  onRange: (from: string, to: string) => void;
  tab: DigitalTab;
  onTab: (t: DigitalTab) => void;
  canSync: boolean;
};

/** The two digital views, with their own pinned bar; the period is the Marketing Report's. */
export function DigitalView({ view, onView, from, to, onRange, tab, onTab, canSync }: ViewProps) {
  const today = new Date();
  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;
  const { data, isLoading, isFetching, isError, error, refetch } = trpc.marketing.digital.useQuery(
    { from, to },
    // The last numbers stay on screen while a new period loads.
    // The audit view needs it too, to compare the team's sheet with.
    { placeholderData: (prev) => prev },
  );
  const auditCount = useAuditCount(from, to);
  const [drill, setDrill] = useState<DrillLink | null>(null);

  return (
    <div className="dm">
      <div className="sr-bar">
        <div className="sr-bar-in">
          <ViewSwitch view={view} onView={onView} from={from} to={to} />
          <div className="sr-seg" role="group" aria-label="Period">
            {periods.map((p) => (
              <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => onRange(p.from, p.to)}>{p.label}</button>
            ))}
          </div>
          <span className="sr-dates">
            <DateInput value={from} onChange={(v) => onRange(v, to)} label="From" />
            –
            <DateInput value={to} onChange={(v) => onRange(from, v)} label="To" />
          </span>
          {isFetching &&<span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          <div className="sr-actions">
            {view === "digital" && <button className="sr-btn2" onClick={() => data && exportAll(data)} disabled={!data}><Download /> Export CSV</button>}
            {canSync && <LeadDocketSyncButton className="sr-btn1" hintClassName="sr-hint" />}
          </div>
        </div>
      </div>

      <div className="sr-canvas">
        <div className="sr-inner">
          <header className="sr-hero sr-hero-slim">
            <h1>{view === "audit" ? "Digital data audit" : "Digital marketing"}</h1>
            <p className="sr-lead">
              {view === "audit"
                ? <>MTD performance summary checks · {rangeLabel(from, to)} · Lead Docket is the source of truth</>
                : <>MTD performance summary · {rangeLabel(from, to)} · live from Lead Docket{data ? ` · compared with ${rangeLabel(data.prior.from, data.prior.to)}` : ""}</>}
              {auditCount != null && auditCount > 0 && view === "digital" && (
                <> · <button className="dm-cell" onClick={() => onView("audit")}>{fmt(auditCount)} lead{auditCount === 1 ? "" : "s"} may be mis-registered</button></>
              )}
            </p>
          </header>

          {view === "audit" ? (
            <AuditView from={from} to={to} report={data ?? null} onDrill={setDrill} />
          ) : (
            <>
              <div className="sr-tabs" role="tablist" aria-label="Report sections">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>{t.label}</button>
                ))}
              </div>
              {!data ? (
                isError && !isLoading
                  ? <LoadError what="the digital marketing report" message={error?.message} onRetry={() => refetch()} />
                  : <div className="dm-grid2">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 240 }} />)}</div>
              ) : tab === "gbp" ? <GbpTab data={data} onDrill={setDrill} />
                : tab === "seo" ? <SeoTab data={data} onDrill={setDrill} />
                : tab === "ads" ? <AdsTab data={data} onDrill={setDrill} />
                : tab === "signups" ? <SignupsTab data={data} />
                : tab === "trends" ? <TrendsTab data={data} />
                : <Overview data={data} onDrill={setDrill} />}
            </>
          )}

          {drill && <Clients key={JSON.stringify(drill)} drill={drill} from={from} to={to} onClose={() => setDrill(null)} />}
        </div>
      </div>
    </div>
  );
}

// ── drills ──

type Bucket = NonNullable<DrillScope["dmBucket"]>;
const BUCKET_LABEL: Record<Bucket, string> = {
  open: "Open", rejected: "Rejected", referredOut: "Referred Out", lostNI: "Lost / Not Interested",
  signedReferred: "Signed Referred Out", signedInHouse: "Signed In-House",
};
const nameOf = (g: DigitalGroup | "TOTAL") => (g === "TOTAL" ? "All digital" : DIGITAL_GROUP_NAME[g]);
/** The clients of some Lead Docket sources: every lead, the signed ones, or one column of the team table. */
function drillFor(title: string, sources: string[], what: Bucket | "all" | "signed"): DrillLink | null {
  if (!sources.length) return null;   // no sources would mean every lead in Lead Docket
  if (what === "all" || what === "signed") return { title, scope: { sources }, status: what };
  return { title, scope: { sources, dmBucket: what }, status: "all", fixed: BUCKET_LABEL[what] };
}
const sourcesOf = (r: { members: { source: string }[] }) => r.members.map((m) => m.source);

// ── overview ──

function Overview({ data, onDrill }: { data: DigitalData; onDrill: (d: DrillLink) => void }) {
  const t = data.total, p = data.prior;
  const toll = data.brands.find((b) => b.label === TOLL_FREE);
  return (
    <>
      <div className="sr-panel sr-headline">
        <div className="dm-bigs">
          <div className="dm-big">
            <Big n={fmt(t.leads)} label="Digital leads" icon={<Inbox />} />
            <span className="dm-big-sub"><Delta cur={t.leads} prev={p.leads} kind="count" /> vs {fmt(p.leads)}</span>
          </div>
          <div className="dm-big">
            <Big n={fmt(t.signed)} label="Total signed" icon={<CheckCircle2 />} />
            <span className="dm-big-sub"><Delta cur={t.signed} prev={p.signed} kind="count" /> · <b>{fmt(t.signedInHouse)}</b> in-house · <b>{fmt(t.signedReferred)}</b> referred out</span>
          </div>
          <div className="dm-big">
            <Big n={pct1(t.conversion)} label="Conversion" icon={<Percent />} />
            <span className="dm-big-sub"><Delta cur={t.conversion} prev={p.conversion} kind="pct" /> · total signed ÷ leads</span>
          </div>
          <div className="dm-big">
            <Big n={pct1(t.achieved)} label="Of target (GBP + SEO)" icon={<Target />} />
            <span className="dm-big-sub"><Delta cur={t.achieved} prev={p.achieved} kind="pct" /> · {fmt(t.targetedSigned)} of {t.target ?? "—"}{data.period.prorated ? " (prorated)" : ""}</span>
          </div>
        </div>
      </div>

      <Gaps data={data} />

      <div className="sr-sc">
        <div className="sr-sc-title">DIGITAL MARKETING TEAM</div>
        <div className="sr-scroll"><TeamTable data={data} onDrill={onDrill} /></div>
      </div>
      <p className="dm-foot">
        Every lead is in exactly one of Open, Rejected, Referred Out, Lost / Not Interested, Signed Referred Out and Signed In-House.
        Total Signed = Signed In-House + Signed Referred Out. Open includes Pending Referral (split out below); Lost / Not Interested is
        Lead Docket's Lost status, which the Marketing Report's scorecard counts under Rejected. Targets: GBP 55 and SEO 20 a month
        {data.period.prorated ? `, prorated to ${data.period.days} days (${data.period.targetMonths} of a month)` : ""}; Ads has none.
        Click any number for its clients.
      </p>

      {toll && toll.leads > 0 && (
        <p className="sr-note" style={{ marginTop: 12 }}>
          <Info /> <span>
            <b>Shared line:</b> the 800-738-0000 toll-free number brought {fmt(toll.leads)} digital leads ({pct1(t.leads ? (toll.leads / t.leads) * 100 : null)})
            and {fmt(toll.signed)} sign-ups ({pct1(t.signed ? (toll.signed / t.signed) * 100 : null)}). It is printed on the website and on merch,
            welcome kits, the emailer and billboards, so those leads count under SEO / Website here but can't be credited to the website alone.
          </span>
        </p>
      )}

      <div className="dm-grid2" style={{ marginTop: 16 }}>
        <div className="sr-panel">
          <div className="sr-panel-h"><h2>Open cases & pending referral</h2></div>
          <p className="sr-sub">Leads still open. Pending Referral is open, on its way to a referral firm.</p>
          <table className="sr-t dm-t">
            <thead><tr><th>Source</th><th className="num">Open (being worked)</th><th className="num">Pending Referral</th><th className="num">Total open</th></tr></thead>
            <tbody>
              {data.team.map((r) => (
                <tr key={r.group}>
                  <td className="l"><b>{DIGITAL_GROUP_LABEL[r.group]}</b></td>
                  <td className="num">{fmt(r.open - r.pendingReferral)}</td>
                  <td className="num">{fmt(r.pendingReferral)}</td>
                  <td className="num"><Cell n={r.open} drill={drillFor(`${nameOf(r.group)} · open`, r.members, "open")} onDrill={onDrill} what="open leads" /></td>
                </tr>
              ))}
              <tr className="foot"><td>Total cases</td><td className="num">{fmt(t.open - t.pendingReferral)}</td><td className="num">{fmt(t.pendingReferral)}</td><td className="num">{fmt(t.open)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="sr-panel">
          <div className="sr-panel-h"><h2>Sign-ups this period</h2><span className="sr-badge sr-b-grey">{data.cumulative.daily ? "by day" : "by month"}</span></div>
          <p className="sr-sub">Building up through the period, against an even pace to the GBP + SEO target{t.target != null ? ` of ${t.target}` : ""}.</p>
          <CumulativeChart rows={data.cumulative.rows} daily={data.cumulative.daily} target={data.cumulative.target} />
        </div>
      </div>

      <GroupMonths data={data} />

      <div className="dm-grid3">
        <SignedSummary data={data} />
        <CaseValueTable title="Category (Case Value) — all digital sign-ups" rows={data.caseValuesAll} />
        <ReferredSummary data={data} />
      </div>
    </>
  );
}

function Gaps({ data }: { data: DigitalData }) {
  const g = data.gaps;
  if (!g.signed || (!g.noCaseValue && !g.noAccident)) return null;
  return (
    <p className="sr-note">
      <Info /> <span>
        {g.noCaseValue > 0 && <>{fmt(g.noCaseValue)} of {fmt(g.signed)} sign-ups have no Case Value in the CRM yet — they fill in as Lead Docket reports those leads changed. </>}
        {g.noAccident > 0 && <>{fmt(g.noAccident)} have no accident date or linked leads yet, so each counts as its own case in the unique count until it is re-read.</>}
      </span>
    </p>
  );
}

/** The team's own table: GBP, SEO / Website, Ads and TOTAL, in their columns. */
function TeamTable({ data, onDrill }: { data: DigitalData; onDrill: (d: DrillLink) => void }) {
  const row = (r: TeamRow | Total, label: ReactNode, total = false) => {
    const g = r.group === "TOTAL" ? "TOTAL" : r.group;
    const d = (what: Bucket | "all" | "signed") => drillFor(`${nameOf(g)}${what === "all" ? "" : ` · ${what === "signed" ? "signed" : BUCKET_LABEL[what]}`}`, r.members, what);
    const c = (n: number, what: Bucket | "all" | "signed", noun: string) => <Cell n={n} drill={d(what)} onDrill={onDrill} what={noun} />;
    return (
      <tr key={g} className={total ? "total" : ""}>
        <td className="l">{label}</td>
        <td>{c(r.leads, "all", "leads")}</td>
        <td className="opt">{c(r.open, "open", "open leads")}</td>
        <td className="opt">{c(r.rejected, "rejected", "rejected leads")}</td>
        <td className="opt">{c(r.referredOut, "referredOut", "referred-out leads")}</td>
        <td className="opt">{c(r.lostNI, "lostNI", "lost or not interested leads")}</td>
        <td className={total ? "opt" : "cyan opt"}>{c(r.signedReferred, "signedReferred", "sign-ups referred out")}</td>
        <td className={total ? "opt" : "green strong opt"}>{fmt(r.unique)}</td>
        <td className={total ? "opt" : "yellow em opt"}>{c(r.signedInHouse, "signedInHouse", "in-house sign-ups")}</td>
        <td className={total ? "big" : "tot blue"}>{c(r.signed, "signed", "sign-ups")}</td>
        <td className={total ? "big opt" : "opt"}>{r.target ?? "—"}</td>
        <td className={total ? "big" : ""}>{pct1(r.achieved)}</td>
        <td className={total ? "big" : ""}>{pct1(r.conversion)}</td>
      </tr>
    );
  };
  return (
    <table className="sr-sct dm-sct">
      <thead>
        <tr>
          <th className="l">Name</th><th>Total Leads</th><th className="opt">Open</th><th className="opt">Rejected</th><th className="opt">Referred Out</th>
          <th className="opt">Lost / Not Interested</th><th className="cyan opt">Signed Referred Out</th><th className="green opt">Sign-up Unique Count</th>
          <th className="yellow opt">Signed In-House</th><th className="tot">Total Signed</th><th className="opt">Target</th><th>Achieved</th><th>Conversion</th>
        </tr>
      </thead>
      <tbody>
        {data.team.map((r) => row(r, <><b>{DIGITAL_GROUP_LABEL[r.group]}</b>{r.group === "Ads" && <small>no target</small>}</>))}
        {row(data.total, "TOTAL", true)}
      </tbody>
    </table>
  );
}

/** Leads and sign-ups by month for one group or all, 12 months. */
function GroupMonths({ data }: { data: DigitalData }) {
  const [g, setG] = useState<DigitalGroup | "all">("all");
  const rows = data.trend.map((m) => ({ month: m.month, ...m[g] }));
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <h2>Leads & sign-ups by channel — last 12 months</h2>
        <div className="sr-seg" role="group" aria-label="Channel group">
          {(["all", ...GROUP_ORDER] as const).map((k) => (
            <button key={k} className={g === k ? "on" : ""} onClick={() => setG(k)}>{k === "all" ? "All digital" : DIGITAL_GROUP_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <p className="sr-sub">Months end with the period's month; each lead counts in the Pacific month of its sign-up (or arrival, if unsigned).</p>
      <MonthlyChart rows={rows} what={g === "all" ? "All digital" : DIGITAL_GROUP_NAME[g]} />
    </div>
  );
}

function SignedSummary({ data }: { data: DigitalData }) {
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><h2>Signed in-house summary</h2></div>
      <p className="sr-sub">Unique: one accident's driver and passengers are one case.</p>
      <table className="sr-t dm-t">
        <thead><tr><th>Lead source</th><th className="num">Count</th><th className="num">Unique</th></tr></thead>
        <tbody>
          {data.team.map((r) => <tr key={r.group}><td className="l"><b>{DIGITAL_GROUP_LABEL[r.group]}</b></td><td className="num">{fmt(r.signedInHouse)}</td><td className="num">{fmt(r.uniqueInHouse)}</td></tr>)}
          <tr className="foot"><td>Total</td><td className="num">{fmt(data.total.signedInHouse)}</td><td className="num">{fmt(data.total.uniqueInHouse)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ReferredSummary({ data }: { data: DigitalData }) {
  const nature = new Map<string, number>();
  for (const r of data.referred) for (const n of r.nature) nature.set(n.name, (nature.get(n.name) ?? 0) + n.n);
  const succ = data.referred.reduce((a, r) => a + r.successful, 0);
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><h2>Referred out summary</h2></div>
      <p className="sr-sub">Referred out and not signed, and those the referral firm signed (successful).</p>
      <table className="sr-t dm-t">
        <thead><tr><th>Source</th><th className="num">Referred out</th><th className="num">Successful</th></tr></thead>
        <tbody>
          {data.referred.map((r) => <tr key={r.group}><td className="l"><b>{DIGITAL_GROUP_LABEL[r.group]}</b></td><td className="num">{fmt(r.referredOut)}</td><td className="num">{fmt(r.successful)}</td></tr>)}
          <tr className="foot"><td>Total</td><td className="num">{fmt(data.referred.reduce((a, r) => a + r.referredOut, 0))}</td><td className="num">{fmt(succ)}</td></tr>
        </tbody>
      </table>
      {nature.size > 0 && (
        <>
          <h3 className="sr-sub" style={{ margin: "12px 0 4px", fontWeight: 600 }}>Nature of the successful cases</h3>
          <div className="sr-hb">
            {Array.from(nature.entries()).sort((a, b) => b[1] - a[1]).map(([name, n], i) => <HBar key={name} label={name} value={n} max={succ || 1} lead={i === 0} />)}
          </div>
        </>
      )}
    </div>
  );
}

function CaseValueTable({ title, rows }: { title: string; rows: DigitalData["caseValuesAll"] }) {
  const sum = (k: "inHouse" | "referred" | "total" | "unique") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><h2>{title}</h2></div>
      <p className="sr-sub">Lead Docket's Case Value on each sign-up.</p>
      <table className="sr-t dm-t">
        <thead><tr><th>Case value</th><th className="num">In-house</th><th className="num">Referred out</th><th className="num">Total</th><th className="num">Unique</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value} className={r.total === 0 ? "none" : ""}>
              <td className="l">{(CASE_VALUES as readonly string[]).includes(r.value) ? <b>{r.value}</b> : <span className="muted">{r.value}</span>}</td>
              <td className="num">{fmt(r.inHouse)}</td><td className="num">{fmt(r.referred)}</td><td className="num">{fmt(r.total)}</td><td className="num">{fmt(r.unique)}</td>
            </tr>
          ))}
          <tr className="foot"><td>Total</td><td className="num">{fmt(sum("inHouse"))}</td><td className="num">{fmt(sum("referred"))}</td><td className="num">{fmt(sum("total"))}</td><td className="num">{fmt(sum("unique"))}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ── GBP / SEO ──

function Kpis({ k, target = true }: { k: DigitalData["kpis"]["GBP"]; target?: boolean }) {
  const items: [string, string, boolean?][] = [
    ["MTD leads", fmt(k.leads)], ["Qualified", fmt(k.qualified)], ["Quality", fmt(k.quality)], ["Non-quality", fmt(k.nonQuality)],
    ["Non-qualified", fmt(k.nonQualified)], ["Total signed", fmt(k.signed), true], ["Signed referred out", fmt(k.signedReferred)],
    ["Signed in-house", fmt(k.signedInHouse)], ["Unique signed", fmt(k.unique)],
    ...(target ? [["Target", k.target == null ? "—" : fmt(k.target)], ["% achieved", pct1(k.achieved)]] as [string, string][] : []),
    ["% conversion", pct1(k.conversion)],
  ];
  return <div className="dm-kpis">{items.map(([l, v, hl]) => <div key={l} className={`dm-kpi${hl ? " hl" : ""}`}><b>{v}</b><span>{l}</span></div>)}</div>;
}
const KPI_NOTE = "Qualified: an accepted personal-injury case type (as the Sign-ups Report's monthly summary). Quality: qualified and not turned down for no injuries, property damage only, no treatment or a gap in treatment — an estimate, since Lead Docket doesn't hold those answers. Conversion is total signed (in-house + referred out) ÷ leads.";

function LabelTable({ rows, noun, onDrill, badge, showQuality = true }: {
  rows: LabelRow[]; noun: string; onDrill: (d: DrillLink) => void; badge?: (r: LabelRow) => ReactNode; showQuality?: boolean;
}) {
  const sum = (k: "leads" | "qualified" | "quality" | "signedInHouse" | "signedReferred" | "signed") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <div className="sr-scroll">
      <table className="sr-t dm-t" style={{ minWidth: showQuality ? 760 : 620 }}>
        <thead>
          <tr>
            <th>{noun}</th><th className="num">Leads</th>{showQuality && <><th className="num">Qualified</th><th className="num">Quality</th></>}
            <th className="num">Signed in-house</th><th className="num">Signed referred out</th><th className="num">Total signed</th><th className="num">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const src = sourcesOf(r);
            return (
              <tr key={r.label} className={r.leads === 0 ? "none" : ""}>
                <td className="l"><b>{r.label}</b>{badge?.(r)}{r.leads === 0 && <span className="dm-tag grey">no leads</span>}</td>
                <td className="num"><Cell n={r.leads} drill={drillFor(r.label, src, "all")} onDrill={onDrill} what="leads" /></td>
                {showQuality && <><td className="num">{fmt(r.qualified)}</td><td className="num">{fmt(r.quality)}</td></>}
                <td className="num"><Cell n={r.signedInHouse} drill={drillFor(`${r.label} · in-house`, src, "signedInHouse")} onDrill={onDrill} what="in-house sign-ups" /></td>
                <td className="num"><Cell n={r.signedReferred} drill={drillFor(`${r.label} · referred out`, src, "signedReferred")} onDrill={onDrill} what="sign-ups referred out" /></td>
                <td className="num"><b><Cell n={r.signed} drill={drillFor(r.label, src, "signed")} onDrill={onDrill} what="sign-ups" /></b></td>
                <td className="num">{r.leads ? pct1(r.conversion) : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
          <tr className="foot">
            <td>Total</td><td className="num">{fmt(sum("leads"))}</td>{showQuality && <><td className="num">{fmt(sum("qualified"))}</td><td className="num">{fmt(sum("quality"))}</td></>}
            <td className="num">{fmt(sum("signedInHouse"))}</td><td className="num">{fmt(sum("signedReferred"))}</td><td className="num">{fmt(sum("signed"))}</td>
            <td className="num">{pct1(sum("leads") ? Math.round((sum("signed") / sum("leads")) * 1000) / 10 : null)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GbpTab({ data, onDrill }: { data: DigitalData; onDrill: (d: DrillLink) => void }) {
  const gbp = data.team.find((r) => r.group === "GBP")!;
  const outcomes = data.outcomes.GBP;
  const top = data.locations.filter((l) => l.signed > 0).slice(0, 10);
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>GBP performance monitoring</h2></div>
        <Kpis k={data.kpis.GBP} />
        <p className="dm-foot">{KPI_NOTE}</p>
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h"><div className="sr-ttl"><h2>Performance per location</h2><span className="sr-count">{data.locations.length}</span></div></div>
        <p className="sr-sub">Each Google Business listing by its office, most sign-ups first. Lead Docket's several names for one listing count together (see Data audit).</p>
        {data.locations.length ? <LabelTable rows={data.locations} noun="Location" onDrill={onDrill} /> : <p className="sr-nil">No GBP leads in this period.</p>}
      </div>
      <div className="dm-grid2">
        <div className="sr-panel">
          <div className="sr-panel-h"><h2>GBP outcome summary</h2></div>
          <p className="sr-sub">Where every GBP lead stands, split into PI cases (a case type the firm accepts) and non-PI.</p>
          <table className="sr-t dm-t">
            <thead><tr><th>Lead summary outcome</th><th className="num">Total</th><th className="num">PI case</th><th className="num">Non-PI case</th></tr></thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.key} className={o.total === 0 ? "none" : ""}>
                  <td className="l"><b>{o.label}</b></td>
                  <td className="num"><Cell n={o.total} drill={gbp.members.length ? { title: `GBP · ${o.label}`, scope: { sources: gbp.members, dmOutcome: o.key }, status: "all", fixed: o.label } : null} onDrill={onDrill} what={`leads: ${o.label}`} /></td>
                  <td className="num">{fmt(o.pi)}</td><td className="num">{fmt(o.nonPi)}</td>
                </tr>
              ))}
              <tr className="foot"><td>Total</td><td className="num">{fmt(outcomes.reduce((a, o) => a + o.total, 0))}</td><td className="num">{fmt(outcomes.reduce((a, o) => a + o.pi, 0))}</td><td className="num">{fmt(outcomes.reduce((a, o) => a + o.nonPi, 0))}</td></tr>
            </tbody>
          </table>
          <p className="dm-foot">
            From Lead Docket's status and sub-status: Pending Referral is the Pending Referral status (open); a Referred lead is Declined
            (Declined, Rejected … Referral, Work Comp, Med Mal, No Follow-Up, Settled / Closed), Pending Review, Reviewing, or Referred (other)
            for any other sub-status; Referred Signed Up is Signed Referred Out; Not Interested / Lost is the Lost status.
          </p>
        </div>
        <div>
          <CaseValueTable title="Case value — GBP sign-ups" rows={data.caseValues.GBP} />
          <div className="sr-panel">
            <div className="sr-panel-h"><h2>Sign-ups by location</h2></div>
            {top.length ? <div className="sr-hb">{top.map((l, i) => <HBar key={l.label} label={l.label} value={l.signed} max={top[0].signed} lead={i === 0} />)}</div> : <p className="sr-nil">No GBP sign-ups in this period.</p>}
          </div>
        </div>
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>GBP — last 12 months</h2></div>
        <MonthlyChart rows={data.trend.map((m) => ({ month: m.month, ...m.GBP }))} what="Google Business Profile" />
      </div>
    </>
  );
}

function SeoTab({ data, onDrill }: { data: DigitalData; onDrill: (d: DrillLink) => void }) {
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>SEO / Website performance monitoring</h2></div>
        <Kpis k={data.kpis.SEO} />
        <p className="dm-foot">{KPI_NOTE}</p>
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>Website leads summary — by brand</h2></div>
        <p className="sr-sub">Every brand, with leads this period or not. Acquisition rate is total signed ÷ leads.</p>
        <LabelTable rows={data.brands} noun="Brand" onDrill={onDrill} badge={(r) =>
          r.label === TOLL_FREE ? <span className="dm-tag warn" title="The number is also on merch, welcome kits, the emailer and billboards">shared line — attribution uncertain</span>
            : r.label === OTHER_CHANNELS ? <span className="dm-tag grey">directories & email</span> : null} />
        <p className="dm-foot">
          {JFJ_WEBSITE} counts the website's own leads — its forms, chat (Intaker) and web search. The toll-free line is printed on the website and also on merch,
          welcome kits, the emailer and soon billboards, so its leads stay in SEO / Website's totals (as on the team's sheet) but can't be credited to the website alone.
        </p>
      </div>
      <div className="dm-grid2">
        <CaseValueTable title="Case value — SEO / Website sign-ups" rows={data.caseValues.SEO} />
        <div className="sr-panel">
          <div className="sr-panel-h"><h2>SEO / Website — last 12 months</h2></div>
          <MonthlyChart rows={data.trend.map((m) => ({ month: m.month, ...m.SEO }))} what="SEO / Website" />
        </div>
      </div>
    </>
  );
}

function AdsTab({ data, onDrill }: { data: DigitalData; onDrill: (d: DrillLink) => void }) {
  const rows = data.campaigns;
  const sum = (k: "leads" | "signed" | "signedInHouse" | "signedReferred") => rows.reduce((a, r) => a + r[k], 0);
  const spend = rows.reduce((a, r) => a + (r.spend ?? 0), 0);
  const anySpend = rows.some((r) => r.spend != null);
  const leads = sum("leads"), signed = sum("signed");
  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>Ads performance summary</h2></div>
        <p className="sr-sub">
          Ad spend is the monthly spend entered in the Marketing Report (All marketing → spend) for each campaign's Lead Docket sources
          {data.spend.partial ? "; this period covers part of a month, and its spend is the whole month's" : ""}. CPL = spend ÷ leads; CPA = spend ÷ total signed.
        </p>
        <div className="sr-scroll">
          <table className="sr-t dm-t" style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Campaign</th><th className="num">MTD leads</th><th className="num">Signed in-house</th><th className="num">Signed referred out</th><th className="num">MTD signed</th><th className="num">MTD ad spend</th><th className="num">MTD CPL</th><th className="num">MTD CPA</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const src = sourcesOf(r);
                return (
                  <tr key={r.label} className={r.leads === 0 && r.spend == null ? "none" : ""}>
                    <td className="l"><b>{r.label}</b>{r.leads === 0 && <span className="dm-tag grey">no leads</span>}
                      {r.spendSources.length > 0 && <small className="muted" style={{ display: "block", fontSize: 11 }}>spend from {r.spendSources.join(", ")}</small>}</td>
                    <td className="num"><Cell n={r.leads} drill={drillFor(r.label, src, "all")} onDrill={onDrill} what="leads" /></td>
                    <td className="num">{fmt(r.signedInHouse)}</td>
                    <td className="num">{fmt(r.signedReferred)}</td>
                    <td className="num"><b><Cell n={r.signed} drill={drillFor(r.label, src, "signed")} onDrill={onDrill} what="sign-ups" /></b></td>
                    <td className="num">{r.spend == null ? <span className="muted">not entered</span> : usd(r.spend)}</td>
                    <td className="num">{usd(r.cpl, true)}</td>
                    <td className="num">{usd(r.cpa, true)}</td>
                  </tr>
                );
              })}
              <tr className="foot">
                <td>Total</td><td className="num">{fmt(leads)}</td><td className="num">{fmt(sum("signedInHouse"))}</td><td className="num">{fmt(sum("signedReferred"))}</td><td className="num">{fmt(signed)}</td>
                <td className="num">{anySpend ? usd(spend) : "—"}</td>
                <td className="num">{anySpend && leads ? usd(spend / leads, true) : "—"}</td>
                <td className="num">{anySpend && signed ? usd(spend / signed, true) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dm-foot">RND Worx Google Ads is the agency's paid search; its pooled-website leads are SEO's "RND Website Pool". A cost reads "—" when there are no leads or sign-ups to divide it by.</p>
      </div>
      <div className="dm-grid2">
        <CaseValueTable title="Case value — ads sign-ups" rows={data.caseValues.Ads} />
        <div className="sr-panel">
          <div className="sr-panel-h"><h2>Ads — last 12 months</h2></div>
          <MonthlyChart rows={data.trend.map((m) => ({ month: m.month, ...m.Ads }))} what="Paid ads" />
        </div>
      </div>
    </>
  );
}

// ── sign-ups ──

type Signup = DigitalData["signups"][number];
const q = (s: unknown) => {
  const v = String(s ?? "");
  // Quoted, with a leading = + - @ defused so a spreadsheet won't run a name as a formula.
  return `"${(/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;
};
function saveCsv(lines: string[], name: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const signupLine = (s: Signup, i: number) => [i + 1, q(s.label), q(s.caseValue ?? ""), q(s.caseType), q(s.name), s.date ? leadDay(s.date) : ""].map(String).join(",");

function SignupList({ title, rows, file }: { title: string; rows: Signup[]; file: string }) {
  const [search, setSearch] = useState("");
  const k = search.trim().toLowerCase();
  const shown = rows.filter((s) => !k || [s.name, s.label, s.caseType, s.caseValue ?? "", s.source].some((v) => v.toLowerCase().includes(k)));
  const uniques = new Set(shown.map((s) => s.accident)).size;
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>{title}</h2><span className="sr-count">{fmt(rows.length)}</span></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="sr-input" placeholder="Search name, source, case…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`Search ${title}`} style={{ width: 240 }} />
          <button className="sr-btn2" disabled={!shown.length} onClick={() => saveCsv(["Count,Lead Source,Case Value,Case Type,Client Name,Sign-up date", ...shown.map(signupLine)], file)}><Download /> CSV</button>
        </div>
      </div>
      {shown.length === 0 ? <p className="sr-nil">{rows.length ? "No sign-ups match." : "None in this period."}</p> : (
        <div className="sr-scroll">
          <table className="sr-t dm-t sr-leads" style={{ minWidth: 720 }}>
            <thead><tr><th className="num">#</th><th>Lead source</th><th>Case value</th><th>Case type</th><th>Client name</th><th>Signed</th></tr></thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id}>
                  <td className="num muted">{i + 1}</td>
                  <td className="nowrap" title={s.source}>{s.label}</td>
                  <td className="nowrap">{s.caseValue ?? <span className="muted">not recorded yet</span>}</td>
                  <td className="nowrap">{s.caseType}</td>
                  <td className="client"><b>{s.name}</b></td>
                  <td className="nowrap">{leadDay(s.date)}</td>
                </tr>
              ))}
              <tr className="foot"><td className="num">{fmt(shown.length)}</td><td colSpan={5}>sign-ups · {fmt(uniques)} unique case{uniques === 1 ? "" : "s"}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SignupsTab({ data }: { data: DigitalData }) {
  const range = `${data.period.from}-to-${data.period.to}`;
  return (
    <>
      <SignupList title="In-house signup details" rows={data.signups.filter((s) => s.kind === "inHouse")} file={`digital-in-house-signups-${range}.csv`} />
      <SignupList title="Signed referred out details" rows={data.signups.filter((s) => s.kind === "referred")} file={`digital-signed-referred-out-${range}.csv`} />
    </>
  );
}

// ── trends ──

function TrendsTab({ data }: { data: DigitalData }) {
  const [g, setG] = useState<DigitalGroup | "all">("all");
  const rows = data.trend.map((m) => ({ month: m.month, ...m[g] }));
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <h2>Lead quality and sign-ups — last 12 months</h2>
        <div className="sr-seg" role="group" aria-label="Channel group">
          {(["all", ...GROUP_ORDER] as const).map((k) => <button key={k} className={g === k ? "on" : ""} onClick={() => setG(k)}>{k === "all" ? "All digital" : DIGITAL_GROUP_LABEL[k]}</button>)}
        </div>
      </div>
      <p className="sr-sub">{KPI_NOTE}</p>
      <QualityChart rows={rows} what={g === "all" ? "All digital" : DIGITAL_GROUP_NAME[g]} />
      <div className="sr-scroll" style={{ marginTop: 12 }}>
        <table className="sr-t dm-t" style={{ minWidth: 760 }}>
          <thead><tr><th>Month</th><th className="num">Leads</th><th className="num">Qualified</th><th className="num">Quality</th><th className="num">Signed in-house</th><th className="num">Signed referred out</th><th className="num">Total signed</th><th className="num">Quality rate</th><th className="num">Conversion</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="l"><b>{monthShort(r.month)}</b></td><td className="num">{fmt(r.leads)}</td><td className="num">{fmt(r.qualified)}</td><td className="num">{fmt(r.quality)}</td>
                <td className="num">{fmt(r.signedInHouse)}</td><td className="num">{fmt(r.signedReferred)}</td><td className="num"><b>{fmt(r.signed)}</b></td>
                <td className="num">{pct1(r.qualityRate)}</td><td className="num">{pct1(r.conversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── export ──

/** Every section as one CSV, block by block, as the page shows them. */
function exportAll(d: DigitalData) {
  const L: string[] = [];
  const cols = ["Total Leads", "Open", "Pending Referral (in Open)", "Rejected", "Referred Out", "Lost/Not Interested", "Signed Referred Out", "Sign-up Unique Count", "Signed In-House", "Total Signed", "Target", "Achieved %", "Conversion %"];
  const teamLine = (name: string, r: TeamRow | Total) => [q(name), r.leads, r.open, r.pendingReferral, r.rejected, r.referredOut, r.lostNI, r.signedReferred, r.unique, r.signedInHouse, r.signed, r.target ?? "", r.achieved ?? "", r.conversion ?? ""].join(",");
  L.push(`Digital marketing - MTD performance summary,${d.period.from} to ${d.period.to},from Lead Docket`, "");
  L.push(["DIGITAL MARKETING TEAM", ...cols].map(q).join(","));
  for (const r of d.team) L.push(teamLine(DIGITAL_GROUP_LABEL[r.group], r));
  L.push(teamLine("TOTAL", d.total), "");
  L.push(`Previous period,${d.prior.from} to ${d.prior.to},Leads ${d.prior.leads},Signed ${d.prior.signed},Conversion ${d.prior.conversion ?? ""}%`, "");
  const labelBlock = (title: string, rows: LabelRow[], cost = false) => {
    L.push([title, "Leads", "Qualified", "Quality", "Signed In-House", "Signed Referred Out", "Total Signed", "Conversion %", ...(cost ? ["Ad spend", "CPL", "CPA"] : []), "Lead Docket sources"].map(q).join(","));
    for (const r of rows) L.push([q(r.label), r.leads, r.qualified, r.quality, r.signedInHouse, r.signedReferred, r.signed, r.conversion ?? "", ...(cost ? [r.spend ?? "", r.cpl ?? "", r.cpa ?? ""] : []), q(r.members.map((m) => `${m.source} (${m.leads})`).join("; "))].join(","));
    L.push("");
  };
  labelBlock("GBP location", d.locations);
  labelBlock("SEO / Website brand", d.brands);
  labelBlock("Ads campaign", d.campaigns, true);
  L.push(["GBP outcome", "Total", "PI case", "Non-PI case"].map(q).join(","));
  for (const o of d.outcomes.GBP) L.push([q(o.label), o.total, o.pi, o.nonPi].join(","));
  L.push("");
  for (const g of GROUP_ORDER) {
    L.push([`Case value - ${DIGITAL_GROUP_LABEL[g]}`, "In-house", "Referred out", "Total", "Unique"].map(q).join(","));
    for (const r of d.caseValues[g]) L.push([q(r.value), r.inHouse, r.referred, r.total, r.unique].join(","));
    L.push("");
  }
  L.push(["Referred out summary", "Referred out", "Successful"].map(q).join(","));
  for (const r of d.referred) L.push([q(DIGITAL_GROUP_LABEL[r.group]), r.referredOut, r.successful].join(","));
  L.push("");
  for (const [title, kind] of [["In-House Signup Details", "inHouse"], ["Signed Referred Out Details", "referred"]] as const) {
    L.push(title, "Count,Lead Source,Case Value,Case Type,Client Name,Sign-up date");
    d.signups.filter((s) => s.kind === kind).forEach((s, i) => L.push(signupLine(s, i)));
    L.push("");
  }
  L.push(["Month", ...GROUP_ORDER.flatMap((g) => [`${g} leads`, `${g} qualified`, `${g} quality`, `${g} signed in-house`, `${g} signed referred out`])].map(q).join(","));
  for (const m of d.trend) L.push([monthShort(m.month), ...GROUP_ORDER.flatMap((g) => [m[g].leads, m[g].qualified, m[g].quality, m[g].signedInHouse, m[g].signedReferred])].join(","));
  saveCsv(L, `digital-marketing-${d.period.from}-to-${d.period.to}.csv`);
}
