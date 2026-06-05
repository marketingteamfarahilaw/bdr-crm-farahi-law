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
  Plus, CheckCircle2, Circle, Trash2, PhoneCall, Car, MessageSquare,
  Calendar, Clock, Star, Edit, RefreshCw, Building2, Gift, FileText,
  TrendingUp, Flag, ExternalLink, ListChecks, Zap, ChevronDown, ChevronUp
} from "lucide-react";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { formatDistanceToNow, format } from "date-fns";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  prospect: { label: "Prospect", color: "bg-sky-500/20 text-sky-400 border-sky-500/30" },
  active_partner: { label: "Active Partner", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  priority_partner: { label: "Priority Partner", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  needs_follow_up: { label: "Needs Follow-Up", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  dormant: { label: "Dormant", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  do_not_use: { label: "Do Not Use", color: "bg-red-900/30 text-red-300 border-red-900/50" },
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
        <Button size="sm" className="gap-1.5" style={{ background: "var(--gold)", color: "#0a0f1e" }}>
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
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
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
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
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
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
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
            <Button className="w-full" style={{background:"var(--gold)",color:"#0a0f1e"}} disabled={createLead.isPending} onClick={()=>createLead.mutate({facilityId,...form,method:form.method as any,outcome:form.outcome as any})}>{createLead.isPending?"Saving...":"Save Lead"}</Button>
          </div>
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
        <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Actions</p><p className="text-2xl font-bold">{(actions as any[]).length}</p></CardContent></Card>
        <Card className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Invested</p><p className="text-2xl font-bold text-yellow-400">${totalSpent.toFixed(2)}</p></CardContent></Card>
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Gratitude & Relationship Actions</h3>
        <Button size="sm" variant="outline" className="gap-1.5 border-border" onClick={()=>setOpen(true)}><Plus className="w-3.5 h-3.5"/>Add Action</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (actions as any[]).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><Gift className="w-10 h-10 mx-auto mb-3 opacity-30"/><p>No gratitude actions recorded yet.</p></div>
      ) : (
        <div className="space-y-2">{(actions as any[]).map((action)=>(
          <Card key={action.id} className="bg-card border-border"><CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium capitalize">{action.actionType.replace(/_/g," ")}</span>
                  {action.amount&&<Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/30">${parseFloat(action.amount).toFixed(2)}</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{action.actionDate?new Date(action.actionDate).toLocaleDateString():""}</span>
                </div>
                {action.repName&&<p className="text-xs text-muted-foreground">By: {action.repName}</p>}
                {action.notes&&<p className="text-sm text-muted-foreground mt-1">{action.notes}</p>}
              </div>
              <button onClick={()=>deleteAction.mutate({id:action.id})} className="text-muted-foreground hover:text-red-400"><Trash2 className="w-4 h-4"/></button>
            </div>
          </CardContent></Card>
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
            <Button className="w-full" style={{background:"var(--gold)",color:"#0a0f1e"}} disabled={createAction.isPending} onClick={()=>createAction.mutate({facilityId,...form})}>{createAction.isPending?"Saving...":"Save Action"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Updates / Transcripts Tab ────────────────────────────────────────────────
function UpdatesTab({ facilityId }: { facilityId: number }) {
  const utils = trpc.useUtils();
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
        <Button size="sm" variant="outline" className="gap-1.5 border-border" onClick={()=>setOpen(true)}><Plus className="w-3.5 h-3.5"/>Add Note</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (updates as any[]).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Phone className="w-10 h-10 mx-auto mb-3 opacity-30"/>
          <p className="font-medium">No call recaps yet</p>
          <p className="text-xs mt-1 max-w-xs mx-auto">Call this facility from RingCentral (desk phone or app). Within a few minutes the call appears here automatically with a transcript and an AI recap.</p>
        </div>
      ) : (
        <div className="space-y-3">{(updates as any[]).map((upd)=>(
          <Card key={upd.id} className={`border ${upd.updateType === "transcript" ? "bg-blue-950/20 border-blue-500/20" : "bg-card border-border"}`}>
            <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {upd.updateType === "transcript" ? <Phone className="w-3.5 h-3.5 text-blue-400" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    upd.updateType === "transcript" ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    : upd.updateType === "sms" ? "bg-green-500/10 text-green-400 border-green-500/30"
                    : upd.updateType === "visit_note" ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    : "bg-muted text-muted-foreground border-border"
                  }`}>
                    {upd.updateType === "transcript" ? "Call Transcript" : upd.updateType.replace(/_/g," ")}
                  </span>
                  {upd.repName&&<span className="text-xs text-muted-foreground">by {upd.repName}</span>}
                  <span className="text-xs text-muted-foreground ml-auto">{upd.updateDate?new Date(upd.updateDate).toLocaleString():""}</span>
                </div>
                {/* Summary */}
                {upd.summary && (
                  <div className={`rounded-lg p-3 mb-2 ${upd.updateType === "transcript" ? "bg-blue-500/10" : "bg-muted/30"}`}>
                    <p className="text-sm text-foreground leading-relaxed">{upd.summary}</p>
                    {upd.updateType === "transcript" && upd.extractedData && (upd.extractedData.relationshipTone || upd.extractedData.leadsDiscussed || upd.extractedData.contactPerson) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {upd.extractedData.relationshipTone && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                            upd.extractedData.relationshipTone === "warm" ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : upd.extractedData.relationshipTone === "cold" ? "bg-blue-500/10 text-blue-300 border-blue-500/20"
                            : upd.extractedData.relationshipTone === "hostile" ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-muted text-muted-foreground border-border"
                          }`}>Tone: {upd.extractedData.relationshipTone}</span>
                        )}
                        {upd.extractedData.leadsDiscussed && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">Leads discussed</span>
                        )}
                        {upd.extractedData.contactPerson && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-muted text-muted-foreground border-border">Spoke with: {upd.extractedData.contactPerson}</span>
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
                            <span className="text-blue-400 mt-1 shrink-0 leading-none">•</span>
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
                            <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              task.priority === "high" ? "bg-red-500/20 text-red-400"
                              : task.priority === "medium" ? "bg-amber-500/20 text-amber-400"
                              : "bg-muted text-muted-foreground"
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
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2.5 mb-2 flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-green-300"><span className="font-semibold">Commitment: </span>{upd.extractedData.commitmentMade}</p>
                  </div>
                )}
                {upd.rawText && upd.rawText.trim() && !upd.rawText.startsWith("[") && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-1">
                      <FileText className="w-3 h-3 inline" /> View full transcript
                    </summary>
                    <pre className="text-xs text-foreground/70 mt-2 whitespace-pre-wrap font-sans bg-muted/30 rounded p-3 max-h-60 overflow-y-auto leading-relaxed">{upd.rawText}</pre>
                  </details>
                )}
              </div>
              <button onClick={()=>deleteUpdate.mutate({id:upd.id})} className="text-muted-foreground hover:text-red-400 flex-shrink-0"><Trash2 className="w-4 h-4"/></button>
            </div>
          </CardContent></Card>
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
            <Button className="w-full" style={{background:"var(--gold)",color:"#0a0f1e"}} disabled={createUpdate.isPending} onClick={()=>createUpdate.mutate({facilityId,...form})}>{createUpdate.isPending?"Saving...":"Save Update"}</Button>
          </div>
        </DialogContent>
      </Dialog>
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

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Back + Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate("/crm/facilities")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Facilities
          </button>
          <div className="flex items-center gap-3">
            {facility.managementFlag === 1 && <AlertTriangle className="w-5 h-5 text-amber-400" />}
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              {facility.name}
            </h1>
            <Badge className={`border ${status.color}`}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {CATEGORY_LABELS[facility.category] ?? facility.category}
            {facility.city ? ` · ${facility.city}` : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-border"
            onClick={() => toggleFlag.mutate({ id: facilityId, managementFlag: facility.managementFlag !== 1 })}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {facility.managementFlag === 1 ? "Clear Flag" : "Flag"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-border"
            onClick={() => navigate(`/crm/facilities/${facilityId}/edit`)}
          >
            <Edit className="w-3.5 h-3.5" /> Edit
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Leads Sent", value: facility.totalLeads ?? 0, icon: Star },
          { label: "Referrals Received", value: facility.totalReferrals ?? 0, icon: Building2 },
          { label: "Open Tasks", value: openTasks.length, icon: Circle },
          { label: "Contact Logs", value: contactLogs?.length ?? 0, icon: PhoneCall },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reciprocity nudge — we've sent leads but received none back */}
      {(facility.totalLeads ?? 0) >= 3 && (facility.totalReferrals ?? 0) === 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="text-base leading-none">⚠️</span>
          <div>
            <span className="font-medium text-amber-600 dark:text-amber-400">One-sided so far.</span>{" "}
            <span className="text-muted-foreground">You've sent <strong className="text-foreground">{facility.totalLeads}</strong> leads here but received <strong className="text-foreground">0</strong> referrals back — a good moment to ask for reciprocity on your next touch.</span>
          </div>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-card border border-border flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">
            Contact Log {contactLogs && contactLogs.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full">{contactLogs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="gratitude">Gratitude</TabsTrigger>
          <TabsTrigger value="updates">Call Recaps</TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks {openTasks.length > 0 && <span className="ml-1.5 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">{openTasks.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="referrals">
            Referrals {referrals && referrals.length > 0 && <span className="ml-1.5 text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">{referrals.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Facility Info</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {facility.address && <div className="flex gap-2"><MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" /><span>{facility.address}{facility.city ? `, ${facility.city}` : ""}</span></div>}
                {facility.phone && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton phoneNumber={facility.phone} facilityId={facilityId} className="hover:text-[var(--gold)] text-sm">{facility.phone}</ClickToCallButton></div>}
                {facility.phone2 && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton phoneNumber={facility.phone2} facilityId={facilityId} className="hover:text-[var(--gold)] text-sm">{facility.phone2} <span className="text-muted-foreground text-xs">(alt)</span></ClickToCallButton></div>}
                {facility.phone3 && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton phoneNumber={facility.phone3} facilityId={facilityId} className="hover:text-[var(--gold)] text-sm">{facility.phone3} <span className="text-muted-foreground text-xs">(alt 2)</span></ClickToCallButton></div>}
                {facility.website && <div className="flex gap-2"><Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" /><a href={facility.website} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--gold)] truncate">{facility.website}</a></div>}
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Primary Contact</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {facility.contactName && <div className="flex gap-2"><User className="w-4 h-4 text-muted-foreground flex-shrink-0" /><span>{facility.contactName}{facility.contactTitle ? ` · ${facility.contactTitle}` : ""}</span></div>}
                {facility.contactPhone && <div className="flex gap-2 items-center"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" /><ClickToCallButton phoneNumber={facility.contactPhone} facilityId={facilityId} className="hover:text-[var(--gold)] text-sm">{facility.contactPhone}</ClickToCallButton></div>}
                {facility.contactEmail && <div className="flex gap-2"><Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" /><a href={`mailto:${facility.contactEmail}`} className="hover:text-[var(--gold)]">{facility.contactEmail}</a></div>}
                {facility.assignedRepName && <div className="flex gap-2 pt-2 border-t border-border"><User className="w-4 h-4 text-muted-foreground flex-shrink-0" /><span>BD Rep: <span className="text-foreground font-medium">{facility.assignedRepName}</span></span></div>}
              </CardContent>
            </Card>
          </div>
          {facility.notes && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{facility.notes}</p></CardContent>
            </Card>
          )}
          {facility.managementNote && (
            <Card className="bg-amber-500/10 border-amber-500/30">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2 text-amber-400"><AlertTriangle className="w-4 h-4" />Management Note</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-amber-300 whitespace-pre-wrap">{facility.managementNote}</p></CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Contact Log Tab */}
        <TabsContent value="contacts" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">{contactLogs?.length ?? 0} contact entries</h3>
            <div className="flex gap-2">
              {rcStatus?.connected && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-border"
                  disabled={syncCalls.isPending}
                  onClick={() => syncCalls.mutate({ facilityId, daysBack: 30 })}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncCalls.isPending ? "animate-spin" : ""}`} />
                  Sync RingCentral
                </Button>
              )}
              <AddContactLogDialog facilityId={facilityId} onSuccess={() => {}} />
            </div>
          </div>
          {contactLogs?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <PhoneCall className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No contact logs yet. Log your first contact above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactLogs?.map((log) => (
                <Card key={log.id} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground">
                          {CONTACT_TYPE_ICONS[log.contactType]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium capitalize">{log.contactType}</span>
                            {log.callResult && (
                              <Badge variant="outline" className="text-xs capitalize border-border">
                                {log.callResult.replace("_", " ")}
                              </Badge>
                            )}
                            {log.callType && (
                              <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                                {log.callType.replace(/_/g, " ")}
                              </Badge>
                            )}
                            {log.callDuration && <span className="text-xs text-muted-foreground">{log.callDuration}</span>}
                          </div>
                          {log.summary && <p className="text-sm text-muted-foreground mt-1">{log.summary}</p>}
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span>{format(new Date(log.contactDate), "MMM d, yyyy h:mm a")}</span>
                            {log.repName && <span>· {log.repName}</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteLog.mutate({ id: log.id })}
                        className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Leads Tab */}
        <TabsContent value="leads" className="mt-4"><LeadsTab facilityId={facilityId} /></TabsContent>
        {/* Gratitude Tab */}
        <TabsContent value="gratitude" className="mt-4"><GratitudeTab facilityId={facilityId} /></TabsContent>
        {/* Updates Tab */}
        <TabsContent value="updates" className="mt-4"><UpdatesTab facilityId={facilityId} /></TabsContent>
        {/* Tasks Tab */}
        <TabsContent value="tasks" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">{openTasks.length} open · {completedTasks.length} completed</h3>
            <AddTaskDialog facilityId={facilityId} onSuccess={() => {}} />
          </div>
          {tasks?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No tasks yet. Add a follow-up task above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks?.map((task) => (
                <Card key={task.id} className={`bg-card border-border ${task.status === "completed" ? "opacity-60" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => task.status === "open" ? completeTask.mutate({ id: task.id }) : undefined}
                        className="mt-0.5 flex-shrink-0"
                      >
                        {task.status === "completed"
                          ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          : <Circle className="w-5 h-5 text-muted-foreground hover:text-emerald-400 transition-colors" />
                        }
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{task.title}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs border-border ${task.priority === "high" ? "text-red-400 border-red-400/30" : task.priority === "low" ? "text-slate-400" : "text-amber-400 border-amber-400/30"}`}
                          >
                            {task.priority}
                          </Badge>
                        </div>
                        {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {task.dueDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Due {format(new Date(task.dueDate), "MMM d, yyyy")}</span>}
                          {task.assignedToName && <span>· {task.assignedToName}</span>}
                        </div>
                      </div>
                      <button onClick={() => deleteTask.mutate({ id: task.id })} className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
            <div className="space-y-2">
              {referrals?.map((ref) => {
                const cv = CASE_VALUE_LABELS[ref.caseValue] ?? CASE_VALUE_LABELS.medium;
                return (
                  <Card key={ref.id} className="bg-card border-border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{ref.clientName}</span>
                            <span className={`text-xs font-medium ${cv.color}`}>{cv.label}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{format(new Date(ref.referralDate), "MMM d, yyyy")}</span>
                            {ref.repName && <span>· {ref.repName}</span>}
                          </div>
                          {ref.notes && <p className="text-xs text-muted-foreground mt-1">{ref.notes}</p>}
                        </div>
                        <button onClick={() => deleteReferral.mutate({ id: ref.id })} className="text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
