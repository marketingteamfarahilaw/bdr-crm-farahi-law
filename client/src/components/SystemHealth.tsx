import { useState } from "react";
import { Link } from "wouter";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { canAssignRoles } from "@shared/permissions";

/**
 * System health (server/systemHealth.ts), for super admins: the background jobs
 * the reports depend on. A card in Settings, and a banner across the app while
 * something is down — call recaps once stopped for eleven days unnoticed.
 */
function useSystemHealth() {
  const { user } = useAuth();
  return trpc.settings.systemHealth.useQuery(undefined, {
    enabled: !!user && canAssignRoles(user.role),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

const LOOK = {
  ok: { Icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400" },
  warn: { Icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  down: { Icon: XCircle, cls: "text-red-600 dark:text-red-400" },
} as const;
const SUMMARY = { ok: "Everything is working", warn: "Needs attention", down: "Something is down" } as const;

export function SystemHealthCard() {
  const q = useSystemHealth();
  const worst = q.data?.worst ?? "ok";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Activity className="w-4 h-4" /></span>
        <div className="text-sm font-semibold text-foreground">System health</div>
        {q.data && <span className={`text-xs font-medium ${LOOK[worst].cls}`}>· {SUMMARY[worst]}</span>}
        <button className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded-md" onClick={() => q.refetch()} disabled={q.isFetching}
          aria-label="Check again" title="Check again">
          {q.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : q.isError ? (
        <p className="text-sm text-muted-foreground">Couldn't check right now. Try again in a minute.</p>
      ) : (
        <ul className="space-y-3">
          {q.data!.checks.map((c) => {
            const { Icon, cls } = LOOK[c.state];
            return (
              <li key={c.id} className="flex items-start gap-3">
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${cls}`} />
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="text-muted-foreground"> — {c.detail}</span>
                  {c.action && <div className="text-xs text-foreground/80 mt-0.5">What to do: {c.action}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const HIDE_KEY = "system-alert-hidden";

/** A banner across the app while something is down. Hidden for the day on request. */
export function SystemAlert() {
  const q = useSystemHealth();
  const today = new Date().toDateString();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === today; } catch { return false; } });
  const down = q.data?.checks.filter((c) => c.state === "down") ?? [];
  if (!down.length || hidden) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, today); } catch { /* private mode */ } setHidden(true); };
  return (
    <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-[720px] flex items-start gap-3 rounded-2xl border border-red-500/30 bg-card px-4 py-3 text-sm shadow-lg">
      <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-foreground">{down.map((d) => d.label).join(" · ")}: </span>
        <span className="text-muted-foreground">{down[0].detail}</span>{" "}
        <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">System health</Link>
      </div>
      <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={hide} aria-label="Hide until tomorrow" title="Hide until tomorrow">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
