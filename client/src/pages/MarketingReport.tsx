/**
 * Marketing Report — every lead the firm takes in Lead Docket, by the marketing
 * source that brought it, laid out like the Sign-ups Report (same styles, same
 * counting). Private: only canSeeMarketing opens it; the server enforces the same.
 */
import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  Inbox, CheckCircle2, DollarSign, Download, Loader2, Trophy, Percent, TrendingUp, Info, Megaphone, X, ArrowUpRight, Users,
} from "lucide-react";
import { canSeeMarketing } from "@shared/permissions";
import {
  Big, DateInput, fmt, hueStyle, initials, iso, leadDay, monthAbbr, monthLabel, monthShort, outcomeBadge, presets, rangeLabel, standing,
} from "./SignupsDashboard";
import "./SignupsDashboard.css";

type Out = inferRouterOutputs<AppRouter>["marketing"];
type Data = NonNullable<Out["dashboard"]>;
type Source = Data["sources"][number];

// Rows the server keeps whole in both views: the team, and leads with no source.
const SPECIAL = new Set(["BD/FR team", "No source recorded"]);
/** What to ask the server for a row's clients: a channel asks for all its Lead Docket sources. */
const scopeOf = (row: { name: string; members: string[] }) =>
  SPECIAL.has(row.name) || !row.members.length ? { source: row.name } : { sources: row.members };
type Focus = { name: string; members: string[]; month?: string };
type Group = "channel" | "source";

const usd = (n: number | null | undefined, cents = false) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export default function MarketingReport() {
  const { user } = useAuth();
  const allowed = canSeeMarketing(user?.email);
  const today = new Date();
  // Opens on the current month, like the Sign-ups Report.
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [team, setTeam] = useState(true);
  // Channels group Lead Docket's per-contract and per-listing sources ("Walker Advertising Contract 26").
  const [group, setGroup] = useState<Group>("channel");
  const { data, isLoading, isFetching } = trpc.marketing.dashboard.useQuery(
    { from, to, team, group },
    { enabled: allowed, placeholderData: (prev) => prev },
  );

  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;

  if (!allowed) {
    return (
      <div className="sr"><div className="sr-canvas"><div className="sr-inner">
        <section className="sr-hero"><h1>Marketing report</h1><p className="sr-lead">This report is private.</p></section>
      </div></div></div>
    );
  }

  const exportCsv = () => {
    if (!data) return;
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [
      `Marketing report,${from} to ${to},${team ? "including the BD/FR team" : "marketing sources only"}`, "",
      "Summary,Value",
      `Leads,${data.totals.leads}`, `Signed,${data.totals.signed}`, `Conversion,${data.totals.conversion}%`,
      `Spend,${data.totals.spend ?? ""}`, `Cost per lead,${data.totals.costPerLead ?? ""}`, `Cost per sign-up,${data.totals.costPerSignup ?? ""}`, "",
      "Source,Leads,Open,Rejected,Referred Out,Not Interested,Signed Referred Out,Signed In-House,Signed,Conversion %,Spend,Cost per lead,Cost per sign-up",
      ...data.sources.map((s) => [q(s.name), s.leads, s.open, s.rejected, s.referredOut, s.notInterested, s.signedReferred, s.signedInHouse, s.signed, s.conversion, s.spend ?? "", s.costPerLead ?? "", s.costPerSignup ?? ""].join(",")), "",
      ["Sign-ups by month", ...data.months.map(monthShort), "Total"].map(q).join(","),
      ...data.sources.filter((s) => s.signed).map((s) => [q(s.name), ...s.cells, s.signed].join(",")), "",
      "Case type,Leads,Signed,Conversion %",
      ...data.caseTypes.map((c) => [q(c.name), c.leads, c.signed, c.conversion].join(",")), "",
      "Campaign,Source,Leads,Signed,Conversion %",
      ...data.campaigns.map((c) => [q(c.name), q(c.source), c.leads, c.signed, c.conversion].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `marketing-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sr">
      <div className="sr-canvas">
        <div className="sr-inner">
          <div className="sr-top">
            <div className="sr-seg" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>
              ))}
            </div>
            <div className="sr-seg" role="group" aria-label="Group by">
              <button className={group === "channel" ? "on" : ""} onClick={() => setGroup("channel")}>Channels</button>
              <button className={group === "source" ? "on" : ""} onClick={() => setGroup("source")}>Sources</button>
            </div>
            <div className="sr-seg" role="group" aria-label="Sources">
              <button className={team ? "on" : ""} onClick={() => setTeam(true)}>All sources</button>
              <button className={team ? "" : "on"} onClick={() => setTeam(false)}>Without BD/FR team</button>
            </div>
            <span className="sr-dates">
              <DateInput value={from} onChange={setFrom} label="From" />
              –
              <DateInput value={to} onChange={setTo} label="To" />
            </span>
            {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          </div>

          <section className="sr-hero">
            <div className="sr-hero-top">
              <div>
                <h1>Marketing report</h1>
                <p className="sr-lead">Every Lead Docket lead by marketing source · {rangeLabel(from, to)}</p>
              </div>
              <div className="sr-actions">
                <button className="sr-btn2" onClick={exportCsv} disabled={!data}><Download /> Export CSV</button>
              </div>
            </div>
            {data && <Coverage c={data.coverage} />}
            {data && <HeroBottom data={data} />}
          </section>

          {isLoading || !data ? (
            <div className="sr-features">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 270 }} />)}</div>
          ) : (
            <Report data={data} from={from} to={to} team={team} group={group} />
          )}
        </div>
      </div>
    </div>
  );
}

/** While the backfill runs, say how much of Lead Docket is in — and how far back it's complete. */
function Coverage({ c }: { c: Data["coverage"] }) {
  if (c.complete || !c.total) return null;
  const share = Math.min(100, Math.round((c.stored / c.total) * 100));
  return (
    <div className="mk-cov">
      <div className="mk-cov-t">
        <b>Loading Lead Docket history — {fmt(c.stored)} of {fmt(c.total)} leads ({share}%).</b>
        <span>
          {c.completeFrom ? `Complete back to ${new Date(c.completeFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}; older months are still filling in, newest first.` : "Newest months fill in first."}
          {" "}It reads about 3,000 leads an hour, between the team's regular syncs.
        </span>
      </div>
      <div className="mk-cov-bar"><i style={{ width: `${share}%` }} /></div>
    </div>
  );
}

function HeroBottom({ data }: { data: Data }) {
  const total = data.totals.leads;
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

  return (
    <div className="sr-hero-bot">
      <div className="sr-segbar">
        {segments.length === 0 ? <p className="sr-nil">No leads in this period.</p> : segments.map((s) => (
          <div key={s.label} className="sr-sg" style={{ flex: `${s.n} 1 0` }} title={`${fmt(s.n)} leads`}>
            <span className="sr-sl">{s.label}</span>
            <span className={`sr-sb ${s.cls}`}>{share(s.n)}</span>
          </div>
        ))}
      </div>
      <div className="sr-bigs">
        <Big n={fmt(total)} label="Leads" icon={<Inbox />} />
        <Big n={fmt(data.totals.signed)} label="Signed" icon={<CheckCircle2 />} />
        {data.totals.costPerSignup != null
          ? <Big n={usd(data.totals.costPerSignup)} label="Per sign-up" icon={<DollarSign />} />
          : <Big n={fmt(data.totals.sources)} label="Sources" icon={<Megaphone />} />}
      </div>
    </div>
  );
}

function Report({ data, from, to, team, group }: { data: Data; from: string; to: string; team: boolean; group: Group }) {
  const spendRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const rowOf = (name: string) => data.sources.find((s) => s.name === name) ?? { name, members: [] as string[] };
  const open = (name: string, month?: string) => setFocus({ name, members: rowOf(name).members, ...(month ? { month } : {}) });
  const noun = group === "channel" ? "channel" : "source";
  const avg = data.totals.conversion;
  const top = data.sources.find((s) => s.signed > 0);
  const minLeads = data.totals.leads >= 500 ? 25 : 8;
  const converter = data.sources.filter((s) => s.leads >= minLeads).sort((a, b) => b.conversion - a.conversion)[0];

  const recent = data.monthly.slice(-8);
  const stickMax = Math.max(1, ...recent.map((m) => m.signed));
  const perMonth = data.monthly.length ? Math.round(data.totals.signed / data.monthly.length) : 0;
  const R = 70, CIRC = 2 * Math.PI * R;

  const gridRows = data.sources.filter((s) => s.signed > 0);
  const cellMax = Math.max(1, ...gridRows.flatMap((r) => r.cells));
  const level = (v: number) => (!v ? "" : v / cellMax <= 0.25 ? "l1" : v / cellMax <= 0.5 ? "l2" : v / cellMax <= 0.75 ? "l3" : "l4");
  const insightIcons = [Trophy, Percent, Users, DollarSign, Info, TrendingUp];

  return (
    <>
      <Scorecard data={data} label={rangeLabel(from, to)} group={group} onSource={(name) => open(name)} />

      <div className="sr-features">
        {top ? (
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

        <div className="sr-card">
          <div className="sr-bh"><h2>Sign-ups by month</h2></div>
          <div className="sr-kv"><span className="n">{perMonth}</span><span className="u">average<br />per month</span></div>
          {recent.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
            <div className="sr-cols">
              {recent.map((m, i) => {
                const hot = i === recent.length - 1;
                return (
                  <div key={m.month} className={`sr-col ${hot ? "hot" : ""}`} title={`${monthLabel(m.month)}: ${m.signed} signed of ${m.leads} leads (${m.conversion}%)`}>
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
          <div className="sr-bh"><h2>Conversion</h2></div>
          <div className="sr-ring">
            <svg viewBox="0 0 164 164">
              <circle className="trk" cx="82" cy="82" r={R} />
              {avg > 0 && <circle className="val" cx="82" cy="82" r={R} strokeDasharray={`${(CIRC * Math.min(avg, 100)) / 100} ${CIRC}`} />}
            </svg>
            <div className="sr-ring-c"><b>{avg}%</b><span>of leads signed</span></div>
          </div>
          <p className="sr-dial-note">{converter ? `${converter.name} converts best, at ${converter.conversion}%.` : "The share of leads that signed."}</p>
        </div>

        <div className="sr-card">
          <div className="sr-bh">
            <h2>Spend</h2>
            <button className="sr-arr" aria-label="Enter spend" onClick={() => spendRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><ArrowUpRight /></button>
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
          {/* Source × month */}
          <div className="sr-panel">
            <div className="sr-panel-h"><div className="sr-ttl"><h2>Sign-ups by {noun} and month</h2></div></div>
            {gridRows.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-grid">
                  <thead>
                    <tr><th className="name" />{data.months.map((m) => <th key={m}>{monthShort(m)}</th>)}<th style={{ textAlign: "right" }}>Total</th></tr>
                  </thead>
                  <tbody>
                    {gridRows.map((r) => (
                      <tr key={r.name}>
                        <td className="name sr-click" onClick={() => open(r.name)}>{r.name}</td>
                        {r.cells.map((v, i) => (
                          <td key={i} className={`cell ${level(v)} ${v ? "sr-click" : ""}`}
                            title={v ? `${r.name} · ${monthLabel(data.months[i])}: see the ${v} sign-up${v === 1 ? "" : "s"}` : undefined}
                            onClick={v ? () => open(r.name, data.months[i]) : undefined}>{v || "·"}</td>
                        ))}
                        <td className="tot sr-click" onClick={() => open(r.name)}>{r.signed}</td>
                      </tr>
                    ))}
                    <tr className="foot"><td className="name">Signed</td>{data.monthly.map((m) => <td key={m.month} className="cell">{m.signed}</td>)}<td className="tot">{fmt(data.totals.signed)}</td></tr>
                    <tr className="soft"><td className="name">All leads</td>{data.monthly.map((m) => <td key={m.month} className="cell">{m.leads}</td>)}<td className="tot">{fmt(data.totals.leads)}</td></tr>
                    <tr className="soft"><td className="name">Conversion</td>{data.monthly.map((m) => <td key={m.month} className="cell">{Math.round(m.conversion)}%</td>)}<td className="tot">{avg}%</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Case types by source */}
          <div className="sr-panel">
            <div className="sr-panel-h"><div className="sr-ttl"><h2>Case types by {noun}</h2></div></div>
            <p className="sr-sub">Sign-ups of all leads, for the ten biggest {noun}s and six biggest case types. Click a row for its clients.</p>
            {data.caseMatrix.rows.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-t mk-matrix" style={{ minWidth: 720 }}>
                  <thead><tr><th>{group === "channel" ? "Channel" : "Source"}</th>{data.caseMatrix.types.map((t) => <th key={t} className="num">{t}</th>)}</tr></thead>
                  <tbody>
                    {data.caseMatrix.rows.map((r) => (
                      <tr key={r.name} className="sr-click" onClick={() => open(r.name)}>
                        <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{r.name}</b></td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="num">{c.leads ? <><b>{c.signed}</b><i> / {c.leads}</i></> : <span className="mk-dot">·</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Case types */}
          <div className="sr-panel">
            <div className="sr-panel-h"><div className="sr-ttl"><h2>Case types</h2><span className="sr-count">{data.caseTypes.length}</span></div></div>
            <p className="sr-sub">As classified in Lead Docket, with the {noun}s that signed the most of each.</p>
            {data.caseTypes.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-t" style={{ minWidth: 640 }}>
                  <thead><tr><th>Case type</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th><th>Top sources</th></tr></thead>
                  <tbody>
                    {data.caseTypes.map((c) => (
                      <tr key={c.name}>
                        <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{c.name}</b></td>
                        <td className="num">{fmt(c.leads)}</td>
                        <td className="num"><span className="sr-score">{fmt(c.signed)}</span></td>
                        <td><span className={`sr-badge ${c.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{c.conversion}%</span></td>
                        <td className="mk-muted">{c.topSources.map((s) => `${s.name} (${s.signed})`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Campaigns */}
          <div className="sr-panel">
            <div className="sr-panel-h"><div className="sr-ttl"><h2>Campaigns</h2><span className="sr-count">{data.campaigns.length}</span></div></div>
            <p className="sr-sub">Lead Docket's Campaign field — the 30 with the most leads.</p>
            {data.campaigns.length === 0 ? <p className="sr-nil">No campaigns recorded in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-t" style={{ minWidth: 640 }}>
                  <thead><tr><th>Campaign</th><th>Source</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th></tr></thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.source + "|" + c.name}>
                        <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{c.name}</b></td>
                        <td className="mk-muted">{c.source}</td>
                        <td className="num">{fmt(c.leads)}</td>
                        <td className="num"><span className="sr-score">{fmt(c.signed)}</span></td>
                        <td><span className={`sr-badge ${c.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{c.conversion}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                Every lead the firm takes in Lead Docket, read by the same sync as the Sign-ups Report. A lead's source is its
                Marketing Source. Leads credited to a BD/FR representative are one source, "BD/FR team" — the Sign-ups Report
                breaks them down by rep. "No source recorded" means intake left Marketing Source empty.
              </p>
            </details>
            <details className="sr-acc">
              <summary><span>When a lead counts as signed</span></summary>
              <p>When it has a sign-up date, even if the case later closed. Signed leads count in the month they signed; the rest in the month they came in — the same as the Sign-ups Report.</p>
            </details>
            <details className="sr-acc">
              <summary><span>Cost per lead and sign-up</span></summary>
              <p>
                From the spend entered below, per source and month. A date range counts each month it touches in full.
                The totals only use sources that have spend entered, so unpaid channels don't make paid ones look cheaper.
              </p>
            </details>
          </div>
        </aside>
      </div>

      <div ref={spendRef} style={{ scrollMarginTop: 16 }}>
        <SpendEditor months={data.months} sources={data.sources} group={group} />
      </div>
      <LeadList from={from} to={to} team={team} rows={data.sources} noun={noun} />
      {focus && <Clients focus={focus} from={from} to={to} team={team} onClose={() => setFocus(null)} />}
    </>
  );
}

/** The team's scorecard layout, one row per source, plus what each costs. */
function Scorecard({ data, label, group, onSource }: { data: Data; label: string; group: Group; onSource: (name: string) => void }) {
  if (!data.sources.length) return null;
  const t = data.totals;
  const sum = (k: keyof Source) => data.sources.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  return (
    <div className="sr-sc-wrap">
      <div className="sr-sc">
        <div className="sr-sc-title">{label}</div>
        <div className="sr-sc-band">{group === "channel" ? "MARKETING CHANNELS" : "MARKETING SOURCES"}</div>
        <div className="sr-scroll">
          <table className="sr-sct">
            <thead>
              <tr>
                <th className="l">{group === "channel" ? "Channel" : "Source"}</th><th>Total Leads</th><th>Open</th><th>Rejected</th><th>Referred Out</th><th>Not Interested</th>
                <th className="cyan">Signed Referred Out</th><th className="yellow">Signed In-House</th><th className="tot">Total Signed</th>
                <th>Conversion</th><th>Spend</th><th>Cost / Lead</th><th>Cost / Sign-up</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => {
                const st = standing(s.conversion, t.conversion);
                return (
                  <tr key={s.name} className="sr-click" title={`See ${s.name}'s clients`} onClick={() => onSource(s.name)}>
                    <td className="l"><b>{s.name}</b>{group === "channel" && s.members.length > 1 && <span className="former">{s.members.length} sources</span>}</td>
                    <td>{fmt(s.leads)}</td><td>{fmt(s.open)}</td><td>{fmt(s.rejected)}</td><td>{fmt(s.referredOut)}</td><td>{fmt(s.notInterested)}</td>
                    <td className="cyan">{fmt(s.signedReferred)}</td>
                    <td className="yellow em">{fmt(s.signedInHouse)}</td>
                    <td className="tot blue">{fmt(s.signed)}</td>
                    <td><span className={`sr-badge ${st.badge}`}>{s.conversion}%</span></td>
                    <td>{usd(s.spend)}</td><td>{usd(s.costPerLead, true)}</td><td>{usd(s.costPerSignup, true)}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td className="l">TOTAL</td>
                <td>{fmt(t.leads)}</td><td>{fmt(t.open)}</td><td>{fmt(t.rejected)}</td><td>{fmt(t.referredOut)}</td><td>{fmt(t.notInterested)}</td>
                <td>{fmt(sum("signedReferred"))}</td><td>{fmt(sum("signedInHouse"))}</td>
                <td className="big">{fmt(t.signed)}</td><td className="big">{t.conversion}%</td>
                <td className="big">{usd(t.spend)}</td><td className="big">{usd(t.costPerLead, true)}</td><td className="big">{usd(t.costPerSignup, true)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="sr-sub" style={{ margin: "2px 4px 18px" }}>
        From Lead Docket. Each lead counts once, in the column for where it ended up, so the columns add up to Total Leads.
        Lost counts as Rejected. Cost columns use the spend entered below. Click a row to see its clients.
        {group === "channel" && " Channels group Lead Docket's per-contract and per-listing sources; switch to Sources to see each one."}
      </p>
    </div>
  );
}

/** Monthly spend per source — what turns lead counts into cost per lead and per sign-up. */
function SpendEditor({ months, sources, group }: { months: string[]; sources: Source[]; group: Group }) {
  const utils = trpc.useUtils();
  const [month, setMonth] = useState(months[months.length - 1] ?? "");
  useEffect(() => { if (!months.includes(month)) setMonth(months[months.length - 1] ?? ""); }, [months, month]);
  const { data: spend = [] } = trpc.marketing.spend.useQuery({ months }, { enabled: months.length > 0 });
  const [extra, setExtra] = useState("");
  const save = trpc.marketing.setSpend.useMutation({
    onSuccess: () => { utils.marketing.spend.invalidate(); utils.marketing.dashboard.invalidate(); toast.success("Spend saved"); },
    onError: (e) => toast.error(e.message),
  });
  const forMonth = spend.filter((r) => r.month === month);
  const amountOf = (source: string) => forMonth.find((r) => r.source.toLowerCase() === source.toLowerCase())?.amount ?? null;
  // The period's sources, plus any with spend this month but no leads (a billboard that brought none).
  const names = [...sources.map((s) => s.name)];
  for (const r of forMonth) if (!names.some((n) => n.toLowerCase() === r.source.toLowerCase())) names.push(r.source);
  const commit = (source: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw.replace(/[$,\s]/g, ""));
    if (value != null && (!Number.isFinite(value) || value < 0)) { toast.error("Enter an amount in dollars."); return; }
    if ((value ?? null) === amountOf(source)) return;
    save.mutate({ month, source, amount: value });
  };

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Marketing spend</h2></div>
        <select className="sr-input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {[...months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <p className="sr-sub">
        What each {group === "channel" ? "channel" : "source"} cost in {month ? monthLabel(month) : "the month"}. Saved when you leave the box; clear it to remove.
        {group === "channel" ? " A channel's cost also includes any spend entered for its individual sources." : ""}
      </p>
      <div className="mk-spend">
        {names.map((name) => {
          const current = amountOf(name);
          return (
            <label key={month + "|" + name + "|" + current} className="mk-spend-row">
              <span title={name}>{name}</span>
              <input className="sr-input" inputMode="decimal" placeholder="$0" defaultValue={current ?? ""}
                onBlur={(e) => commit(name, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
            </label>
          );
        })}
        <div className="mk-spend-row">
          <input className="sr-input" placeholder="Another source, as Lead Docket names it" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <input className="sr-input" inputMode="decimal" placeholder="$0" disabled={!extra.trim()}
            onBlur={(e) => { if (extra.trim() && e.target.value.trim()) { commit(extra.trim(), e.target.value); setExtra(""); e.target.value = ""; } }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
      </div>
    </div>
  );
}

/** Clients, fetched a page at a time — the firm has far too many to send at once. */
function LeadTable({ rows }: { rows: Out["leads"]["rows"] }) {
  return (
    <div className="sr-scroll">
      <table className="sr-t sr-leads" style={{ minWidth: 820 }}>
        <thead><tr><th>Client</th><th>Case type</th><th>Source</th><th>Campaign / rep</th><th>Date</th><th>Outcome</th><th>City</th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="client"><b>{l.name}</b></td>
              <td className="nowrap">{l.caseType}</td>
              <td className="partner">{l.source}</td>
              <td className="partner mk-muted">{l.detail ?? "—"}</td>
              <td className="nowrap">{leadDay(l.date)}</td>
              <td className="nowrap"><span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span></td>
              <td className="nowrap mk-muted">{l.city ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function LeadList({ from, to, team, rows: groups, noun }: { from: string; to: string; team: boolean; rows: Source[]; noun: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "signed" | "open">("all");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(50);
  const q = useDebounced(search.trim());
  useEffect(() => setLimit(50), [from, to, team, status, source, q]);
  const picked = groups.find((g) => g.name === source);
  const { data, isFetching } = trpc.marketing.leads.useQuery(
    { from, to, team, status, limit, ...(picked ? scopeOf(picked) : {}), ...(q ? { search: q } : {}) },
    { placeholderData: (prev) => prev },
  );
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Leads</h2><span className="sr-count">{fmt(total)}</span>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="sr-input" placeholder="Search client, case type, campaign, city…" value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} aria-label="Search leads" />
          <select className="sr-input" value={source} onChange={(e) => setSource(e.target.value)} aria-label={noun} style={{ maxWidth: 220 }}>
            <option value="">All {noun}s</option>
            {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
          <div className="sr-seg" role="group" aria-label="Outcome">
            {([["all", "All"], ["signed", "Signed"], ["open", "Not signed"]] as const).map(([v, label]) => (
              <button key={v} className={status === v ? "on" : ""} onClick={() => setStatus(v)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-sub">Newest first. The date is the sign-up date for signed leads, otherwise the day the lead came in.</p>
      {rows.length === 0 ? <p className="sr-nil">{data ? "No leads match." : "Loading…"}</p> : (
        <>
          <LeadTable rows={rows} />
          {total > rows.length && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              {limit < 500
                ? <button className="sr-btn2" onClick={() => setLimit(Math.min(500, limit + 200))}>Show {fmt(Math.min(200, total - rows.length))} more of {fmt(total)}</button>
                : <p className="sr-sub">Showing the newest 500 — search or pick a source to narrow it down.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The clients behind a source's numbers — opened by clicking the source or one of its months. */
function Clients({ focus, from, to, team, onClose }: {
  focus: Focus; from: string; to: string; team: boolean; onClose: () => void;
}) {
  const [signedOnly, setSignedOnly] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const base = { from, to, team, ...scopeOf(focus), ...(focus.month ? { month: focus.month } : {}), limit: 500 };
  const signed = trpc.marketing.leads.useQuery({ ...base, status: "signed" });
  const all = trpc.marketing.leads.useQuery({ ...base, status: "all" }, { enabled: !signedOnly });
  const shown = signedOnly ? signed.data : all.data;

  return (
    <div className="sr-modal-back" onClick={onClose}>
      <div className="sr-modal" role="dialog" aria-modal="true" aria-label={`${focus.name} clients`} onClick={(e) => e.stopPropagation()}>
        <div className="sr-panel-h" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          <div className="sr-who">
            <span className="sr-av" style={hueStyle(focus.name)}>{initials(focus.name)}</span>
            <div><b style={{ fontSize: 17 }}>{focus.name}</b><i>{focus.month ? monthLabel(focus.month) : "the selected period"}</i></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="sr-seg" role="group" aria-label="Show">
              <button className={signedOnly ? "on" : ""} onClick={() => setSignedOnly(true)}>Signed ({signed.data ? fmt(signed.data.total) : "…"})</button>
              <button className={signedOnly ? "" : "on"} onClick={() => setSignedOnly(false)}>All leads{all.data ? ` (${fmt(all.data.total)})` : ""}</button>
            </div>
            <button className="sr-arr" aria-label="Close" onClick={onClose}><X /></button>
          </div>
        </div>
        {!shown ? <p className="sr-nil"><Loader2 size={13} className="sr-spin" /> Loading…</p>
          : shown.rows.length === 0 ? <p className="sr-nil">None.</p>
          : <>
              <LeadTable rows={shown.rows} />
              {shown.total > shown.rows.length && <p className="sr-sub" style={{ marginTop: 8 }}>The newest {fmt(shown.rows.length)} of {fmt(shown.total)} — narrow the dates to see the rest.</p>}
            </>}
      </div>
    </div>
  );
}
