import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, MapPin, Star, ClipboardList, Check, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { PageHeader, APPT_STATUS } from "./shared";

export default function PartnershipVisits() {
  const utils = trpc.useUtils();
  const { data: appts, isLoading } = trpc.partnership.visits.list.useQuery({});
  const { data: requests } = trpc.partnership.requests.list.useQuery();
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ facilityId?: number; facilityName?: string } | null>(null);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <PageHeader title="Visits & Briefings" subtitle="The BDR schedules the FR's visit and attaches a briefing — who to ask for, what they care about, what was discussed — so the FR shows up with context, not from zero.">
        <Button onClick={() => { setPrefill(null); setOpen(true); }}><CalendarPlus className="w-4 h-4" /> Schedule Visit</Button>
      </PageHeader>

      {(open || prefill) && <ScheduleForm prefill={prefill} onClose={() => { setOpen(false); setPrefill(null); }} onSaved={() => { setOpen(false); setPrefill(null); utils.partnership.visits.list.invalidate(); }} />}

      {/* Partner visit requests (§4) */}
      {requests && requests.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" /> Partners asking for an in-person visit ({requests.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {requests.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> {r.city || "—"}{r.assignedRepName ? ` · ${r.assignedRepName}` : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPrefill({ facilityId: r.id, facilityName: r.name })}><CalendarPlus className="w-3.5 h-3.5" /> Schedule</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !appts?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No visits scheduled yet.</div>
      ) : (
        <div className="space-y-3">
          {appts.map((a: any) => <AppointmentCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function AppointmentCard({ a }: { a: any }) {
  const utils = trpc.useUtils();
  const [outcome, setOutcome] = useState(a.outcome ?? "");
  const update = trpc.partnership.visits.update.useMutation({
    onSuccess: () => { toast.success("Updated"); utils.partnership.visits.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const st = APPT_STATUS[a.status] ?? APPT_STATUS.scheduled;
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold text-foreground">{a.facilityName || "Facility"} <span className="text-xs font-normal text-muted-foreground">· {a.type}</span></p>
            <p className="text-xs text-muted-foreground">{format(new Date(a.scheduledFor), "EEE, MMM d 'at' h:mm a")} · FR {a.frName || "—"} · set by {a.bdrName || a.createdByName || "—"}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
        </div>
        {a.briefing && (
          <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-sm">
            <p className="text-[10px] uppercase tracking-wide text-primary mb-0.5 flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Briefing for the FR</p>
            <p className="text-foreground whitespace-pre-wrap">{a.briefing}</p>
          </div>
        )}
        {a.status === "scheduled" ? (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => update.mutate({ id: a.id, status: "attended", outcome })}><Check className="w-3.5 h-3.5" /> Mark attended</Button>
            <Button size="sm" variant="ghost" className="text-red-500" onClick={() => update.mutate({ id: a.id, status: "no_show" })}><X className="w-3.5 h-3.5" /> No-show</Button>
          </div>
        ) : a.status === "attended" && (
          <div className="flex gap-2">
            <Input placeholder="Visit outcome / notes…" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => update.mutate({ id: a.id, outcome })}>Save</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleForm({ prefill, onClose, onSaved }: { prefill: { facilityId?: number; facilityName?: string } | null; onClose: () => void; onSaved: () => void }) {
  const [search, setSearch] = useState(prefill?.facilityName ?? "");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(prefill?.facilityId ? { id: prefill.facilityId, name: prefill.facilityName ?? "" } : null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [type, setType] = useState("visit");
  const [frName, setFrName] = useState("");
  const [briefing, setBriefing] = useState("");
  const { data: results } = trpc.crm.facilities.list.useQuery({ search }, { enabled: search.length >= 2 && !picked });

  const create = trpc.partnership.visits.create.useMutation({
    onSuccess: () => { toast.success("Visit scheduled"); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const submit = () => {
    if (!scheduledFor) return toast.error("Pick a date/time");
    create.mutate({ facilityId: picked?.id, facilityName: picked?.name, scheduledFor: new Date(scheduledFor).toISOString(), type: type as any, frName: frName || undefined, briefing: briefing || undefined });
  };

  return (
    <Card className="border-primary/40">
      <CardHeader><CardTitle className="text-base">Schedule a visit</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Facility</label>
          {picked ? (
            <div className="flex items-center gap-2"><span className="text-sm font-medium text-foreground">{picked.name}</span><Button size="sm" variant="ghost" onClick={() => { setPicked(null); setSearch(""); }}>change</Button></div>
          ) : (
            <>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search facility name…" />
              {results && results.length > 0 && search.length >= 2 && (
                <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto">
                  {results.slice(0, 12).map((f: any) => (
                    <button key={f.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted" onClick={() => { setPicked({ id: f.id, name: f.name }); }}>
                      {f.name} <span className="text-xs text-muted-foreground">{f.city}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">When</label><Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
            <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {["visit", "lunch", "drop_in", "meeting", "other"].map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
            </SelectContent></Select>
          </div>
          <div><label className="text-xs font-medium text-muted-foreground mb-1 block">FR who attends</label><Input value={frName} onChange={(e) => setFrName(e.target.value)} placeholder="Field Rep name" /></div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Briefing — who to ask for, what they care about, prior conversation</label>
          <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px]" value={briefing} onChange={(e) => setBriefing(e.target.value)} placeholder="e.g. Ask for Dr. Lee. We spoke 3x — she cares about quick lien turnaround. Bring the updated referral sheet." />
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={create.isPending}>Schedule</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
