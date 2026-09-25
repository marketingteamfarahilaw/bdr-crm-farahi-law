import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, Globe, MapPin, User, Mail, AlertTriangle,
  Plus, CheckCircle2, Circle, Trash2, PhoneCall, Play, Car, MessageSquare,
  Calendar, Clock, Star, Edit, RefreshCw, Building2, Gift, FileText,
  TrendingUp, Flag, ExternalLink, ListChecks, Zap, ChevronDown, ChevronUp,
  Flame, Snowflake, ThermometerSun, Loader2, Download, ClipboardList, Receipt
} from "lucide-react";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { FacilityLocationMap } from "@/components/FacilityLocationMap";
import { LeadFormFields } from "@/components/LeadFormFields";
import { formatDistanceToNow, format } from "@/lib/datetime";

// The Voice Agents look the rest of the app uses (tokens and .premium-card in
// index.css): glass panels, soft list rows, white icon discs, quiet pills.
const PANEL = "premium-card p-5";
const ROW = "group rounded-[18px] bg-white/70 dark:bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--border)] p-4 transition-colors hover:bg-white dark:hover:bg-white/[0.07]";
const DISC = "w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-white/85 dark:bg-white/10 text-foreground shadow-[inset_0_0_0_1px_var(--edge),0_1px_2px_rgb(0_0_0/0.04)]";
const TONE = {
  ok: "bg-[#e3f1e8] text-[#2f7d4f] dark:bg-[#2f7d4f]/25 dark:text-[#7fcf9f]",
  sun: "bg-sun-soft text-sun-ink",
  bad: "bg-[#fdebe1] text-[#c2410c] dark:bg-[#e2703f]/20 dark:text-[#e2703f]",
  mute: "bg-muted text-muted-foreground",
  ink: "bg-primary text-primary-foreground",
};
const PILL = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  prospect: { label: "Prospect", color: TONE.mute },
  active_partner: { label: "Active Partner", color: TONE.ok },
  priority_partner: { label: "Priority Partner", color: TONE.sun },
  needs_follow_up: { label: "Needs Follow-Up", color: TONE.bad },
  dormant: { label: "Dormant", color: TONE.mute },
  do_not_use: { label: "Do Not Use", color: TONE.bad },
};

const CATEGORY_LABELS: Record<string, string> = {
  body_shop: "Body Shop", chiropractor: "Chiropractor", physical_therapist: "Physical Therapist",
  medical_clinic: "Medical Clinic", orthopedic_doctor: "Orthopedic Doctor", imaging_center: "Imaging Center", other: "Other",
};

const CONTACT_TYPE_ICONS: Record<string, React.ReactNode> = {
  call: <PhoneCall className="w-4 h-4" />,
  visit: <Car className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  text: <MessageSquare className="w-4 h-4" />,
  meeting: <Calendar className="w-4 h-4" />,
  other: <Clock className="w-4 h-4" />,
};

const CASE_VALUE_LABELS: Record<string, { label: string; color: string }> = {
  rank_x: { label: "Rank X", color: "text-purple-400" },
  high: { label: "High", color: "text-emerald-400" },
  medium: { label: "Medium", color: "text-amber-400" },
  low: { label: "Low", color: "text-slate-400" },
  na: { label: "N/A", color: "text-muted-foreground" },
};

type Temp = { key: "hot" | "warm" | "cold"; label: string; reason: string; cls: string; Icon: any };

/**
 * Relationship "temperature" — a quick health read on a partner, blending recency
 * of contact, partner status, referrals received, and open follow-ups.
 *   Hot  🔥 — engaged & recently touched (keep nurturing)
 *   Warm ☀️ — alive but cooling (a touch is due)
 *   Cold ❄️ — gone quiet / dormant (re-engage or retire)
 */
function facilityTemperature(facility: any, contactLogs: any[] | undefined, openTasksCount: number): Temp {
  const times = (contactLogs ?? []).map((l) => new Date(l.contactDate).getTime()).filter((n) => !isNaN(n));
  const last = times.length ? Math.max(...times) : null;
  const daysSince = last !== null ? Math.floor((Date.now() - last) / 86400000) : null;

  let score = 0;
  if (daysSince === null) score -= 1;
  else if (daysSince <= 14) score += 2;
  else if (daysSince <= 30) score += 1;
  else if (daysSince > 45) score -= 2;

  const ps = facility.partnerStatus;
  if (ps === "priority_partner") score += 2;
  else if (ps === "active_partner") score += 1;
  else if (ps === "dormant") score -= 2;
  else if (ps === "do_not_use") score -= 3;

  if ((facility.totalReferrals ?? 0) > 0) score += 1;
  if (openTasksCount > 0) score += 1;

  const reason =
    daysSince === null ? "No contact logged yet"
    : daysSince === 0 ? "Contacted today"
    : daysSince === 1 ? "Last contact yesterday"
    : `Last contact ${daysSince}d ago`;

  // tier-* are the app's shared hot/warm/cold chips (index.css).
  if (score >= 3) return { key: "hot", label: "Hot", reason, Icon: Flame, cls: "tier-hot" };
  if (score >= 1) return { key: "warm", label: "Warm", reason, Icon: ThermometerSun, cls: "tier-warm" };
  return { key: "cold", label: "Cold", reason, Icon: Snowflake, cls: "tier-cold" };
}

// Record an FR's in-person visit — logged by the BDR on the partner's behalf.
// Stored as a visit-type contact log credited to the FR, so it feeds the
// Check-In Report's FIELD REPRESENTATIVES visit matrix and the Daily Log.
const FR_ROSTER = ["Lupe", "Jezel", "Zulema", "Genysys"];
function RecordFrVisitDialog({ facilityId, onSuccess }: { facilityId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [frName, setFrName] = useState(FR_ROSTER[0]);
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const utils = trpc.useUtils();
  const createLog = trpc.crm.contactLogs.create.useMutation({
    onSuccess: () => {
      toast.success("FR visit recorded — it will show in the Check-In Report");
      utils.crm.facilities.get.invalidate({ id: facilityId });
      utils.crm.contactLogs.list.invalidate({ facilityId });
      setOpen(false); setSummary("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });
  const visitor = frName === "__other__" ? custom.trim() : frName;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 border-border">
          <MapPin className="w-3.5 h-3.5" /> Log FR Visit
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader><DialogTitle>Log FR Visit</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Who visited (FR)</label>
              <Select value={frName} onValueChange={setFrName}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FR_ROSTER.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  <SelectItem value="__other__">Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Visit date</label>
              <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="bg-background border-border" />
            </div>
          </div>
          {frName === "__other__" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Who visited?" className="bg-background border-border" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">What happened at the visit? (optional)</label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Dropped off lunch, met with the manager…" rows={3} className="bg-background border-border resize-none" />
          </div>
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
            disabled={createLog.isPending || !visitor}
            onClick={() => createLog.mutate({
              facilityId,
              contactType: "visit",
              contactDate: new Date(`${date}T12:00:00`).toISOString(),
              summary: summary || `FR visit by ${visitor}`,
              repName: visitor,
            })}
          >
            {createLog.isPending ? "Saving…" : "Log Visit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddContactLogDialog({ facilityId, onSuccess }: { facilityId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("call");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [callResult, setCallResult] = useState("connected");
  const [callType, setCallType] = useState("partner_checkin");
  const [duration, setDuration] = useState("");
  const [summary, setSummary] = useState("");
  const utils = trpc.useUtils();
  const createLog = trpc.crm.contactLogs.create.useMutation({
    onSuccess: () => {
      toast.success("Contact logged successfully");
      utils.crm.facilities.get.invalidate({ id: facilityId });
      utils.crm.contactLogs.list.invalidate({ facilityId });
      setOpen(false);
      setSummary(""); setDuration("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5" style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
          <Plus className="w-3.5 h-3.5" /> Log Contact
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>Log Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="visit">Visit</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date & Time</label>
              <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background border-border" />
            </div>
          </div>
          {type === "call" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Result</label>
                <Select value={callResult} onValueChange={setCallResult}>
                  <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="connected">Connected</SelectItem>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                    <SelectItem value="no_answer">No Answer</SelectItem>
                    <SelectItem value="busy">Busy</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Call Type</label>
                <Select value={callType} onValueChange={setCallType}>
                  <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partner_checkin">Partner Check-in</SelectItem>
                    <SelectItem value="bdr_checkin">BDR Check-in</SelectItem>
                    <SelectItem value="fr_checkin">FR Check-in</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="potential_lead">Potential Lead</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {type === "call" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Duration (e.g. 3:45)</label>
              <Input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="0:00" className="bg-background border-border" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes / Summary</label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed?" rows={3} className="bg-background border-border resize-none" />
          </div>
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
            disabled={createLog.isPending}
            onClick={() => createLog.mutate({
              facilityId,
              contactType: type as any,
              contactDate: new Date(date).toISOString(),
              callResult: type === "call" ? (callResult as any) : undefined,
              callDuration: type === "call" && duration ? duration : undefined,
              callType: type === "call" ? (callType as any) : undefined,
              summary: summary || undefined,
            })}
          >
            {createLog.isPending ? "Saving..." : "Save Contact Log"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({ facilityId, onSuccess }: { facilityId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const utils = trpc.useUtils();
  const createTask = trpc.crm.tasks.create.useMutation({
    onSuccess: () => {
      toast.success("Task created");
      utils.crm.tasks.listByFacility.invalidate({ facilityId });
      setOpen(false); setTitle(""); setDescription(""); setDueDate("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 border-border">
          <Plus className="w-3.5 h-3.5" /> Add Task
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Task Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up with Dr. Smith" className="bg-background border-border" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="bg-background border-border resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
            disabled={!title || createTask.isPending}
            onClick={() => createTask.mutate({
              facilityId,
              title,
              description: description || undefined,
              dueDate: dueDate ? new Date(dueDate + "T00:00:00").toISOString() : undefined,
              priority: priority as any,
            })}
          >
            {createTask.isPending ? "Creating..." : "Create Task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddReferralDialog({ facilityId, onSuccess }: { facilityId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [referralDate, setReferralDate] = useState(new Date().toISOString().slice(0, 10));
  const [caseValue, setCaseValue] = useState("medium");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();
  const createReferral = trpc.crm.referrals.create.useMutation({
    onSuccess: () => {
      toast.success("Referral recorded");
      utils.crm.referrals.list.invalidate({ facilityId });
      utils.crm.facilities.get.invalidate({ id: facilityId });
      setOpen(false); setClientName(""); setNotes("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 border-border">
          <Plus className="w-3.5 h-3.5" /> Add Referral
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader><DialogTitle>Record Referral</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Client Name *</label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="John Doe" className="bg-background border-border" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Referral Date</label>
              <Input type="date" value={referralDate} onChange={(e) => setReferralDate(e.target.value)} className="bg-background border-border" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Case Value</label>
              <Select value={caseValue} onValueChange={setCaseValue}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rank_x">Rank X</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="na">N/A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-background border-border resize-none" />
          </div>
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
            disabled={!clientName || createReferral.isPending}
            onClick={() => createReferral.mutate({
              facilityId,
              clientName,
              referralDate: new Date(referralDate).toISOString(),
              caseValue: caseValue as any,
              notes: notes || undefined,
            })}
          >
            {createReferral.isPending ? "Saving..." : "Record Referral"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Leads Tab ───────────────────────────────────────────────────────────────
function LeadsTab({ facilityId }: { facilityId: number }) {
  const utils = trpc.useUtils();
  const { data: leads = [], isLoading } = trpc.crm.facilityLeads.list.useQuery({ facilityId });
  const createLead = trpc.crm.facilityLeads.create.useMutation({
    onSuccess: () => { utils.crm.facilityLeads.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); toast.success("Lead recorded"); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateLead = trpc.crm.facilityLeads.update.useMutation({
    onSuccess: () => { utils.crm.facilityLeads.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); toast.success("Lead updated"); },
  });
  const deleteLead = trpc.crm.facilityLeads.delete.useMutation({
    onSuccess: () => { utils.crm.facilityLeads.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); toast.success("Lead removed"); },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ direction: "received_from_facility" as "sent_to_facility" | "received_from_facility", leadDate: new Date().toISOString().slice(0,10), method: "phone_call", contactPerson: "", clientArea: "", outcome: "pending", signedCase: 0, notes: "", repName: "" });
  const resetForm = () => setForm({ direction: "received_from_facility", leadDate: new Date().toISOString().slice(0,10), method: "phone_call", contactPerson: "", clientArea: "", outcome: "pending", signedCase: 0, notes: "", repName: "" });
  const received = (leads as any[]).filter((l) => l.direction === "received_from_facility");
  const sent = (leads as any[]).filter((l) => l.direction === "sent_to_facility");
  const signed = (leads as any[]).filter((l) => l.signedCase === 1);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{label:"Received",value:received.length,color:"text-emerald-400"},{label:"Sent",value:sent.length,color:"text-blue-400"},{label:"Signed Cases",value:signed.length,color:"text-yellow-400"}].map(s=><Card key={s.label} className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className={`text-2xl font-bold ${s.color}`}>{s.value}</p></CardContent></Card>)}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Lead History</h3>
        <Button size="sm" variant="outline" className="gap-1.5 border-border" onClick={()=>setOpen(true)}><Plus className="w-3.5 h-3.5"/>Add Lead</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (leads as any[]).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30"/><p>No leads recorded yet.</p></div>
      ) : (
        <div className="space-y-2">{(leads as any[]).map((lead)=>(
          <Card key={lead.id} className="bg-card border-border"><CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{lead.direction==="received_from_facility"?"Received from facility":"Sent to facility"}</span>
                  <Badge variant="outline" className={`text-xs border-border ${lead.outcome==="signed"?"text-emerald-400":lead.outcome==="pending"?"text-amber-400":"text-slate-400"}`}>{lead.outcome}</Badge>
                  {lead.signedCase===1&&<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">✓ Signed</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{lead.leadDate?new Date(lead.leadDate).toLocaleDateString():""}</span>
                </div>
                {lead.clientArea&&<p className="text-xs text-muted-foreground mt-0.5">Area: {lead.clientArea}</p>}
                {lead.repName&&<p className="text-xs text-muted-foreground">Rep: {lead.repName}</p>}
                {lead.notes&&<p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
                {lead.outcome==="pending"&&<button className="mt-1 text-xs text-emerald-400 hover:text-emerald-300" onClick={()=>updateLead.mutate({id:lead.id,outcome:"signed",signedCase:1})}>Mark as Signed</button>}
              </div>
              <button onClick={()=>deleteLead.mutate({id:lead.id})} className="text-muted-foreground hover:text-red-400"><Trash2 className="w-4 h-4"/></button>
            </div>
          </CardContent></Card>
        ))}</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle>Record Lead</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Direction</label>
                <Select value={form.direction} onValueChange={(v:any)=>setForm(f=>({...f,direction:v}))}><SelectTrigger className="bg-background border-border"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="received_from_facility">Received from Facility</SelectItem><SelectItem value="sent_to_facility">Sent to Facility</SelectItem></SelectContent></Select>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Date</label><Input type="date" value={form.leadDate} onChange={e=>setForm(f=>({...f,leadDate:e.target.value}))} className="bg-background border-border"/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Outcome</label>
                <Select value={form.outcome} onValueChange={v=>setForm(f=>({...f,outcome:v}))}><SelectTrigger className="bg-background border-border"><SelectValue/></SelectTrigger><SelectContent>{["pending","signed","not_signed","not_qualified","duplicate","unknown"].map(t=><SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Client Area</label><Input placeholder="e.g. Pomona" value={form.clientArea} onChange={e=>setForm(f=>({...f,clientArea:e.target.value}))} className="bg-background border-border"/></div>
            </div>
            <div className="flex items-center gap-2"><input type="checkbox" id="signed-cb" checked={form.signedCase===1} onChange={e=>setForm(f=>({...f,signedCase:e.target.checked?1:0,outcome:e.target.checked?"signed":f.outcome}))} className="rounded"/><label htmlFor="signed-cb" className="text-sm">Signed Case</label></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">BD Rep</label><Input value={form.repName} onChange={e=>setForm(f=>({...f,repName:e.target.value}))} className="bg-background border-border"/></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Notes</label><Textarea rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="bg-background border-border resize-none"/></div>
            <Button className="w-full" style={{background:"var(--gold)",color:"var(--gold-foreground)"}} disabled={createLead.isPending} onClick={()=>createLead.mutate({facilityId,...form,method:form.method as any,outcome:form.outcome as any})}>{createLead.isPending?"Saving...":"Save Lead"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Lead Capture Tab (per-facility intake → lead_intake) ────────────────────
const LEAD_FIELDS = [
  { key: "leadName", label: "Lead Name", required: true },
  { key: "leadDate", label: "Date", type: "date" },
  { key: "value", label: "Value" },
  { key: "outcome", label: "Outcome" },
  { key: "classification", label: "Classification" },
  { key: "disposition", label: "Disposition" },
  { key: "sud", label: "SUD" },
  { key: "liability", label: "Liability" },
  { key: "clientLocation", label: "Client's Location" },
  { key: "role", label: "Role" },
  { key: "member", label: "Member" },
  { key: "fvDocumentation", label: "FV Documentation" },
] as const;

function LeadCaptureTab({ facility }: { facility: any }) {
  const utils = trpc.useUtils();
  const { data: all = [], isLoading } = trpc.crm.leadIntake.list.useQuery();
  const facilityName = (facility.name ?? "").trim();
  const leads = (all as any[]).filter(
    (l) => (l.facility ?? "").trim().toLowerCase() === facilityName.toLowerCase(),
  );
  const signed = leads.filter((l) => /sign/i.test(l.outcome ?? "")).length;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const openForm = () => {
    setForm({
      leadDate: new Date().toISOString().slice(0, 10),
      facility: facilityName,
      typeOfFacility: CATEGORY_LABELS[facility.category] ?? facility.category ?? "",
      clientLocation: facility.city ?? "",
    });
    setOpen(true);
  };

  const create = trpc.crm.leadIntake.create.useMutation({
    onSuccess: () => { toast.success("Lead captured"); utils.crm.leadIntake.list.invalidate(); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.crm.leadIntake.delete.useMutation({
    onSuccess: () => { utils.crm.leadIntake.list.invalidate(); toast.success("Lead removed"); },
  });

  const submit = () => {
    if (!form.leadName?.trim()) { toast.error("Lead Name is required."); return; }
    const payload: Record<string, string> = { facility: facilityName };
    if (form.typeOfFacility?.trim()) payload.typeOfFacility = form.typeOfFacility.trim();
    for (const f of LEAD_FIELDS) { const v = form[f.key]?.trim(); if (v) payload[f.key] = v; }
    create.mutate(payload as any);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Captured", value: leads.length },
          { label: "Signed", value: signed },
          { label: "Pending", value: leads.length - signed },
        ].map((s) => (
          <div key={s.label} className={PANEL}>
            <p className="font-display text-3xl text-foreground leading-none">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Captured Leads <span className="font-normal text-muted-foreground">· this facility</span>
        </h3>
        <Button size="sm" className="gap-1.5" onClick={openForm}><Plus className="w-3.5 h-3.5" /> Add Lead</Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : leads.length === 0 ? (
        <div className="premium-card text-center py-14 text-muted-foreground">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">No leads captured here yet</p>
          <p className="text-xs mt-1">Click "Add Lead" to log a lead for {facilityName || "this facility"}.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {leads.map((l) => (
            <div key={l.id} className={ROW}>
              <div className="flex items-start gap-3.5">
                <div className={DISC}>
                  <ClipboardList className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{l.leadName}</span>
                    {l.outcome && <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${/sign/i.test(l.outcome) ? TONE.ok : TONE.mute}`}>{l.outcome}</span>}
                    {l.value && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TONE.mute}`}>{l.value}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    {l.leadDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(l.leadDate).toLocaleDateString()}</span>}
                    {l.classification && <span>{l.classification}</span>}
                    {l.disposition && <span>· {l.disposition}</span>}
                    {l.member && <span className="flex items-center gap-1"><User className="w-3 h-3" />{l.member}</span>}
                  </div>
                  {l.clientLocation && <p className="text-xs text-muted-foreground mt-1">Location: {l.clientLocation}</p>}
                </div>
                <button onClick={() => del.mutate({ id: l.id })} className="text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Capture a lead — {facilityName}</DialogTitle></DialogHeader>
          <div className="pt-1">
            <LeadFormFields form={form} setForm={setForm} lockFacility />
          </div>
          <Button className="w-full mt-3 gap-2" disabled={create.isPending} onClick={submit}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save lead
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Gratitude Tab ────────────────────────────────────────────────────────────
function GratitudeTab({ facilityId }: { facilityId: number }) {
  const utils = trpc.useUtils();
  const { data: actions = [], isLoading } = trpc.crm.gratitude.list.useQuery({ facilityId });
  const createAction = trpc.crm.gratitude.create.useMutation({
    onSuccess: () => { utils.crm.gratitude.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); toast.success("Gratitude action recorded"); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteAction = trpc.crm.gratitude.delete.useMutation({
    onSuccess: () => { utils.crm.gratitude.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); toast.success("Action removed"); },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ actionDate: new Date().toISOString().slice(0,10), actionType: "thank_you_call" as any, amount: "", notes: "", repName: "" });
  const resetForm = () => setForm({ actionDate: new Date().toISOString().slice(0,10), actionType: "thank_you_call", amount: "", notes: "", repName: "" });
  const totalSpent = (actions as any[]).reduce((sum,a)=>sum+(parseFloat(a.amount??"0")||0),0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className={PANEL}><p className="font-display text-3xl text-foreground leading-none">{(actions as any[]).length}</p><p className="text-xs text-muted-foreground mt-1.5">Total Actions</p></div>
        <div className={PANEL}><p className="font-display text-3xl text-foreground leading-none">${totalSpent.toFixed(2)}</p><p className="text-xs text-muted-foreground mt-1.5">Total Invested</p></div>
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Gratitude & Relationship Actions</h3>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>setOpen(true)}><Plus className="w-3.5 h-3.5"/>Add Action</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (actions as any[]).length === 0 ? (
        <div className="premium-card text-center py-14 text-muted-foreground"><Gift className="w-10 h-10 mx-auto mb-3 opacity-30"/><p className="font-medium text-foreground">No gratitude actions recorded yet</p></div>
      ) : (
        <div className="space-y-2.5">{(actions as any[]).map((action)=>(
          <div key={action.id} className={ROW}>
            <div className="flex items-start gap-3.5">
              <div className={DISC}><Gift className="w-4 h-4" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold capitalize text-foreground">{action.actionType.replace(/_/g," ")}</span>
                  {action.amount&&<span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE.sun}`}>${parseFloat(action.amount).toFixed(2)}</span>}
                  <span className="text-xs text-muted-foreground ml-auto">{action.actionDate?new Date(action.actionDate).toLocaleDateString():""}</span>
                </div>
                {action.repName&&<p className="text-xs text-muted-foreground mt-0.5">By {action.repName}</p>}
                {action.notes&&<p className="text-sm text-foreground/80 mt-1.5">{action.notes}</p>}
              </div>
              <button onClick={()=>deleteAction.mutate({id:action.id})} className="text-muted-foreground/40 hover:text-[#c2410c] transition-colors shrink-0"><Trash2 className="w-4 h-4"/></button>
            </div>
          </div>
        ))}</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle>Record Gratitude Action</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Action Type</label>
                <Select value={form.actionType} onValueChange={(v:any)=>setForm(f=>({...f,actionType:v}))}><SelectTrigger className="bg-background border-border"><SelectValue/></SelectTrigger><SelectContent>{["thank_you_call","thank_you_sms","visit","meal_delivery","gift","other"].map(t=><SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Date</label><Input type="date" value={form.actionDate} onChange={e=>setForm(f=>({...f,actionDate:e.target.value}))} className="bg-background border-border"/></div>
            </div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Amount Spent ($)</label><Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} className="bg-background border-border"/></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">BD Rep</label><Input value={form.repName} onChange={e=>setForm(f=>({...f,repName:e.target.value}))} className="bg-background border-border"/></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Notes</label><Textarea rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="bg-background border-border resize-none"/></div>
            <Button className="w-full" style={{background:"var(--gold)",color:"var(--gold-foreground)"}} disabled={createAction.isPending} onClick={()=>createAction.mutate({facilityId,...form})}>{createAction.isPending?"Saving...":"Save Action"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Updates / Transcripts Tab ────────────────────────────────────────────────
function UpdatesTab({ facilityId }: { facilityId: number }) {
  const utils = trpc.useUtils();
  const { data: rcStatus } = trpc.crm.ringcentral.status.useQuery();
  const { data: updates = [], isLoading } = trpc.crm.updates.list.useQuery({ facilityId });
  const createUpdate = trpc.crm.updates.create.useMutation({
    onSuccess: () => { utils.crm.updates.list.invalidate({ facilityId }); toast.success("Update saved"); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteUpdate = trpc.crm.updates.delete.useMutation({
    onSuccess: () => { utils.crm.updates.list.invalidate({ facilityId }); toast.success("Update removed"); },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ updateDate: new Date().toISOString().slice(0,10), updateType: "manual_note" as any, rawText: "", summary: "", repName: "" });
  const resetForm = () => setForm({ updateDate: new Date().toISOString().slice(0,10), updateType: "manual_note", rawText: "", summary: "", repName: "" });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Call Transcripts, Notes & Updates</h3>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>setOpen(true)}><Plus className="w-3.5 h-3.5"/>Add Note</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (updates as any[]).length === 0 ? (
        <div className="premium-card text-center py-14 px-6 text-muted-foreground">
          <Phone className="w-10 h-10 mx-auto mb-3 opacity-30"/>
          <p className="font-medium">No call recaps yet</p>
          <p className="text-xs mt-1 max-w-xs mx-auto">Call this facility from RingCentral (desk phone or app). Within a few minutes the call appears here automatically with a transcript and an AI recap.</p>
        </div>
      ) : (
        <div className="space-y-3">{(updates as any[]).map((upd)=>(
          <div key={upd.id} className={ROW}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {upd.updateType === "transcript" ? <Phone className="w-3.5 h-3.5 text-foreground" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    upd.updateType === "transcript" ? TONE.ink
                    : upd.updateType === "sms" ? TONE.ok
                    : upd.updateType === "visit_note" ? TONE.sun
                    : TONE.mute
                  }`}>
                    {upd.updateType === "transcript" ? "Call Transcript" : upd.updateType.replace(/_/g," ")}
                  </span>
                  {upd.repName&&<span className="text-xs text-muted-foreground">by {upd.repName}</span>}
                  <span className="text-xs text-muted-foreground ml-auto">{upd.updateDate?new Date(upd.updateDate).toLocaleString():""}</span>
                </div>
                {/* Summary */}
                {upd.summary && (
                  <div className="rounded-[14px] p-3 mb-2 bg-muted">
                    <p className="text-sm text-foreground leading-relaxed">{upd.summary}</p>
                    {upd.updateType === "transcript" && upd.extractedData && (upd.extractedData.relationshipTone || upd.extractedData.leadsDiscussed || upd.extractedData.contactPerson) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {upd.extractedData.relationshipTone && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            upd.extractedData.relationshipTone === "warm" ? TONE.ok
                            : upd.extractedData.relationshipTone === "cold" ? "tier-cold"
                            : upd.extractedData.relationshipTone === "hostile" ? TONE.bad
                            : TONE.mute
                          }`}>Tone: {upd.extractedData.relationshipTone}</span>
                        )}
                        {upd.extractedData.leadsDiscussed && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TONE.sun}`}>Leads discussed</span>
                        )}
                        {upd.extractedData.contactPerson && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TONE.mute}`}>Spoke with: {upd.extractedData.contactPerson}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Recap — key points (falls back to action items on older recaps) */}
                {upd.updateType === "transcript" && (() => {
                  const points: string[] = (upd.extractedData?.keyPoints?.length ? upd.extractedData.keyPoints : upd.extractedData?.actionItems) ?? [];
                  return points.length > 0 ? (
                    <div className="mb-2 px-1">
                      <p className="text-xs font-semibold text-foreground mb-1.5">Recap</p>
                      <ul className="space-y-1">
                        {points.map((p: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                            <span className="text-sun-ink mt-1 shrink-0 leading-none">•</span>
                            <span className="leading-relaxed">{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
                {/* Tasks */}
                {upd.updateType === "transcript" && (
                  <div className="mb-2 px-1">
                    <p className="text-xs font-semibold text-foreground mb-1.5">Tasks</p>
                    {upd.extractedData?.followUpTasks?.length > 0 ? (
                      <ul className="space-y-1.5">
                        {(upd.extractedData.followUpTasks as Array<{title:string;priority:string;dueInDays:number}>).map((task, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                              task.priority === "high" ? TONE.bad : task.priority === "medium" ? TONE.sun : TONE.mute
                            }`}>{task.priority.toUpperCase()}</span>
                            <span className="text-foreground flex-1 leading-relaxed">{task.title}</span>
                            <span className="text-muted-foreground shrink-0">due in {task.dueInDays}d</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">None</p>
                    )}
                  </div>
                )}
                {/* Commitment made */}
                {upd.updateType === "transcript" && upd.extractedData?.commitmentMade && (
                  <div className={`rounded-[14px] p-2.5 mb-2 flex items-start gap-2 ${TONE.ok}`}>
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p className="text-xs"><span className="font-semibold">Commitment: </span>{upd.extractedData.commitmentMade}</p>
                  </div>
                )}
                {upd.rawText && upd.rawText.trim() && !upd.rawText.startsWith("[") && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                      <FileText className="w-3 h-3 inline" /> View full transcript
                    </summary>
                    <pre className="text-xs text-foreground/70 mt-2 whitespace-pre-wrap font-sans bg-muted rounded-[14px] p-3 max-h-60 overflow-y-auto leading-relaxed">{upd.rawText}</pre>
                  </details>
                )}
              </div>
              {rcStatus?.canManage && (
                <button onClick={()=>deleteUpdate.mutate({id:upd.id})} className="text-muted-foreground/40 hover:text-[#c2410c] transition-colors flex-shrink-0" title="Delete recap (managers only)"><Trash2 className="w-4 h-4"/></button>
              )}
            </div>
          </div>
        ))}</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader><DialogTitle>Add Update / Note</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <Select value={form.updateType} onValueChange={(v:any)=>setForm(f=>({...f,updateType:v}))}><SelectTrigger className="bg-background border-border"><SelectValue/></SelectTrigger><SelectContent>{["transcript","sms","manual_note","visit_note","other"].map(t=><SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Date</label><Input type="date" value={form.updateDate} onChange={e=>setForm(f=>({...f,updateDate:e.target.value}))} className="bg-background border-border"/></div>
            </div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Summary <span className="text-muted-foreground/60">(shown at top)</span></label><Input placeholder="Brief summary..." value={form.summary} onChange={e=>setForm(f=>({...f,summary:e.target.value}))} className="bg-background border-border"/></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Full Text / Transcript <span className="text-muted-foreground/60">(optional)</span></label><Textarea rows={6} placeholder="Paste transcript or full notes here..." value={form.rawText} onChange={e=>setForm(f=>({...f,rawText:e.target.value}))} className="bg-background border-border resize-none"/></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">BD Rep</label><Input value={form.repName} onChange={e=>setForm(f=>({...f,repName:e.target.value}))} className="bg-background border-border"/></div>
            <Button className="w-full" style={{background:"var(--gold)",color:"var(--gold-foreground)"}} disabled={createUpdate.isPending} onClick={()=>createUpdate.mutate({facilityId,...form})}>{createUpdate.isPending?"Saving...":"Save Update"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Expenses tab: per-partner FR/BDR expenses + reimbursement status ──
function ExpensesTab({ facilityId, facilityName }: { facilityId: number; facilityName?: string | null }) {
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.crm.expenses.byFacility.useQuery({ facilityId });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ expenseDate: new Date().toISOString().slice(0, 10), store: "", reason: "", amount: "", cardType: "Company" as "Company" | "Personal", notes: "" });
  const create = trpc.crm.expenses.create.useMutation({ onSuccess: () => { utils.crm.expenses.byFacility.invalidate({ facilityId }); toast.success("Expense added"); setOpen(false); setForm({ expenseDate: new Date().toISOString().slice(0, 10), store: "", reason: "", amount: "", cardType: "Company", notes: "" }); }, onError: (e) => toast.error(e.message) });
  const setStatus = trpc.crm.expenses.setReimbursement.useMutation({ onSuccess: () => utils.crm.expenses.byFacility.invalidate({ facilityId }), onError: (e) => toast.error(e.message) });
  const total = rows.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const STT: Record<string, string> = { pending: TONE.sun, submitted: TONE.mute, approved: TONE.ok };
  const exportCsv = () => {
    const out = [["Date", "Kind", "Store", "Reason", "Amount", "Reimbursement", "Representative"], ...rows.map((e: any) => [e.date ? new Date(e.date).toISOString().slice(0, 10) : "", e.kind, e.store, e.reason, e.amount, e.reimbursementStatus, e.agentName])];
    const csv = out.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `Expenses - ${facilityName ?? facilityId}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">Total: <span className="font-semibold text-foreground">${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span> · {rows.length} expenses</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> Export</Button>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Add Expense</Button>
        </div>
      </div>
      {open && (
        <Card className="border-primary/40"><CardContent className="p-4 grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">Date</label><Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">Amount ($)</label><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="25.00" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">Store / vendor</label><Input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder="Uber Eats" /></div>
          <div><label className="text-xs text-muted-foreground mb-1 block">Category / reason</label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Partner lunch" /></div>
          <div className="col-span-2 flex gap-2"><Button size="sm" disabled={create.isPending} onClick={() => create.mutate({ facilityId, facilityName: facilityName ?? undefined, ...form })}>Save</Button><Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button></div>
        </CardContent></Card>
      )}
      {isLoading ? <Skeleton className="h-32 rounded-[22px]" /> : !rows.length ? (
        <div className="premium-card text-center py-14 text-muted-foreground"><Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" /><p className="font-medium text-foreground">No expenses logged for this partner</p></div>
      ) : (
        <div className="space-y-2">
          {rows.map((e: any) => (
            <div key={`${e.kind}-${e.id}`} className={`${ROW} !py-3 flex items-center justify-between gap-2 text-sm`}>
              <div className="min-w-0"><p className="font-medium text-foreground">${Number(e.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} <span className="font-normal text-muted-foreground">· {e.store || e.reason || "expense"}</span></p><p className="text-[11px] text-muted-foreground">{e.kind} · {e.date ? new Date(e.date).toLocaleDateString() : ""}{e.agentName ? ` · ${e.agentName}` : ""}</p></div>
              <Select value={e.reimbursementStatus} onValueChange={(v) => setStatus.mutate({ kind: e.kind, id: e.id, status: v as any })}>
                <SelectTrigger className={`h-7 w-32 text-xs rounded-full border-0 ${STT[e.reimbursementStatus] ?? ""}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="approved">Approved</SelectItem></SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Referrals Sent / Received tab (facility_leads filtered by direction) ──
function ReferralsDirectionTab({ facilityId, direction, counted }: {
  facilityId: number; direction: "sent_to_facility" | "received_from_facility"; counted: number;
}) {
  const { data: leads = [], isLoading } = trpc.crm.facilityLeads.list.useQuery({ facilityId });
  const rows = (leads as any[]).filter((l) => l.direction === direction);
  const sent = direction === "sent_to_facility";
  if (isLoading) return <Skeleton className="h-32 rounded-[22px] mt-4" />;
  // "Leads Sent" also counts leads logged only as a monthly number, which have no row here.
  const monthlyOnly = sent ? Math.max(0, counted - rows.length) : 0;
  const outcome = (l: any) =>
    l.signedCase ? { label: "Signed", cls: TONE.ok }
    : l.outcome === "not_signed" ? { label: "Not signed", cls: TONE.bad }
    : sent ? { label: "Sent", cls: TONE.mute }
    : { label: "Open", cls: TONE.sun };
  return (
    <div className="mt-4 space-y-2.5">
      <p className="text-sm text-muted-foreground px-1">
        {rows.length} {sent ? "sent to" : "received from"} this partner
        {rows.length > 0 && <> · {rows.filter((l) => l.signedCase).length} signed</>}
        {monthlyOnly > 0 && <> · plus {monthlyOnly} counted in monthly totals only</>}
      </p>
      {!rows.length ? (
        <div className="premium-card text-center py-14 px-6 text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">{sent ? "No referrals sent to this partner yet" : "No referrals received from this partner yet"}</p>
          <p className="text-xs mt-1 max-w-sm mx-auto">
            {sent
              ? "Referrals the team sends out appear here from the outbound referral sheet."
              : "Lead Docket leads that name this partner as the source appear here automatically. A lead that names it differently can be linked from the Sign-ups Report."}
          </p>
        </div>
      ) : rows.map((l) => {
        const o = outcome(l);
        return (
          <div key={l.id} className={`${ROW} flex items-center gap-3.5`}>
            <div className={DISC}>{l.signedCase ? <CheckCircle2 className="w-4 h-4" /> : <User className="w-4 h-4" />}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{l.clientName || l.contactPerson || "Client not recorded"}</p>
              <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                {l.leadDate && <span>{format(new Date(l.leadDate), "MMM d, yyyy")}</span>}
                {l.caseType && <span>· {l.caseType}</span>}
                {l.repName && <span>· {l.repName}</span>}
                {l.externalSource === "leaddocket" && <span>· Lead Docket</span>}
              </p>
            </div>
            <span className={`${PILL} ${o.cls} shrink-0`}>{o.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function FacilityProfile() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const facilityId = parseInt(params.id, 10);
  const utils = trpc.useUtils();

  const { data: facility, isLoading } = trpc.crm.facilities.get.useQuery({ id: facilityId });
  const { data: contactLogs } = trpc.crm.contactLogs.list.useQuery({ facilityId });
  const { data: tasks } = trpc.crm.tasks.listByFacility.useQuery({ facilityId });
  const { data: referrals } = trpc.crm.referrals.list.useQuery({ facilityId });
  const { data: rcStatus } = trpc.crm.ringcentral.status.useQuery();
  const [playLog, setPlayLog] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "overview");

  const completeTask = trpc.crm.tasks.complete.useMutation({
    onSuccess: () => { utils.crm.tasks.listByFacility.invalidate({ facilityId }); toast.success("Task completed"); },
  });
  const deleteTask = trpc.crm.tasks.delete.useMutation({
    onSuccess: () => { utils.crm.tasks.listByFacility.invalidate({ facilityId }); },
  });
  const deleteLog = trpc.crm.contactLogs.delete.useMutation({
    onSuccess: () => { utils.crm.contactLogs.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); },
  });
  const deleteReferral = trpc.crm.referrals.delete.useMutation({
    onSuccess: () => { utils.crm.referrals.list.invalidate({ facilityId }); utils.crm.facilities.get.invalidate({ id: facilityId }); },
  });
  const syncCalls = trpc.crm.ringcentral.syncCalls.useMutation({
    onSuccess: (data) => {
      toast.success(`Synced ${data.synced} calls from RingCentral`);
      utils.crm.contactLogs.list.invalidate({ facilityId });
      utils.crm.facilities.get.invalidate({ id: facilityId });
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleFlag = trpc.crm.facilities.update.useMutation({
    onSuccess: () => { utils.crm.facilities.get.invalidate({ id: facilityId }); },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Facility not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/crm/facilities")}>Back to Facilities</Button>
      </div>
    );
  }

  const status = STATUS_LABELS[facility.partnerStatus] ?? STATUS_LABELS.prospect;
  const openTasks = tasks?.filter((t) => t.status === "open") ?? [];
  const completedTasks = tasks?.filter((t) => t.status === "completed") ?? [];
  const initial = (facility.name?.trim()?.[0] ?? "?").toUpperCase();
  const temp = facilityTemperature(facility, contactLogs, openTasks.length);

  return (
    <div className="max-w-[1200px] mx-auto p-6 lg:p-8 space-y-6">
      {/* Back + header */}
      <div className="space-y-3">
        <button
          onClick={() => navigate("/crm/facilities")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Facilities
        </button>
        <div className="premium-card">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-5 p-6 lg:p-7">
            <div className="flex items-start gap-4 min-w-0">
              <div className="h-14 w-14 rounded-full flex items-center justify-center shrink-0 bg-primary text-primary-foreground font-display text-2xl !font-normal">
                {initial}
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-3xl sm:text-4xl text-foreground leading-[1.08]">{facility.name}</h1>
                <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                  <span className={`${PILL} ${status.color}`}>{status.label}</span>
                  <span className={`${PILL} ${temp.cls}`} title={`${temp.label} partner — ${temp.reason}`}>
                    <temp.Icon className="w-3 h-3" /> {temp.label}
                  </span>
                  {facility.managementFlag === 1 && (
                    <span className={`${PILL} ${TONE.sun}`}><AlertTriangle className="w-3 h-3" /> Flagged</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-2.5 flex items-center gap-x-2.5 gap-y-1 flex-wrap">
                  <span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />{CATEGORY_LABELS[facility.category] ?? facility.category}</span>
                  {facility.city && <><span className="opacity-40">·</span><span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{facility.city}</span></>}
                  {facility.assignedRepName && <><span className="opacity-40">·</span><span className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5" />{facility.assignedRepName}</span></>}
                </p>
                {(facility.phone || facility.website) && (
                  <div className="flex items-center gap-2 mt-3.5 flex-wrap">
                    {/* ClickToCallButton draws its own phone icon. */}
                    {facility.phone && (
                      <ClickToCallButton phoneNumber={facility.phone} facilityId={facilityId} className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                        {facility.phone}
                      </ClickToCallButton>
                    )}
                    {facility.website && (
                      <a href={facility.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-medium text-foreground bg-white/85 dark:bg-white/10 shadow-[inset_0_0_0_1px_var(--edge)] hover:bg-white dark:hover:bg-white/15 transition-colors">
                        <Globe className="w-3.5 h-3.5" /> Website <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
              <RecordFrVisitDialog facilityId={facilityId} onSuccess={() => {}} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => toggleFlag.mutate({ id: facilityId, managementFlag: facility.managementFlag !== 1 })}>
                <Flag className="w-3.5 h-3.5" /> {facility.managementFlag === 1 ? "Clear Flag" : "Flag"}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => navigate(`/crm/facilities/${facilityId}/edit`)}>
                <Edit className="w-3.5 h-3.5" /> Edit
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats — each opens its tab */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: "Leads Sent", value: facility.totalLeads ?? 0, icon: Star, tab: "sent" },
          { label: "Referrals Received", value: facility.totalReferrals ?? 0, icon: Building2, tab: "received" },
          { label: "Open Tasks", value: openTasks.length, icon: ListChecks, tab: "tasks" },
          { label: "Contact Logs", value: contactLogs?.length ?? 0, icon: PhoneCall, tab: "contacts" },
        ].map(({ label, value, icon: Icon, tab }) => (
          <button key={label} type="button" onClick={() => setActiveTab(tab)}
            className={`premium-card p-4 lg:p-5 text-left cursor-pointer hover:-translate-y-0.5 ${activeTab === tab ? "outline-2 -outline-offset-2 outline-sun" : ""}`}>
            <div className={DISC}><Icon className="w-[18px] h-[18px]" /></div>
            <div className="font-display text-4xl text-foreground leading-none mt-4">{value.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1.5">{label}</div>
          </button>
        ))}
      </div>

      {/* Reciprocity nudge — we've sent leads but received none back */}
      {(facility.totalLeads ?? 0) >= 3 && (facility.totalReferrals ?? 0) === 0 && (
        <div className="flex items-start gap-3 rounded-[18px] bg-sun-soft px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-sun-ink shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-sun-ink">One-sided so far.</span>{" "}
            <span className="text-foreground/80">You've sent <strong className="text-foreground">{facility.totalLeads}</strong> leads here but received <strong className="text-foreground">0</strong> referrals back — a good moment to ask for reciprocity on your next touch.</span>
          </div>
        </div>
      )}

      {/* Main tabs — one scrolling row of pills rather than a wrapped block */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-11 p-1 max-w-full overflow-x-auto justify-start">
          <TabsTrigger value="overview" className="flex-none">Overview</TabsTrigger>
          <TabsTrigger value="contacts" className="flex-none">
            Call &amp; Visit Log {contactLogs && contactLogs.length > 0 && <span className="text-[10px] font-semibold bg-foreground/10 px-1.5 py-0.5 rounded-full">{contactLogs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex-none">Expenses</TabsTrigger>
          <TabsTrigger value="tasks" className="flex-none">
            Tasks {openTasks.length > 0 && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TONE.sun}`}>{openTasks.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="sent" className="flex-none">Referrals Sent</TabsTrigger>
          <TabsTrigger value="received" className="flex-none">Referrals Received</TabsTrigger>
          <TabsTrigger value="leads" className="flex-none">Log Lead</TabsTrigger>
          <TabsTrigger value="gratitude" className="flex-none">Gratitude</TabsTrigger>
          <TabsTrigger value="updates" className="flex-none">Call Recaps</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses"><ExpensesTab facilityId={facilityId} facilityName={facility.name} /></TabsContent>
        <TabsContent value="sent"><ReferralsDirectionTab facilityId={facilityId} direction="sent_to_facility" counted={facility.totalLeads ?? 0} /></TabsContent>
        <TabsContent value="received"><ReferralsDirectionTab facilityId={facilityId} direction="received_from_facility" counted={facility.totalReferrals ?? 0} /></TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base font-medium">Facility Info</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {facility.address && <div className="flex gap-2"><MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" /><span>{facility.address}{facility.city ? `, ${facility.city}` : ""}</span></div>}
                {facility.phone && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton icon={false} phoneNumber={facility.phone} facilityId={facilityId} className="text-foreground hover:underline text-sm">{facility.phone}</ClickToCallButton></div>}
                {facility.phone2 && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton icon={false} phoneNumber={facility.phone2} facilityId={facilityId} className="text-foreground hover:underline text-sm">{facility.phone2} <span className="text-muted-foreground text-xs">(alt)</span></ClickToCallButton></div>}
                {facility.phone3 && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton icon={false} phoneNumber={facility.phone3} facilityId={facilityId} className="text-foreground hover:underline text-sm">{facility.phone3} <span className="text-muted-foreground text-xs">(alt 2)</span></ClickToCallButton></div>}
                {facility.website && <div className="flex gap-2"><Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" /><a href={facility.website} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--gold)] truncate">{facility.website}</a></div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base font-medium">Primary Contact</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {facility.contactName && <div className="flex gap-2"><User className="w-4 h-4 text-muted-foreground flex-shrink-0" /><span>{facility.contactName}{facility.contactTitle ? ` · ${facility.contactTitle}` : ""}</span></div>}
                {facility.contactPhone && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton icon={false} phoneNumber={facility.contactPhone} facilityId={facilityId} className="text-foreground hover:underline text-sm">{facility.contactPhone}</ClickToCallButton></div>}
                {facility.contactEmail && <div className="flex gap-2"><Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" /><a href={`mailto:${facility.contactEmail}`} className="hover:text-[var(--gold)]">{facility.contactEmail}</a></div>}
                {facility.assignedRepName && <div className="flex gap-2 pt-2 border-t border-border"><User className="w-4 h-4 text-muted-foreground flex-shrink-0" /><span>BD Rep: <span className="text-foreground font-medium">{facility.assignedRepName}</span></span></div>}
              </CardContent>
            </Card>
          </div>
          {facility.notes && (
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base font-medium">Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{facility.notes}</p></CardContent>
            </Card>
          )}
          {facility.managementNote && (
            <div className="rounded-[22px] bg-sun-soft p-5">
              <p className="text-sm font-semibold flex items-center gap-2 text-sun-ink"><AlertTriangle className="w-4 h-4" />Management Note</p>
              <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed mt-2">{facility.managementNote}</p>
            </div>
          )}
        </TabsContent>

        {/* Contact Log Tab */}
        <TabsContent value="contacts" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">{contactLogs?.length ?? 0} contact entries</h3>
            <div className="flex gap-2">
              {(rcStatus?.connected || (rcStatus?.canManage && rcStatus?.accountConnected)) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={syncCalls.isPending}
                  onClick={() => syncCalls.mutate({ facilityId, daysBack: 30 })}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncCalls.isPending ? "animate-spin" : ""}`} />
                  Sync RingCentral
                </Button>
              )}
              <RecordFrVisitDialog facilityId={facilityId} onSuccess={() => {}} />
              <AddContactLogDialog facilityId={facilityId} onSuccess={() => {}} />
            </div>
          </div>
          {contactLogs?.length === 0 ? (
            <div className="premium-card text-center py-14 text-muted-foreground">
              <PhoneCall className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-foreground">No contact logs yet</p>
              <p className="text-xs mt-1">Log your first call or visit above.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {contactLogs?.map((log) => (
                <div key={log.id} className={ROW}>
                  <div className="flex items-start gap-3.5">
                    <div className={DISC}>
                      {CONTACT_TYPE_ICONS[log.contactType]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold capitalize text-foreground">{log.contactType}</span>
                        {log.callResult && <span className={`text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full ${log.callResult === "connected" ? TONE.ok : TONE.mute}`}>{log.callResult.replace("_", " ")}</span>}
                        {log.callType && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TONE.mute}`}>{log.callType.replace(/_/g, " ")}</span>}
                        {log.callDuration && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{log.callDuration}</span>}
                        {(log as any).fromRingCentral === 1 && log.callResult === "connected" && (
                          <button onClick={() => setPlayLog(playLog === log.id ? null : log.id)} className="text-[11px] font-semibold inline-flex items-center gap-1 text-primary hover:text-primary/80">
                            <Play className="w-3 h-3" /> {playLog === log.id ? "Hide" : "Listen"}
                          </button>
                        )}
                      </div>
                      {log.summary && <p className="text-sm text-foreground/80 mt-1.5 leading-relaxed">{log.summary}</p>}
                      {playLog === log.id && (
                        <audio
                          controls autoPlay className="mt-2 w-full max-w-sm h-9"
                          src={`/api/recording/${log.id}`}
                          onError={() => { toast.error("No recording available for this call."); setPlayLog(null); }}
                        />
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(log.contactDate), "MMM d, yyyy h:mm a")}</span>
                        {log.repName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{log.repName}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteLog.mutate({ id: log.id })}
                      className="text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Leads Tab — per-facility lead capture */}
        <TabsContent value="leads" className="mt-4"><LeadCaptureTab facility={facility} /></TabsContent>
        {/* Gratitude Tab */}
        <TabsContent value="gratitude" className="mt-4"><GratitudeTab facilityId={facilityId} /></TabsContent>
        {/* Updates Tab */}
        <TabsContent value="updates" className="mt-4"><UpdatesTab facilityId={facilityId} /></TabsContent>
        {/* Tasks Tab */}
        <TabsContent value="tasks" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              Tasks <span className="font-normal text-muted-foreground">· {openTasks.length} open · {completedTasks.length} done</span>
            </h3>
            <AddTaskDialog facilityId={facilityId} onSuccess={() => {}} />
          </div>
          {tasks?.length === 0 ? (
            <div className="premium-card text-center py-14 text-muted-foreground">
              <ListChecks className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-foreground">No tasks yet</p>
              <p className="text-xs mt-1">Add a follow-up task to stay on cadence.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {tasks?.map((task) => {
                const isDone = task.status === "completed";
                const overdue = !isDone && !!task.dueDate && new Date(task.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
                const prio = task.priority === "high" ? TONE.bad : task.priority === "low" ? TONE.mute : TONE.sun;
                return (
                  <div key={task.id} className={`${ROW} ${isDone ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-3.5">
                      <button
                        onClick={() => task.status === "open" ? completeTask.mutate({ id: task.id }) : undefined}
                        className="mt-0.5 shrink-0"
                        aria-label={isDone ? "Completed" : "Mark complete"}
                      >
                        {isDone
                          ? <CheckCircle2 className="w-5 h-5 text-[#2f7d4f] dark:text-[#7fcf9f]" />
                          : <Circle className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.title}</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${prio}`}>{task.priority}</span>
                          {overdue && <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${TONE.bad}`}>Overdue</span>}
                        </div>
                        {task.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.description}</p>}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {task.dueDate && <span className={`flex items-center gap-1 ${overdue ? "text-[#c2410c] dark:text-[#e2703f] font-medium" : ""}`}><Calendar className="w-3 h-3" /> {format(new Date(task.dueDate), "MMM d, yyyy")}</span>}
                          {task.assignedToName && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {task.assignedToName}</span>}
                        </div>
                      </div>
                      <button onClick={() => deleteTask.mutate({ id: task.id })} className="text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Referrals Tab */}
        <TabsContent value="referrals" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">{referrals?.length ?? 0} referrals received</h3>
            <AddReferralDialog facilityId={facilityId} onSuccess={() => {}} />
          </div>
          {referrals?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Star className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No referrals recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {referrals?.map((ref) => {
                const cv = CASE_VALUE_LABELS[ref.caseValue] ?? CASE_VALUE_LABELS.medium;
                return (
                  <div key={ref.id} className={ROW}>
                    <div className="flex items-start gap-3.5">
                      <div className={DISC}>
                        <Star className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{ref.clientName}</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary ${cv.color}`}>{cv.label}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(ref.referralDate), "MMM d, yyyy")}</span>
                          {ref.repName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{ref.repName}</span>}
                        </div>
                        {ref.notes && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{ref.notes}</p>}
                      </div>
                      <button onClick={() => deleteReferral.mutate({ id: ref.id })} className="text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Location map ── */}
      {(facility.address || facility.city || (facility.latitude && facility.longitude)) && (() => {
        const q = facility.latitude && facility.longitude
          ? `${facility.latitude},${facility.longitude}`
          : [facility.address, facility.city].filter(Boolean).join(", ");
        return (
          <div className="premium-card overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
              <MapPin className="w-4 h-4 text-foreground shrink-0" />
              <span className="text-sm font-semibold text-foreground">Location</span>
              {(facility.address || facility.city) && (
                <span className="text-xs text-muted-foreground truncate">{[facility.address, facility.city].filter(Boolean).join(", ")}</span>
              )}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
              >
                Open in Maps <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <FacilityLocationMap
              name={facility.name}
              latitude={facility.latitude}
              longitude={facility.longitude}
              address={[facility.address, facility.city].filter(Boolean).join(", ")}
            />
          </div>
        );
      })()}
    </div>
  );
}
