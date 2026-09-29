/**
 * Monthly leads summary (server/signupsMonthly.ts): the team's "Monthly leads
 * summary" sheet, from Lead Docket — per role, a column per month, the sheet's
 * rows (with "Partner named" where the sheet had "Leads in DOMO"), and beside it
 * the sheet's chart: leads as bars, quality leads and sign-ups as lines.
 */
import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";

type Monthly = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["signupsMonthly"]>;
type Group = Monthly["groups"][number];
type Row = Group["total"];
type Month = Monthly["months"][number];

const num = (n: number) => n.toLocaleString("en-US");

const ROWS: { key: keyof Row; label: string; pct?: boolean; strong?: boolean; hint?: string }[] = [
  { key: "leads", label: "Total leads" },
  { key: "partnerNamed", label: "Partner named", hint: "Leads whose Lead Docket record names who referred them (Referred By or Marketing Source Details)." },
  { key: "pctPartnerNamed", label: "% partner named", pct: true },
  { key: "qualified", label: "Qualified leads", hint: "An accepted case type: Auto, Motorcycle, Bicycle, Pedestrian, Truck, Slip and Fall, Dog Bite, Personal Injury, Wrongful Death." },
  { key: "quality", label: "Quality leads", hint: "Estimate: qualified leads that intake didn't turn down for no injuries, property damage only, no treatment or a gap in treatment." },
  { key: "signed", label: "Signed" },
  { key: "signedReferral", label: "Signed referral", hint: "Signed, then referred out to another firm." },
  { key: "totalSigned", label: "Total signed", strong: true },
  { key: "pctSignedToLeads", label: "% Signed to leads", pct: true, hint: "Total signed ÷ total leads." },
  { key: "pctQuality", label: "% Quality leads", pct: true, strong: true, hint: "Quality leads ÷ total leads." },
  { key: "pctSignedToQuality", label: "% Signed to quality", pct: true, strong: true, hint: "Signed (in-house) ÷ quality leads, as on the team's sheet — it can pass 100%." },
];

const cell = (r: Row, key: keyof Row, pct?: boolean) => {
  const v = r[key] as number | null;
  return v == null ? "—" : pct ? `${v}%` : num(v);
};

export function MonthlyPanel({ role, team, member }: { role: "all" | "BDR" | "FR" | "Intake"; team: "all" | "current"; member?: string }) {
  const [year, setYear] = useState<number>();
  const { data, isPlaceholderData } = trpc.teamReports.signupsMonthly.useQuery(
    { ...(year ? { year } : {}), ...(role !== "all" ? { role } : {}), team, ...(member ? { member } : {}) },
    { placeholderData: (prev) => prev },
  );
  const shown = data?.year ?? year;
  return (
    <div className="sr-panel sr-monthly" style={isPlaceholderData ? { opacity: 0.6 } : undefined}>
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>{shown ? `${shown} monthly leads summary` : "Monthly leads summary"}</h2></div>
        {data && data.years.length > 1 && (
          <div className="sr-seg" role="group" aria-label="Year">
            {data.years.map((y) => (
              <button key={y} type="button" className={y === data.year ? "on" : ""} aria-pressed={y === data.year} onClick={() => setYear(y)}>{y}</button>
            ))}
          </div>
        )}
      </div>
      <p className="sr-sub">
        From Lead Docket, the month a lead signed or came in, as in the rest of the report. Quality leads are an estimate —
        Lead Docket doesn't record injuries or treatment, so a qualified lead counts unless intake turned it down for one of them.
        Hover a row name for how it's counted.
      </p>
      {!data ? (
        <div className="sr-skel" style={{ height: 320 }} />
      ) : data.groups.length === 0 ? (
        <p className="sr-nil">No leads in {data.year}.</p>
      ) : (
        data.groups.map((g) => <MonthlyBlock key={g.key} g={g} months={data.months} year={data.year} />)
      )}
    </div>
  );
}

function MonthlyBlock({ g, months, year }: { g: Group; months: Month[]; year: number }) {
  return (
    <div className="sr-mo">
      <div className="sr-scroll sr-mo-tw">
        <table className="sr-mo-t">
          <thead>
            <tr>
              <th scope="col">{g.label}</th>
              {months.map((m) => <th key={m.key} scope="col" className={m.current ? "now" : undefined}>{m.label}{m.current ? "*" : ""}</th>)}
              <th scope="col" className="tot">{year}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className={r.strong ? "b" : undefined}>
                <th scope="row" title={r.hint}>{r.label}</th>
                {g.months.map((m, i) => <td key={months[i].key} className={months[i].current ? "now" : undefined}>{cell(m, r.key, r.pct)}</td>)}
                <td className="tot">{cell(g.total, r.key, r.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {months.some((m) => m.current) && <p className="sr-mo-foot">* this month so far</p>}
      </div>
      <MonthlyChart g={g} months={months} />
    </div>
  );
}

// Lines, in the order of the legend. Colours are validated for colour-blind separation (see SignupsDashboard.css).
const LINES = [
  { key: "quality", label: "Quality leads", cls: "q" },
  { key: "signed", label: "Signed", cls: "s" },
  { key: "signedReferral", label: "Signed referral", cls: "r" },
] as const;

function MonthlyChart({ g, months }: { g: Group; months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the plot's real width, so labels keep their size on a phone instead of shrinking with it.
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = plot.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = width, H = 250, L = 34, R = 10, T = 22, B = 24;
  const top = Math.max(1, ...g.months.map((m) => Math.max(m.leads, m.quality, m.signed, m.signedReferral)));
  // A round axis: steps of 5, 10, 25, 50… with four or five gridlines.
  const step = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].find((s) => top / s <= 5) ?? 1000;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const slot = (W - L - R) / months.length;
  const x = (i: number) => L + slot * i + slot / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const barW = Math.min(38, slot * 0.62);
  const tip = hover == null ? null : g.months[hover];
  return (
    <div className="sr-mo-chart">
      <div className="sr-mo-legend" aria-hidden>
        <span><i className="bar" />Total leads</span>
        {LINES.map((l) => <span key={l.key}><i className={`ln ${l.cls}`} />{l.label}</span>)}
      </div>
      <div className="sr-mo-plot" ref={plot}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${g.label}: leads, quality leads and sign-ups by month`}>
          {ticks.map((t) => (
            <g key={t} className="grid">
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
              <text x={L - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>
            </g>
          ))}
          {g.months.map((m, i) => {
            const h = y(0) - y(m.leads);
            return (
              <g key={months[i].key} className={`col${months[i].current ? " now" : ""}${hover === i ? " on" : ""}`}>
                {m.leads > 0 && <rect className="bar" x={x(i) - barW / 2} y={y(m.leads)} width={barW} height={h} rx={4} />}
                <text className="mx" x={x(i)} y={H - 7} textAnchor="middle">{months[i].label}</text>
              </g>
            );
          })}
          {LINES.map((l) => {
            const pts = g.months.map((m, i) => `${x(i)},${y(m[l.key])}`).join(" ");
            return (
              <g key={l.key} className={`ln ${l.cls}`}>
                <polyline className="halo" points={pts} />
                <polyline points={pts} />
                {g.months.map((m, i) => <circle key={i} cx={x(i)} cy={y(m[l.key])} r={hover === i ? 4.5 : 3.5} />)}
              </g>
            );
          })}
          {/* The bars' numbers go over the lines, so a line never hides one. */}
          {g.months.map((m, i) => {
            if (!m.leads) return null;
            const inside = y(0) - y(m.leads) >= 18;
            return (
              <text key={months[i].key} className={`bv${inside ? " in" : ""}${months[i].current ? " now" : ""}`} x={x(i)} y={inside ? y(m.leads) + 13 : y(m.leads) - 4} textAnchor="middle">
                {m.leads}
              </text>
            );
          })}
          {months.map((m, i) => (
            <rect
              key={m.key} className="hit" x={L + slot * i} y={T} width={slot} height={H - T - B}
              tabIndex={0} aria-label={`${m.label}: ${num(g.months[i].leads)} leads, ${num(g.months[i].quality)} quality, ${num(g.months[i].signed)} signed, ${num(g.months[i].signedReferral)} signed referral`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {tip && hover != null && (
          <div className="sr-mo-tip" style={{ left: `${(x(hover) / W) * 100}%` }} data-edge={hover < 2 ? "l" : hover > months.length - 3 ? "r" : undefined}>
            <b>{months[hover].label}{months[hover].current ? " (so far)" : ""}</b>
            <span>{num(tip.leads)} leads · {num(tip.quality)} quality</span>
            <span>{num(tip.signed)} signed · {num(tip.signedReferral)} signed referral</span>
          </div>
        )}
      </div>
    </div>
  );
}
