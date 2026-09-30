/**
 * FR Field Time (server/timeero.ts): the Field Reps' Timeero timesheets for the
 * dates picked — hours worked, miles driven, and where each shift started and
 * ended, tied to the CRM partner there when there is one. Managers only.
 */
import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Clock, Car, CalendarDays, MapPin, Loader2, AlertTriangle, Building2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { RepFace } from "@/components/RepFace";
import { Big, DateInput, fmt, hueStyle, initials, iso, presets, rangeLabel } from "./SignupsDashboard";
import { LoadError } from "./signups/LoadError";
import "./SignupsDashboard.css";

const hm = (sec: number) => `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
const clock = (t: string | null) => (t ? new Date(`${t.slice(0, 19)}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

type Place = { id: number; name: string } | null;

function Where({ partner, address }: { partner: Place; address: string | null }) {
  if (partner) return <Link href={`/crm/facilities/${partner.id}`} className="ft-partner"><Building2 /> {partner.name}</Link>;
  return <span className="ft-addr" title={address ?? undefined}>{address ? address.replace(/, United States of America$/, "") : "—"}</span>;
}

export default function FieldTime() {
  const today = new Date();
  const q = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const from = q.get("from") || iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = q.get("to") || iso(today);
  const rep = q.get("rep") || "";
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    navigate(`/field-time?${next}`, { replace: true });
  };
  const periods = presets(today);
  const active = periods.find((p) => p.from === from && p.to === to)?.label;
  const { data, isLoading, isFetching, isError, error, refetch } = trpc.teamReports.fieldTime.useQuery({ from, to }, { placeholderData: (p) => p });
  const [showAll, setShowAll] = useState(false);

  const rows = (data?.rows ?? []).filter((r) => !rep || r.rep === rep);
  const shown = showAll ? rows : rows.slice(0, 60);
  const totals = (data?.reps ?? []).filter((r) => !rep || r.rep === rep).reduce(
    (a, r) => ({ hours: a.hours + r.hours, miles: a.miles + r.miles, days: a.days + r.days, shifts: a.shifts + r.shifts }),
    { hours: 0, miles: 0, days: 0, shifts: 0 },
  );

  return (
    <div className="sr">
      <div className="sr-bar">
        <div className="sr-bar-in">
          <div className="sr-seg" role="group" aria-label="Period">
            {periods.map((p) => (
              <button key={p.label} className={p.label === active ? "on" : ""} onClick={() => set({ from: p.from, to: p.to })}>{p.label}</button>
            ))}
          </div>
          <span className="sr-dates">
            <DateInput value={from} onChange={(v) => set({ from: v })} label="From" />–<DateInput value={to} onChange={(v) => set({ to: v })} label="To" />
          </span>
          {!!data?.reps.length && (
            <select className="sr-input" value={rep} onChange={(e) => set({ rep: e.target.value || null })} aria-label="Representative">
              <option value="">All Field Reps</option>
              {data.reps.map((r) => <option key={r.rep} value={r.rep}>{r.rep}</option>)}
            </select>
          )}
          {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
        </div>
      </div>

      <div className="sr-canvas">
        <div className="sr-inner">
          <header className="sr-hero sr-hero-slim">
            <h1>FR field time</h1>
            <p className="sr-lead">{rangeLabel(from, to)} · from Timeero clock-ins · {rep || "all Field Reps"}</p>
          </header>

          {!data ? (
            isError && !isLoading ? <LoadError what="the field time" message={error?.message} onRetry={() => refetch()} />
              : <div className="sr-skel" style={{ height: 260 }} />
          ) : (
            <>
              <div className="sr-panel sr-headline">
                <div className="sr-bigs">
                  <Big n={fmt(Math.round(totals.hours))} label="Hours worked" icon={<Clock />} />
                  <Big n={fmt(totals.miles)} label="Miles driven" icon={<Car />} />
                  <Big n={fmt(totals.shifts)} label="Shifts" icon={<CalendarDays />} />
                </div>
              </div>

              <div className="sr-panel">
                <div className="sr-panel-h"><div className="sr-ttl"><h2>By representative</h2><span className="sr-count">{data.reps.length}</span></div></div>
                {data.reps.length === 0 ? <p className="sr-nil">No Timeero shifts in these dates.</p> : (
                  <div className="sr-scroll">
                    <table className="sr-t sr-t-fit">
                      <thead><tr><th>Representative</th><th className="num">Days</th><th className="num">Hours</th><th className="num">Avg / day</th><th className="num">Miles</th><th className="num" title="Shifts that started or ended at a CRM partner, or were clocked to a Timeero job">At a partner</th></tr></thead>
                      <tbody>
                        {data.reps.map((r) => (
                          <tr key={r.rep} className="sr-click" onClick={() => set({ rep: rep === r.rep ? null : r.rep })} title="Show only this rep's shifts">
                            <td><div className="sr-who"><span className="sr-av" style={hueStyle(r.rep)}><RepFace name={r.rep} fallback={initials(r.rep)} /></span><div><b>{r.rep}</b>{r.flagged ? <i>{r.flagged} flagged</i> : null}</div></div></td>
                            <td className="num">{r.days}</td>
                            <td className="num"><span className="sr-score">{r.hours.toFixed(1)}</span></td>
                            <td className="num">{r.avgHoursPerDay.toFixed(1)}</td>
                            <td className="num">{fmt(r.miles)}</td>
                            <td className="num">{r.atPartners} of {r.shifts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="sr-panel">
                <div className="sr-panel-h"><div className="sr-ttl"><h2>Shifts</h2><span className="sr-count">{fmt(rows.length)}</span></div></div>
                <p className="sr-sub">Newest first. Clock-in and clock-out places show the CRM partner when they're within about 150 m of one; otherwise Timeero's address.</p>
                {rows.length === 0 ? <p className="sr-nil">No shifts.</p> : (
                  <>
                    <div className="sr-scroll">
                      <table className="sr-t ft-t">
                        <thead><tr><th>Day</th><th>Representative</th><th>In</th><th>Out</th><th className="num">Worked</th><th className="num">Miles</th><th>Started at</th><th>Ended at</th><th>Notes</th></tr></thead>
                        <tbody>
                          {shown.map((r) => (
                            <tr key={r.id}>
                              <td className="nowrap">{dayLabel(r.day)}</td>
                              <td className="nowrap">{r.rep}</td>
                              <td className="nowrap">{clock(r.clockIn)}</td>
                              <td className="nowrap">{r.open ? <span className="sr-badge sr-b-sun">still in</span> : clock(r.clockOut)}</td>
                              <td className="num nowrap">{hm(r.seconds)}</td>
                              <td className="num">{r.miles ? r.miles.toFixed(1) : "—"}</td>
                              <td>{r.job ? (r.jobPartner ? <Where partner={r.jobPartner} address={null} /> : <span className="ft-addr"><MapPin /> {r.job}</span>) : <Where partner={r.inPartner} address={r.inAddress} />}</td>
                              <td><Where partner={r.outPartner} address={r.outAddress} /></td>
                              <td className="ft-notes">{r.flagged && <span className="sr-badge sr-b-bad"><AlertTriangle /> flagged</span>} {r.notes ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {rows.length > shown.length && (
                      <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                        <button className="sr-btn2" onClick={() => setShowAll(true)}>Show all {fmt(rows.length)} shifts</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
