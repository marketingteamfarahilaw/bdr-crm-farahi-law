import { useState } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadDocketSyncButton } from "@/components/DataSyncPanel";
import {
  Users, CheckCircle2, Percent, Handshake, Trophy, Download, TrendingUp,
  CalendarRange, Building2, MapPin, Loader2,
} from "lucide-react";

/**
 * Styled after the Executive AI Assistant (JFBotIntelligence): navy header with
 * a gold rule, cream page, white cards with warm hairlines. The colours live
 * here rather than in theme tokens because the app's --gold token is navy.
 */
const C = { navy: "#0f2747", navy2: "#1b3a63", gold: "#b8924a", gold2: "#d8b878", ok: "#2e7d4f" };
const GRADIENT = `linear-gradient(120deg, ${C.navy}, ${C.navy2})`;
const card = "rounded-[10px] border border-[#e2ddd2] bg-white shadow-[0_1px_2px_rgba(15,39,71,.04)] dark:border-border dark:bg-card";
const line = "border-[#e2ddd2] dark:border-border";
const muted = "text-[#6b7787] dark:text-muted-foreground";
const navyText = "text-[#0f2747] dark:text-[#d8b878]";
const th = `py-2.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide ${muted}`;
const td = "py-2.5 px-2.5";

const fmt = (n: number) => n.toLocaleString();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};
const monthShort = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short" }) + " '" + y.slice(2);
};

type Role = "all" | "BDR" | "FR";
type Team = "all" | "current";

/** Common reporting windows, so nobody has to type dates for the usual questions. */
function presets(today: Date) {
  const y = today.getFullYear(), m = today.getMonth();
  return [
    { label: "This month", from: iso(new Date(y, m, 1)), to: iso(today) },
    { label: "Last month", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: "Year to date", from: `${y}-01-01`, to: iso(today) },
    { label: "Last 12 months", from: iso(new Date(y, m - 11, 1)), to: iso(today) },
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
  const scope = [role === "all" ? "BDR + FR" : role, team === "current" ? "current team only" : "including former representatives"].join(" · ");

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
      ...data.partners.map((p) => [q(p.name), q(p.territory ?? ""), p.leads, p.signed, p.conversion].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `signups-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f6f3ec] dark:bg-background">
      {/* Header */}
      <header className="px-7 py-5 text-white flex items-center justify-between gap-4 flex-wrap border-b-[3px]" style={{ background: GRADIENT, borderBottomColor: C.gold }}>
        <div>
          <h1 className="text-xl font-semibold tracking-[.3px]">Sign-ups Report</h1>
          <div className="text-xs mt-1" style={{ color: C.gold2 }}>
            Farahi Law · Business Development &amp; Field Representatives · {period}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: C.gold, color: C.navy }}>
            ● Live · Lead Docket
          </span>
          <LeadDocketSyncButton onDark />
          <button
            onClick={exportCsv}
            disabled={!data}
            className="h-8 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 bg-white/10 border border-white/25 hover:bg-white/20 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </header>

      {/* Period tabs */}
      <nav className={`flex items-center gap-1 px-5 bg-white dark:bg-card border-b ${line} overflow-x-auto`}>
        {periods.map((p) => {
          const on = p.label === activePreset;
          return (
            <button
              key={p.label}
              onClick={() => { setFrom(p.from); setTo(p.to); }}
              className={`px-4 py-3.5 text-sm whitespace-nowrap border-b-[3px] transition-colors ${on ? `font-semibold ${navyText}` : `border-transparent ${muted} hover:text-[#0f2747] dark:hover:text-foreground`}`}
              style={on ? { borderBottomColor: C.gold } : undefined}
            >
              {p.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 py-2 pl-4 shrink-0">
          <CalendarRange className={`w-4 h-4 ${activePreset ? muted : navyText}`} />
          <DateInput value={from} onChange={setFrom} label="From" />
          <span className={muted}>–</span>
          <DateInput value={to} onChange={setTo} label="To" />
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto px-6 pt-5 pb-16 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            options={[{ value: "all", label: "BDR + FR" }, { value: "BDR", label: "BDR" }, { value: "FR", label: "FR" }]}
            value={role}
            onChange={(v) => setRole(v as Role)}
          />
          <Toggle
            options={[{ value: "all", label: "Include former reps" }, { value: "current", label: "Current team only" }]}
            value={team}
            onChange={(v) => setTeam(v as Team)}
          />
          <span className={`text-[13px] ${muted} flex items-center gap-1.5`}>
            {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isFetching ? "Updating…" : `Showing ${scope}`}
          </span>
        </div>

        {isLoading || !data ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-[10px]" />
            <Skeleton className="h-72 w-full rounded-[10px]" />
          </div>
        ) : (
          <Report data={data} />
        )}
      </main>
    </div>
  );
}

type ReportData = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["signupsDashboard"]>;

function Report({ data }: { data: ReportData }) {
  // Facility type / territory only describe leads whose referring partner we
  // could match, so "N/A" is left out of the bars and explained instead.
  const types = data.byType.filter((t) => t.name !== "N/A");
  const territories = data.byTerritory.filter((t) => t.name !== "N/A").slice(0, 10);
  const typeMax = Math.max(1, ...types.map((t) => t.leads));
  const terrMax = Math.max(1, ...territories.map((t) => t.leads));
  const monthMax = Math.max(1, ...data.months.map((m) => m.leads));
  const fr = data.roles.find((r) => r.role === "FR");
  const bdr = data.roles.find((r) => r.role === "BDR");
  const avg = data.totals.signedPct;

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi hero label="Signed" value={fmt(data.totals.signed)} sub="clients signed" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Kpi label="Leads" value={fmt(data.totals.leads)} sub="credited to the team" icon={<Users className="w-4 h-4" />} />
        <Kpi label="Conversion" value={`${avg}%`} sub="of leads signed" icon={<Percent className="w-4 h-4" />} />
        <Kpi label="FR sign-ups" value={fmt(fr?.signed ?? 0)} sub={`${fr?.share ?? 0}% of sign-ups · ${fr?.conversion ?? 0}% conv.`} icon={<Handshake className="w-4 h-4" />} />
        <Kpi label="BDR sign-ups" value={fmt(bdr?.signed ?? 0)} sub={`${bdr?.share ?? 0}% of sign-ups · ${bdr?.conversion ?? 0}% conv.`} icon={<Trophy className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* Representatives */}
          <Section title="Representatives" hint="Ranked by sign-ups. Conversion is green at or above the team's overall rate, gold below it." icon={<Trophy className="w-4 h-4" />}>
            {data.reps.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto -mx-2.5">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className={`border-b ${line}`}>
                      <th className={`${th} text-left w-10`}>#</th>
                      <th className={`${th} text-left`}>Representative</th>
                      <th className={`${th} text-right`}>Leads</th>
                      <th className={`${th} text-right`}>Signed</th>
                      <th className={`${th} text-left w-[36%]`}>Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reps.map((r, i) => (
                      <tr key={r.name} className={`border-b last:border-0 ${line} ${r.current ? "" : "opacity-70"}`}>
                        <td className={`${td} tabular-nums ${muted}`}>
                          {i === 0 ? <Trophy className="w-4 h-4" style={{ color: C.gold }} /> : i + 1}
                        </td>
                        <td className={td}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{r.name}</span>
                            <Pill tone={r.role === "BDR" ? "navy" : "gold"}>{r.role}</Pill>
                            {!r.current && <Pill tone="grey">Former</Pill>}
                          </div>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{fmt(r.leads)}</td>
                        <td className={`${td} text-right tabular-nums font-semibold ${navyText}`}>{fmt(r.signed)}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-[#f0ece2] dark:bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.conversion)}%`, background: r.conversion >= avg ? C.ok : C.gold }} />
                            </div>
                            <span className="w-11 text-right tabular-nums text-xs font-medium">{r.conversion}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Monthly trend */}
          <Section title="Monthly trend" hint="Sign-ups against all leads, month by month. Hover a month for its conversion." icon={<TrendingUp className="w-4 h-4" />}>
            {data.months.length === 0 ? <Empty /> : (
              <>
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-2 min-w-fit h-48 pt-2">
                    {data.months.map((m) => (
                      <div key={m.month} className="flex flex-col items-center gap-1 w-12 h-full shrink-0" title={`${monthLabel(m.month)}: ${m.signed} signed of ${m.leads} leads (${m.conversion}%)`}>
                        <span className={`text-[11px] font-semibold tabular-nums ${navyText}`}>{m.signed}</span>
                        <div className="relative w-7 flex-1">
                          <div className="absolute bottom-0 w-full rounded-t bg-[#e8e2d4] dark:bg-muted" style={{ height: `${(m.leads / monthMax) * 100}%` }} />
                          <div className="absolute bottom-0 w-full rounded-t bg-[#0f2747] dark:bg-[#d8b878]" style={{ height: `${(m.signed / monthMax) * 100}%` }} />
                        </div>
                        <span className={`text-[10px] whitespace-nowrap ${muted}`}>{monthShort(m.month)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`flex gap-4 mt-3 text-[11px] ${muted}`}>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#0f2747] dark:bg-[#d8b878]" /> Signed</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#e8e2d4] dark:bg-muted" /> All leads</span>
                </div>
              </>
            )}
          </Section>

          {/* Rep × month */}
          <Section title="Sign-ups by representative and month" hint="Deeper gold means more sign-ups that month." icon={<CalendarRange className="w-4 h-4" />}>
            {data.repMonths.rows.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto -mx-2.5">
                <table className="text-[13px] min-w-full border-collapse">
                  <thead>
                    <tr className={`border-b ${line}`}>
                      <th className={`${th} text-left sticky left-0 bg-white dark:bg-card`}>Representative</th>
                      {data.repMonths.months.map((m) => <th key={m} className={`${th} text-center whitespace-nowrap`}>{monthShort(m)}</th>)}
                      <th className={`${th} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.repMonths.rows.map((r) => (
                      <tr key={r.name} className={`border-b ${line} ${r.current ? "" : "opacity-70"}`}>
                        <td className={`${td} whitespace-nowrap sticky left-0 bg-white dark:bg-card font-medium`}>
                          {r.name} <span className={`text-[10px] font-normal ${muted}`}>{r.role}</span>
                        </td>
                        {r.cells.map((v, i) => <HeatCell key={i} v={v} />)}
                        <td className={`${td} text-right tabular-nums font-semibold ${navyText}`}>{r.total}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className={`${td} sticky left-0 bg-white dark:bg-card ${navyText}`}>Total</td>
                      {data.months.map((m) => <td key={m.month} className={`${td} text-center tabular-nums`}>{m.signed}</td>)}
                      <td className={`${td} text-right tabular-nums ${navyText}`}>{data.totals.signed}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Referring partners */}
          <Section
            title="Top referring partners"
            hint={`From the ${fmt(data.totals.attributed)} leads whose "Referred by" in Lead Docket matches a partner in the CRM.`}
            icon={<Handshake className="w-4 h-4" />}
          >
            {data.partners.length === 0 ? (
              <p className={`text-sm ${muted}`}>No leads in this period name a partner we can match.</p>
            ) : (
              <div className="overflow-x-auto -mx-2.5">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className={`border-b ${line}`}>
                      <th className={`${th} text-left`}>Partner</th>
                      <th className={`${th} text-left`}>Territory</th>
                      <th className={`${th} text-right`}>Leads</th>
                      <th className={`${th} text-right`}>Signed</th>
                      <th className={`${th} text-right`}>Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.partners.map((p) => (
                      <tr key={p.facilityId} className={`border-b last:border-0 ${line}`}>
                        <td className={td}>
                          <Link href={`/crm/facilities/${p.facilityId}`} className={`font-semibold hover:underline ${navyText}`}>{p.name}</Link>
                        </td>
                        <td className={`${td} ${muted}`}>{p.territory ?? "—"}</td>
                        <td className={`${td} text-right tabular-nums`}>{p.leads}</td>
                        <td className={`${td} text-right tabular-nums font-semibold`}>{p.signed}</td>
                        <td className={`${td} text-right`}>
                          <Pill tone={p.conversion >= avg ? "ok" : "grey"}>{p.conversion}%</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Partner type + territory (partner-attributed leads only) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Section title="Referring partner type" hint="Leads with a matched referring partner." icon={<Building2 className="w-4 h-4" />}>
              {types.length === 0 ? <p className={`text-sm ${muted}`}>No partner-attributed leads.</p> : (
                <div className="space-y-2.5">
                  {types.map((t) => <Bar key={t.name} label={t.name} value={t.leads} max={typeMax} tone="navy" />)}
                </div>
              )}
            </Section>
            <Section title="Territory" hint="Where the referring partner is; top 10." icon={<MapPin className="w-4 h-4" />}>
              {territories.length === 0 ? <p className={`text-sm ${muted}`}>No partner-attributed leads.</p> : (
                <div className="space-y-2.5">
                  {territories.map((t) => <Bar key={t.name} label={t.name} value={t.leads} max={terrMax} tone="gold" />)}
                </div>
              )}
            </Section>
          </div>
        </div>

        {/* Right rail */}
        <aside className="space-y-5">
          <section className={`${card} overflow-hidden`}>
            <div className="px-5 py-3 text-white border-b-[3px]" style={{ background: GRADIENT, borderBottomColor: C.gold }}>
              <div className="text-sm font-semibold">Executive briefing</div>
              <div className="text-[11px] mt-0.5" style={{ color: C.gold2 }}>What this period's numbers say</div>
            </div>
            <ul className="px-5 py-4 space-y-3 text-[13px] leading-relaxed">
              {data.insights.map((i, n) => (
                <li key={n} className="flex gap-2.5">
                  <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: C.gold }} />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </section>

          <Section title="Recommendations">
            {data.recommendations.length === 0 ? <p className={`text-sm ${muted}`}>Nothing flagged for this period.</p> : (
              <ol className="space-y-3 text-[13px] leading-relaxed">
                {data.recommendations.map((r, n) => (
                  <li key={n} className="flex gap-2.5">
                    <span className="w-5 h-5 rounded-full shrink-0 text-[11px] font-bold flex items-center justify-center" style={{ background: C.gold, color: C.navy }}>{n + 1}</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="How these numbers are built">
            <div className={`rounded-[7px] bg-[#f6f3ec] dark:bg-muted/40 p-3.5 space-y-2.5 text-[12.5px] leading-relaxed ${muted}`}>
              <p>
                Leads and sign-ups come from <b className={navyText}>Lead Docket</b>. A lead belongs to a representative when its
                Marketing Source names them — "BDR Miguel Flores", "Field Representative Lupe Campos". Marketing, intake and
                website leads are not counted.
              </p>
              <p>
                A lead counts as <b className={navyText}>signed</b> when it has a sign-up date, even if the case later closed.
                Months are by sign-up date for signed leads.
              </p>
              <p>
                Partner, type and territory come from Lead Docket's "Referred by". {fmt(data.totals.attributed)} of{" "}
                {fmt(data.totals.leads)} leads name a partner we can match; the rest still count for the representative.
              </p>
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}

function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="date"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className={`h-8 px-2 rounded-[7px] border ${line} bg-white dark:bg-background text-[13px] text-[#1c2430] dark:text-foreground`}
    />
  );
}

function Toggle({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className={`inline-flex rounded-[7px] border ${line} bg-white dark:bg-card p-0.5`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-[5px] text-xs font-semibold transition-colors ${on ? "text-white" : `${muted} hover:text-[#0f2747] dark:hover:text-foreground`}`}
            style={on ? { background: C.navy } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, sub, icon, hero }: { label: string; value: string; sub?: string; icon: React.ReactNode; hero?: boolean }) {
  if (hero) {
    return (
      <div className="rounded-[10px] px-4 py-3.5 text-white border-b-[3px] shadow-sm" style={{ background: GRADIENT, borderBottomColor: C.gold }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/75">{icon} {label}</div>
        <div className="text-[32px] font-bold leading-tight mt-1 tabular-nums" style={{ color: C.gold2 }}>{value}</div>
        {sub && <div className="text-xs text-white/70">{sub}</div>}
      </div>
    );
  }
  return (
    <div className={`${card} px-4 py-3.5`}>
      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide ${muted}`}>
        <span className={`w-6 h-6 rounded-md flex items-center justify-center bg-[#f6f3ec] dark:bg-muted ${navyText}`}>{icon}</span>
        {label}
      </div>
      <div className={`text-[28px] font-bold leading-tight mt-1 tabular-nums ${navyText}`}>{value}</div>
      {sub && <div className={`text-xs ${muted}`}>{sub}</div>}
    </div>
  );
}

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${card} px-5 py-[18px]`}>
      <h2 className={`text-base font-semibold flex items-center gap-2 ${navyText}`}>
        {icon && <span style={{ color: C.gold }}>{icon}</span>}
        {title}
      </h2>
      {hint && <p className={`text-[13px] mt-0.5 ${muted}`}>{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Pill({ tone, children }: { tone: "navy" | "gold" | "grey" | "ok"; children: React.ReactNode }) {
  const tones = {
    navy: "bg-[#e6ebf2] text-[#0f2747] dark:bg-white/10 dark:text-foreground",
    gold: "bg-[#f5ecdb] text-[#8a6a2c] dark:bg-[#b8924a]/20 dark:text-[#d8b878]",
    grey: "bg-[#f0ece2] text-[#6b7787] dark:bg-muted dark:text-muted-foreground",
    ok: "bg-[#e3f1e8] text-[#2e7d4f] dark:bg-[#2e7d4f]/25 dark:text-[#7fcf9f]",
  };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-xl ${tones[tone]}`}>{children}</span>;
}

function HeatCell({ v }: { v: number }) {
  if (!v) return <td className={`${td} text-center ${muted} opacity-40`}>·</td>;
  const a = Math.min(0.12 + v / 25, 0.85);
  return (
    <td className={`${td} text-center tabular-nums font-medium`} style={{ background: `rgba(184,146,74,${a})`, color: a > 0.5 ? "#fff" : undefined }}>
      {v}
    </td>
  );
}

function Empty() {
  return <p className={`text-sm ${muted}`}>No leads in this period.</p>;
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "navy" | "gold" }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <div className={`w-28 shrink-0 truncate text-right ${muted}`} title={label}>{label}</div>
      <div className="flex-1 h-5 rounded bg-[#f0ece2] dark:bg-muted overflow-hidden">
        <div className={`h-full rounded ${tone === "navy" ? "bg-[#0f2747] dark:bg-[#8db8e3]" : "bg-[#b8924a]"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 shrink-0 tabular-nums text-right font-semibold">{value}</div>
    </div>
  );
}
