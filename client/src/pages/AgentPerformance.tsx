import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Phone, PhoneCall, Clock, Building2, ThumbsUp, ThumbsDown, Loader2, AlertTriangle, Lightbulb, Award, CalendarDays } from "lucide-react";
import { format } from "date-fns";

function presetRange(p: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  const som = (yy: number, mm: number) => new Date(yy, mm, 1);
  const eom = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
  if (p === "last_month") return { from: iso(som(y, m - 1)), to: iso(eom(y, m - 1)) };
  if (p === "last_7") { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: iso(f), to: iso(now) }; }
  if (p === "last_30") { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: iso(f), to: iso(now) }; }
  return { from: iso(som(y, m)), to: iso(eom(y, m)) };
}
const PRESETS = [["this_month", "This Month"], ["last_month", "Last Month"], ["last_7", "Last 7 Days"], ["last_30", "Last 30 Days"]];
const fmtDur = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

const RATING: Record<string, { label: string; cls: string }> = {
  strong: { label: "Strong", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  solid: { label: "Solid", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" },
  needs_improvement: { label: "Needs Improvement", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
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

export default function AgentPerformance() {
  const { user } = useAuth();
  const isManager = seesAllData(user?.role);
  const [preset, setPreset] = useState("this_month");
  const r0 = presetRange("this_month");
  const [from, setFrom] = useState(r0.from);
  const [to, setTo] = useState(r0.to);
  const [agent, setAgent] = useState("__all__");

  const { data: agents = [] } = trpc.reports.agents.useQuery();
  const { data, isFetching } = trpc.reports.agentPerformance.useQuery(
    { agentName: isManager ? agent : undefined, from: `${from}T00:00:00`, to: `${to}T23:59:59` },
  );
  const review = trpc.reports.agentPerformanceReview.useMutation();

  const applyPreset = (p: string) => { setPreset(p); const r = presetRange(p); setFrom(r.from); setTo(r.to); review.reset(); };
  const k = data?.kpis;
  const recaps = k?.recaps ?? 0;
  const pct = (n: number) => (recaps ? Math.round((n / recaps) * 100) : 0);
  const rev = review.data;
  const rating = rev ? (RATING[rev.performanceRating] ?? RATING.solid) : null;

  return (
    <div className="min-h-full bg-background p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><Sparkles className="w-[18px] h-[18px] text-primary-foreground" /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Agent Performance</h1>
            <p className="text-sm text-muted-foreground">Activity, partner sentiment, and an AI review of each day — challenges and recommendations.</p>
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
            <div><label className="text-[11px] text-muted-foreground block mb-1">From</label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); review.reset(); }} className="bg-card border-border h-9 w-[150px]" /></div>
            <div><label className="text-[11px] text-muted-foreground block mb-1">To</label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); review.reset(); }} className="bg-card border-border h-9 w-[150px]" /></div>
          </div>
          {isManager && (
            <div><label className="text-[11px] text-muted-foreground block mb-1">Agent</label>
              <Select value={agent} onValueChange={(v) => { setAgent(v); review.reset(); }}>
                <SelectTrigger className="bg-card border-border h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all__">Whole Team</SelectItem>{agents.map((a: any) => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat icon={PhoneCall} label="Calls" value={k?.calls ?? 0} />
          <Stat icon={Phone} label="Connected" value={k?.connected ?? 0} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" cls="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={Clock} label="Talk Time" value={fmtDur(k?.talkSec ?? 0)} chip="bg-sky-500/10 text-sky-600 dark:text-sky-400" cls="text-sky-600 dark:text-sky-400" />
          <Stat icon={Building2} label="Facilities" value={k?.facilities ?? 0} chip="bg-violet-500/10 text-violet-600 dark:text-violet-400" cls="text-violet-600 dark:text-violet-400" />
          <Stat icon={ThumbsUp} label="Interested" value={`${k?.interest.interested ?? 0} · ${pct(k?.interest.interested ?? 0)}%`} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" cls="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={ThumbsDown} label="Not Interested" value={`${k?.interest.notInterested ?? 0} · ${pct(k?.interest.notInterested ?? 0)}%`} chip="bg-destructive/10 text-destructive" cls="text-destructive" />
        </div>

        {/* AI Review */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> AI Performance Review</span>
            <Button
              size="sm" className="gap-2"
              disabled={review.isPending || isFetching || !(k?.calls || k?.recaps)}
              onClick={() => review.mutate({ agentName: isManager ? agent : undefined, from: `${from}T00:00:00`, to: `${to}T23:59:59` })}
            >
              {review.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {review.isPending ? "Analyzing…" : rev ? "Regenerate" : "Generate review"}
            </Button>
          </div>

          <div className="p-5">
            {!rev && !review.isPending && (
              <p className="text-sm text-muted-foreground">
                Click <strong className="text-foreground">Generate review</strong> — the AI reads {agent === "__all__" && isManager ? "the team's" : "this agent's"} call recaps for the period and writes a day-by-day summary, the challenges they ran into, what they did well, and concrete recommendations.
              </p>
            )}
            {review.isPending && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Reading the recaps and writing the review…</div>
            )}
            {rev && (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  {rating && <span className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${rating.cls}`}>{rating.label}</span>}
                  <p className="text-sm text-foreground leading-relaxed">{rev.overallSummary}</p>
                </div>

                {rev.strengths.length > 0 && (
                  <Section icon={Award} title="Strengths" tone="emerald" items={rev.strengths} />
                )}
                {rev.challenges.length > 0 && (
                  <Section icon={AlertTriangle} title="Challenges" tone="amber" items={rev.challenges} />
                )}
                {rev.recommendations.length > 0 && (
                  <Section icon={Lightbulb} title="Recommendations" tone="sky" items={rev.recommendations} />
                )}

                {rev.daily.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-primary" /> Day by day</p>
                    <div className="space-y-1.5">
                      {rev.daily.map((d, i) => (
                        <div key={i} className="flex gap-3 text-sm">
                          <span className="shrink-0 w-24 text-xs text-muted-foreground pt-0.5 tabular-nums">{d.date}</span>
                          <span className="text-foreground/90 leading-relaxed">{d.summary}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground pt-1">Generated from {rev.basedOnRecaps} analyzed call recap{rev.basedOnRecaps === 1 ? "" : "s"}. AI-written — sanity-check before sharing.</p>
              </div>
            )}
          </div>
        </div>

        {/* Daily activity */}
        {(data?.days?.length ?? 0) > 0 && (
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground">Daily activity</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                  <th className="px-5 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Calls</th><th className="px-3 py-2 font-semibold">Connected</th><th className="px-3 py-2 font-semibold">Recaps</th>
                </tr></thead>
                <tbody>
                  {data!.days.map((d) => (
                    <tr key={d.date} className="border-b border-border/50">
                      <td className="px-5 py-2 text-muted-foreground tabular-nums">{d.date}</td>
                      <td className="px-3 py-2">{d.calls}</td>
                      <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{d.connected}</td>
                      <td className="px-3 py-2 text-muted-foreground">{d.recaps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, tone, items }: { icon: any; title: string; tone: "emerald" | "amber" | "sky"; items: string[] }) {
  const dot = tone === "emerald" ? "text-emerald-500" : tone === "amber" ? "text-amber-500" : "text-sky-500";
  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5"><Icon className={`w-3.5 h-3.5 ${dot}`} /> {title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
            <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-sky-500"}`} />
            <span className="leading-relaxed">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
