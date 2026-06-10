/**
 * Team Reports — the BDR/FR Excel workbooks, live.
 * Tabs: Check-Ins & Visits · Sign-Ups · New Facilities · Call Activity · Leads & Targets.
 * Same metrics, same groupings as the spreadsheets — computed from CRM data,
 * with the known Excel formula bugs fixed (totals that missed rows, etc).
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "@/lib/datetime";
import { FileBarChart2, ChevronDown, ChevronUp, PhoneCall, Building2, Award, Target, ClipboardList } from "lucide-react";

const fmtH = (sec: number) => `${(sec / 3600).toFixed(1)}h`;
const fmtD = (d: string) => format(new Date(`${d}T12:00:00`), "MMM d");
const pctCls = (v: number, goal = 100) => v >= goal ? "text-emerald-600 dark:text-emerald-400" : v >= goal / 2 ? "text-amber-600 dark:text-amber-400" : "text-destructive";

function presetRange(p: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  if (p === "last_month") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (p === "last_30") { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
  if (p === "ytd") return { from: iso(new Date(y, 0, 1)), to: iso(now) };
  return { from: iso(new Date(y, m, 1)), to: iso(now) }; // this month MTD
}

const TABS = [
  { id: "checkins", label: "Check-Ins & Visits", icon: PhoneCall },
  { id: "signups", label: "Sign-Ups", icon: Award },
  { id: "facilities", label: "New Facilities", icon: Building2 },
  { id: "calls", label: "Call Activity", icon: ClipboardList },
  { id: "leads", label: "Leads & Targets", icon: Target },
] as const;

function Th({ children, right = true }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2.5 font-semibold whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right = true, cls = "" }: { children: React.ReactNode; right?: boolean; cls?: string }) {
  return <td className={`px-3 py-2.5 whitespace-nowrap ${right ? "text-right" : "text-left"} ${cls}`}>{children}</td>;
}
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
const HeadRow = ({ cols }: { cols: string[] }) => (
  <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
    {cols.map((c, i) => <Th key={c} right={i !== 0}>{c}</Th>)}
  </tr></thead>
);

// ─── Tab 1: Check-Ins & Visits ───────────────────────────────────────────────
function CheckinsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.teamReports.checkinsVisits.useQuery({ from, to });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return null;

  const Section = ({ title, d, ckTarget, vTarget }: any) => (
    <Card title={title} sub={`Targets per facility this month: ${ckTarget} check-ins · ${vTarget} visits`}>
      <table className="w-full text-sm">
        <HeadRow cols={["Rep", "Facilities (book)", "Touched", "Total Check-ins", "Avg Check-in", "Total Visits", "Avg Visit"]} />
        <tbody>
          {d.reps.map((r: any) => (
            <>
              <tr key={r.rep} className="border-b border-border/60 hover:bg-secondary/30 cursor-pointer" onClick={() => setOpen((p) => ({ ...p, [title + r.rep]: !p[title + r.rep] }))}>
                <Td right={false} cls="font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">{open[title + r.rep] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{r.rep}</span>
                </Td>
                <Td>{r.bookSize}</Td>
                <Td>{r.facilitiesTouched}</Td>
                <Td cls="font-semibold">{r.totalCheckins}</Td>
                <Td cls={`font-semibold ${pctCls((r.avgCheckins / ckTarget) * 100)}`}>{r.avgCheckins.toFixed(2)}</Td>
                <Td cls="font-semibold">{r.totalVisits}</Td>
                <Td cls={`font-semibold ${pctCls((r.avgVisits / vTarget) * 100)}`}>{r.avgVisits.toFixed(2)}</Td>
              </tr>
              {open[title + r.rep] && (
                <tr key={r.rep + "detail"}><td colSpan={7} className="bg-secondary/20 px-5 py-3">
                  <table className="w-full text-xs">
                    <HeadRow cols={["Facility", "Check-in dates (×count)", "Total CK", "Visit dates", "Total V"]} />
                    <tbody>
                      {r.rows.map((f: any) => (
                        <tr key={f.facility} className="border-b border-border/40 last:border-0">
                          <Td right={false}>{f.facility}</Td>
                          <Td right={false} cls="text-muted-foreground">{f.checkinSlots.map((s: any) => `${fmtD(s.date)}×${s.count}`).join("  ·  ") || "—"}{f.checkinOverflow > 0 ? `  (+${f.checkinOverflow} more days)` : ""}</Td>
                          <Td cls="font-semibold">{f.totalCheckins}</Td>
                          <Td right={false} cls="text-muted-foreground">{f.visitSlots.map((s: any) => `${fmtD(s.date)}×${s.count}`).join("  ·  ") || "—"}</Td>
                          <Td cls="font-semibold">{f.totalVisits}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td></tr>
              )}
            </>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <Td right={false}>TOTAL</Td><Td>{d.total.bookSize}</Td><Td>—</Td>
            <Td>{d.total.totalCheckins}</Td><Td>{d.total.avgCheckins.toFixed(2)}</Td>
            <Td>{d.total.totalVisits}</Td><Td>{d.total.avgVisits.toFixed(2)}</Td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
  return (
    <div className="space-y-5">
      <Section title="Business Development Reps" d={data.bdr} ckTarget={data.bdr.targets.checkins} vTarget={data.bdr.targets.visits} />
      <Section title="Field Reps" d={data.fr} ckTarget={data.fr.targets.checkins} vTarget={data.fr.targets.visits} />
    </div>
  );
}

// ─── Tab 2: Sign-Ups ─────────────────────────────────────────────────────────
function SignupsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.teamReports.signups.useQuery({ from, to });
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return null;
  const months: string[] = data.months;
  return (
    <div className="space-y-5">
      <Card title="Sign-Ups per Facility by Case Value" sub="High / Medium / Low / Rank X per month — signed cases credited to the sourcing facility (by sign-up date)">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
              <Th right={false}>Role</Th><Th right={false}>Rep</Th><Th right={false}>Facility</Th>
              {months.map((m) => <Th key={m}>{format(new Date(`${m}-15T12:00:00`), "MMM")} H/M/L/X</Th>)}
              <Th>Total</Th>
            </tr>
          </thead>
          <tbody>
            {data.perFacility.map((f: any, i: number) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                <Td right={false} cls="text-muted-foreground">{f.role}</Td>
                <Td right={false} cls="font-medium text-foreground">{f.member}</Td>
                <Td right={false}>{f.facility}</Td>
                {months.map((m) => {
                  const c = f.months[m];
                  return <Td key={m} cls="text-muted-foreground">{c ? `${c.high}/${c.medium}/${c.low}/${c.rankX}` : "—"}</Td>;
                })}
                <Td cls="font-semibold">{f.total.total}</Td>
              </tr>
            ))}
            {data.perFacility.length === 0 && <tr><td colSpan={4 + months.length} className="px-4 py-8 text-center text-sm text-muted-foreground">No signed cases in this range.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card title="Sign-Ups vs Unique Facilities" sub="Each rep's total signed cases and which facilities sourced them">
        <table className="w-full text-sm">
          <HeadRow cols={["Role", "Rep", "Total Sign-Ups", "Unique Facilities", "Breakdown"]} />
          <tbody>
            {data.perMember.map((m: any, i: number) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                <Td right={false} cls="text-muted-foreground">{m.role}</Td>
                <Td right={false} cls="font-medium text-foreground">{m.member}</Td>
                <Td cls="font-semibold">{m.total}</Td>
                <Td>{m.uniqueFacilities}</Td>
                <Td right={false} cls="text-xs text-muted-foreground max-w-[420px] whitespace-normal">{m.facilities.map((f: any) => `${f.facility} (${f.count})`).join(" · ")}</Td>
              </tr>
            ))}
            {data.perMember.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No signed cases in this range.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Tab 3: New Facilities ───────────────────────────────────────────────────
function FacilitiesTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.teamReports.newFacilities.useQuery({ from, to });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return null;
  return (
    <Card title="New Facilities" sub={`Facilities at period start + added − dropped = active. "Dropped" is approximate (status flips to do-not-use/dormant in the window).`}>
      <table className="w-full text-sm">
        <HeadRow cols={["Rep", "At Period Start", "New Added", "Dropped ≈", "Total Active"]} />
        <tbody>
          {data.reps.map((r: any) => (
            <>
              <tr key={r.rep} className="border-b border-border/60 hover:bg-secondary/30 cursor-pointer" onClick={() => setOpen((p) => ({ ...p, [r.rep]: !p[r.rep] }))}>
                <Td right={false} cls="font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">{open[r.rep] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{r.rep}</span>
                </Td>
                <Td>{r.startCount}</Td>
                <Td cls="font-semibold text-emerald-600 dark:text-emerald-400">{r.addedCount}</Td>
                <Td cls={r.droppedApprox ? "text-destructive" : ""}>{r.droppedApprox}</Td>
                <Td cls="font-semibold">{r.active}</Td>
              </tr>
              {open[r.rep] && r.added.length > 0 && (
                <tr key={r.rep + "d"}><td colSpan={5} className="bg-secondary/20 px-6 py-3">
                  <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                    {r.added.map((a: any, i: number) => (
                      <div key={i} className="text-xs flex justify-between gap-4"><span className="text-foreground">{i + 1}. {a.name}</span><span className="text-muted-foreground shrink-0">{fmtD(a.date)}</span></div>
                    ))}
                  </div>
                </td></tr>
              )}
            </>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <Td right={false}>TOTAL</Td><Td>{data.total.startCount}</Td><Td>{data.total.addedCount}</Td><Td>{data.total.droppedApprox}</Td><Td>{data.total.active}</Td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ─── Tab 4: Call Activity ────────────────────────────────────────────────────
function CallsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.teamReports.callActivity.useQuery({ from, to });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return null;
  return (
    <Card title="Call Activity" sub={`Calls ≥ 30s count toward handle time (the tracker's rule) · daily target ${fmtH(data.targetDailySec)} handle time`}>
      <table className="w-full text-sm">
        <HeadRow cols={["Agent", "Calls", "Outbound", "Inbound", "<30s / missed", "Active Days", "Avg Calls/Day", "Total Handle", "Avg Daily Handle", "vs 2.5h Target"]} />
        <tbody>
          {data.perAgent.map((a: any) => (
            <>
              <tr key={a.rep} className="border-b border-border/60 hover:bg-secondary/30 cursor-pointer" onClick={() => setOpen((p) => ({ ...p, [a.rep]: !p[a.rep] }))}>
                <Td right={false} cls="font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">{open[a.rep] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}{a.rep}</span>
                </Td>
                <Td cls="font-semibold">{a.totalCalls}</Td>
                <Td>{a.outbound}</Td><Td>{a.inbound}</Td>
                <Td cls="text-muted-foreground">{a.notConnected}</Td>
                <Td>{a.activeDays}</Td>
                <Td>{a.avgCallsPerDay.toFixed(1)}</Td>
                <Td cls="font-semibold">{fmtH(a.totalSec)}</Td>
                <Td cls={`font-semibold ${pctCls((a.avgDailySec / data.targetDailySec) * 100)}`}>{fmtH(a.avgDailySec)}</Td>
                <Td cls={a.balanceToTargetSec > 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>{a.balanceToTargetSec > 0 ? `−${fmtH(a.balanceToTargetSec)}` : `+${fmtH(-a.balanceToTargetSec)}`}</Td>
              </tr>
              {open[a.rep] && (
                <tr key={a.rep + "d"}><td colSpan={10} className="bg-secondary/20 px-6 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {a.days.map((d: any) => (
                      <div key={d.day} className="rounded-lg border border-border bg-card px-2 py-1 text-[11px]">
                        <span className="font-medium text-foreground">{fmtD(d.day)}</span>
                        <span className="text-muted-foreground"> · {d.calls} calls · {fmtH(d.sec)}</span>
                      </div>
                    ))}
                  </div>
                </td></tr>
              )}
            </>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <Td right={false}>TEAM</Td><Td>{data.team.totalCalls}</Td><Td>{data.team.outbound}</Td><Td>{data.team.inbound}</Td>
            <Td>—</Td><Td>—</Td><Td>—</Td><Td>{fmtH(data.team.totalSec)}</Td><Td>{fmtH(data.team.avgDailySec)}</Td><Td>—</Td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// ─── Tab 5: Leads & Targets ──────────────────────────────────────────────────
function LeadsTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.teamReports.leadsTargets.useQuery({ from, to });
  if (isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!data) return null;
  const Section = ({ role }: { role: "FR" | "BDR" }) => {
    const list = data.members.filter((m: any) => m.role === role);
    const t = data.totals[role];
    return (
      <Card title={`${role} — Leads & Targets`} sub={`Monthly signed target: ${role === "FR" ? 10 : 2} per rep · signed counted by sign-up date`}>
        <table className="w-full text-sm">
          <HeadRow cols={["Rep", "Leads", "Open", "Rejected", "Referred Out", "Not Interested", "Signed Ref. Out", "Signed In-House", "Total Signed", "Unique (Driver)", "Target", "Achieved", "Conversion"]} />
          <tbody>
            {list.map((m: any) => (
              <tr key={m.member} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                <Td right={false} cls="font-medium text-foreground">{m.member}</Td>
                <Td>{m.total}</Td><Td>{m.open}</Td><Td>{m.rejected}</Td><Td>{m.referredOut}</Td><Td>{m.notInterested}</Td>
                <Td>{m.signedReferredOut}</Td><Td>{m.signedInHouse}</Td>
                <Td cls="font-semibold">{m.totalSigned}</Td>
                <Td>{m.signUpUnique}</Td>
                <Td cls="text-muted-foreground">{m.target}</Td>
                <Td cls={`font-semibold ${pctCls(m.achievedPct)}`}>{m.achievedPct}%</Td>
                <Td>{m.conversionPct}%</Td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={13} className="px-4 py-6 text-center text-sm text-muted-foreground">No {role} leads in this range.</td></tr>}
            {list.length > 0 && (
              <tr className="bg-secondary/40 font-semibold">
                <Td right={false}>TOTAL</Td>
                <Td>{t.total}</Td><Td>{t.open}</Td><Td>{t.rejected}</Td><Td>{t.referredOut}</Td><Td>{t.notInterested}</Td>
                <Td>{t.signedReferredOut}</Td><Td>{t.signedInHouse}</Td><Td>{t.totalSigned}</Td><Td>{t.signUpUnique}</Td>
                <Td>{t.target}</Td><Td cls={pctCls(t.achievedPct)}>{t.achievedPct}%</Td><Td>{t.conversionPct}%</Td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    );
  };
  return <div className="space-y-5"><Section role="FR" /><Section role="BDR" /></div>;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function TeamReports() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("checkins");
  const r0 = useMemo(() => presetRange("this_month"), []);
  const [preset, setPreset] = useState("this_month");
  const [from, setFrom] = useState(r0.from);
  const [to, setTo] = useState(r0.to);
  const applyPreset = (p: string) => { setPreset(p); const r = presetRange(p); setFrom(r.from); setTo(r.to); };

  return (
    <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><FileBarChart2 className="w-[18px] h-[18px] text-primary-foreground" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Team Reports</h1>
            <p className="text-sm text-muted-foreground">The BDR & FR report workbooks — live, from CRM data. All dates in California time.</p>
          </div>
        </div>

        {/* Range */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {([["this_month", "This Month (MTD)"], ["last_month", "Last Month"], ["last_30", "Last 30 Days"], ["ytd", "Year to Date"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => applyPreset(id)}
                className={`text-xs font-medium rounded-lg px-3 py-2 border transition-colors ${preset === id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div><label className="text-[11px] text-muted-foreground block mb-1">From</label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" /></div>
            <div><label className="text-[11px] text-muted-foreground block mb-1">To</label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" /></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`text-sm px-3.5 py-2 border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${tab === t.id ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>

        {tab === "checkins" && <CheckinsTab from={from} to={to} />}
        {tab === "signups" && <SignupsTab from={from} to={to} />}
        {tab === "facilities" && <FacilitiesTab from={from} to={to} />}
        {tab === "calls" && <CallsTab from={from} to={to} />}
        {tab === "leads" && <LeadsTab from={from} to={to} />}
      </div>
    </div>
  );
}
