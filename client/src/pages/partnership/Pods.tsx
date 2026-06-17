import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Plus, Pencil, Trash2, Target } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, HEALTH_BANDS } from "./shared";

type PodForm = {
  id?: number; name: string; region: string; frName: string; bdrName: string; qaCoachName: string;
  monthlyTarget: number; notes: string;
};
const EMPTY: PodForm = { name: "", region: "", frName: "", bdrName: "", qaCoachName: "", monthlyTarget: 12, notes: "" };

function HealthBadge({ podId }: { podId: number }) {
  const { data } = trpc.partnership.health.useQuery({ podId });
  if (!data) return null;
  const b = HEALTH_BANDS[data.band] ?? HEALTH_BANDS.watch;
  return <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${b.cls}`}>{b.label} · {data.score}</span>;
}

export default function PartnershipPods() {
  const utils = trpc.useUtils();
  const { data: pods, isLoading } = trpc.partnership.pods.list.useQuery();
  const { data: team } = trpc.team.list.useQuery();
  const [form, setForm] = useState<PodForm | null>(null);

  const agentNames: string[] = Array.from(new Set((team ?? []).map((u: any) => u.agentName).filter(Boolean))).sort();

  const save = trpc.partnership.pods.create.useMutation({
    onSuccess: () => { toast.success("Pod created"); utils.partnership.pods.list.invalidate(); setForm(null); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.partnership.pods.update.useMutation({
    onSuccess: () => { toast.success("Pod updated"); utils.partnership.pods.list.invalidate(); setForm(null); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.partnership.pods.delete.useMutation({
    onSuccess: () => { toast.success("Pod deleted"); utils.partnership.pods.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!form || !form.name.trim()) return toast.error("Pod name is required");
    if (form.id) update.mutate(form as any);
    else save.mutate(form as any);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <PageHeader
        title="Team Pods"
        subtitle="Each pod binds a Field Rep + a BDR (and a QA Coach) into one unit with one shared quota — one team doing one job from two positions."
      >
        <Button onClick={() => setForm({ ...EMPTY })}><Plus className="w-4 h-4" /> New Pod</Button>
      </PageHeader>

      {form && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">{form.id ? "Edit Pod" : "New Pod"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Pod name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pod A — Central Valley" /></Field>
              <Field label="Region"><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="Bakersfield / Fresno" /></Field>
              <Field label="Field Rep (FR)"><AgentInput value={form.frName} names={agentNames} onChange={(v) => setForm({ ...form, frName: v })} /></Field>
              <Field label="BDR"><AgentInput value={form.bdrName} names={agentNames} onChange={(v) => setForm({ ...form, bdrName: v })} /></Field>
              <Field label="QA Coach"><AgentInput value={form.qaCoachName} names={agentNames} onChange={(v) => setForm({ ...form, qaCoachName: v })} /></Field>
              <Field label="Monthly target (qualified leads)"><Input type="number" value={form.monthlyTarget} onChange={(e) => setForm({ ...form, monthlyTarget: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex gap-2">
              <Button onClick={submit} disabled={save.isPending || update.isPending}>Save Pod</Button>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? <Skeleton className="h-48 rounded-xl" /> : !pods?.length ? (
        <EmptyState onCreate={() => setForm({ ...EMPTY })} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pods.map((p: any) => (
            <Card key={p.id} className={p.active ? "" : "opacity-60"}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      <h3 className="font-semibold text-foreground">{p.name}</h3>
                    </div>
                    {p.region && <p className="text-xs text-muted-foreground mt-0.5">{p.region}</p>}
                  </div>
                  <HealthBadge podId={p.id} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <Member role="FR" name={p.frName} />
                  <Member role="BDR" name={p.bdrName} />
                  <Member role="QA Coach" name={p.qaCoachName} />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1 border-t border-border">
                  <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {p.monthlyTarget} qualified leads / month</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm({ id: p.id, name: p.name ?? "", region: p.region ?? "", frName: p.frName ?? "", bdrName: p.bdrName ?? "", qaCoachName: p.qaCoachName ?? "", monthlyTarget: p.monthlyTarget ?? 12, notes: p.notes ?? "" })}>
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => { if (confirm(`Delete pod "${p.name}"?`)) del.mutate({ id: p.id }); }}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>{children}</div>;
}
function Member({ role, name }: { role: string; name?: string | null }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{role}</p>
      <p className="font-medium text-foreground truncate">{name || "—"}</p>
    </div>
  );
}
function AgentInput({ value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] }) {
  return (
    <>
      <Input list="pod-agents" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Name" />
      <datalist id="pod-agents">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </>
  );
}
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
      <p className="text-foreground font-medium">No pods yet</p>
      <p className="text-sm text-muted-foreground mb-4">Create your first FR/BDR pod to start tracking the shared quota and the coordinated loop.</p>
      <Button onClick={onCreate}><Plus className="w-4 h-4" /> Create a Pod</Button>
    </div>
  );
}
