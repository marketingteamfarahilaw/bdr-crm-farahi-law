import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, ThumbsUp, ThumbsDown, Minus, Clock, PhoneCall, Voicemail, PhoneMissed, Handshake } from "lucide-react";
import { format } from "@/lib/datetime";

function presetRange(p: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const som = (yy: number, mm: number) => new Date(yy, mm, 1);
  const eom = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
  if (p === "last_month") return { from: iso(som(y, m - 1)), to: iso(eom(y, m - 1)) };
  if (p === "last_30") { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
  if (p === "this_quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(som(y, q)), to: iso(eom(y, q + 2)) }; }
  if (p === "this_year") return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
  return { from: iso(som(y, m)), to: iso(eom(y, m)) };
}
const PRESETS = [["this_month", "This Month"], ["last_month", "Last Month"], ["last_30", "Last 30 Days"], ["this_quarter", "This Quarter"], ["this_year", "This Year"]];

const fmtDur = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
};

function Stat({ icon: Icon, label, value, cls = "text-primary", chip = "bg-primary/10 text-primary" }: any) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${chip}`}><Icon className="w-[18px] h-[18px]" /></div>
      <div className={`text-2xl font-bold mt-3 leading-none ${cls}`} style={{ fontFamily: "'Playfair Display', serif" }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5 font-medium">{label}</div>
    </div>
  );
}

const COLLAB: Record<string, string> = {
  collaborative: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  neutral: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  cool: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
};

export default function CallAnalytics() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isManager = seesAllData(user?.role);
  const [preset, setPreset] = useState("this_month");
  const r0 = presetRange("this_month");
  const [from, setFrom] = useState(r0.from);
  const [to, setTo] = useState(r0.to);
  const [agent, setAgent] = useState("__all__");

  const { data: agents = [] } = trpc.reports.agents.useQuery();
  const { data } = trpc.reports.callAnalytics.useQuery(
    { agentName: isManager ? agent : undefined, from: `${from}T00:00:00`, to: `${to}T23:59:59` },
  );

  const applyPreset = (p: string) => { setPreset(p); const r = presetRange(p); setFrom(r.from); setTo(r.to); };
  const t = data?.totals;
  const analyzed = t?.analyzed ?? 0;
  const pct = (n: number) => (analyzed ? Math.round((n / analyzed) * 100) : 0);

  return (
    <div className="min-h-full bg-background p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><Phone className="w-[18px] h-[18px] text-primary-foreground" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Call Analytics</h1>
            <p className="text-sm text-muted-foreground">Call activity per agent + AI sentiment of your partners.</p>
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([id, label]) => (
              <button key={id} onClick={() => applyPreset(id)} className={`text-xs font-medium rounded-lg px-3 py-2 border transition-colors ${preset === id ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div><label className="text-[11px] text-muted-foreground block mb-1">From</label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" /></div>
            <div><label className="text-[11px] text-muted-foreground block mb-1">To</label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} className="bg-card border-border h-9 w-[150px]" /></div>
          </div>
          {isManager && (
            <div><label className="text-[11px] text-muted-foreground block mb-1">Agent</label>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger className="bg-card border-border h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All Agents</SelectItem>{agents.map((a: any) => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat icon={PhoneCall} label="Total Calls" value={t?.calls ?? 0} />
          <Stat icon={Phone} label="Connected" value={data?.byAgent.reduce((s, a) => s + a.connected, 0) ?? 0} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" cls="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={Clock} label="Talk Time" value={fmtDur(t?.durationSec ?? 0)} chip="bg-sky-500/10 text-sky-600 dark:text-sky-400" cls="text-sky-600 dark:text-sky-400" />
          <Stat icon={ThumbsUp} label="Interested" value={`${t?.interested ?? 0} · ${pct(t?.interested ?? 0)}%`} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" cls="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={ThumbsDown} label="Not Interested" value={`${t?.notInterested ?? 0} · ${pct(t?.notInterested ?? 0)}%`} chip="bg-destructive/10 text-destructive" cls="text-destructive" />
          <Stat icon={Minus} label="Neutral" value={`${t?.neutral ?? 0} · ${pct(t?.neutral ?? 0)}%`} chip="bg-slate-500/10 text-slate-600 dark:text-slate-400" cls="text-slate-600 dark:text-slate-400" />
        </div>

        {/* Sentiment bar */}
        {analyzed > 0 && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground">Partner Interest <span className="font-normal text-muted-foreground">· {analyzed} calls analyzed by AI</span></span>
            </div>
            <div className="h-3 w-full rounded-full overflow-hidden flex bg-secondary">
              <div className="bg-emerald-500" style={{ width: `${pct(t!.interested)}%` }} title={`Interested ${pct(t!.interested)}%`} />
              <div className="bg-slate-400" style={{ width: `${pct(t!.neutral)}%` }} title={`Neutral ${pct(t!.neutral)}%`} />
              <div className="bg-red-500" style={{ width: `${pct(t!.notInterested)}%` }} title={`Not interested ${pct(t!.notInterested)}%`} />
            </div>
          </div>
        )}

        {/* Per-agent call log */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground">Calls by Agent</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2 font-semibold">Agent</th><th className="px-3 py-2 font-semibold">Calls</th><th className="px-3 py-2 font-semibold">Connected</th><th className="px-3 py-2 font-semibold">Voicemail</th><th className="px-3 py-2 font-semibold">No Answer</th><th className="px-3 py-2 font-semibold">Talk Time</th>
              </tr></thead>
              <tbody>
                {(data?.byAgent ?? []).map((a) => (
                  <tr key={a.agent} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="px-5 py-2 font-medium text-foreground">{a.agent}</td>
                    <td className="px-3 py-2">{a.calls}</td>
                    <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{a.connected}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.voicemail}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.noAnswer}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDur(a.durationSec)}</td>
                  </tr>
                ))}
                {(data?.byAgent ?? []).length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No calls in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Partner sentiment */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground flex items-center gap-2"><Handshake className="w-4 h-4 text-primary" /> Partner Sentiment <span className="font-normal text-muted-foreground">· from AI-analyzed calls</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2 font-semibold">Partner</th><th className="px-3 py-2 font-semibold">Calls</th><th className="px-3 py-2 font-semibold">Interested</th><th className="px-3 py-2 font-semibold">Not Interested</th><th className="px-3 py-2 font-semibold">Read</th>
              </tr></thead>
              <tbody>
                {(data?.partners ?? []).map((p) => (
                  <tr key={p.facilityId} className="border-b border-border/50 hover:bg-accent/30 cursor-pointer" onClick={() => p.facilityId && navigate(`/crm/facilities/${p.facilityId}`)}>
                    <td className="px-5 py-2 font-medium text-foreground max-w-[260px] truncate">{p.facility}</td>
                    <td className="px-3 py-2">{p.calls}</td>
                    <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{p.interested}</td>
                    <td className="px-3 py-2 text-destructive">{p.notInterested}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${COLLAB[p.collaboration]}`}>{p.collaboration}</span></td>
                  </tr>
                ))}
                {(data?.partners ?? []).length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">No AI-analyzed calls yet. Recorded calls are transcribed + scored automatically.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
