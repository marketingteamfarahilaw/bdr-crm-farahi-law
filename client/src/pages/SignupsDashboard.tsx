import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { LeadDocketSyncButton } from "@/components/DataSyncPanel";
import {
  Inbox, CheckCircle2, User, Download, ArrowUpRight, Loader2,
  Trophy, Percent, Users, TrendingUp, Handshake, Info, X,
} from "lucide-react";
import "./SignupsDashboard.css";

// The look lives in SignupsDashboard.css (the Voice Agents board style).

// English formatting regardless of the browser's language, to match the rest of the CRM.
const fmt = (n: number) => n.toLocaleString("en-US");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1);
};
const monthLabel = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const monthAbbr = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short" });
const monthShort = (m: string) => monthAbbr(m) + " '" + m.slice(2, 4);

/** A stable colour per name, for avatars and the spotlight card. */
const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
const initials = (s: string) => s.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const hueStyle = (name: string) => ({ "--h": hue(name) }) as React.CSSProperties;
const roleName = (role: string) => (role === "FR" ? "Field Representative" : role === "BDR" ? "Business Development Rep." : role);

type Role = "all" | "BDR" | "FR" | "Intake";
type Team = "all" | "current";
type ReportData = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["signupsDashboard"]>;

/** Common reporting windows, so nobody has to type dates for the usual questions. */
function presets(today: Date) {
  const y = today.getFullYear(), m = today.getMonth();
  return [
    { label: "This month", from: iso(new Date(y, m, 1)), to: iso(today) },
    { label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: "Year to date", from: `${y}-01-01`, to: iso(today) },
    { label: "12 months", from: iso(new Date(y, m - 11, 1)), to: iso(today) },
    { label: "All time", from: "2020-01-01", to: iso(today) },
  ];
}

export default function SignupsDashboard() {
  const today = new Date();
  const [from, setFrom] = useState(`${today.getFullYear()}-01-01`);
  const [to, setTo] = useState(iso(today));
  const [role, setRole] = useState<Role>("all");
  const [team, setTeam] = useState<Team>("all");
  const { data, isLoading, isFetching } = trpc.teamReports.signupsDashboard.useQuery(
    { from, to, ...(role !== "all" ? { role } : {}), team },
    // Keep the last report on screen while a new filter loads, instead of flashing skeletons.
    { placeholderData: (prev) => prev },
  );

  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;
  const period = data?.period.firstLead
    ? `${monthLabel(data.period.firstLead)} – ${monthLabel(data.period.lastLead ?? data.period.firstLead)}`
    : `${from} – ${to}`;
  const scope = [role === "all" ? "all roles" : role, team === "current" ? "current team only" : "including former representatives"].join(" · ");

  const exportCsv = () => {
    if (!data) return;
    const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [
      `Sign-ups report,${from} to ${to},${q(scope)}`, "",
      "Summary,Value",
      `Total leads,${data.totals.leads}`,
      `Signed,${data.totals.signed}`,
      `Conversion,${data.totals.signedPct}%`,
      ...data.roles.map((r) => `${r.role} sign-ups,${r.signed} (${r.share}% of sign-ups; ${r.conversion}% conversion)`),
      `Leads naming a referring partner,${data.totals.attributed}`, "",
      "Representative,Role,Status,Leads,Signed,Conversion %",
      ...data.reps.map((r) => [q(r.name), r.role, r.current ? "current" : "former", r.leads, r.signed, r.conversion].join(",")), "",
      ["Sign-ups by month", ...data.repMonths.months.map(monthShort), "Total"].map(q).join(","),
      ...data.repMonths.rows.map((r) => [q(r.name), ...r.cells, r.total].join(",")),
      ["TOTAL", ...data.months.map((m) => m.signed), data.totals.signed].join(","), "",
      "Month,Leads,Signed,Conversion %",
      ...data.months.map((m) => [monthLabel(m.month), m.leads, m.signed, m.conversion].join(",")), "",
      "Referring partner,Territory,Leads,Signed,Conversion %",
      ...data.partners.map((p) => [q(p.name), q(p.territory ?? ""), p.leads, p.signed, p.conversion].join(",")), "",
      "Case type,Leads,Signed,Conversion %",
      ...data.caseTypes.map((c) => [q(c.name), c.leads, c.signed, c.conversion].join(",")), "",
      "Lead,Case type,Representative,Role,Date,Outcome,Referred by",
      ...data.leadList.map((l) => [q(l.name), q(l.caseType), q(l.member), l.role, l.date ? l.date.slice(0, 10) : "", q(l.outcome), q(l.partner ?? "")].join(",")),
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
      <div className="sr-canvas">
        <div className="sr-inner">
          {/* Filters */}
          <div className="sr-top">
            <div className="sr-seg" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => { setFrom(p.from); setTo(p.to); }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="sr-seg" role="group" aria-label="Team">
              {([["all", "All"], ["BDR", "BDR"], ["FR", "FR"], ["Intake", "Intake"]] as const).map(([v, label]) => (
                <button key={v} className={role === v ? "on" : ""} onClick={() => setRole(v)}>{label}</button>
              ))}
            </div>
            <select className="sr-input" value={team} onChange={(e) => setTeam(e.target.value as Team)} aria-label="Representatives">
              <option value="all">Include former reps</option>
              <option value="current">Current team only</option>
            </select>
            <span className="sr-dates">
              <DateInput value={from} onChange={setFrom} label="From" />
              –
              <DateInput value={to} onChange={setTo} label="To" />
            </span>
            {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          </div>

          {/* Hero */}
          <section className="sr-hero">
            <div className="sr-hero-top">
              <div>
                <h1>Sign-ups report</h1>
                <p className="sr-lead">BD / FR leads and sign-ups from Lead Docket · {period}</p>
              </div>
              <div className="sr-actions">
                <button className="sr-btn2" onClick={exportCsv} disabled={!data}><Download /> Export CSV</button>
                <LeadDocketSyncButton className="sr-btn1" hintClassName="sr-hint" />
              </div>
            </div>
            {data && <HeroBottom data={data} />}
          </section>

          {isLoading || !data ? (
            <div className="sr-features">
              {[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 270 }} />)}
            </div>
          ) : (
            <Report data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Where the period's leads ended up, plus the three headline counts. */
function HeroBottom({ data }: { data: ReportData }) {
  const fr = data.roles.find((r) => r.role === "FR")?.signed ?? 0;
  const bdr = data.roles.find((r) => r.role === "BDR")?.signed ?? 0;
  const intake = data.roles.find((r) => r.role === "Intake")?.signed ?? 0;
  const total = data.totals.leads;
  const share = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : "0%");
  const segments = [
    { label: "FR signed", n: fr, cls: "sr-s-dark" },
    { label: "BDR signed", n: bdr, cls: "sr-s-sun" },
    { label: "Intake signed", n: intake, cls: "sr-s-hatch" },
    { label: "Not signed", n: total - data.totals.signed, cls: "sr-s-line" },
  ].filter((s) => s.n > 0);

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
        <Big n={fmt(data.reps.length)} label="Representatives" icon={<User />} />
      </div>
    </div>
  );
}

function Report({ data }: { data: ReportData }) {
  const partnersRef = useRef<HTMLDivElement>(null);
  // Clicking a rep (or one of their monthly numbers) opens the clients behind it.
  const [focus, setFocus] = useState<{ rep: string; role: string; month?: string } | null>(null);
  const avg = data.totals.signedPct;
  const top = data.reps[0];
  const converter = data.reps.filter((r) => r.leads >= 10).sort((a, b) => b.conversion - a.conversion)[0];

  const recent = data.months.slice(-8);
  const stickMax = Math.max(1, ...recent.map((m) => m.signed));
  const perMonth = data.months.length ? Math.round(data.totals.signed / data.months.length) : 0;

  const R = 70, CIRC = 2 * Math.PI * R;

  const lastMonth = data.repMonths.months[data.repMonths.months.length - 1];
  const cellMax = Math.max(1, ...data.repMonths.rows.flatMap((r) => r.cells));
  const level = (v: number) => (!v ? "" : v / cellMax <= 0.25 ? "l1" : v / cellMax <= 0.5 ? "l2" : v / cellMax <= 0.75 ? "l3" : "l4");

  // Facility type / territory only describe leads whose referring partner we
  // could match, so "N/A" is left out of the bars and explained instead.
  const types = data.byType.filter((t) => t.name !== "N/A");
  const territories = data.byTerritory.filter((t) => t.name !== "N/A").slice(0, 10);
  const typeMax = Math.max(1, ...types.map((t) => t.leads));
  const terrMax = Math.max(1, ...territories.map((t) => t.leads));

  const insightIcons = [CheckCircle2, Trophy, Percent, Users, TrendingUp, Handshake, Info];

  return (
    <>
      {/* Feature row */}
      <div className="sr-features">
        {top ? (
          <div className="sr-spot" style={hueStyle(top.name)}>
            <span className="sr-spot-tag">Top representative</span>
            <div className="sr-spot-ini">{initials(top.name)}</div>
            <div className="sr-spot-foot">
              <div><b>{top.name}</b><i>{roleName(top.role)}</i></div>
              <span className="sr-spot-pill">{fmt(top.signed)} signed</span>
            </div>
          </div>
        ) : (
          <div className="sr-card"><div className="sr-bh"><h2>Top representative</h2></div><p className="sr-nil">No sign-ups in this period.</p></div>
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
          <p className="sr-dial-note">
            {converter ? `${converter.name} converts best, at ${converter.conversion}%.` : "The share of leads that signed."}
          </p>
        </div>

        <div className="sr-card">
          <div className="sr-bh">
            <h2>Top partners</h2>
            <button className="sr-arr" aria-label="See all referring partners" onClick={() => partnersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <ArrowUpRight />
            </button>
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

      <div className="sr-board">
        <div style={{ minWidth: 0 }}>
          {/* Representatives */}
          <div className="sr-panel">
            <div className="sr-panel-h">
              <div className="sr-ttl"><h2>Representatives</h2><span className="sr-count">{data.reps.length}</span></div>
            </div>
            {data.reps.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-t" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Representative</th>
                      <th className="num">Leads</th>
                      <th className="num">Signed</th>
                      <th className="num">Conversion</th>
                      <th>Standing</th>
                      {lastMonth && <th className="mid">{monthAbbr(lastMonth)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.reps.map((r) => {
                      const s = standing(r.conversion, avg);
                      const latest = data.repMonths.rows.find((x) => x.name === r.name)?.cells.at(-1) ?? 0;
                      return (
                        <tr key={r.name} className={`sr-click ${r.current ? "" : "former"}`} title={`See ${r.name}'s clients`}
                          onClick={() => setFocus({ rep: r.name, role: r.role })}>
                          <td>
                            <div className="sr-who">
                              <span className="sr-av" style={hueStyle(r.name)}>{initials(r.name)}</span>
                              <div><b>{r.name}</b><i>{roleName(r.role)}{r.current ? "" : " · former"}</i></div>
                            </div>
                          </td>
                          <td className="num">{fmt(r.leads)}</td>
                          <td className="num"><span className="sr-score">{fmt(r.signed)}</span></td>
                          <td className="num"><span className={`sr-score ${s.score}`}>{r.conversion}%</span></td>
                          <td><span className={`sr-badge ${s.badge}`}>{s.label}</span></td>
                          {lastMonth && (
                            <td className="mid" onClick={(e) => { e.stopPropagation(); setFocus({ rep: r.name, role: r.role, month: lastMonth }); }}>
                              <span className={`sr-flag ${latest ? "" : "zero"}`}>{latest}</span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Rep × month */}
          <div className="sr-panel">
            <div className="sr-panel-h"><div className="sr-ttl"><h2>Sign-ups by representative and month</h2></div></div>
            {data.repMonths.rows.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
              <>
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
                          <td className="name sr-click" onClick={() => setFocus({ rep: r.name, role: r.role })}>{r.name}<i>{r.role}</i></td>
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
                        <td className="name">All leads</td>
                        {data.months.map((m) => <td key={m.month} className="cell">{m.leads}</td>)}
                        <td className="tot">{fmt(data.totals.leads)}</td>
                      </tr>
                      <tr className="soft">
                        <td className="name">Conversion</td>
                        {data.months.map((m) => <td key={m.month} className="cell">{Math.round(m.conversion)}%</td>)}
                        <td className="tot">{avg}%</td>
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

          {/* Referring partners */}
          <div className="sr-panel" ref={partnersRef} style={{ scrollMarginTop: 16 }}>
            <div className="sr-panel-h">
              <div className="sr-ttl"><h2>Top referring partners</h2><span className="sr-count">{data.partners.length}</span></div>
            </div>
            <p className="sr-sub">From the {fmt(data.totals.attributed)} leads whose "Referred by" in Lead Docket matches a partner in the CRM.</p>
            {data.partners.length === 0 ? <p className="sr-nil">No leads in this period name a partner we can match.</p> : (
              <div className="sr-scroll">
                <table className="sr-t" style={{ minWidth: 560 }}>
                  <thead>
                    <tr><th>Partner</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th></tr>
                  </thead>
                  <tbody>
                    {data.partners.map((p) => (
                      <tr key={p.facilityId}>
                        <td>
                          <div className="sr-who">
                            <span className="sr-av" style={hueStyle(p.name)}>{initials(p.name)}</span>
                            <div><Link href={`/crm/facilities/${p.facilityId}`}><b>{p.name}</b></Link><i>{p.territory ?? "No territory"}</i></div>
                          </div>
                        </td>
                        <td className="num">{p.leads}</td>
                        <td className="num"><span className="sr-score">{p.signed}</span></td>
                        <td><span className={`sr-badge ${p.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{p.conversion}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Case types */}
          <div className="sr-panel">
            <div className="sr-panel-h">
              <div className="sr-ttl"><h2>Case types</h2><span className="sr-count">{data.caseTypes.length}</span></div>
            </div>
            <p className="sr-sub">As classified in Lead Docket.</p>
            {data.caseTypes.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
              <div className="sr-scroll">
                <table className="sr-t" style={{ minWidth: 480 }}>
                  <thead>
                    <tr><th>Case type</th><th className="num">Leads</th><th className="num">Signed</th><th>Conversion</th></tr>
                  </thead>
                  <tbody>
                    {data.caseTypes.map((c) => (
                      <tr key={c.name}>
                        <td><b style={{ color: "var(--ink)", fontWeight: 600 }}>{c.name}</b></td>
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

          <LeadList leads={data.leadList} />
          {focus && <RepClients focus={focus} leads={data.leadList} onClose={() => setFocus(null)} />}

          {/* Partner type + territory (partner-attributed leads only) */}
          <div className="sr-pair">
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
              <div className="sr-panel-h"><h2>Territory</h2></div>
              <p className="sr-sub">Where the referring partner is; top 10.</p>
              {territories.length === 0 ? <p className="sr-nil">No partner-attributed leads.</p> : (
                <div className="sr-hb">
                  {territories.map((t, i) => <HBar key={t.name} label={t.name} value={t.leads} max={terrMax} lead={i === 0} />)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
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
                them — "BDR Miguel Flores", "Field Representative Lupe Campos". Leads brought in by Malvin Rosales, the Intake
                Department Manager, count under Intake; other marketing, intake and website leads are not counted.
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
    </>
  );
}

const leadDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }) : "—";
const outcomeBadge = (o: string, signed: boolean) =>
  signed ? "sr-b-ok" : /^(lost|rejected)/i.test(o) ? "sr-b-bad" : "sr-b-sun";

/** Every lead in the period by name — searchable, newest first. */
function LeadList({ leads }: { leads: ReportData["leadList"] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "signed" | "open">("all");
  const [showAll, setShowAll] = useState(false);
  const q = search.trim().toLowerCase();
  const rows = leads.filter((l) =>
    (status === "all" || (status === "signed") === l.signed) &&
    (!q || [l.name, l.caseType, l.member, l.partner ?? "", l.outcome].some((v) => v.toLowerCase().includes(q))));
  const shown = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Leads</h2><span className="sr-count">{fmt(rows.length)}</span></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="sr-input" placeholder="Search lead, case type, rep, partner…" value={search}
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
          <LeadTable rows={shown} showRep />
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

/** Clients by name — shared by the Leads list and a rep's client window. */
function LeadTable({ rows, showRep }: { rows: ReportData["leadList"]; showRep?: boolean }) {
  return (
    <div className="sr-scroll">
      <table className="sr-t" style={{ minWidth: showRep ? 820 : 640 }}>
        <thead>
          <tr><th>Client</th><th>Case type</th>{showRep && <th>Representative</th>}<th>Date</th><th>Outcome</th><th>Referred by</th></tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td><b style={{ color: "var(--ink)", fontWeight: 600, whiteSpace: "nowrap" }}>{l.name}</b></td>
              <td>{l.caseType}</td>
              {showRep && <td style={{ whiteSpace: "nowrap" }}>{l.member} <span style={{ fontSize: 11, color: "var(--mute)" }}>{l.role}</span></td>}
              <td style={{ whiteSpace: "nowrap" }}>{leadDay(l.date)}</td>
              <td><span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span></td>
              <td>{l.partnerId ? <Link href={`/crm/facilities/${l.partnerId}`}>{l.partner}</Link> : <span style={{ color: "var(--mute2)" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
            <span className="sr-av" style={hueStyle(focus.rep)}>{initials(focus.rep)}</span>
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
function standing(conv: number, avg: number) {
  if (conv >= avg) return { label: "Above average", badge: "sr-b-ok", score: "" };
  if (conv >= avg - 10) return { label: "Near average", badge: "sr-b-sun", score: "mid" };
  return { label: "Below average", badge: "sr-b-bad", score: "low" };
}

function Big({ n, label, icon }: { n: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="sr-big">
      <span className="n">{n}</span>
      <span className="c">{icon}{label}</span>
    </div>
  );
}

function HBar({ label, value, max, lead }: { label: string; value: number; max: number; lead?: boolean }) {
  return (
    <div className={`sr-hb-row ${lead ? "lead" : ""}`}>
      <b title={label}>{label}</b>
      <div className="sr-hb-t"><i style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div>
      <span className="sr-hb-v">{value}</span>
    </div>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
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
