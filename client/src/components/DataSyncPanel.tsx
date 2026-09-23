import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock, Database, Sheet, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Job = "leaddocket" | "sheets";

const JOBS: { job: Job; title: string; blurb: string; icon: any }[] = [
  {
    job: "leaddocket",
    title: "Lead Docket",
    blurb: "BD/FR leads and sign-ups — the source of truth. Only leads credited to a representative are brought in.",
    icon: Database,
  },
  {
    job: "sheets",
    title: "Google Sheets",
    blurb: "Centralized BDR/FR workbook: facilities, call history, expenses, referrals, errands and visits.",
    icon: Sheet,
  },
];

const ago = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "never");

function StateBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    running: { label: "Syncing…", cls: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30", Icon: Loader2 },
    ok: { label: "Up to date", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
    partial: { label: "Partly synced", cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30", Icon: AlertTriangle },
    failed: { label: "Last run failed", cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30", Icon: XCircle },
    idle: { label: "Not run yet", cls: "text-muted-foreground bg-muted border-border", Icon: Clock },
  };
  const s = map[state] ?? map.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <s.Icon className={`w-3.5 h-3.5 ${state === "running" ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

/** Full sync controls — status, last result and a manual button per source. */
export function DataSyncPanel() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.dataSync.status.useQuery(undefined, {
    // Poll while anything is running so the badge flips to done without a refresh.
    refetchInterval: (q) => {
      const d: any = q.state.data;
      return d && (d.leaddocket?.state === "running" || d.sheets?.state === "running") ? 5000 : 60000;
    },
  });
  const run = trpc.dataSync.run.useMutation({
    onSuccess: (r, vars) => {
      if (r.alreadyRunning) toast.info(`${vars.job === "leaddocket" ? "Lead Docket" : "Google Sheets"} is already syncing.`);
      else toast.success(`${vars.job === "leaddocket" ? "Lead Docket" : "Google Sheets"} sync started — you can keep working.`);
      utils.dataSync.status.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not start the sync"),
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold text-foreground">Data sync</div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Runs automatically every {data?.intervalHours ?? 8} hours. Use the buttons to pull the latest now.
          </p>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading sync status…</div>}

      <div className="space-y-3">
        {data && JOBS.map(({ job, title, blurb, icon: Icon }) => {
          const s = data[job];
          const busy = s.state === "running" || (run.isPending && run.variables?.job === job);
          const disabled = busy || (job === "leaddocket" && !data.leadDocketConfigured);
          return (
            <div key={job} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground">{title}</span>
                  <StateBadge state={s.state} />
                </div>
                <Button size="sm" className="gap-2" disabled={disabled} onClick={() => run.mutate({ job })}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {busy ? "Syncing…" : "Sync now"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{blurb}</p>
              <div className="text-xs text-muted-foreground mt-2">
                Last successful sync: <span className="text-foreground">{ago(s.lastSuccessAt)}</span>
                {s.trigger && s.finishedAt && <> · last run {s.trigger === "manual" ? "started by hand" : "scheduled"}, {ago(s.finishedAt)}</>}
              </div>
              {s.summary && s.state !== "failed" && <p className="text-xs text-foreground/80 mt-1.5">{s.summary}</p>}
              {s.error && (s.state === "failed" || s.state === "partial") && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 break-words">{s.error}</p>
              )}
              {job === "leaddocket" && !data.leadDocketConfigured && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">Lead Docket isn't configured on the server yet.</p>
              )}
            </div>
          );
        })}
      </div>

      {data?.sheetAccess && data.sheetAccess.some((a: any) => !a.ok) && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="font-medium text-foreground mb-1">Some sheets can't be read</div>
          {data.sheetAccess.filter((a: any) => !a.ok).map((a: any) => (
            <div key={a.key} className="text-muted-foreground">{a.label}: {a.detail}</div>
          ))}
          <div className="text-muted-foreground mt-1">In Google Sheets: Share → General access → "Anyone with the link" → Viewer.</div>
        </div>
      )}
    </div>
  );
}

/** Compact button for report pages — pulls the latest Lead Docket sign-ups. */
export function LeadDocketSyncButton() {
  const utils = trpc.useUtils();
  const { data } = trpc.dataSync.status.useQuery(undefined, {
    refetchInterval: (q) => ((q.state.data as any)?.leaddocket?.state === "running" ? 5000 : 60000),
  });
  const run = trpc.dataSync.run.useMutation({
    onSuccess: (r) => {
      toast[r.alreadyRunning ? "info" : "success"](r.alreadyRunning ? "Lead Docket is already syncing." : "Syncing Lead Docket — the report updates when it finishes.");
      utils.dataSync.status.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not start the sync"),
  });
  const s = data?.leaddocket;
  const busy = s?.state === "running" || run.isPending;

  // When a sync finishes, reload the reports so the new sign-ups appear without
  // anyone having to refresh the page.
  const prev = useRef(s?.state);
  useEffect(() => {
    if (prev.current === "running" && s && s.state !== "running") utils.teamReports.invalidate();
    prev.current = s?.state;
  }, [s?.state]);

  return (
    <div className="flex items-center gap-2">
      {s && <span className="text-xs text-muted-foreground hidden sm:inline">Lead Docket synced {ago(s.lastSuccessAt)}</span>}
      <Button size="sm" variant="outline" className="gap-2" disabled={busy || !data?.leadDocketConfigured} onClick={() => run.mutate({ job: "leaddocket" })}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {busy ? "Syncing…" : "Sync Lead Docket"}
      </Button>
    </div>
  );
}
