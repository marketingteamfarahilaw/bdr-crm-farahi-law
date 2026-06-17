import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target, TrendingUp, CheckCircle2, DollarSign, Download } from "lucide-react";
import { PageHeader, StatCard, HEALTH_BANDS, money, monthOptions, monthLabel } from "./shared";

export default function PartnershipLeadership() {
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const { data, isLoading } = trpc.partnership.leadership.useQuery({ month });

  const exportCsv = () => {
    if (!data?.pods.length) return;
    const head = ["Pod", "Region", "FR", "BDR", "QA Coach", "Target", "Qualified", "Signed", "% to target", "Health", "Score", "Bonus pool", "FR bonus", "BDR bonus"];
    const rows = data.pods.map((p: any) => [p.podName, p.region ?? "", p.frName ?? "", p.bdrName ?? "", p.qaCoachName ?? "", p.target, p.qualified, p.signed, `${p.pctToTarget}%`, p.health?.band ?? "", p.health?.score ?? "", p.bonusPool, Math.round(p.frBonus), Math.round(p.bdrBonus)]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `Partnership Leadership ${month}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <PageHeader title="Leadership Dashboard" subtitle="Pod-level results the QA Coach reports up: shared-quota attainment, partnership health, and the bonus pool across every pod.">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{monthOptions(6).map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={!data?.pods.length}><Download className="w-4 h-4" /> Export</Button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Target} label="Combined target" value={data?.totals.target ?? 0} />
        <StatCard icon={TrendingUp} label="Qualified leads" value={data?.totals.qualified ?? 0} color="text-primary" sub={data?.totals.target ? `${Math.round(((data.totals.qualified) / data.totals.target) * 100)}% to target` : undefined} />
        <StatCard icon={CheckCircle2} label="Signed cases" value={data?.totals.signed ?? 0} color="text-emerald-500" />
        <StatCard icon={DollarSign} label="Total bonus pool" value={money(data?.totals.bonusPool)} />
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !data?.pods.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No active pods for this month.</div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pod</TableHead><TableHead>Team</TableHead><TableHead className="text-right">Qualified / Target</TableHead>
                  <TableHead className="text-right">Signed</TableHead><TableHead>Health</TableHead><TableHead className="text-right">Bonus pool</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pods.map((p: any) => {
                  const b = HEALTH_BANDS[p.health?.band] ?? HEALTH_BANDS.watch;
                  return (
                    <TableRow key={p.podId}>
                      <TableCell><div className="font-medium text-foreground">{p.podName}</div><div className="text-xs text-muted-foreground">{p.region}</div></TableCell>
                      <TableCell className="text-xs text-muted-foreground">FR {p.frName || "—"}<br />BDR {p.bdrName || "—"}</TableCell>
                      <TableCell className="text-right"><span className="font-semibold text-foreground">{p.qualified}</span> / {p.target}<div className="text-xs text-muted-foreground">{p.pctToTarget}%</div></TableCell>
                      <TableCell className="text-right font-medium text-emerald-500">{p.signed}</TableCell>
                      <TableCell>{p.health ? <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${b.cls}`}>{b.label} · {p.health.score}</span> : "—"}</TableCell>
                      <TableCell className="text-right"><div className="font-semibold text-foreground">{money(p.bonusPool)}</div><div className="text-xs text-muted-foreground">FR {money(p.frBonus)} · BDR {money(p.bdrBonus)}</div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
