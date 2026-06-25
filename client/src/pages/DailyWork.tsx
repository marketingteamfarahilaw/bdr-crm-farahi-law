import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Receipt, PhoneMissed, Stethoscope, Car, Phone, Building2, Check, X, ChevronRight, Activity, CheckCircle2, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "@/lib/datetime";

const money = (n: any) => `$${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const daysSince = (d: any) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

export default function DailyWork() {
  const { data, isLoading } = trpc.dailyWork.summary.useQuery();
  const c = data?.counts;
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Daily Work</h1>
        <p className="text-sm text-muted-foreground mt-1">What to work on right now — overdue partners, due tasks, pending expenses, unassigned calls, and cases awaiting action.</p>
      </div>

      <IntegrationHealth />

      {isLoading || !data ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OverduePartners rows={data.overduePartners} n={c?.overduePartners ?? 0} />
          <DueTasks rows={data.dueTasks} n={c?.dueTasks ?? 0} />
          <PendingExpenses rows={data.pendingExpenses} total={data.pendingExpenseTotal} n={c?.pendingExpenses ?? 0} />
          <UnmatchedCalls rows={data.unmatchedCalls} n={c?.unmatchedCalls ?? 0} />
          <ChiroAwaiting rows={data.chiroAwaiting} n={c?.chiroAwaiting ?? 0} />
          <PdAwaiting rows={data.pdAwaiting} n={c?.pdAwaiting ?? 0} />
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, n, accent, children, footer }: { icon: any; title: string; n: number; accent?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Icon className={`w-4 h-4 ${accent ?? "text-muted-foreground"}`} /> {title} <Badge variant="secondary" className="ml-auto">{n}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-1.5 max-h-80 overflow-y-auto">{n === 0 ? <p className="text-sm text-muted-foreground py-3 text-center flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> All clear</p> : children}{footer}</CardContent>
    </Card>
  );
}
const Row = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <div className={`flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm ${onClick ? "cursor-pointer hover:bg-muted/70" : ""}`} onClick={onClick}>{children}</div>
);

function OverduePartners({ rows, n }: { rows: any[]; n: number }) {
  const [, nav] = useLocation();
  return (
    <Section icon={AlertTriangle} title="Partners overdue for contact (>14d)" n={n} accent="text-red-500">
      {rows.map((p) => { const d = daysSince(p.lastContactDate); return (
        <Row key={p.id} onClick={() => nav(`/crm/facilities/${p.id}`)}>
          <div className="min-w-0"><p className="font-medium text-foreground truncate">{p.name}</p><p className="text-[11px] text-muted-foreground">{p.city || "—"}{p.assignedRepName ? ` · ${p.assignedRepName}` : ""}</p></div>
          <span className="text-xs font-medium text-red-500 shrink-0">{d == null ? "never" : `${d}d`}</span>
        </Row>
      ); })}
    </Section>
  );
}

function DueTasks({ rows, n }: { rows: any[]; n: number }) {
  const [, nav] = useLocation();
  return (
    <Section icon={Clock} title="Tasks due / overdue" n={n} accent="text-amber-500" footer={n > 0 ? <Button variant="ghost" size="sm" className="w-full mt-1" onClick={() => nav("/tasks")}>Open Task Board <ChevronRight className="w-3.5 h-3.5" /></Button> : undefined}>
      {rows.map((t) => { const over = t.dueDate && new Date(t.dueDate) < new Date(); return (
        <Row key={t.id} onClick={() => t.facilityId && nav(`/crm/facilities/${t.facilityId}`)}>
          <div className="min-w-0"><p className="font-medium text-foreground truncate">{t.title}</p><p className="text-[11px] text-muted-foreground truncate">{t.facilityName || "—"}{t.assignedToName ? ` · ${t.assignedToName}` : ""}</p></div>
          <span className={`text-xs shrink-0 ${over ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{t.dueDate ? format(new Date(t.dueDate), "MMM d") : ""}</span>
        </Row>
      ); })}
    </Section>
  );
}

function PendingExpenses({ rows, total, n }: { rows: any[]; total: number; n: number }) {
  const [, nav] = useLocation();
  return (
    <Section icon={Receipt} title="Pending expense reimbursements" n={n} footer={n > 0 ? <div className="flex items-center justify-between pt-1.5 text-sm"><span className="text-muted-foreground">Total pending</span><span className="font-semibold text-foreground">{money(total)}</span></div> : undefined}>
      {rows.slice(0, 20).map((e) => (
        <Row key={`${e.kind}-${e.id}`} onClick={() => nav("/bdr/expenses")}>
          <div className="min-w-0"><p className="font-medium text-foreground truncate">{e.facilityName || e.store || "Expense"}</p><p className="text-[11px] text-muted-foreground">{e.kind} · {e.expenseDate ? format(new Date(e.expenseDate), "MMM d") : ""}{e.agentName ? ` · ${e.agentName}` : ""}</p></div>
          <span className="text-xs font-medium text-foreground shrink-0">{money(e.amount)}</span>
        </Row>
      ))}
    </Section>
  );
}

function UnmatchedCalls({ rows, n }: { rows: any[]; n: number }) {
  return (
    <Section icon={PhoneMissed} title="Unassigned RingCentral calls" n={n} accent="text-blue-500">
      {rows.map((call) => <UnmatchedRow key={call.id} call={call} />)}
    </Section>
  );
}
function UnmatchedRow({ call }: { call: any }) {
  const utils = trpc.useUtils();
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState("");
  const { data: results } = trpc.crm.facilities.list.useQuery({ search: q }, { enabled: assigning && q.length >= 2 });
  const assign = trpc.dailyWork.assignCall.useMutation({ onSuccess: () => { toast.success("Call assigned to partner"); utils.dailyWork.summary.invalidate(); }, onError: (e) => toast.error(e.message) });
  const dismiss = trpc.dailyWork.dismissCall.useMutation({ onSuccess: () => { utils.dailyWork.summary.invalidate(); }, onError: (e) => toast.error(e.message) });
  const num = call.direction === "Inbound" ? call.fromNumber : call.toNumber;
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0"><p className="font-medium text-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> {num || "Unknown"}</p><p className="text-[11px] text-muted-foreground">{call.direction ?? ""} · {call.startTime ? formatDistanceToNow(new Date(call.startTime), { addSuffix: true }) : ""}{call.callResult ? ` · ${call.callResult}` : ""}</p></div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7" onClick={() => setAssigning((v) => !v)}>Assign</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Dismiss" onClick={() => dismiss.mutate({ id: call.id })}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      {assigning && (
        <div>
          <Input className="h-8" placeholder="Search partner…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {results && q.length >= 2 && (
            <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto">
              {results.slice(0, 8).map((f: any) => (
                <button key={f.id} className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm hover:bg-muted" onClick={() => { assign.mutate({ id: call.id, facilityId: f.id }); setAssigning(false); }}>
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" /> {f.name} <span className="text-xs text-muted-foreground">{f.city}</span>
                </button>
              ))}
              {!results.length && <p className="text-xs text-muted-foreground px-2.5 py-1.5">No match</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChiroAwaiting({ rows, n }: { rows: any[]; n: number }) {
  return (
    <Section icon={Stethoscope} title="Chiro cases awaiting assignment" n={n} accent="text-violet-500">
      {rows.map((r) => (
        <Row key={r.id}>
          <div className="min-w-0"><p className="font-medium text-foreground truncate">{r.clientName}</p><p className="text-[11px] text-muted-foreground truncate">{r.facilityName || "unassigned"}{r.facilityType ? ` · ${r.facilityType}` : ""}</p></div>
          <span className="text-[11px] text-muted-foreground shrink-0">{r.month || ""}</span>
        </Row>
      ))}
    </Section>
  );
}

function PdAwaiting({ rows, n }: { rows: any[]; n: number }) {
  const [, nav] = useLocation();
  return (
    <Section icon={Car} title="PD cars awaiting status" n={n} accent="text-cyan-500" footer={n > 0 ? <Button variant="ghost" size="sm" className="w-full mt-1" onClick={() => nav("/pd-tracker")}>Open PD Tracker <ChevronRight className="w-3.5 h-3.5" /></Button> : undefined}>
      {rows.map((r) => (
        <Row key={r.id} onClick={() => nav("/pd-tracker")}>
          <div className="min-w-0"><p className="font-medium text-foreground truncate">{r.clientName || r.caseNumber || "Car"}</p><p className="text-[11px] text-muted-foreground truncate">{r.vehicleInfo || r.caseNumber || ""}</p></div>
          <span className="text-[11px] text-cyan-600 dark:text-cyan-400 shrink-0">{r.status === "new_case" ? "New" : "Waiting liability"}</span>
        </Row>
      ))}
    </Section>
  );
}

function IntegrationHealth() {
  const { data } = trpc.dailyWork.integrations.useQuery();
  if (!data) return null;
  const rc = data.ringcentral, fv = data.filevine;
  const dot = (ok: boolean) => <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Integration health</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-medium text-foreground"><Phone className="w-3.5 h-3.5" /> RingCentral</div>
          <div className="flex items-center gap-2 text-muted-foreground">{dot(rc.connectedAgents > 0)} {rc.connectedAgents}/{rc.totalAgents} agents connected</div>
          <div className="flex items-center gap-2 text-muted-foreground"><RefreshCw className="w-3 h-3" /> Last sync: {rc.lastSync ? formatDistanceToNow(new Date(rc.lastSync), { addSuffix: true }) : "never"}</div>
          <div className={`flex items-center gap-2 ${rc.unmatchedCalls > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}><PhoneMissed className="w-3 h-3" /> {rc.unmatchedCalls} unmatched calls</div>
          {rc.staleAgents.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Stale (24h+): {rc.staleAgents.slice(0, 5).join(", ")}</p>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-medium text-foreground"><Link2 className="w-3.5 h-3.5" /> FileVine</div>
          <div className="flex items-center gap-2 text-muted-foreground">{dot(fv.configured)} {fv.configured ? "Webhook configured" : "Not configured"}</div>
          <div className="flex items-center gap-2 text-muted-foreground">Last push: {fv.lastPushAt ? formatDistanceToNow(new Date(fv.lastPushAt), { addSuffix: true }) : "—"}{fv.lastStatus ? ` (${fv.lastStatus})` : ""}</div>
          {fv.lastStatus === "failed" && fv.lastError && <p className="text-[11px] text-red-500">Last error: {fv.lastError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
