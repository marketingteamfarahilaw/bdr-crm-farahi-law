import { useState, useMemo, Fragment } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, Clock, Search, Download, ExternalLink, Play } from "lucide-react";
import { format } from "date-fns";

function presetRange(p: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const som = (yy: number, mm: number) => new Date(yy, mm, 1);
  const eom = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
  if (p === "last_month") return { from: iso(som(y, m - 1)), to: iso(eom(y, m - 1)) };
  if (p === "last_7") { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: iso(f), to: iso(now) }; }
  if (p === "last_30") { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
  if (p === "this_year") return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
  return { from: iso(som(y, m)), to: iso(eom(y, m)) };
}
const PRESETS = [["this_month", "This Month"], ["last_month", "Last Month"], ["last_7", "Last 7 Days"], ["last_30", "Last 30 Days"], ["this_year", "This Year"]];

const fmtDur = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`; };

const RESULT_STYLE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  voicemail: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  no_answer: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  busy: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  other: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
};
const RESULT_LABEL: Record<string, string> = { connected: "Connected", voicemail: "Voicemail", no_answer: "No Answer", busy: "Busy", other: "Other" };

function Stat({ icon: Icon, label, value, cls = "text-primary", chip = "bg-primary/10 text-primary" }: any) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${chip}`}><Icon className="w-[18px] h-[18px]" /></div>
      <div className={`text-2xl font-bold mt-3 leading-none ${cls}`} style={{ fontFamily: "'Playfair Display', serif" }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5 font-medium">{label}</div>
    </div>
  );
}

export default function CallLogs() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isManager = seesAllData(user?.role);
  const [preset, setPreset] = useState("this_month");
  const r0 = presetRange("this_month");
  const [from, setFrom] = useState(r0.from);
  const [to, setTo] = useState(r0.to);
  const [agent, setAgent] = useState("__all__");
  const [q, setQ] = useState("");
  const [result, setResult] = useState("__all__");
  const [playing, setPlaying] = useState<number | null>(null);

  const { data: agents = [] } = trpc.reports.agents.useQuery();
  const { data: rows = [], isLoading } = trpc.reports.callLogs.useQuery(
    { agentName: isManager ? agent : undefined, from: `${from}T00:00:00`, to: `${to}T23:59:59` },
  );

  const applyPreset = (p: string) => { setPreset(p); const r = presetRange(p); setFrom(r.from); setTo(r.to); };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rows as any[]).filter((r) => {
      if (result !== "__all__" && (r.result || "other") !== result) return false;
      if (!ql) return true;
      return [r.facilityName, r.rep, r.summary, r.direction].some((x) => String(x ?? "").toLowerCase().includes(ql));
    });
  }, [rows, q, result]);

  const kpis = useMemo(() => ({
    calls: filtered.length,
    connected: filtered.filter((r) => r.result === "connected").length,
    talk: filtered.reduce((s, r) => s + (r.durationSec || 0), 0),
  }), [filtered]);

  const exportCsv = () => {
    const head = ["Date", "Time", "Facility", "Agent", "Direction", "Result", "Duration", "Source"];
    const lines = filtered.map((r) => {
      const d = r.date ? new Date(r.date) : null;
      const cell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      return [
        d ? format(d, "yyyy-MM-dd") : "", d ? format(d, "HH:mm") : "",
        r.facilityName ?? "", r.rep ?? "", r.direction ?? "",
        RESULT_LABEL[r.result] ?? r.result ?? "", r.duration ?? "",
        r.fromRingCentral ? "RingCentral" : "Manual",
      ].map(cell).join(",");
    });
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `call-logs_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-full bg-background p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><PhoneCall className="w-[18px] h-[18px] text-primary-foreground" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Call Logs</h1>
            <p className="text-sm text-muted-foreground">Every call — facility, time, duration, result, and agent.</p>
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
                <SelectTrigger className="bg-card border-border h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">All Agents</SelectItem>{agents.map((a: any) => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><label className="text-[11px] text-muted-foreground block mb-1">Result</label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger className="bg-card border-border h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Results</SelectItem>
                <SelectItem value="connected">Connected</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
                <SelectItem value="no_answer">No Answer</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]"><label className="text-[11px] text-muted-foreground block mb-1">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Facility, agent…" className="bg-card border-border h-9 pl-8" />
            </div>
          </div>
          <Button variant="outline" className="h-9 gap-2" onClick={exportCsv} disabled={!filtered.length}><Download className="w-4 h-4" /> Export</Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={PhoneCall} label="Calls" value={kpis.calls} />
          <Stat icon={Phone} label="Connected" value={kpis.connected} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" cls="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={Clock} label="Talk Time" value={fmtDur(kpis.talk)} chip="bg-sky-500/10 text-sky-600 dark:text-sky-400" cls="text-sky-600 dark:text-sky-400" />
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground flex items-center justify-between">
            <span>{filtered.length} call{filtered.length === 1 ? "" : "s"}</span>
            <span className="text-xs font-normal text-muted-foreground">Click a row to open the facility</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Facility</th>
                  <th className="px-3 py-2 font-semibold">Agent</th>
                  <th className="px-3 py-2 font-semibold">Dir</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                  <th className="px-3 py-2 font-semibold text-right">Duration</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const d = c.date ? new Date(c.date) : null;
                  const playable = c.fromRingCentral && c.result === "connected";
                  return (
                    <Fragment key={c.id}>
                      <tr className="border-b border-border/50 hover:bg-accent/30 cursor-pointer" onClick={() => c.facilityId && navigate(`/crm/facilities/${c.facilityId}`)}>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{d ? format(d, "MMM d, h:mm a") : "—"}</td>
                        <td className="px-3 py-2 font-medium text-foreground max-w-[240px] truncate">{c.facilityName ?? <span className="text-muted-foreground italic">Unmatched</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{c.rep ?? "—"}</td>
                        <td className="px-3 py-2">
                          {c.direction === "Inbound" ? <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"><PhoneIncoming className="w-3.5 h-3.5" />In</span>
                            : c.direction === "Outbound" ? <span className="inline-flex items-center gap-1 text-foreground"><PhoneOutgoing className="w-3.5 h-3.5" />Out</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${RESULT_STYLE[c.result] ?? RESULT_STYLE.other}`}>{RESULT_LABEL[c.result] ?? c.result ?? "—"}</span></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{c.duration ?? "—"}</td>
                        <td className="px-2 py-2 text-right">
                          {playable ? (
                            <button onClick={(e) => { e.stopPropagation(); setPlaying(playing === c.id ? null : c.id); }} className="text-primary hover:text-primary/80" title="Play recording">
                              <Play className="w-4 h-4 inline" />
                            </button>
                          ) : (c.facilityId && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground inline" />)}
                        </td>
                      </tr>
                      {playing === c.id && (
                        <tr className="bg-accent/20 border-b border-border/50">
                          <td colSpan={7} className="px-4 py-2">
                            <audio
                              controls autoPlay className="w-full max-w-md h-9"
                              src={`/api/recording/${c.id}`}
                              onError={() => { toast.error("No recording available for this call."); setPlaying(null); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!isLoading && filtered.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">No calls in this period.</td></tr>}
                {isLoading && <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Showing up to 2,000 most-recent calls in the selected range. Use the filters to narrow down.</p>
      </div>
    </div>
  );
}
