// Shared constants + small components for the FR/BDR Partnership Model pages.
import { Card, CardContent } from "@/components/ui/card";

export const LOOP_STAGES = [
  { key: "research", label: "Research", desc: "BDR identifies the target", color: "bg-slate-500/15 text-slate-500 border-slate-500/30" },
  { key: "first_contact", label: "First Contact", desc: "BDR's intro call — seed planted", color: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  { key: "appointment_set", label: "Appointment Set", desc: "Visit booked for the FR", color: "bg-violet-500/15 text-violet-500 border-violet-500/30" },
  { key: "visited", label: "Visited", desc: "FR showed up with context", color: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  { key: "post_visit", label: "Post-Visit", desc: "BDR follows up & reinforces", color: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  { key: "nurture", label: "Nurture", desc: "Ongoing check-ins, both roles", color: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
] as const;
export type LoopStageKey = (typeof LOOP_STAGES)[number]["key"];
export const stageMeta = (k?: string | null) => LOOP_STAGES.find((s) => s.key === k) ?? LOOP_STAGES[0];

export const HEALTH_BANDS: Record<string, { label: string; cls: string; dot: string }> = {
  healthy: { label: "Healthy", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", dot: "#10b981" },
  watch: { label: "Watch", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", dot: "#f59e0b" },
  at_risk: { label: "At Risk", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", dot: "#ef4444" },
};

export const PACE_META: Record<string, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  slightly_behind: { label: "Slightly behind", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  behind: { label: "Behind", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

export const APPT_STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  attended: { label: "Attended ✓", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  no_show: { label: "No-show", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  cancelled: { label: "Cancelled", cls: "bg-slate-500/15 text-slate-500" },
  rescheduled: { label: "Rescheduled", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

export const money = (n?: number | null) =>
  `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const monthOptions = (count = 6): string[] => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
};
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-2 flex-wrap items-center">{children}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, sub, color = "text-foreground" }: {
  icon?: React.ElementType; label: string; value: React.ReactNode; sub?: string; color?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function ProgressBar({ value, max, color = "var(--primary)" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
