/**
 * Shared Intake UI vocabulary — status/tier/SOL/case-type metadata and the
 * small badges used across the Intake Case Desk pages.
 */
import { canSeeIntake } from "@shared/permissions";
import { useAuth } from "@/_core/hooks/useAuth";
import { ShieldAlert } from "lucide-react";

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" },
  reviewing: { label: "Reviewing", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  qualified: { label: "Qualified", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  signed: { label: "Signed ✓", cls: "bg-primary/15 text-primary border-primary/30" },
  unqualified: { label: "Unqualified", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30" },
  referred_out: { label: "Referred Out", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  lost: { label: "Lost", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  duplicate: { label: "Duplicate", cls: "bg-slate-500/15 text-slate-500 border-slate-500/30" },
};

export const TIER_META: Record<string, { label: string; cls: string; bar: string }> = {
  hot: { label: "🔥 Hot", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", bar: "#ef4444" },
  qualified: { label: "Qualified", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", bar: "#10b981" },
  review: { label: "Needs Review", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", bar: "#f59e0b" },
  unqualified: { label: "Unqualified", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30", bar: "#64748b" },
};

export const SOL_META: Record<string, { label: string; cls: string }> = {
  ok: { label: "SOL OK", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25" },
  warning: { label: "SOL < 4 mo", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  urgent: { label: "SOL URGENT", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" },
  expired: { label: "SOL EXPIRED", cls: "bg-destructive/20 text-destructive border-destructive/40" },
  unknown: { label: "SOL unknown", cls: "bg-slate-500/10 text-slate-500 border-slate-500/20" },
};

export const CASE_TYPES: Record<string, string> = {
  auto_accident: "Auto Accident",
  slip_fall: "Slip & Fall",
  dog_bite: "Dog Bite",
  premises: "Premises Liability",
  work_injury: "Work Injury",
  medical_malpractice: "Medical Malpractice",
  product_liability: "Product Liability",
  wrongful_death: "Wrongful Death",
  other: "Other",
};

export const leadName = (l: { firstName?: string | null; lastName?: string | null; callerName?: string | null; phone?: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ") || l.callerName || l.phone || "Unknown caller";

export function Chip({ meta, fallback }: { meta?: { label: string; cls: string }; fallback?: string }) {
  if (!meta) return fallback ? <span className="text-xs text-muted-foreground">{fallback}</span> : null;
  return <span className={`inline-flex items-center text-[11px] font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap ${meta.cls}`}>{meta.label}</span>;
}

/** Compact score donut (0–100) colored by tier. */
export function ScoreRing({ score, tier, size = 44 }: { score: number | null | undefined; tier?: string | null; size?: number }) {
  const s = typeof score === "number" ? Math.max(0, Math.min(100, score)) : null;
  const color = tier ? (TIER_META[tier]?.bar ?? "#64748b") : "#64748b";
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={s === null ? "Not scored yet" : `Qualification score ${s}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth={4} />
        {s !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
            strokeDasharray={`${(s / 100) * c} ${c}`} />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-foreground" style={{ fontSize: size >= 56 ? 14 : 11 }}>
        {s === null ? "—" : s}
      </span>
    </div>
  );
}

/** Client-side guard — the server already denies BD/FR roles; this just shows
 *  a clean message instead of failed queries if someone types the URL. */
export function IntakeGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && !canSeeIntake(user.role)) {
    return (
      <div className="min-h-full flex items-center justify-center p-10">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">Intake team only</p>
          <p className="text-xs text-muted-foreground mt-1">This area is reserved for the Intake (AI Case Desk) team.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export const fmtDur = (sec?: number | null) => {
  const s = sec ?? 0;
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};
