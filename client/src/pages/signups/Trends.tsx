/**
 * Trends & forecast (server/signupsTrends.ts): this week, this month and this
 * year side by side — sign-ups so far, the forecast, the same point last time —
 * over each one's recent history. Past periods are charcoal sticks, the one
 * under way is yellow, the forecast a dashed ghost, the team's target a dashed
 * line; the numbers behind every stick are one click away.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";

type Trends = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["signupsTrends"]>;
type View = Trends["week"];
type Unit = "week" | "month" | "year";

const num = (n: number) => n.toLocaleString("en-US");

export function TrendsPanel({ role, team }: { role: "all" | "BDR" | "FR" | "Intake"; team: "all" | "current" }) {
  const { data, isPlaceholderData } = trpc.teamReports.signupsTrends.useQuery(
    { ...(role !== "all" ? { role } : {}), team },
    { placeholderData: (prev) => prev },
  );
  const scope = [role === "all" ? "BDR and FR" : role, team === "current" ? "current team" : "including former reps"].join(", ");
  return (
    <div className="sr-panel sr-trends" style={isPlaceholderData ? { opacity: 0.6 } : undefined}>
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>Trends &amp; forecast</h2></div>
        <div className="sr-tlegend" aria-hidden>
          <span><i className="act" />signed</span><span><i className="now" />so far</span><span><i className="fc" />forecast</span><span><i className="tgt" />target</span>
        </div>
      </div>
      <p className="sr-sub">
        Sign-ups by week, month and year ({scope}) — the whole history, whatever the dates above. The forecast is what's
        signed so far plus the rest of the period at the last {data?.paceWeeks ?? 8} weeks' pace, weekday by weekday.
      </p>
      {!data ? (
        <div className="sr-trend-grid">{[0, 1, 2].map((i) => <div key={i} className="sr-skel" style={{ height: 300 }} />)}</div>
      ) : (
        <div className="sr-trend-grid">
          <TrendCard title="This week" unit="week" v={data.week} />
          <TrendCard title="This month" unit="month" v={data.month} />
          <TrendCard title="This year" unit="year" v={data.year} />
        </div>
      )}
    </div>
  );
}

function TrendCard({ title, unit, v }: { title: string; unit: Unit; v: View }) {
  const delta = v.soFar - v.samePointBefore;
  const max = Math.max(1, v.target ?? 0, ...v.periods.map((p) => Math.max(p.signed, p.forecast ?? 0)));
  const h = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  const vsTarget = v.target ? Math.round((v.forecast / v.target) * 100) : null;
  // Fourteen sticks don't all fit a label: every third, counting back from the one under way.
  const current = v.periods.findIndex((p) => p.state === "current");
  const showLabel = (i: number) => v.periods.length <= 8 || (i <= current && (current - i) % 3 === 0);
  return (
    <div className="sr-tcard">
      <div className="sr-tcard-h">
        <h3>{title}</h3>
        {v.target != null && <span className="sr-tcard-tg">target {num(v.target)}</span>}
      </div>
      <div className="sr-kv">
        <span className="n">{num(v.soFar)}</span>
        <span className="u">signed so far<br />forecast <b>{num(v.forecast)}</b>{vsTarget != null && <> · {vsTarget}% of target</>}</span>
      </div>
      <p className="sr-tcmp">
        <span className={`sr-tdelta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {num(Math.abs(delta))}
        </span>
        {" "}vs {num(v.samePointBefore)} by this point last {unit}
        {v.next != null && <> · next {unit} ≈ <b>{num(v.next)}</b></>}
      </p>
      <div className="sr-tchart">
        {v.target != null && (
          <div className="sr-tplot" aria-hidden><div className="sr-tline" style={{ bottom: h(v.target) }}><span>{num(v.target)}</span></div></div>
        )}
        {v.periods.map((p, i) => {
          const tip = p.state === "next"
            ? `${p.label}: forecast ${num(p.forecast ?? 0)} sign-ups`
            : `${p.label}: ${num(p.signed)} signed${p.fr || p.bdr ? ` (${num(p.fr)} FR · ${num(p.bdr)} BDR)` : ""} of ${num(p.leads)} leads`
              + (p.state === "current" ? ` so far · forecast ${num(p.forecast ?? p.signed)}` : "");
          return (
            <div key={p.key} className={`sr-tcol ${p.state} ${i < 3 ? "l" : i > v.periods.length - 4 ? "r" : ""}`} tabIndex={0} aria-label={tip}>
              <div className="sr-tstick">
                {p.forecast != null && <i className="fc" style={{ height: h(p.forecast) }} />}
                {p.state !== "next" && p.signed > 0 && <i className="act" style={{ height: h(p.signed) }} />}
              </div>
              <span className="sr-lab">{showLabel(i) ? p.label : ""}</span>
              <span className="sr-ttip" role="tooltip">{tip}</span>
            </div>
          );
        })}
      </div>
      <details className="sr-tnums">
        <summary>See the numbers</summary>
        <table>
          <thead><tr><th>{unit === "week" ? "Week of" : unit === "month" ? "Month" : "Year"}</th><th>Leads</th><th>Signed</th><th>FR</th><th>BDR</th><th>Forecast</th></tr></thead>
          <tbody>
            {v.periods.slice().reverse().map((p) => (
              <tr key={p.key} className={p.state}>
                <td>{p.label}{p.state === "current" ? " (so far)" : p.state === "next" ? " (next)" : ""}</td>
                <td>{p.state === "next" ? "—" : num(p.leads)}</td>
                <td>{p.state === "next" ? "—" : num(p.signed)}</td>
                <td>{p.state === "next" ? "—" : num(p.fr)}</td>
                <td>{p.state === "next" ? "—" : num(p.bdr)}</td>
                <td>{p.forecast == null ? "" : num(p.forecast)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
