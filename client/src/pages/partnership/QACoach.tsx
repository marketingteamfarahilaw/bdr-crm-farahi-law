import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, MapPin, ClipboardCheck, Activity, AlertTriangle, Star } from "lucide-react";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { PageHeader, HEALTH_BANDS } from "./shared";

const FLAGS = [
  { key: "none", label: "No issue" },
  { key: "kudos", label: "👏 Kudos" },
  { key: "coaching_needed", label: "Coaching needed" },
  { key: "breakdown", label: "⚠ Breakdown" },
];

export default function QACoach() {
  const { data: pods } = trpc.partnership.pods.list.useQuery();
  const [podId, setPodId] = useState<number | undefined>(undefined);
  useEffect(() => { if (!podId && pods?.length) setPodId(pods[0].id); }, [pods, podId]);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <PageHeader title="QA Coach Desk" subtitle="Review BDR call quality and FR visits, score messaging consistency, log coaching, and watch each pod's health — intervene early, before a small problem becomes a big one.">
        {pods && pods.length > 0 && (
          <Select value={podId ? String(podId) : ""} onValueChange={(v) => setPodId(Number(v))}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select pod" /></SelectTrigger>
            <SelectContent>{pods.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </PageHeader>

      {!podId ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Create a pod first to use the QA desk.</div>
      ) : (
        <Tabs defaultValue="reviews">
          <TabsList>
            <TabsTrigger value="reviews"><ClipboardCheck className="w-4 h-4 mr-1" /> Call Reviews</TabsTrigger>
            <TabsTrigger value="health"><Activity className="w-4 h-4 mr-1" /> Health</TabsTrigger>
            <TabsTrigger value="feed"><Phone className="w-4 h-4 mr-1" /> Coordination Feed</TabsTrigger>
          </TabsList>
          <TabsContent value="reviews" className="mt-4"><ReviewsTab podId={podId} /></TabsContent>
          <TabsContent value="health" className="mt-4"><HealthTab podId={podId} /></TabsContent>
          <TabsContent value="feed" className="mt-4"><FeedTab podId={podId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ReviewsTab({ podId }: { podId: number }) {
  const { data: calls, isLoading } = trpc.partnership.qa.recentCalls.useQuery({ podId });
  const { data: reviews } = trpc.partnership.qa.reviews.useQuery({ podId });
  const [reviewing, setReviewing] = useState<any | null>(null);

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <div className="space-y-4">
      {reviewing && <ReviewForm podId={podId} call={reviewing} onClose={() => setReviewing(null)} />}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent calls to review</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!calls?.length && <p className="text-sm text-muted-foreground">No recent calls for this pod's reps.</p>}
          {calls?.map((c: any) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{c.repName || "—"} <span className="text-xs font-normal text-muted-foreground">· {c.callResult ?? "call"} · {format(new Date(c.contactDate), "MMM d, h:mm a")}</span></p>
                {c.summary && <p className="text-xs text-muted-foreground truncate">{c.summary}</p>}
              </div>
              {c.reviewed ? <span className="text-xs text-emerald-500 flex items-center gap-1 shrink-0"><ClipboardCheck className="w-3.5 h-3.5" /> reviewed</span>
                : <Button size="sm" variant="outline" className="shrink-0" onClick={() => setReviewing(c)}>Review</Button>}
            </div>
          ))}
        </CardContent>
      </Card>
      {reviews && reviews.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Past reviews</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {reviews.slice(0, 30).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm border-b border-border py-1.5 last:border-0">
                <span className="text-muted-foreground">{format(new Date(r.createdAt), "MMM d")} · {r.subjectName || r.subjectType}</span>
                <span className="flex items-center gap-2">
                  {r.score && <span className="text-foreground font-medium">{r.score}/5</span>}
                  <FlagChip flag={r.flag} />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReviewForm({ podId, call, onClose }: { podId: number; call: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [score, setScore] = useState(4);
  const [tone, setTone] = useState(4);
  const [messaging, setMessaging] = useState(4);
  const [objection, setObjection] = useState(4);
  const [flag, setFlag] = useState("none");
  const [notes, setNotes] = useState("");
  const create = trpc.partnership.qa.createReview.useMutation({
    onSuccess: () => { toast.success("Review saved"); utils.partnership.qa.recentCalls.invalidate(); utils.partnership.qa.reviews.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card className="border-primary/40">
      <CardHeader><CardTitle className="text-base">Review call — {call.repName}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {call.summary && <p className="text-sm text-muted-foreground rounded-lg bg-muted/40 px-3 py-2">{call.summary}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Rating label="Overall" value={score} onChange={setScore} />
          <Rating label="Tone" value={tone} onChange={setTone} />
          <Rating label="Messaging" value={messaging} onChange={setMessaging} />
          <Rating label="Objection handling" value={objection} onChange={setObjection} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Flag</label>
          <Select value={flag} onValueChange={setFlag}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent>
            {FLAGS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[70px]" placeholder="Coaching notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => create.mutate({ podId, subjectType: "call", refId: call.id, facilityId: call.facilityId, subjectName: call.repName, score, toneScore: tone, messagingScore: messaging, objectionScore: objection, flag: flag as any, notes: notes || undefined })} disabled={create.isPending}>Save Review</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => onChange(n)}><Star className={`w-5 h-5 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} /></button>
        ))}
      </div>
    </div>
  );
}
function FlagChip({ flag }: { flag: string }) {
  const map: Record<string, string> = {
    none: "bg-muted text-muted-foreground", kudos: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    coaching_needed: "bg-amber-500/15 text-amber-600 dark:text-amber-400", breakdown: "bg-red-500/15 text-red-600 dark:text-red-400",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs ${map[flag] ?? map.none}`}>{FLAGS.find((f) => f.key === flag)?.label ?? flag}</span>;
}

function HealthTab({ podId }: { podId: number }) {
  const { data, isLoading } = trpc.partnership.health.useQuery({ podId });
  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (!data) return <p className="text-sm text-muted-foreground">No health data.</p>;
  const b = HEALTH_BANDS[data.band] ?? HEALTH_BANDS.watch;
  const m = data.metrics;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 flex items-center gap-5">
          <div className="text-center">
            <div className="text-4xl font-bold" style={{ color: b.dot }}>{data.score}</div>
            <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${b.cls}`}>{b.label}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm flex-1">
            <Metric label="Visits attended" value={`${m.attended}${m.attendRate != null ? ` (${Math.round(m.attendRate * 100)}%)` : ""}`} />
            <Metric label="No-shows" value={m.noShow} />
            <Metric label="Visits w/ briefing" value={m.briefingRate != null ? `${Math.round(m.briefingRate * 100)}%` : "—"} />
            <Metric label="Days since contact" value={m.daysSinceContact >= 999 ? "—" : m.daysSinceContact} />
            <Metric label="Qualified leads" value={`${m.qualified} / ${m.target}`} />
            <Metric label="QA breakdown flags" value={m.breakdownFlags} />
          </div>
        </CardContent>
      </Card>
      {data.warnings.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" /> Warning signs</CardTitle></CardHeader>
          <CardContent><ul className="space-y-1.5">{data.warnings.map((w, i) => <li key={i} className="text-sm text-foreground flex gap-2"><span className="text-amber-400">•</span> {w}</li>)}</ul></CardContent>
        </Card>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-muted/40 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="font-semibold text-foreground">{value}</p></div>;
}

function FeedTab({ podId }: { podId: number }) {
  const { data, isLoading } = trpc.partnership.feed.useQuery({ podId });
  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  const ICON: Record<string, any> = { call: Phone, visit: MapPin, appointment: ClipboardCheck, qa: Star };
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {data.map((e: any, i: number) => {
          const Icon = ICON[e.kind] ?? Activity;
          return (
            <div key={i} className="flex gap-3 text-sm border-b border-border pb-2 last:border-0">
              <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-foreground">{e.text}</p>
                <p className="text-[11px] text-muted-foreground">{e.who || "—"} · {e.when ? format(new Date(e.when), "MMM d, h:mm a") : ""} · {e.kind}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
