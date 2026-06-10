/**
 * Intake Desk — the intake team's command center.
 * KPIs, tier pipeline, SOL alerts, and the freshest AI-qualified leads.
 */
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "@/lib/datetime";
import { toast } from "sonner";
import {
  Sparkles, PhoneCall, Flame, Gauge, Inbox, Scale, AlertTriangle,
  RefreshCw, ArrowUpRight, ClipboardList, Loader2,
} from "lucide-react";
import { STATUS_META, TIER_META, SOL_META, CASE_TYPES, leadName, Chip, ScoreRing, IntakeGuard } from "./shared";

function Stat({ icon: Icon, label, value, chip = "bg-primary/10 text-primary", cls = "text-foreground", onClick }: any) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`rounded-2xl border border-border bg-card p-4 shadow-sm text-left transition-all ${onClick ? "hover:border-primary/40 hover:shadow-md cursor-pointer" : "cursor-default"}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${chip}`}><Icon className="w-[18px] h-[18px]" /></div>
      <div className={`text-2xl font-bold mt-3 leading-none ${cls}`} style={{ fontFamily: "'Playfair Display', serif" }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5 font-medium">{label}</div>
    </button>
  );
}

export default function IntakeDesk() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: stats, isLoading } = trpc.intake.dashboard.stats.useQuery(undefined, { refetchInterval: 60_000 });

  const sync = trpc.intake.calls.syncNow.useMutation({
    onSuccess: (r) => {
      toast.success(`Synced — ${r.logged} new call${r.logged === 1 ? "" : "s"}, ${r.transcribed} transcribed, ${r.leadsCreated} new lead${r.leadsCreated === 1 ? "" : "s"}`);
      utils.intake.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const firstName = (user?.name ?? "there").split(" ")[0];
  const tiers = stats?.tierBreakdown;
  const tierTotal = tiers ? tiers.hot + tiers.qualified + tiers.review + tiers.unqualified : 0;

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Hero */}
          <header className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 lg:p-8 shadow-sm">
            <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.14), transparent 70%)" }} />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-primary/80 text-[11px] font-semibold tracking-[0.2em] uppercase mb-3">
                  <Sparkles className="w-3.5 h-3.5" /> Farahi Law · Intake — AI Case Desk
                </div>
                <h1 className="text-3xl lg:text-4xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Welcome back, <span className="text-primary">{firstName}</span>
                </h1>
                <p className="text-muted-foreground mt-2 text-sm">
                  {format(new Date(), "EEEE, MMMM d")} — every intake call is transcribed, analyzed, and scored automatically. You review, qualify, and sign.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => sync.mutate({})} disabled={sync.isPending}>
                  {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {sync.isPending ? "Syncing…" : "Sync my calls"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => navigate("/intake/leads")}>
                  <Inbox className="w-4 h-4" /> Lead Queue
                </Button>
              </div>
            </div>
          </header>

          {/* KPIs */}
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Inbox} label="New leads today" value={stats?.newToday ?? 0} onClick={() => navigate("/intake/leads")} />
              <Stat icon={PhoneCall} label="Calls today" value={stats?.callsToday ?? 0} chip="bg-sky-500/10 text-sky-600 dark:text-sky-400" onClick={() => navigate("/intake/calls")} />
              <Stat icon={Flame} label="Hot leads open" value={stats?.hotLeads ?? 0} chip="bg-red-500/10 text-red-600 dark:text-red-400" cls="text-red-600 dark:text-red-400" onClick={() => navigate("/intake/leads?tier=hot")} />
              <Stat icon={AlertTriangle} label="SOL urgent / expired" value={stats?.solUrgent ?? 0} chip="bg-amber-500/10 text-amber-600 dark:text-amber-400" cls={stats?.solUrgent ? "text-amber-600 dark:text-amber-400" : "text-foreground"} onClick={() => navigate("/intake/leads")} />
              <Stat icon={ClipboardList} label="Pending review" value={stats?.pendingReview ?? 0} chip="bg-violet-500/10 text-violet-600 dark:text-violet-400" onClick={() => navigate("/intake/leads?status=new")} />
              <Stat icon={Gauge} label="Qualified rate" value={`${stats?.qualifiedRate ?? 0}%`} chip="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
              <Stat icon={Scale} label="Signed" value={stats?.signed ?? 0} chip="bg-primary/10 text-primary" onClick={() => navigate("/intake/leads?status=signed")} />
              <Stat icon={PhoneCall} label="Calls this week" value={stats?.callsThisWeek ?? 0} chip="bg-sky-500/10 text-sky-600 dark:text-sky-400" onClick={() => navigate("/intake/calls")} />
            </div>
          )}

          <div className="grid lg:grid-cols-5 gap-4">
            {/* Recent leads */}
            <div className="lg:col-span-3 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Latest leads</span>
                <button onClick={() => navigate("/intake/leads")} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">All leads <ArrowUpRight className="w-3 h-3" /></button>
              </div>
              <div className="divide-y divide-border">
                {(stats?.recentLeads ?? []).length === 0 && (
                  <p className="px-5 py-8 text-sm text-muted-foreground text-center">No leads yet — they appear automatically as intake calls come in.</p>
                )}
                {(stats?.recentLeads ?? []).map((l: any) => (
                  <button key={l.id} onClick={() => navigate(`/intake/leads/${l.id}`)}
                    className="w-full px-5 py-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors text-left">
                    <ScoreRing score={l.qualificationScore} tier={l.qualificationTier} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{leadName(l)}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {l.caseType ? CASE_TYPES[l.caseType] ?? l.caseType : "Case type unknown"} · {l.createdAt ? formatDistanceToNow(new Date(l.createdAt), { addSuffix: true }) : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {l.qualificationTier && <Chip meta={TIER_META[l.qualificationTier]} />}
                      <Chip meta={STATUS_META[l.status]} />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tier pipeline + status mix */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
                <p className="text-sm font-semibold text-foreground mb-4">Qualification mix</p>
                {(["hot", "qualified", "review", "unqualified"] as const).map((t) => {
                  const n = tiers?.[t] ?? 0;
                  const pct = tierTotal ? Math.round((n / tierTotal) * 100) : 0;
                  return (
                    <div key={t} className="mb-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-foreground">{TIER_META[t].label}</span>
                        <span className="text-muted-foreground">{n} · {pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: TIER_META[t].bar }} />
                      </div>
                    </div>
                  );
                })}
                {tiers && tiers.unscored > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2">{tiers.unscored} lead{tiers.unscored === 1 ? "" : "s"} not scored yet (no transcript).</p>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
                <p className="text-sm font-semibold text-foreground mb-3">Pipeline status</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(stats?.statusBreakdown ?? {}).map(([s, n]) => (
                    <button key={s} onClick={() => navigate(`/intake/leads?status=${s}`)} className="hover:scale-105 transition-transform">
                      <span className={`inline-flex items-center text-[11px] font-semibold rounded-full border px-2 py-0.5 ${STATUS_META[s]?.cls ?? "bg-secondary text-muted-foreground border-border"}`}>
                        {STATUS_META[s]?.label ?? s} · {n as number}
                      </span>
                    </button>
                  ))}
                  {Object.keys(stats?.statusBreakdown ?? {}).length === 0 && <p className="text-xs text-muted-foreground">Nothing yet.</p>}
                </div>
                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">How it works:</span> connect your RingCentral once (Settings). Every intake call is recorded → transcribed → the AI fills the case facts, computes the California SOL deadline, and scores the lead 0–100. Qualified &amp; signed leads are pushed to Filevine automatically.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </IntakeGuard>
  );
}
