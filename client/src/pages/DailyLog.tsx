import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, MapPin, Users2, CalendarDays, StickyNote, ArrowLeftRight, Inbox, CheckSquare, Clock, Sparkles, Download, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { canManage } from "@shared/permissions";

const todayLA = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const KIND: Record<string, { label: string; cls: string }> = {
  call: { label: "Call", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  visit: { label: "Visit", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  meeting: { label: "Meeting", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  email: { label: "Email", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  text: { label: "Text", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  note: { label: "Note", cls: "bg-slate-500/15 text-slate-500" },
  referral_sent: { label: "Referral sent", cls: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
  lead_received: { label: "Lead received", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  task_completed: { label: "Task done", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  gratitude: { label: "Gratitude", cls: "bg-pink-500/15 text-pink-600 dark:text-pink-400" },
  contact: { label: "Contact", cls: "bg-muted text-muted-foreground" },
};
const shiftDate = (d: string, days: number) => { const dt = new Date(d + "T12:00:00Z"); dt.setUTCDate(dt.getUTCDate() + days); return dt.toISOString().slice(0, 10); };

export default function DailyLog() {
  const { user } = useAuth();
  const isMgr = canManage(user?.role);
  const [date, setDate] = useState(todayLA());
  const [agent, setAgent] = useState("");
  const arg = { date, ...(isMgr && agent ? { agent } : {}) };

  const { data: team } = trpc.team.list.useQuery(undefined, { enabled: isMgr });
  const { data: dates } = trpc.dailyLog.dates.useQuery(isMgr && agent ? { agent } : {});
  const { data: log, isLoading } = trpc.dailyLog.day.useQuery(arg);
  const agentNames: string[] = Array.from(new Set((team ?? []).map((u: any) => u.agentName).filter(Boolean))).sort();

  const t: any = log?.totals ?? {};
  const exportCsv = () => {
    if (!log?.byPerson?.length) return;
    const rows = [["Person", "Calls", "Facilities", "Visits", "Meetings", "Notes", "Referrals sent", "Leads received", "Tasks done", "Pending"]];
    for (const p of log.byPerson) rows.push([p.person, p.calls, p.facilitiesContacted, p.visits, p.meetings, p.notesAdded, p.referralsSent, p.leadsReceived, p.tasksCompleted, p.pendingFollowUps]);
    rows.push([]); rows.push(["Timeline"]);
    for (const p of log.byPerson) for (const e of p.events) rows.push([p.person, format(new Date(e.when), "h:mm a"), KIND[e.kind]?.label ?? e.kind, e.facilityName ?? "", e.detail]);
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `Daily Activity ${date}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Daily Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1">An archived day-by-day record of what each person did — pulled automatically from calls, visits, leads, notes, and tasks.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {isMgr && (
            <Select value={agent || "all"} onValueChange={(v) => setAgent(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Everyone" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Everyone</SelectItem>{agentNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button variant="outline" size="icon" onClick={() => setDate(shiftDate(date, -1))} title="Previous day"><ChevronLeft className="w-4 h-4" /></Button>
          <Input type="date" value={date} max={todayLA()} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="icon" disabled={date >= todayLA()} onClick={() => setDate(shiftDate(date, 1))} title="Next day"><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={exportCsv} disabled={!log?.byPerson?.length}><Download className="w-4 h-4" /> Export</Button>
        </div>
      </div>

      <p className="text-base font-semibold text-foreground -mb-2">{format(new Date(date + "T12:00:00Z"), "EEEE, MMMM d, yyyy")}</p>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Kpi icon={Users2} label="Active" value={t.peopleActive ?? 0} />
        <Kpi icon={Phone} label="Calls" value={t.calls ?? 0} />
        <Kpi icon={MapPin} label="Visits" value={t.visits ?? 0} />
        <Kpi icon={CalendarDays} label="Meetings" value={t.meetings ?? 0} />
        <Kpi icon={Inbox} label="Leads in" value={t.leadsReceived ?? 0} />
        <Kpi icon={CheckSquare} label="Tasks done" value={t.tasksCompleted ?? 0} />
      </div>

      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !log?.byPerson?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No activity logged on this date.</div>
      ) : (
        <Tabs defaultValue="person">
          <TabsList>
            <TabsTrigger value="person"><Users2 className="w-4 h-4 mr-1" /> By Person</TabsTrigger>
            <TabsTrigger value="facility"><Building2 className="w-4 h-4 mr-1" /> By Facility</TabsTrigger>
          </TabsList>
          <TabsContent value="person" className="mt-4 space-y-4">
            {log.byPerson.map((p: any) => <PersonCard key={p.person} p={p} date={date} />)}
          </TabsContent>
          <TabsContent value="facility" className="mt-4 space-y-3">
            {log.byFacility.map((f: any) => <FacilityCard key={f.facilityId} f={f} />)}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="bg-card border-border"><CardContent className="p-3">
      <div className="flex items-center gap-1.5 mb-0.5"><Icon className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-[11px] text-muted-foreground">{label}</span></div>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </CardContent></Card>
  );
}

function PersonCard({ p, date }: { p: any; date: string }) {
  const [recap, setRecap] = useState<{ bullets: string[]; pending: string[] } | null>(null);
  const narrate = trpc.dailyLog.narrative.useMutation({
    onSuccess: (r) => setRecap(r),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-foreground">{p.person}</h3>
          <Button size="sm" variant="outline" onClick={() => narrate.mutate({ date, person: p.person })} disabled={narrate.isPending}>
            <Sparkles className="w-3.5 h-3.5" /> {narrate.isPending ? "Writing…" : "AI recap"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Stat n={p.calls} l="calls" /><Stat n={p.facilitiesContacted} l="facilities" /><Stat n={p.visits} l="visits" />
          <Stat n={p.meetings} l="meetings" /><Stat n={p.notesAdded} l="notes" /><Stat n={p.referralsSent} l="referrals sent" />
          <Stat n={p.leadsReceived} l="leads in" /><Stat n={p.tasksCompleted} l="tasks done" />
          {p.pendingFollowUps > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1"><Clock className="w-3 h-3" />{p.pendingFollowUps} pending</span>}
        </div>
        {recap && (
          <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-primary flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI recap</p>
            <ul className="text-sm text-foreground space-y-0.5">{recap.bullets.map((b, i) => <li key={i}>• {b}</li>)}</ul>
            {recap.pending.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">Pending: {recap.pending.join("; ")}</p>}
          </div>
        )}
        <div className="space-y-1.5 border-t border-border pt-2">
          {p.events.map((e: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-[11px] text-muted-foreground w-14 shrink-0 pt-0.5">{format(new Date(e.when), "h:mm a")}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${KIND[e.kind]?.cls ?? "bg-muted"}`}>{KIND[e.kind]?.label ?? e.kind}</span>
              <span className="text-foreground min-w-0"><span className="font-medium">{e.facilityName ? e.facilityName + " — " : ""}</span>{e.detail}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
function Stat({ n, l }: { n: number; l: string }) { return <span><span className="font-semibold text-foreground">{n}</span> {l}</span>; }

function FacilityCard({ f }: { f: any }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-primary shrink-0" /><h3 className="font-semibold text-foreground">{f.facilityName ?? `Facility #${f.facilityId}`}</h3></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          {f.lastContacted && <Row l="Last contact" v={format(new Date(f.lastContacted), "h:mm a")} />}
          {f.lastVisit && <Row l="Last visit" v={format(new Date(f.lastVisit), "h:mm a")} />}
          {f.latestAction && <Row l="Latest action" v={f.latestAction} />}
          {f.lastSummary && <Row l="Summary" v={f.lastSummary} />}
          {f.pendingFollowUp && <Row l="Pending" v={f.pendingFollowUp} amber />}
        </div>
      </CardContent>
    </Card>
  );
}
function Row({ l, v, amber }: { l: string; v: string; amber?: boolean }) {
  return <div className="flex gap-1.5"><span className="text-muted-foreground shrink-0">{l}:</span><span className={`${amber ? "text-amber-600 dark:text-amber-400" : "text-foreground"} truncate`}>{v}</span></div>;
}
