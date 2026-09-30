import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { LeadDocketSyncButton } from "@/components/DataSyncPanel";
import {
  Inbox, CheckCircle2, Download, ArrowUpRight, Loader2,
  Trophy, Percent, Users, TrendingUp, Handshake, Info, X, Link2, Pencil, Presentation,
} from "lucide-react";
import { enterFullscreen, exitFullscreenSoon } from "./signups/fullscreen";
import type { DeckPlace, PresentationProps } from "./signups/Presentation";
import "./SignupsDashboard.css";
import { RepFace, PartnerLogo } from "@/components/RepFace";
import { PartnerPicker } from "./signups/PartnerPicker";
import { TrendsPanel } from "./signups/Trends";
import { MonthlyPanel } from "./signups/Monthly";
import { LoadError } from "./signups/LoadError";

// The look lives in SignupsDashboard.css (the Voice Agents board style).

// The CEO presentation (signups/Presentation.tsx). Most visits never open it, so
// it loads on demand; that also keeps the page and the deck, which reuses this
// file's helpers, from importing each other statically. A deploy since this tab
// opened deletes the old file, so a failed load says so and hands the page back
// instead of letting the app's error screen take over mid-meeting.
const loadPresentation = () => import("./signups/Presentation");
// The Marketing Report loads its deck the same way, with the same message and fallback.
export const DECK_GONE = "The CRM was updated since this page opened. Reload the page, then press Present again.";
// lazy() keeps the fallback below for the rest of the visit, so once the load has
// failed, Present just says so: going full screen first would leave the bare
// report stuck in full screen with nothing to take it out again.
let deckFailed = false;
const SignupsPresentation = lazy<ComponentType<PresentationProps>>(
  () => loadPresentation().catch(() => {
    deckFailed = true;
    return { default: PresentationUnavailable };
  }),
);

export function PresentationUnavailable({ onExit }: { onExit: () => void }) {
  // Once, on mount: it unmounts as soon as onExit ends presenting.
  useEffect(() => {
    // "Soon": the Present click's fullscreen request may land a frame after this.
    exitFullscreenSoon();
    toast.error(DECK_GONE);
    onExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Presenting the same filters again within this long picks up on the same slide.
export const RESUME_MS = 30 * 60_000;

// English formatting regardless of the browser's language, to match the rest of the CRM.
export const fmt = (n: number) => n.toLocaleString("en-US");
// The local calendar date as YYYY-MM-DD (toISOString is UTC: after 5pm Pacific it gave tomorrow).
export const iso = (d: Date) => d.toLocaleDateString("en-CA");
const dateOf = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1);
};
export const monthLabel = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short", year: "numeric" });
export const monthAbbr = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short" });
export const monthShort = (m: string) => monthAbbr(m) + " '" + m.slice(2, 4);

/** A stable colour per name, for avatars and the spotlight card. */
const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
export const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const hueStyle = (name: string) => ({ "--h": hue(name) }) as React.CSSProperties;
/**
 * The rep with the most sign-ups on each team (FR, BDR) — ties share it — who
 * gets the trophy: the team presents FR and BDR side by side, so each team's
 * best is called out, not only the overall leader (Youssef, 2026-09-25).
 */
export function teamTops(reps: { name: string; role: string; signed: number }[]): Set<string> {
  const best = new Map<string, number>();
  for (const r of reps) best.set(r.role, Math.max(best.get(r.role) ?? 0, r.signed));
  return new Set(reps.filter((r) => r.signed > 0 && r.signed === best.get(r.role)).map((r) => r.name));
}

export const roleName = (role: string) => (role === "FR" ? "Field Representative" : role === "BDR" ? "Business Development Rep." : role);

type Role = "all" | "BDR" | "FR";
type Team = "all" | "current";
export type ReportData = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["signupsDashboard"]>;

/** Conversion and share of target, the one way the report writes them: one decimal. */
export const pct1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** Common reporting windows, so nobody has to type dates for the usual questions. */
export function presets(today: Date) {
  const y = today.getFullYear(), m = today.getMonth();
  // Weeks run Monday to Sunday — the team presents weekly. This week is Monday to
  // today (the rest hasn't happened); last week is the whole week before it.
  const monday = new Date(y, m, today.getDate() - ((today.getDay() + 6) % 7));
  return [
    { label: "This month", from: iso(new Date(y, m, 1)), to: iso(today) },
    { label: "This week", from: iso(monday), to: iso(today) },
    { label: "Last week", from: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)), to: iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1)) },
    { label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: "Year to date", from: `${y}-01-01`, to: iso(today) },
    { label: "12 months", from: iso(new Date(y, m - 11, 1)), to: iso(today) },
    { label: "All time", from: "2020-01-01", to: iso(today) },
  ];
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "team", label: "Team" },
  { id: "trends", label: "Trends" },
  { id: "partners", label: "Partners & sources" },
  { id: "leads", label: "Leads" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function SignupsDashboard() {
  const today = new Date();
  // The filters and the tab live in the address, so a reload, a shared link or
  // the way back from a rep's profile opens the report as it was left. Without
  // them it opens on the current month — what the team reviews day to day.
  const search = useSearch();
  const [, navigate] = useLocation();
  const q = new URLSearchParams(search);
  const from = q.get("from") || iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = q.get("to") || iso(today);
  const role: Role = q.get("role") === "BDR" ? "BDR" : q.get("role") === "FR" ? "FR" : "all";
  const team: Team = q.get("team") === "current" ? "current" : "all";
  const tab: Tab = TABS.find((t) => t.id === q.get("tab"))?.id ?? "overview";
  // Replace, not push: Back leaves the report instead of stepping through every filter click.
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    const s = next.toString();
    navigate(`/signups-report${s ? `?${s}` : ""}`, { replace: true });
  };
  const setTab = (t: Tab) => setParams({ tab: t === "overview" ? null : t });

  const { data, isLoading, isFetching, isPlaceholderData, isError, error, refetch } = trpc.teamReports.signupsDashboard.useQuery(
    { from, to, ...(role !== "all" ? { role } : {}), team },
    // Keep the last report on screen while a new filter loads, instead of flashing skeletons.
    { placeholderData: (prev) => prev },
  );
  const [presenting, setPresenting] = useState(false);
  const presentBtn = useRef<HTMLButtonElement>(null);
  // Where the deck is, for these filters. Leaving full screen ends the deck (Esc
  // by mistake, a clicker's second slideshow press, a look at Lead Docket in
  // another tab), so Present on the same filters picks up on the same slide, with
  // the same clock, instead of back on the cover. A ref: turning a slide needn't
  // re-render the report behind the deck.
  const deckKey = [from, to, role, team].join("|");
  const place = useRef<(DeckPlace & { key: string; at: number }) | null>(null);
  const [resume, setResume] = useState<DeckPlace>();
  const notePlace = (p: DeckPlace) => { place.current = { ...p, key: deckKey, at: Date.now() }; };
  // Fullscreen must be asked for inside the click itself; the deck may not have loaded yet.
  const present = () => {
    if (deckFailed) {
      toast.error(DECK_GONE);
      return;
    }
    const last = place.current;
    setResume(last && last.key === deckKey && Date.now() - last.at < RESUME_MS ? { slide: last.slide, startedAt: last.startedAt } : undefined);
    enterFullscreen();
    setPresenting(true);
  };
  const endPresenting = () => {
    if (place.current) place.current.at = Date.now();
    setPresenting(false);
    // Once the deck is gone and the page is live again. preventScroll leaves the
    // report scrolled where it was.
    requestAnimationFrame(() => presentBtn.current?.focus({ preventScroll: true }));
  };
  const prefetchPresentation = () => { loadPresentation().catch(() => {}); };

  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;
  const scope = [role === "all" ? "BDR and FR" : role, team === "current" ? "current team only" : "including former representatives"].join(" · ");
  // A rep's profile, with everything needed to come back to this exact view.
  const openRep = (rep: string) => navigate(`/signups-report/rep/${encodeURIComponent(rep)}?${new URLSearchParams({ ...Object.fromEntries(q), from, to })}`);

  const exportCsv = () => {
    if (!data) return;
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [
      `Sign-ups report,${from} to ${to},${q(scope)}`, "",
      "Summary,Value",
      `Leads,${data.totals.leads}`,
      `Signed,${data.totals.signed}`,
      `Conversion,${pct1(data.totals.signedPct)}`,
      ...data.roles.filter((r) => r.leads > 0).map((r) => `${r.role} sign-ups,${r.signed} (${pct1(r.share)} of sign-ups; ${pct1(r.conversion)} conversion)`),
      `Leads naming a referring partner,${data.totals.attributed}`, "",
      "Representative,Role,Status,Leads,Signed,Conversion %",
      ...data.reps.map((r) => [q(r.name), r.role, r.current ? "current" : "former", r.leads, r.signed, r.conversion.toFixed(1)].join(",")), "",
      ["Sign-ups by month", ...data.repMonths.months.map(monthShort), "Total"].map(q).join(","),
      ...data.repMonths.rows.map((r) => [q(r.name), ...r.cells, r.total].join(",")),
      ["TOTAL", ...data.months.map((m) => m.signed), data.totals.signed].join(","), "",
      "Month,Leads,Signed,Conversion %",
      ...data.months.map((m) => [monthLabel(m.month), m.leads, m.signed, m.conversion.toFixed(1)].join(",")), "",
      "Referring partner,Territory,Leads,Signed,Conversion %",
      ...data.partners.map((p) => [q(p.name), q(p.territory ?? ""), p.leads, p.signed, p.conversion.toFixed(1)].join(",")), "",
      "Case type,Leads,Signed,Conversion %",
      ...data.caseTypes.map((c) => [q(c.name), c.leads, c.signed, c.conversion.toFixed(1)].join(",")), "",
      "Case value of sign-ups,FR,BDR,Total",
      ...data.caseValues.map((v) => [q(v.value), v.FR, v.BDR, v.total].join(",")), "",
      "Lead,Case type,Case value,Representative,Role,Date,Outcome,Referring partner,Lead Docket referral text",
      ...data.leadList.map((l) => [q(l.name), q(l.caseType), q(l.caseValue ?? ""), q(l.member), l.role, l.date ? l.date.slice(0, 10) : "", q(l.outcome), q(l.partner ?? ""), q(l.referredBy ?? "")].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `signups-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sr">
      {/* One bar for every control, pinned while the report scrolls under it. */}
      <div className="sr-bar">
        <div className="sr-bar-in">
          <div className="sr-seg" role="group" aria-label="Period">
            {periods.map((p) => (
              <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => setParams({ from: p.from, to: p.to })}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="sr-dates">
            <DateInput value={from} onChange={(v) => setParams({ from: v })} label="From" />
            –
            <DateInput value={to} onChange={(v) => setParams({ to: v })} label="To" />
          </span>
          <div className="sr-seg" role="group" aria-label="Role">
            {([["all", "All"], ["BDR", "BDR"], ["FR", "FR"]] as const).map(([v, label]) => (
              <button key={v} className={role === v ? "on" : ""} onClick={() => setParams({ role: v === "all" ? null : v })}>{label}</button>
            ))}
          </div>
          <select className="sr-input" value={team} onChange={(e) => setParams({ team: e.target.value === "current" ? "current" : null })} aria-label="Representatives">
            <option value="all">Include former reps</option>
            <option value="current">Current team only</option>
          </select>
          {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          {isError && data && !isFetching && <span className="sr-fresh sr-fresh-bad">Couldn't refresh — showing the last numbers</span>}
          <div className="sr-actions">
            {/* Disabled while a new filter loads, so it never presents the old filter's numbers under the new label. */}
            <button ref={presentBtn} className="sr-btn2" onClick={present} disabled={!data || isPlaceholderData}
              onPointerEnter={prefetchPresentation} onFocus={prefetchPresentation}
              title="Show this report full screen, one slide at a time">
              <Presentation /> Present
            </button>
            <button className="sr-btn2" onClick={exportCsv} disabled={!data}><Download /> Export</button>
            <LeadDocketSyncButton className="sr-btn1" hintClassName="sr-hint" />
          </div>
        </div>
      </div>

      <div className="sr-canvas">
        <div className="sr-inner">
          <header className="sr-hero sr-hero-slim">
            <h1>Sign-ups report</h1>
            <p className="sr-lead">{rangeLabel(from, to)} · {scope} · from Lead Docket</p>
          </header>

          <div className="sr-tabs" role="tablist" aria-label="Report sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "trends" ? (
            // These read their own data, so they show whether or not the report above loaded.
            <>
              <p className="sr-note">
                <Info /> Fixed periods: these charts always show this week, this month, this year and each month of the year —
                the dates picked above don't change them. The role and representative filters do.
              </p>
              <TrendsPanel role={role} team={team} />
              <MonthlyPanel role={role} team={team} />
            </>
          ) : !data ? (
            isError && !isLoading
              ? <LoadError what="the sign-ups report" message={error?.message} onRetry={() => refetch()} />
              : <div className="sr-features">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 270 }} />)}</div>
          ) : tab === "team" ? (
            <TeamTab data={data} from={from} to={to} onRep={openRep} />
          ) : tab === "partners" ? (
            <PartnersTab data={data} />
          ) : tab === "leads" ? (
            <LeadList leads={data.leadList} />
          ) : (
            <Overview data={data} onRep={openRep} onPartners={() => setTab("partners")} />
          )}
        </div>
      </div>
      {presenting && data && (
        // The fallback is styled inline: the deck's own CSS arrives with its code.
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--canvas)" }} />}>
          <SignupsPresentation data={data} from={from} to={to} role={role} team={team} preset={activePreset}
            resume={resume} onPlace={notePlace} onExit={endPresenting} />
        </Suspense>
      )}
    </div>
  );
}

/** Where the period's leads ended up, plus the headline counts. */
function Headline({ data }: { data: ReportData }) {
  const fr = data.roles.find((r) => r.role === "FR")?.signed ?? 0;
  const bdr = data.roles.find((r) => r.role === "BDR")?.signed ?? 0;
  const total = data.totals.leads;
  const share = (n: number) => pct1(total ? (n / total) * 100 : 0);
  const segments = [
    { label: "FR signed", n: fr, cls: "sr-s-dark" },
    { label: "BDR signed", n: bdr, cls: "sr-s-sun" },
    { label: "Not signed", n: total - data.totals.signed, cls: "sr-s-line" },
  ].filter((s) => s.n > 0);

  return (
    <div className="sr-panel sr-headline">
      <div className="sr-bigs">
        <Big n={fmt(total)} label="Leads" icon={<Inbox />} />
        <Big n={fmt(data.totals.signed)} label="Signed" icon={<CheckCircle2 />} />
        <Big n={pct1(data.totals.signedPct)} label="Conversion" icon={<Percent />} />
      </div>
      <div className="sr-segbar">
        {segments.length === 0 ? <p className="sr-nil">No leads in this period.</p> : segments.map((s) => (
          <div key={s.label} className="sr-sg" style={{ flex: `${s.n} 1 0` }} title={`${fmt(s.n)} leads`}>
            <span className="sr-sl">{s.label}</span>
            <span className={`sr-sb ${s.cls}`}>{share(s.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TEAM_NAME: Record<string, string> = { FR: "Field Representatives", BDR: "Business Development Reps" };

/** FR and BDR side by side: what each team signed, from how many leads, against its target. */
function RoleSplit({ data }: { data: ReportData }) {
  const roles = (["FR", "BDR"] as const)
    .map((role) => data.roles.find((r) => r.role === role))
    .filter((r): r is ReportData["roles"][number] => !!r && r.leads > 0);
  if (!roles.length) return null;
  return (
    <div className="sr-split">
      {roles.map((r) => {
        const t = data.scorecard.groups.find((g) => g.role === r.role)?.total;
        return (
          <div key={r.role} className="sr-panel sr-split-c">
            <div className="sr-bh"><h2>{TEAM_NAME[r.role]}</h2><span className="sr-badge sr-b-grey">{pct1(r.share)} of sign-ups</span></div>
            <div className="sr-kv"><span className="n">{fmt(r.signed)}</span><span className="u">signed from<br />{fmt(r.leads)} leads</span></div>
            <dl className="sr-split-s">
              <div><dt>Conversion</dt><dd>{pct1(r.conversion)}</dd></div>
              {t?.target != null && <div><dt>Target</dt><dd>{fmt(t.target)}</dd></div>}
              {t?.target != null && <div><dt>Achieved</dt><dd>{pct1(t.achieved)}</dd></div>}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Lead Docket's Case Value of the period's sign-ups, FR and BDR side by side.
 * Values fill in as the sync re-reads leads, so "Not recorded" shrinks over time.
 */
function CaseValues({ data }: { data: ReportData }) {
  const rows = data.caseValues;
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Case value of sign-ups</h2><span className="sr-count">{fmt(data.totals.signed)}</span></div></div>
      <p className="sr-sub">From Lead Docket's Case Value. "Not recorded" leads fill in as Lead Docket syncs them again.</p>
      <table className="sr-t sr-t-fit">
        <thead><tr><th>Case value</th><th className="num">FR</th><th className="num">BDR</th><th className="num">Total</th><th style={{ width: "40%" }} /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value}>
              <td><b style={{ color: r.value === "Not recorded" ? "var(--mute)" : "var(--ink)", fontWeight: 600 }}>{r.value}</b></td>
              <td className="num">{fmt(r.FR)}</td>
              <td className="num">{fmt(r.BDR)}</td>
              <td className="num"><span className="sr-score">{fmt(r.total)}</span></td>
              <td><div className="sr-hb-t"><i style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({ data, onRep, onPartners }: { data: ReportData; onRep: (rep: string) => void; onPartners: () => void }) {
  const avg = data.totals.signedPct;
  const top = data.reps[0];
  const converter = data.reps.filter((r) => r.leads >= 10).sort((a, b) => b.conversion - a.conversion)[0];

  const recent = data.months.slice(-8);
  const stickMax = Math.max(1, ...recent.map((m) => m.signed));
  const perMonth = data.months.length ? Math.round(data.totals.signed / data.months.length) : 0;

  const R = 70, CIRC = 2 * Math.PI * R;
  const insightIcons = [CheckCircle2, Trophy, Percent, Users, TrendingUp, Handshake, Info];

  return (
    <div className="sr-board">
      <div style={{ minWidth: 0 }}>
        <Headline data={data} />
        <RoleSplit data={data} />
        <CaseValues data={data} />

        <div className="sr-features">
          {top ? (
            <div className="sr-spot sr-click" style={hueStyle(top.name)} onClick={() => onRep(top.name)} title={`Open ${top.name}'s profile`}>
              <span className="sr-spot-tag">Top representative</span>
              <div className="sr-spot-ini"><RepFace name={top.name} fallback={initials(top.name)} className="sr-spot-photo" /></div>
              <div className="sr-spot-foot">
                <div><b>{top.name}</b><i>{roleName(top.role)}</i></div>
                <span className="sr-spot-pill">{fmt(top.signed)} signed</span>
              </div>
            </div>
          ) : (
            <div className="sr-card"><div className="sr-bh"><h2>Top representative</h2></div><p className="sr-nil">No sign-ups in this period.</p></div>
          )}

          <div className="sr-card">
            <div className="sr-bh"><h2>Conversion</h2></div>
            <div className="sr-ring">
              <svg viewBox="0 0 164 164">
                <circle className="trk" cx="82" cy="82" r={R} />
                {avg > 0 && <circle className="val" cx="82" cy="82" r={R} strokeDasharray={`${(CIRC * Math.min(avg, 100)) / 100} ${CIRC}`} />}
              </svg>
              <div className="sr-ring-c"><b>{pct1(avg)}</b><span>of leads signed</span></div>
            </div>
            <p className="sr-dial-note">
              {converter ? `${converter.name} converts best, at ${pct1(converter.conversion)}.` : "The share of leads that signed."}
            </p>
          </div>

          <div className="sr-card">
            <div className="sr-bh"><h2>Signed by month</h2></div>
            <div className="sr-kv"><span className="n">{perMonth}</span><span className="u">average<br />per month</span></div>
            {recent.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
              <div className="sr-cols">
                {recent.map((m, i) => {
                  const hot = i === recent.length - 1;
                  return (
                    <div key={m.month} className={`sr-col ${hot ? "hot" : ""}`} title={`${monthLabel(m.month)}: ${m.signed} signed of ${m.leads} leads (${pct1(m.conversion)})`}>
                      {hot && <span className="sr-tipp">{m.signed}</span>}
                      <div className="sr-stick"><i style={{ height: `${Math.max(6, (m.signed / stickMax) * 100)}%` }} /></div>
                      <span className="sr-lab">{monthAbbr(m.month)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="sr-card">
            <div className="sr-bh">
              <h2>Top partners</h2>
              <button className="sr-arr" aria-label="See all referring partners" onClick={onPartners}><ArrowUpRight /></button>
            </div>
            <div className="sr-kv"><span className="n">{fmt(data.totals.attributed)}</span><span className="u">leads name a<br />referring partner</span></div>
            {data.partners.length === 0 ? <p className="sr-nil">None in this period.</p> : (
              <div className="sr-minis">
                {data.partners.slice(0, 3).map((p, i) => (
                  <div key={p.facilityId} className={`sr-m ${["sr-s-sun", "sr-s-dark", "sr-m-grey"][i]}`} title={`${p.name}: ${p.signed} signed of ${p.leads} leads`}>
                    <span>{p.signed}</span><i>{p.name}</i>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <aside>
        <div className="sr-panel sr-queue">
          <div className="sr-panel-h"><h2>Executive briefing</h2><span className="sr-qn">{data.insights.length}</span></div>
          <div className="sr-qis">
            {data.insights.map((text, n) => {
              const Icon = insightIcons[n % insightIcons.length];
              return (
                <div key={n} className="sr-qi">
                  <span className="sr-qi-ic"><Icon /></span>
                  <p>{text}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sr-panel">
          <div className="sr-panel-h"><h2>Recommendations</h2></div>
          {data.recommendations.length === 0 ? <p className="sr-nil">Nothing flagged for this period.</p> : data.recommendations.map((r, n) => (
            <div key={n} className="sr-coach"><span>Recommendation {n + 1}</span><b>{r}</b></div>
          ))}
        </div>

        <div className="sr-panel">
          <div className="sr-panel-h"><h2>How these numbers are built</h2></div>
          <details className="sr-acc">
            <summary><span>Where leads come from</span></summary>
            <p>
              Leads and sign-ups come from Lead Docket. A lead belongs to a representative when its Marketing Source names
              them — "BDR Miguel Flores", "Field Representative Lupe Campos". Marketing, intake and website leads are not counted.
            </p>
          </details>
          <details className="sr-acc">
            <summary><span>When a lead counts as signed</span></summary>
            <p>When it has a sign-up date, even if the case later closed. Months are by sign-up date for signed leads.</p>
          </details>
          <details className="sr-acc">
            <summary><span>Partner, type and territory</span></summary>
            <p>
              These come from Lead Docket's "Referred by". {fmt(data.totals.attributed)} of {fmt(data.totals.leads)} leads
              name a partner we can match; the rest still count for the representative.
            </p>
          </details>
        </div>
      </aside>
    </div>
  );
}

/**
 * Every rep in one place: the team's scorecard (their sheet's columns, a TOTAL
 * per team) with each rep's standing, or the same reps month by month. A rep
 * opens their profile; a month, the clients behind it.
 */
function TeamTab({ data, from, to, onRep }: { data: ReportData; from: string; to: string; onRep: (rep: string) => void }) {
  const [view, setView] = useState<"scorecard" | "months">("scorecard");
  const [focus, setFocus] = useState<{ rep: string; role: string; month?: string } | null>(null);
  const avg = data.totals.signedPct;
  const tops = teamTops(data.reps);
  const sc = data.scorecard;

  const cellMax = Math.max(1, ...data.repMonths.rows.flatMap((r) => r.cells));
  const level = (v: number) => (!v ? "" : v / cellMax <= 0.25 ? "l1" : v / cellMax <= 0.5 ? "l2" : v / cellMax <= 0.75 ? "l3" : "l4");

  return (
    <>
      <div className="sr-panel-h sr-tab-h">
        <div className="sr-ttl"><h2>Representatives</h2><span className="sr-count">{data.reps.length}</span></div>
        <div className="sr-seg" role="group" aria-label="View">
          <button className={view === "scorecard" ? "on" : ""} onClick={() => setView("scorecard")}>Scorecard</button>
          <button className={view === "months" ? "on" : ""} onClick={() => setView("months")}>By month</button>
        </div>
      </div>

      {view === "scorecard" ? (
        !sc.groups.length ? <div className="sr-panel"><p className="sr-nil">No leads in this period.</p></div> : (
          <div className="sr-sc-wrap">
            {sc.groups.map((g) => (
              <div key={g.role} className="sr-sc">
                <div className="sr-sc-title">{rangeLabel(from, to)}</div>
                <div className="sr-sc-band">{SC_TITLE[g.role] ?? g.role}</div>
                <div className="sr-scroll">
                  <ScorecardTable role={g.role} rows={g.rows} total={g.total} onRep={(rep) => onRep(rep)} rich={{ avg, tops }} />
                </div>
              </div>
            ))}
            <p className="sr-sub" style={{ margin: "2px 4px 18px" }}>
              Each lead counts once, in the column for where it ended up — so the columns add up to Leads.
              Lost counts as Rejected. Referred Out = referred to another firm without signing; Signed Referred Out = signed first,
              then referred. Unique = different accidents behind the sign-ups: a driver and passengers Lead Docket links are one case.{" "}
              {sc.prorated
                ? `Targets: FR 20, BDR 5 a month per rep, prorated to these ${sc.prorated.days} days (FR ${Math.round(20 * sc.prorated.share * 10) / 10}, BDR ${Math.round(5 * sc.prorated.share * 10) / 10} each).`
                : `Targets: FR ${20 * sc.months}, BDR ${5 * sc.months} a month per rep${sc.months > 1 ? ` (× ${sc.months} months)` : ""}.`}
              {" "}Standing compares a rep's conversion with the whole report's ({pct1(avg)}). Click a rep to open their profile.
            </p>
          </div>
        )
      ) : (
        <div className="sr-panel">
          {data.repMonths.rows.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
            <>
              <p className="sr-sub">Sign-ups per rep and month. Click a number for the clients behind it, a name for the rep's profile.</p>
              <div className="sr-scroll">
                <table className="sr-grid">
                  <thead>
                    <tr>
                      <th className="name" />
                      {data.repMonths.months.map((m) => <th key={m}>{monthShort(m)}</th>)}
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.repMonths.rows.map((r) => (
                      <tr key={r.name} className={r.current ? "" : "former"}>
                        <td className="name sr-click" title={`Open ${r.name}'s profile`} onClick={() => onRep(r.name)}>{r.name}<i>{r.role}</i></td>
                        {r.cells.map((v, i) => (
                          <td key={i} className={`cell ${level(v)} ${v ? "sr-click" : ""}`}
                            title={v ? `${r.name} · ${monthLabel(data.repMonths.months[i])}: see the ${v} sign-up${v === 1 ? "" : "s"}` : undefined}
                            onClick={v ? () => setFocus({ rep: r.name, role: r.role, month: data.repMonths.months[i] }) : undefined}>
                            {v || "·"}
                          </td>
                        ))}
                        <td className="tot sr-click" onClick={() => setFocus({ rep: r.name, role: r.role })}>{r.total}</td>
                      </tr>
                    ))}
                    <tr className="foot">
                      <td className="name">Signed</td>
                      {data.months.map((m) => <td key={m.month} className="cell">{m.signed}</td>)}
                      <td className="tot">{fmt(data.totals.signed)}</td>
                    </tr>
                    <tr className="soft">
                      <td className="name">Leads</td>
                      {data.months.map((m) => <td key={m.month} className="cell">{m.leads}</td>)}
                      <td className="tot">{fmt(data.totals.leads)}</td>
                    </tr>
                    <tr className="soft">
                      <td className="name">Conversion</td>
                      {data.months.map((m) => <td key={m.month} className="cell">{pct1(m.conversion)}</td>)}
                      <td className="tot">{pct1(avg)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="sr-legend">
                <span><i style={{ background: "rgba(28,28,28,.07)" }} /> A few</span>
                <span><i style={{ background: "#fdf3cc" }} /> Some</span>
                <span><i style={{ background: "#f6cf4b" }} /> Many</span>
                <span><i style={{ background: "#262626" }} /> Most in the period</span>
              </div>
            </>
          )}
        </div>
      )}
      {focus && <RepClients focus={focus} leads={data.leadList} onClose={() => setFocus(null)} />}
    </>
  );
}

/** Where the leads came from: partners, their type and territory, and the case types. */
function PartnersTab({ data }: { data: ReportData }) {
  const avg = data.totals.signedPct;
  // Facility type / territory only describe leads whose referring partner we
  // could match, so "N/A" is left out of the bars and explained instead.
  const types = data.byType.filter((t) => t.name !== "N/A");
  const territories = data.byTerritory.filter((t) => t.name !== "N/A").slice(0, 10);
  const typeMax = Math.max(1, ...types.map((t) => t.leads));
  const terrMax = Math.max(1, ...territories.map((t) => t.leads));

  // Two balanced columns, each card only as tall as itself — side-by-side cards
  // stretched to their neighbour's height sat half empty. The browser picks the split.
  return (
    <div className="sr-flow">
      <div className="sr-panel">
        <div className="sr-panel-h">
          <div className="sr-ttl"><h2>Top referring partners</h2><span className="sr-count">{data.partners.length}</span></div>
        </div>
        <p className="sr-sub">
          From the {fmt(data.totals.attributed)} leads whose "Referred by" in Lead Docket matches a partner in the CRM.
          {data.totals.leads > data.totals.attributed && (
            <> The other {fmt(data.totals.leads - data.totals.attributed)} name none we can match — <Link href="/data-check">link them in Data Check</Link>.</>
          )}
        </p>
        {data.partners.length === 0 ? <p className="sr-nil">No leads in this period name a partner we can match.</p> : (
          <div className="sr-scroll">
            <table className="sr-t sr-t-fit">
              <thead>
                <tr><th>Partner</th><th className="num">Leads</th><th className="num">Signed</th><th className="num">Conversion</th></tr>
              </thead>
              <tbody>
                {data.partners.map((p) => (
                  <tr key={p.facilityId}>
                    <td>
                      <div className="sr-who">
                        <span className="sr-av" style={hueStyle(p.name)}><PartnerLogo facilityId={p.facilityId} fallback={initials(p.name)} /></span>
                        <div><Link href={`/crm/facilities/${p.facilityId}`}><b>{p.name}</b></Link><i>{p.territory ?? "No territory"}</i></div>
                      </div>
                    </td>
                    <td className="num">{p.leads}</td>
                    <td className="num"><span className="sr-score">{p.signed}</span></td>
                    <td className="num"><span className={`sr-badge ${p.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{pct1(p.conversion)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>Referring partner type</h2></div>
        <p className="sr-sub">Leads with a matched referring partner.</p>
        {types.length === 0 ? <p className="sr-nil">No partner-attributed leads.</p> : (
          <div className="sr-hb">
            {types.map((t, i) => <HBar key={t.name} label={t.name} value={t.leads} max={typeMax} lead={i === 0} />)}
          </div>
        )}
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h">
          <div className="sr-ttl"><h2>Case types</h2><span className="sr-count">{data.caseTypes.length}</span></div>
        </div>
        <p className="sr-sub">As classified in Lead Docket.</p>
        {data.caseTypes.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
          <div className="sr-scroll">
            <table className="sr-t sr-t-fit">
              <thead>
                <tr><th>Case type</th><th className="num">Leads</th><th className="num">Signed</th><th className="num">Conversion</th></tr>
              </thead>
              <tbody>
                {data.caseTypes.map((c) => (
                  <tr key={c.name}>
                    <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{c.name}</b></td>
                    <td className="num">{fmt(c.leads)}</td>
                    <td className="num"><span className="sr-score">{fmt(c.signed)}</span></td>
                    <td className="num"><span className={`sr-badge ${c.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{pct1(c.conversion)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="sr-panel">
        <div className="sr-panel-h"><h2>Territory</h2></div>
        <p className="sr-sub">Where the referring partner is; top 10.</p>
        {territories.length === 0 ? <p className="sr-nil">No partner-attributed leads.</p> : (
          <div className="sr-hb">
            {territories.map((t, i) => <HBar key={t.name} label={t.name} value={t.leads} max={terrMax} lead={i === 0} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export const leadDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }) : "—";
export const outcomeBadge = (o: string, signed: boolean) =>
  signed ? "sr-b-ok" : /^(lost|rejected)/i.test(o) ? "sr-b-bad" : "sr-b-sun";

/** Every lead in the period by name — searchable, newest first. Also a rep's own list on their profile. */
export function LeadList({ leads, showRep = true }: { leads: ReportData["leadList"]; showRep?: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "signed" | "open">("all");
  const [showAll, setShowAll] = useState(false);
  const q = search.trim().toLowerCase();
  const rows = leads.filter((l) =>
    (status === "all" || (status === "signed") === l.signed) &&
    (!q || [l.name, l.caseType, l.member, l.partner ?? "", l.referredBy ?? "", l.outcome].some((v) => v.toLowerCase().includes(q))));
  const shown = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Leads</h2><span className="sr-count">{fmt(rows.length)}</span></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="sr-input" placeholder={showRep ? "Search lead, case type, rep, partner…" : "Search lead, case type, partner…"} value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} aria-label="Search leads" />
          <div className="sr-seg" role="group" aria-label="Outcome">
            {([["all", "All"], ["signed", "Signed"], ["open", "Not signed"]] as const).map(([v, label]) => (
              <button key={v} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-sub">Newest first. The date is the sign-up date for signed leads, otherwise the day the lead came in.</p>
      {rows.length === 0 ? <p className="sr-nil">No leads match.</p> : (
        <>
          <LeadTable rows={shown} showRep={showRep} />
          {rows.length > shown.length && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <button className="sr-btn2" onClick={() => setShowAll(true)}>Show all {fmt(rows.length)} leads</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "September 1–18, 2026", or "Aug 20, 2026 – Sep 18, 2026" across months — as the team's sheet titles it. */
export function rangeLabel(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm) {
    const month = new Date(fy, fm - 1, 1).toLocaleDateString("en-US", { month: "long" });
    return `${month} ${fd}–${td}, ${fy}`;
  }
  const f = (y: number, m: number, d: number) => new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${f(fy, fm, fd)} – ${f(ty, tm, td)}`;
}

export const SC_TITLE: Record<string, string> = { FR: "FRS", BDR: "BDRS", Intake: "INTAKE" };
export const pctText = (v: number | null) => pct1(v);

type ScorecardGroup = ReportData["scorecard"]["groups"][number];

/**
 * One team's sheet: the columns the team knows, in their order. Shared with the
 * presentation deck, so a column change reaches both. Rows open a rep's profile
 * only when onRep is given (never in the deck); TOTAL shows only when given, so
 * the deck can page a long team and total it once, on the last page. `rich`
 * adds the page's extras — photo, trophy, standing — and lets a phone drop the
 * detail columns.
 */
export function ScorecardTable({ role, rows, total, onRep, pct = pctText, targets = true, rich }: {
  role: string; rows: ScorecardGroup["rows"]; total?: ScorecardGroup["total"]; onRep?: (rep: string, role: string) => void;
  /** How Achieved and Conversion read. The deck rounds Achieved down, so a team that is short never reads 100%. */
  pct?: (v: number | null, of: "achieved" | "conversion") => string;
  /** False leaves out Target and Achieved (the deck does, for All time). */
  targets?: boolean;
  rich?: { avg: number; tops: Set<string> };
}) {
  // Nothing lands in Not Interested today, so an empty column is left out rather
  // than shown as a wall of zeros. It comes back by itself if one ever does.
  const ni = [...rows, ...(total ? [total] : [])].some((r) => r.notInterested > 0);
  return (
    <table className={`sr-sct${rich ? " rich" : ""}`}>
      <thead>
        <tr>
          <th className="l">Name</th><th>Leads</th><th className="opt">Open</th><th className="opt">Rejected</th><th className="opt">Referred Out</th>
          {ni && <th className="opt">Not Interested</th>}
          <th className="cyan opt">Signed Referred Out</th><th className="green opt">Unique</th><th className="yellow opt">Signed In-House</th>
          <th className="tot">Signed</th>{targets && <><th className="opt">Target</th><th>Achieved</th></>}<th>Conversion</th>
          {rich && <th className="opt">Standing</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const [first, ...rest] = r.name.split(" ");
          const s = rich && standing(r.conversion ?? 0, rich.avg);
          return (
            <tr key={r.name} {...(onRep ? { className: "sr-click", title: `Open ${r.name}'s profile`, onClick: () => onRep(r.name, role) } : {})}>
              <td className="l">
                {rich ? (
                  <div className="sr-who">
                    <span className="sr-av" style={hueStyle(r.name)}><RepFace name={r.name} fallback={initials(r.name)} /></span>
                    <div>
                      <b>{r.name}{rich.tops.has(r.name) && <span className="sr-award" title={`Most sign-ups among the ${role}s`}><Trophy /> Top {role}</span>}</b>
                      {!r.current && <i>former</i>}
                    </div>
                  </div>
                ) : (
                  <><b>{first}</b> <span className="last">{rest.join(" ")}</span>{!r.current && <span className="former">former</span>}</>
                )}
              </td>
              <td>{r.leads}</td><td className="opt">{r.open}</td><td className="opt">{r.rejected}</td><td className="opt">{r.referredOut}</td>
              {ni && <td className="opt">{r.notInterested}</td>}
              <td className="cyan opt">{r.signedReferred}</td>
              <td className="green strong opt">{r.unique}</td>
              <td className="yellow em opt">{r.signedInHouse}</td>
              <td className="tot blue">{r.signed}</td>
              {targets && <><td className="opt">{r.target ?? "—"}</td><td>{pct(r.achieved, "achieved")}</td></>}
              <td>{pct(r.conversion, "conversion")}</td>
              {s && <td className="opt"><span className={`sr-badge ${s.badge}`}>{s.label}</span></td>}
            </tr>
          );
        })}
        {total && (
          <tr className="total">
            <td className="l">TOTAL</td>
            <td>{total.leads}</td><td className="opt">{total.open}</td><td className="opt">{total.rejected}</td><td className="opt">{total.referredOut}</td>
            {ni && <td className="opt">{total.notInterested}</td>}
            <td className="opt">{total.signedReferred}</td><td className="opt">{total.unique}</td><td className="opt">{total.signedInHouse}</td>
            <td className="big">{total.signed}</td>
            {targets && <><td className="big opt">{total.target ?? "—"}</td><td className="big">{pct(total.achieved, "achieved")}</td></>}
            <td className="big">{pct(total.conversion, "conversion")}</td>
            {rich && <td className="opt" />}
          </tr>
        )}
      </tbody>
    </table>
  );
}

type LeadRow = ReportData["leadList"][number];

/** Clients by name — shared by the Leads list and a rep's client window. */
function LeadTable({ rows, showRep }: { rows: ReportData["leadList"]; showRep?: boolean }) {
  const [picking, setPicking] = useState<LeadRow | null>(null);
  return (
    <div className="sr-scroll">
      {/* Long names ("… Passenger of …", "… as the Mother of …") wrap instead of
          pushing Outcome and Referred by off the edge. */}
      <table className="sr-t sr-leads" style={{ minWidth: showRep ? 760 : 600 }}>
        <thead>
          <tr><th>Client</th><th>Case type</th><th>Case value</th>{showRep && <th>Representative</th>}<th>Date</th><th>Outcome</th><th>Referred by</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="client"><b>{l.name}</b></td>
              <td className="nowrap">{l.caseType}</td>
              <td className="nowrap">{l.caseValue ?? <span style={{ color: "var(--mute2)" }}>—</span>}</td>
              {showRep && <td className="nowrap">{l.member} <span className="role">{l.role}</span></td>}
              <td className="nowrap">{leadDay(l.date)}</td>
              <td className="nowrap"><span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span></td>
              <td className="partner"><ReferredBy lead={l} onPick={() => setPicking(l)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {picking && <LinkPartner lead={picking} onClose={() => setPicking(null)} />}
    </div>
  );
}

/**
 * The partner, or — when Lead Docket's "Marketing Source Details" names no
 * partner the CRM could match — intake's own words, so the list never shows a
 * blank where Lead Docket has something. Either way it can be linked by hand.
 */
function ReferredBy({ lead, onPick }: { lead: LeadRow; onPick: () => void }) {
  const edit = lead.linkable && (
    <button className="sr-link-btn" onClick={onPick} title={lead.partnerId ? "Change the partner" : "Link to a partner"}
      aria-label={lead.partnerId ? `Change the partner for ${lead.name}` : `Link ${lead.name} to a partner`}>
      {lead.partnerId ? <Pencil /> : <><Link2 /> Link</>}
    </button>
  );
  return (
    <span className="sr-ref">
      {lead.partnerId
        ? <Link href={`/crm/facilities/${lead.partnerId}`} title={lead.linkedBy ? `Linked by ${lead.linkedBy}` : undefined}>{lead.partner}</Link>
        : lead.referredBy
          ? <span className="sr-ref-raw" title="As written in Lead Docket — not linked to a partner in the CRM">{lead.referredBy}</span>
          : <span style={{ color: "var(--mute2)" }}>—</span>}
      {edit}
    </span>
  );
}

/** Pick the lead's referring partner by hand; it then counts on that partner everywhere. */
function LinkPartner({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const link = trpc.teamReports.linkLeadPartner.useMutation({
    onSuccess: (r) => {
      toast.success(r.partner
        ? `${lead.name} now counts under ${r.partner}` + (r.also ? ` — and ${r.also} other lead${r.also === 1 ? "" : "s"} with the same words` : "")
        : `${lead.name} is no longer linked to a partner`);
      utils.teamReports.signupsDashboard.invalidate();
      utils.dataCheck.get.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <PartnerPicker
      title={`Link ${lead.name} to a partner`}
      who={<><b style={{ color: "var(--ink)" }}>{lead.name}</b> · {lead.member}</>}
      said={lead.referredBy}
      currentId={lead.partnerId}
      pending={link.isPending}
      onPick={(id) => link.mutate({ leadId: lead.id, facilityId: id })}
      none={lead.partnerId ? { label: "Not from a partner", run: () => link.mutate({ leadId: lead.id, facilityId: null }) } : undefined}
      hint="The lead then counts on the partner's page and in the Partner Referral Tracker — and so does every other lead with the same words, now and later."
      onClose={onClose}
    />
  );
}

const pacificMonth = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }).slice(0, 7) : "";

/** The clients behind a rep's numbers — opened by clicking the rep or one of their months. */
function RepClients({ focus, leads, onClose }: {
  focus: { rep: string; role: string; month?: string }; leads: ReportData["leadList"]; onClose: () => void;
}) {
  const [signedOnly, setSignedOnly] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const mine = leads.filter((l) => l.member === focus.rep && (!focus.month || pacificMonth(l.date) === focus.month));
  const signedN = mine.filter((l) => l.signed).length;
  const rows = signedOnly ? mine.filter((l) => l.signed) : mine;

  return (
    <div className="sr-modal-back" onClick={onClose}>
      <div className="sr-modal" role="dialog" aria-modal="true" aria-label={`${focus.rep}'s clients`} onClick={(e) => e.stopPropagation()}>
        <div className="sr-panel-h" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          <div className="sr-who">
            <span className="sr-av" style={hueStyle(focus.rep)}><RepFace name={focus.rep} fallback={initials(focus.rep)} /></span>
            <div><b style={{ fontSize: 17 }}>{focus.rep}</b><i>{roleName(focus.role)} · {focus.month ? monthLabel(focus.month) : "the selected period"}</i></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="sr-seg" role="group" aria-label="Show">
              <button className={signedOnly ? "on" : ""} onClick={() => setSignedOnly(true)}>Signed ({signedN})</button>
              <button className={signedOnly ? "" : "on"} onClick={() => setSignedOnly(false)}>All leads ({mine.length})</button>
            </div>
            <button className="sr-arr" aria-label="Close" onClick={onClose}><X /></button>
          </div>
        </div>
        {rows.length === 0 ? <p className="sr-nil">None.</p> : <LeadTable rows={rows} />}
      </div>
    </div>
  );
}

/** Green at or above the team's conversion, amber within 10 points, red below that. */
export function standing(conv: number, avg: number) {
  if (conv >= avg) return { label: "Above average", badge: "sr-b-ok", score: "" };
  if (conv >= avg - 10) return { label: "Near average", badge: "sr-b-sun", score: "mid" };
  return { label: "Below average", badge: "sr-b-bad", score: "low" };
}

export function Big({ n, label, icon }: { n: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="sr-big">
      <span className="n">{n}</span>
      <span className="c">{icon}{label}</span>
    </div>
  );
}

export function HBar({ label, value, max, lead }: { label: string; value: number; max: number; lead?: boolean }) {
  return (
    <div className={`sr-hb-row ${lead ? "lead" : ""}`}>
      <b title={label}>{label}</b>
      <div className="sr-hb-t"><i style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
      <span className="sr-hb-v">{value}</span>
    </div>
  );
}

export function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="date"
      className="sr-input"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
  );
}
