import { useLocation } from "wouter";
import { motion, type Variants } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Handshake, Scale, Star, Phone, ClipboardList,
  AlertTriangle, ArrowUpRight, Search, Map, BarChart3,
  Flag, Clock, TrendingUp, ChevronRight, Sparkles, Award,
  CalendarClock, CheckCircle2, ListChecks, Activity, FileText,
} from "lucide-react";
import { format, isToday, formatDistanceToNow } from "date-fns";
import { seesAllData } from "@shared/permissions";

const STATUS_META: Record<string, { label: string; color: string }> = {
  active_partner: { label: "Active Partner", color: "#34d399" },
  priority_partner: { label: "Priority Partner", color: "#e8c468" },
  prospect: { label: "Prospect", color: "#7dd3fc" },
  warm_lead: { label: "Warm Lead", color: "#fbbf24" },
  cold: { label: "Cold", color: "#64748b" },
  dormant: { label: "Dormant", color: "#94a3b8" },
  needs_follow_up: { label: "Needs Follow-Up", color: "#fb923c" },
  do_not_use: { label: "Do Not Use", color: "#9f1239" },
  churned: { label: "Churned", color: "#f87171" },
  do_not_contact: { label: "Do Not Contact", color: "#9f1239" },
  needs_agent: { label: "Needs Agent", color: "#a78bfa" },
};

const PRIORITY_META: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/25",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  low: "bg-slate-500/15 text-slate-400 border-slate-500/25",
};

const ACTIVITY_META: Record<string, { icon: any; color: string; bg: string }> = {
  call: { icon: Phone, color: "#22d3ee", bg: "rgba(34,211,238,0.12)" },
  update: { icon: FileText, color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  referral: { icon: Star, color: "#e8c468", bg: "rgba(232,196,104,0.12)" },
};

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = seesAllData(user?.role); // managers + super admin see the Command Center; agents get "My Day"

  // Hooks always run; gated by `enabled` (never early-return before a hook).
  const { data: stats, isLoading: statsLoading } = trpc.crm.management.dashboard.useQuery(undefined, { enabled: isAdmin });
  const { data: overdue } = trpc.crm.tasks.listOverdue.useQuery(undefined, { retry: false, enabled: isAdmin });
  const { data: activity } = trpc.crm.activity.recent.useQuery(undefined, { enabled: isAdmin });
  const { data: myTasks, isLoading: myTasksLoading } = trpc.crm.tasks.listMine.useQuery({ status: "open" }, { enabled: !!user });

  const firstName = (user?.name ?? "there").split(" ")[0];
  const today = format(new Date(), "EEEE, MMMM d");
  const myOpen = myTasks ?? [];

  const quickActions = [
    { label: "Facilities", icon: Building2, path: "/crm/facilities" },
    { label: "Search Leads", icon: Search, path: "/search" },
    { label: "Lead Map", icon: Map, path: "/map" },
    { label: "Reports", icon: BarChart3, path: "/crm/reports" },
  ];

  const hero = (
    <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl premium-card p-6 lg:p-8">
      <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(232,196,104,0.16), transparent 70%)" }} />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary/80 text-[11px] font-semibold tracking-[0.2em] uppercase mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Farahi Law · {isAdmin ? "Command Center" : "My Day"}
          </div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground">
            {greeting()}, <span className="gold-text">{firstName}</span>
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {today} — {isAdmin ? "here's how your partnerships are performing." : "here's what needs your attention today."}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-4xl lg:text-5xl font-bold gold-text leading-none">
            {isAdmin ? (stats?.totalSignedCases ?? 0).toLocaleString() : myOpen.length}
          </div>
          <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5 justify-end">
            {isAdmin
              ? (<><Scale className="w-3.5 h-3.5 text-primary" /> total signed cases</>)
              : (<><ListChecks className="w-3.5 h-3.5 text-primary" /> open tasks</>)}
          </div>
        </div>
      </div>
    </motion.header>
  );

  // ─────────────── Rep view: "My Day" ───────────────
  if (!isAdmin) {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const tomorrow = new Date(startToday.getTime() + 86400000);
    const overdueMine = myOpen.filter((t) => t.dueDate && new Date(t.dueDate) < startToday);
    const todayMine = myOpen.filter((t) => t.dueDate && isToday(new Date(t.dueDate)));
    const upcomingMine = myOpen.filter((t) => !t.dueDate || new Date(t.dueDate) >= tomorrow);

    return (
      <div className="dashboard-mesh min-h-full">
        <div className="max-w-[1100px] mx-auto p-6 lg:p-8 space-y-8">
          {hero}
          {myTasksLoading ? (
            <div className="grid md:grid-cols-3 gap-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
          ) : myOpen.length === 0 ? (
            <motion.div variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-80" />
              <p className="font-display text-xl font-semibold text-foreground">You're all caught up 🎉</p>
              <p className="text-muted-foreground text-sm mt-1">No open tasks assigned to you right now.</p>
            </motion.div>
          ) : (
            <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-3 gap-6">
              <TaskColumn title="Overdue" icon={AlertTriangle} tint="#f87171" tasks={overdueMine} navigate={navigate} emptyText="Nothing overdue 👍" />
              <TaskColumn title="Due Today" icon={CalendarClock} tint="#e8c468" tasks={todayMine} navigate={navigate} emptyText="Nothing due today" />
              <TaskColumn title="Upcoming" icon={Clock} tint="#7dd3fc" tasks={upcomingMine} navigate={navigate} emptyText="Nothing upcoming" />
            </motion.div>
          )}
          <QuickActions actions={quickActions} navigate={navigate} />
        </div>
      </div>
    );
  }

  // ─────────────── Admin view: Command Center ───────────────
  if (statsLoading) {
    return (
      <div className="dashboard-mesh min-h-full p-6 lg:p-8 space-y-8">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  const statusData = Object.entries(stats?.statusBreakdown ?? {})
    .map(([k, v]) => ({ name: STATUS_META[k]?.label ?? k, value: v as number, color: STATUS_META[k]?.color ?? "#94a3b8" }))
    .sort((a, b) => b.value - a.value);

  const kpis = [
    { label: "Facilities", value: stats?.totalFacilities, icon: Building2, tint: "#7dd3fc" },
    { label: "Active Partners", value: stats?.activePartners, icon: Handshake, tint: "#34d399" },
    { label: "Signed Cases", value: stats?.totalSignedCases, icon: Scale, tint: "#e8c468", hero: true },
    { label: "Referrals", value: stats?.totalReferrals, icon: Star, tint: "#fbbf24" },
    { label: "Calls Logged", value: stats?.totalContactLogs, icon: Phone, tint: "#22d3ee" },
    { label: "Open Tasks", value: stats?.openTasks, icon: ClipboardList, tint: "#fb923c", badge: stats?.overdueTasks },
  ];

  return (
    <div className="dashboard-mesh min-h-full">
      <div className="max-w-[1400px] mx-auto p-6 lg:p-8 space-y-8">
        {hero}

        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <motion.div key={k.label} variants={item}
                className="premium-card group rounded-2xl p-4 hover:-translate-y-1 hover:shadow-[0_16px_44px_-16px_rgba(232,196,104,0.30)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${k.tint}1a`, border: `1px solid ${k.tint}33` }}>
                    <Icon className="w-[18px] h-[18px]" style={{ color: k.tint }} />
                  </div>
                  {k.badge ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">{k.badge} overdue</span> : null}
                </div>
                <div className={`font-display font-bold text-foreground ${k.hero ? "text-3xl" : "text-2xl"}`}>{(k.value ?? 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
              </motion.div>
            );
          })}
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <motion.section variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-6">
              <SectionTitle icon={TrendingUp} title="Partner Portfolio" subtitle="Relationship status across all facilities" />
              <div className="grid sm:grid-cols-2 gap-6 items-center mt-5">
                <div className="relative h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={3} stroke="none">
                        {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <RTooltip contentStyle={{ background: "oklch(0.16 0.018 255)", border: "1px solid oklch(0.26 0.02 255)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="font-display text-3xl font-bold text-foreground">{stats?.totalFacilities ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Facilities</div>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {statusData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} /><span className="text-muted-foreground">{d.name}</span></div>
                      <span className="font-semibold text-foreground">{d.value}</span>
                    </div>
                  ))}
                  {statusData.length === 0 && <p className="text-sm text-muted-foreground">No facilities yet.</p>}
                </div>
              </div>
            </motion.section>

            <motion.section variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-6">
              <SectionTitle icon={Award} title="Top Partners" subtitle="Ranked by signed cases delivered" />
              <div className="mt-5 space-y-1">
                {(stats?.topReferrers ?? []).filter((p) => (p.totalSignedCases ?? 0) > 0).slice(0, 6).map((p, i) => {
                  const max = stats?.topReferrers?.[0]?.totalSignedCases || 1;
                  const pct = Math.max(6, Math.round(((p.totalSignedCases || 0) / max) * 100));
                  return (
                    <button key={p.id} onClick={() => navigate(`/crm/facilities/${p.id}`)} className="w-full group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-secondary/60 transition-colors text-left">
                      <span className="font-display text-sm w-5 text-center text-primary/70">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
                          <span className="text-sm font-bold text-foreground shrink-0">{p.totalSignedCases}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #b8902f, #e8c468)" }} /></div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
                {(stats?.topReferrers ?? []).filter((p) => (p.totalSignedCases ?? 0) > 0).length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">No signed cases recorded yet.</p>
                )}
              </div>
            </motion.section>

            <motion.section variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-6">
              <SectionTitle icon={Activity} title="Recent Activity" subtitle="Calls, notes & referrals across all partners" />
              <div className="mt-5 space-y-1 max-h-[440px] overflow-y-auto pr-1">
                {(activity ?? []).map((a: any) => {
                  const meta = ACTIVITY_META[a.kind] ?? ACTIVITY_META.update;
                  const Icon = meta.icon;
                  return (
                    <button key={a.id} onClick={() => navigate(`/crm/facilities/${a.facilityId}`)}
                      className="w-full text-left flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-secondary/60 transition-colors">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: meta.bg }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground leading-snug line-clamp-2">{a.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                          <span className="truncate">{a.facilityName ?? "Facility"}</span>
                          {a.repName && <><span>·</span><span className="truncate">{a.repName}</span></>}
                          {a.date && <><span>·</span><span className="shrink-0">{formatDistanceToNow(new Date(a.date), { addSuffix: true })}</span></>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {(activity ?? []).length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No recent activity yet.</p>}
              </div>
            </motion.section>
          </div>

          <div className="space-y-6">
            <motion.section variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-6">
              <SectionTitle icon={AlertTriangle} title="Needs Attention" />
              <div className="mt-5 space-y-3">
                <AttentionRow icon={Clock} tint="#fb923c" label="Overdue tasks" value={stats?.overdueTasks ?? 0} onClick={() => navigate("/crm/dashboard")} />
                <AttentionRow icon={TrendingUp} tint="#7dd3fc" label="Follow-ups due" value={stats?.followUpDue ?? 0} onClick={() => navigate("/crm/facilities")} />
                <AttentionRow icon={Flag} tint="#f87171" label="Flagged facilities" value={stats?.flaggedCount ?? 0} onClick={() => navigate("/crm/dashboard")} />
              </div>
              {Array.isArray(overdue) && overdue.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border space-y-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Most overdue</p>
                  {overdue.slice(0, 3).map((t: any) => (
                    <button key={t.id} onClick={() => navigate(`/crm/facilities/${t.facilityId}`)} className="w-full text-left flex items-start gap-2 group">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors line-clamp-1">{t.title}{t.facilityName ? ` · ${t.facilityName}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </motion.section>

            <QuickActions actions={quickActions} navigate={navigate} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskColumn({ title, icon: Icon, tint, tasks, navigate, emptyText }: { title: string; icon: any; tint: string; tasks: any[]; navigate: (p: string) => void; emptyText: string }) {
  return (
    <motion.section variants={item} className="premium-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: tint }} />
          <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${tint}1a`, color: tint, border: `1px solid ${tint}33` }}>{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">{emptyText}</p>
        ) : tasks.map((t) => (
          <button key={t.id} onClick={() => navigate(`/crm/facilities/${t.facilityId}`)}
            className="w-full text-left rounded-xl px-3 py-2.5 bg-secondary/40 hover:bg-secondary border border-transparent hover:border-border transition-all group">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground leading-snug">{t.title}</span>
              {t.priority && <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${PRIORITY_META[t.priority] ?? PRIORITY_META.low}`}>{t.priority}</span>}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className="text-xs text-muted-foreground truncate">{t.facilityName ?? "Facility"}</span>
              {t.dueDate && <span className="text-[11px] text-muted-foreground shrink-0">{format(new Date(t.dueDate), "MMM d")}</span>}
            </div>
          </button>
        ))}
      </div>
    </motion.section>
  );
}

function QuickActions({ actions, navigate }: { actions: { label: string; icon: any; path: string }[]; navigate: (p: string) => void }) {
  return (
    <motion.section variants={item} initial="hidden" animate="show" className="premium-card rounded-2xl p-6">
      <SectionTitle icon={Sparkles} title="Quick Actions" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.label} onClick={() => navigate(a.path)}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 py-4 hover:border-primary/40 hover:bg-secondary transition-all group">
              <Icon className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
              <span className="text-xs font-medium text-foreground">{a.label}</span>
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-primary" /></div>
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function AttentionRow({ icon: Icon, tint, label, value, onClick }: { icon: any; tint: string; label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 bg-secondary/40 hover:bg-secondary border border-transparent hover:border-border transition-all group">
      <div className="flex items-center gap-2.5"><Icon className="w-4 h-4" style={{ color: tint }} /><span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span></div>
      <div className="flex items-center gap-1.5"><span className="font-display text-lg font-bold text-foreground">{value}</span><ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" /></div>
    </button>
  );
}
