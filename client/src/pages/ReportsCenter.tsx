import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { useBrand } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { exportReportToExcel } from "@/lib/reportExport";

const NAVY = "#16264a";

function presetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const som = (yy: number, mm: number) => new Date(yy, mm, 1);
  const eom = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
  switch (preset) {
    case "this_month": return { from: iso(som(y, m)), to: iso(eom(y, m)) };
    case "last_month": return { from: iso(som(y, m - 1)), to: iso(eom(y, m - 1)) };
    case "last_30": { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
    case "this_quarter": { const q = Math.floor(m / 3) * 3; return { from: iso(som(y, q)), to: iso(eom(y, q + 2)) }; }
    case "this_year": return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default: return null;
  }
}

const PRESETS = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_30", label: "Last 30 Days" },
  { id: "this_quarter", label: "This Quarter" },
  { id: "this_year", label: "This Year" },
  { id: "custom", label: "Custom" },
];

function Kpi({ label, value, accent = NAVY, sub }: { label: string; value: string | number; accent?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
      <div className="text-[22px] font-bold leading-none" style={{ color: accent, fontFamily: "'Playfair Display', serif" }}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1.5 font-medium">{label}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function DocTable({ title, rows, columns }: { title: string; rows: any[]; columns: { key: string; label: string; money?: boolean }[] }) {
  if (!rows?.length) return null;
  const shown = rows.slice(0, 40);
  return (
    <div className="mt-6" style={{ breakInside: "avoid" }}>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">{title} <span className="font-normal text-slate-400">({rows.length})</span></h3>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-300 text-left text-[10px] uppercase tracking-wide text-slate-500">
            {columns.map((c) => <th key={c.key} className="py-1.5 pr-3 font-semibold">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {columns.map((c) => {
                let v: any = r[c.key];
                if (c.key === "date" && v) v = new Date(v).toLocaleDateString();
                else if (c.money) v = `$${Number(v ?? 0).toFixed(2)}`;
                else if (v === "" || v == null) v = "—";
                return <td key={c.key} className="py-1.5 pr-3 text-slate-700 align-top max-w-[220px] truncate">{String(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 40 && <p className="text-[10px] text-slate-400 mt-1">Showing 40 of {rows.length} — full rows in the Excel export.</p>}
    </div>
  );
}

export default function ReportsCenter() {
  const { user } = useAuth();
  const isManager = seesAllData(user?.role);
  const { logo } = useBrand();

  const [preset, setPreset] = useState("this_month");
  const initial = presetRange("this_month")!;
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [agent, setAgent] = useState("__all__");

  const { data: agents = [] } = trpc.reports.agents.useQuery();
  const { data: report, isFetching } = trpc.reports.agentReport.useQuery(
    { agentName: isManager ? agent : undefined, from: `${from}T00:00:00`, to: `${to}T23:59:59` },
    { enabled: !!from && !!to },
  );

  const applyPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) { setFrom(r.from); setTo(r.to); }
  };

  const agentLabel = isManager ? (agent === "__all__" ? "All Agents" : agent) : (user?.agentName || user?.name || "Me");
  const rangeLabel = `${format(new Date(from + "T00:00:00"), "MMM d, yyyy")} – ${format(new Date(to + "T00:00:00"), "MMM d, yyyy")}`;
  const k = report?.kpis;

  return (
    <div className="min-h-full bg-background p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ── Controls (not printed) ── */}
        <div className="no-print">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0">
              <BarChart3 className="w-[18px] h-[18px] text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Reports Center</h1>
              <p className="text-sm text-muted-foreground">Pick a period, review your activity, export a document.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`text-xs font-medium rounded-lg px-3 py-2 border transition-colors ${preset === p.id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">From</label>
                <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">To</label>
                <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" />
              </div>
            </div>
            {isManager && (
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Agent</label>
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger className="bg-card border-border h-9 w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Agents</SelectItem>
                    {agents.map((a: any) => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" className="gap-2 border-border" disabled={!report} onClick={() => report && exportReportToExcel(report, agentLabel, rangeLabel)}>
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </Button>
              <Button className="gap-2" disabled={!report} onClick={() => window.print()}>
                <Download className="w-4 h-4" /> PDF
              </Button>
            </div>
          </div>
        </div>

        {/* ── The report document (this is what prints) ── */}
        <div className="report-doc bg-white text-slate-800 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Branded header */}
          <div className="px-7 py-5 border-b-2" style={{ borderColor: NAVY }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <img src={logo} alt="Farahi Law" className="h-12 w-auto max-w-[150px] object-contain" />
                <div className="min-w-0">
                  <div className="text-xl font-bold" style={{ color: NAVY, fontFamily: "'Playfair Display', serif" }}>Activity Report</div>
                  <div className="text-sm text-slate-500">{agentLabel} · {rangeLabel}</div>
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-400 shrink-0">
                Generated {format(new Date(), "MMM d, yyyy h:mm a")}
                {isFetching && <span className="ml-2 inline-flex items-center gap-1 no-print"><Loader2 className="w-3 h-3 animate-spin" /></span>}
              </div>
            </div>
          </div>

          <div className="p-7 space-y-6">
            {/* KPI groups */}
            <Section title="Outreach">
              <Kpi label="Calls" value={k?.callsTotal ?? 0} sub={`${k?.callsConnected ?? 0} connected · ${k?.callsVoicemail ?? 0} vm`} />
              <Kpi label="Partner Check-ins" value={k?.partnerCheckins ?? 0} accent="#0ea5e9" />
              <Kpi label="Leads Sent" value={k?.leadsSent ?? 0} accent="#6366f1" />
              <Kpi label="Leads Received" value={k?.leadsReceived ?? 0} accent="#0ea5e9" />
              <Kpi label="Signed Cases" value={k?.signedCases ?? 0} accent="#16a34a" />
            </Section>

            <Section title="Field & Relationship">
              <Kpi label="Field Visits" value={k?.visits ?? 0} />
              <Kpi label="Facilities Visited" value={k?.facilitiesVisited ?? 0} accent="#0ea5e9" />
              <Kpi label="Hours Worked" value={(k?.hours ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} accent="#6366f1" />
              <Kpi label="Errands Done" value={k?.errandsCompleted ?? 0} sub={`of ${k?.errandsTotal ?? 0}`} accent="#16a34a" />
            </Section>

            <Section title="Rewards & Cost">
              <Kpi label="Rewards Accepted" value={k?.rewardsAccepted ?? 0} sub={`of ${k?.rewardsTotal ?? 0}`} accent="#16a34a" />
              <Kpi label="Payouts" value={`$${(k?.payoutTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} accent="#16a34a" />
              <Kpi label="Expenses" value={`$${(k?.expenseTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} accent="#dc2626" />
            </Section>

            {/* Trend chart */}
            <div style={{ breakInside: "avoid" }}>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Daily Activity</h3>
              {report && report.series.length > 0 ? (
                <div className="h-56 w-full rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.series.map((s) => ({ ...s, date: format(new Date(s.date + "T00:00:00"), "MMM d") }))}>
                      <defs>
                        <linearGradient id="gCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={NAVY} stopOpacity={0.4} /><stop offset="100%" stopColor={NAVY} stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} width={28} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                      <Area type="monotone" dataKey="calls" stroke={NAVY} strokeWidth={2} fill="url(#gCalls)" name="Calls" />
                      <Area type="monotone" dataKey="visits" stroke="#0ea5e9" strokeWidth={2} fill="transparent" name="Visits" />
                      <Area type="monotone" dataKey="leads" stroke="#16a34a" strokeWidth={2} fill="transparent" name="Leads" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-400">No activity recorded in this period.</div>
              )}
            </div>

            {/* Detail tables */}
            {report && (
              <>
                <DocTable title="Calls" rows={report.detail.calls} columns={[{ key: "date", label: "Date" }, { key: "result", label: "Result" }, { key: "type", label: "Type" }, { key: "duration", label: "Dur." }, { key: "summary", label: "Notes" }]} />
                <DocTable title="Leads" rows={report.detail.leads} columns={[{ key: "date", label: "Date" }, { key: "direction", label: "Direction" }, { key: "outcome", label: "Outcome" }, { key: "signed", label: "Signed" }, { key: "area", label: "Area" }]} />
                <DocTable title="Field Visits" rows={report.detail.visits} columns={[{ key: "date", label: "Date" }, { key: "agent", label: "Agent" }, { key: "facilities", label: "Facilities" }, { key: "hours", label: "Hours" }, { key: "notes", label: "Notes" }]} />
                <DocTable title="Referral Rewards" rows={report.detail.rewards} columns={[{ key: "date", label: "Date" }, { key: "client", label: "Client" }, { key: "tier", label: "Tier" }, { key: "type", label: "Type" }, { key: "payout", label: "Payout", money: true }, { key: "status", label: "Status" }]} />
                <DocTable title="Errands" rows={report.detail.errands} columns={[{ key: "date", label: "Date" }, { key: "client", label: "Client" }, { key: "task", label: "Task" }, { key: "status", label: "Status" }]} />
                <DocTable title="Expenses" rows={report.detail.expenses} columns={[{ key: "date", label: "Date" }, { key: "kind", label: "Type" }, { key: "store", label: "Store" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Amount", money: true }]} />
              </>
            )}

            <div className="pt-4 mt-4 border-t border-slate-200 text-[10px] text-slate-400 text-center">
              Farahi Law · Business Development · Confidential
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ breakInside: "avoid" }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>
    </div>
  );
}
