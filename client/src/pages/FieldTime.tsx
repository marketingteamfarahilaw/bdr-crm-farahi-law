/**
 * FR Field Time (server/timeero.ts): the Field Reps' Timeero timesheets for the
 * dates picked — hours worked, miles driven, and where each shift started and
 * ended, tied to the CRM partner there when there is one. Managers only.
 * Laid out like the other desktop reports (BDR Reports, Facilities): a compact
 * header, a row of stat cards and dense tables.
 */
import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Clock, Car, CalendarDays, MapPin, Loader2, AlertTriangle, Building2, Users, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { iso, presets, rangeLabel } from "./SignupsDashboard";

const hm = (sec: number) => `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
// Timeero writes the rep's wall-clock time with no zone; read it as written.
const clock = (t: string | null) => (t ? new Date(t.slice(0, 19)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const short = (a: string | null) => (a ? a.replace(/, United States of America$/, "").replace(/, CA \d{5}$/, "") : "—");

type Place = { id: number; name: string } | null;

function Where({ partner, address, job }: { partner: Place; address: string | null; job?: string | null }) {
  if (partner) {
    return (
      <Link href={`/crm/facilities/${partner.id}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary" title={address ?? undefined}>
        <Building2 className="w-3 h-3 shrink-0" /><span className="truncate max-w-[220px]">{partner.name}</span>
      </Link>
    );
  }
  if (job) return <span className="inline-flex items-center gap-1 text-foreground"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[220px]">{job}</span></span>;
  return <span className="block truncate max-w-[240px] text-muted-foreground" title={address ?? undefined}>{short(address)}</span>;
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{label}</span></div>
        <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
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

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !rep || r.rep === rep), [data, rep]);
  const reps = (data?.reps ?? []).filter((r) => !rep || r.rep === rep);
  const totals = reps.reduce((a, r) => ({ hours: a.hours + r.hours, miles: a.miles + r.miles, days: a.days + r.days, shifts: a.shifts + r.shifts, at: a.at + r.atPartners }),
    { hours: 0, miles: 0, days: 0, shifts: 0, at: 0 });
  const shown = showAll ? rows : rows.slice(0, 100);

  const exportCsv = () => {
    const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Day", "Representative", "Clock in", "Clock out", "Hours", "Miles", "Started at", "Ended at", "Job", "Notes", "Flagged"].join(","),
      ...rows.map((r) => [r.day, c(r.rep), clock(r.clockIn), r.open ? "still in" : clock(r.clockOut), (r.seconds / 3600).toFixed(2), r.miles,
        c(r.jobPartner?.name ?? r.inPartner?.name ?? r.inAddress), c(r.outPartner?.name ?? r.outAddress), c(r.job), c(r.notes), r.flagged ? "yes" : ""].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `fr-field-time-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Header + filters on one line */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>FR Field Time</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rangeLabel(from, to)} · Timeero clock-ins, hours and mileage{rep ? ` · ${rep}` : ""}
            {isFetching && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin" />}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1">
            {periods.map((p) => (
              <button key={p.label} onClick={() => set({ from: p.from, to: p.to })}
                className={`text-xs font-medium rounded-lg px-2.5 py-2 border transition-colors ${p.label === active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Input type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} className="bg-card border-border h-9 w-[140px]" aria-label="From" />
          <Input type="date" value={to} onChange={(e) => e.target.value && set({ to: e.target.value })} className="bg-card border-border h-9 w-[140px]" aria-label="To" />
          <Select value={rep || "__all__"} onValueChange={(v) => set({ rep: v === "__all__" ? null : v })}>
            <SelectTrigger className="bg-card border-border h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Field Reps</SelectItem>
              {(data?.reps ?? []).map((r) => <SelectItem key={r.rep} value={r.rep}>{r.rep}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> Export CSV</Button>
        </div>
      </div>

      {!data ? (
        isError && !isLoading ? (
          <Card className="bg-card border-border"><CardContent className="p-5 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-destructive" /><span className="flex-1">Couldn't load the field time. {error?.message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat icon={Clock} label="Hours worked" value={totals.hours.toFixed(1)} sub={totals.days ? `${(totals.hours / totals.days).toFixed(1)} h per working day` : undefined} />
            <Stat icon={CalendarDays} label="Working days" value={String(totals.days)} sub={`${totals.shifts} shift${totals.shifts === 1 ? "" : "s"}`} />
            <Stat icon={Car} label="Miles driven" value={totals.miles.toLocaleString("en-US")} />
            <Stat icon={Building2} label="Shifts at a partner" value={`${totals.at} of ${totals.shifts}`} sub="GPS near a CRM partner, or a Timeero job" />
            <Stat icon={Users} label="Field Reps" value={String(reps.length)} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-5 items-start">
            {/* By representative */}
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> By representative</CardTitle></CardHeader>
              {!data.reps.length ? <CardContent className="text-sm text-muted-foreground">No Timeero shifts in these dates.</CardContent> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium">Representative</th>
                      <th className="text-right px-3 py-2 font-medium">Days</th>
                      <th className="text-right px-3 py-2 font-medium">Hours</th>
                      <th className="text-right px-3 py-2 font-medium">/ day</th>
                      <th className="text-right px-3 py-2 font-medium">Miles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reps.map((r) => (
                      <tr key={r.rep} onClick={() => set({ rep: rep === r.rep ? null : r.rep })}
                        className={`border-b border-border/50 cursor-pointer transition-colors ${rep === r.rep ? "bg-primary/10" : "hover:bg-muted/20"}`}
                        title={rep === r.rep ? "Show every rep" : "Show only this rep's shifts"}>
                        <td className="px-3 py-2 font-medium text-foreground">{r.rep}{r.flagged ? <span className="ml-1.5 text-[10px] text-destructive">{r.flagged} flagged</span> : null}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.hours.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.avgHoursPerDay.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.miles.toLocaleString("en-US")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Shifts */}
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Shifts <span className="text-xs font-normal text-muted-foreground">· {rows.length} · newest first</span></CardTitle>
              </CardHeader>
              {!rows.length ? <CardContent className="text-sm text-muted-foreground">No shifts.</CardContent> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Day</th>
                          <th className="text-left px-3 py-2 font-medium">Rep</th>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">In – Out</th>
                          <th className="text-right px-3 py-2 font-medium">Worked</th>
                          <th className="text-right px-3 py-2 font-medium">Miles</th>
                          <th className="text-left px-3 py-2 font-medium">Started at</th>
                          <th className="text-left px-3 py-2 font-medium">Ended at</th>
                          <th className="text-left px-3 py-2 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 align-top">
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{dayLabel(r.day)}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-medium text-foreground">{r.rep}</td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {clock(r.clockIn)} – {r.open ? <span className="text-amber-600 dark:text-amber-400 font-medium">still in</span> : clock(r.clockOut)}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums font-semibold">{hm(r.seconds)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.miles ? r.miles.toFixed(1) : "—"}</td>
                            <td className="px-3 py-2"><Where partner={r.jobPartner ?? r.inPartner} address={r.inAddress} job={r.job} /></td>
                            <td className="px-3 py-2"><Where partner={r.outPartner} address={r.outAddress} /></td>
                            <td className="px-3 py-2 min-w-[180px] max-w-[320px] text-muted-foreground">
                              {r.flagged && <span className="inline-flex items-center gap-1 mr-1 text-destructive font-medium"><AlertTriangle className="w-3 h-3" /> flagged</span>}
                              <span className="line-clamp-2" title={r.notes ?? undefined}>{r.notes ?? ""}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > shown.length && (
                    <div className="p-3 flex justify-center border-t border-border">
                      <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>Show all {rows.length} shifts</Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            From Timeero timesheets, updated live as reps clock in and out. Hours exclude breaks. "Started at" / "Ended at" show the CRM
            partner when the clock-in or clock-out was within about 150 m of one (or the shift was clocked to a Timeero job), otherwise Timeero's address.
          </p>
        </>
      )}
    </div>
  );
}
