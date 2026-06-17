import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, CheckCircle2, Users } from "lucide-react";
import { PageHeader, StatCard, ProgressBar, PACE_META, monthOptions, monthLabel } from "./shared";

export default function PartnershipQuota() {
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const { data, isLoading } = trpc.partnership.quota.useQuery({ month });

  const totals = (data?.pods ?? []).reduce(
    (a, p) => ({ target: a.target + p.target, qualified: a.qualified + p.qualified, signed: a.signed + p.signed }),
    { target: 0, qualified: 0, signed: 0 }
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <PageHeader title="Shared Quota" subtitle="One combined target per pod — no individual splits. Both succeed or both fall short together. A qualified lead is a partner-referred case delivered to the firm.">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{monthOptions(6).map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Target} label="Combined target" value={totals.target} sub={`${data?.pods.length ?? 0} active pods`} />
        <StatCard icon={TrendingUp} label="Qualified leads" value={totals.qualified} color="text-primary" sub={totals.target ? `${Math.round((totals.qualified / totals.target) * 100)}% to target` : undefined} />
        <StatCard icon={CheckCircle2} label="Signed cases" value={totals.signed} color="text-emerald-500" />
        <StatCard icon={Users} label="Active pods" value={data?.pods.length ?? 0} />
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !data?.pods.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No active pods for this month. Create a pod in Team Pods first.</div>
      ) : (
        <div className="space-y-4">
          {data.pods.map((p) => {
            const pace = PACE_META[p.pace] ?? PACE_META.behind;
            return (
              <Card key={p.podId}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="font-semibold text-foreground">{p.podName}</h3>
                      <p className="text-xs text-muted-foreground">FR {p.frName || "—"} · BDR {p.bdrName || "—"}{p.region ? ` · ${p.region}` : ""}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${pace.cls}`}>{pace.label}</span>
                  </div>
                  <div className="flex items-end justify-between text-sm">
                    <span className="text-2xl font-bold text-foreground">{p.qualified}<span className="text-base text-muted-foreground font-normal"> / {p.target}</span></span>
                    <span className="text-xs text-muted-foreground">expected by now: {p.expected}</span>
                  </div>
                  <ProgressBar value={p.qualified} max={p.target} />
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border text-sm">
                    <Mini label="Qualified" value={p.qualified} />
                    <Mini label="Signed" value={p.signed} />
                    <Mini label="% to target" value={`${p.pctToTarget}%`} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="font-semibold text-foreground">{value}</p></div>;
}
