import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Building2, Phone, ClipboardList, ArrowLeft, Search } from "lucide-react";

// Open from anywhere: dispatch `new CustomEvent("open-quick-add")`.
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "call" | "task">("menu");
  const [facility, setFacility] = useState<{ id: number; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskDue, setTaskDue] = useState("");
  const [callResult, setCallResult] = useState("connected");
  const [callSummary, setCallSummary] = useState("");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  useEffect(() => {
    const h = () => { setOpen(true); setMode("menu"); };
    document.addEventListener("open-quick-add", h);
    return () => document.removeEventListener("open-quick-add", h);
  }, []);

  const { data: facilities } = trpc.crm.facilities.list.useQuery(
    { search: q },
    { enabled: open && !facility && mode !== "menu" && q.trim().length >= 2 },
  );

  function reset() {
    setOpen(false); setMode("menu"); setFacility(null); setQ("");
    setTaskTitle(""); setTaskDue(""); setTaskPriority("medium"); setCallResult("connected"); setCallSummary("");
  }

  const createTask = trpc.crm.tasks.create.useMutation({
    onSuccess: () => { toast.success("Task added"); utils.crm.tasks.listMine.invalidate(); utils.crm.tasks.listByFacility.invalidate(); reset(); },
    onError: (e) => toast.error(e.message),
  });
  const createLog = trpc.crm.contactLogs.create.useMutation({
    onSuccess: () => { toast.success("Call logged"); utils.crm.contactLogs.list.invalidate(); utils.crm.activity.recent.invalidate(); reset(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            {mode !== "menu" && (
              <button onClick={() => (facility ? setFacility(null) : setMode("menu"))} className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {mode === "menu" ? "Quick Add" : mode === "call" ? "Log a Call" : "Add a Task"}
          </DialogTitle>
        </DialogHeader>

        {mode === "menu" && (
          <div className="grid gap-2">
            <button onClick={() => { reset(); navigate("/crm/facilities/new"); }} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary text-left transition-colors">
              <Building2 className="w-5 h-5 text-primary" /><div><div className="text-sm font-medium text-foreground">New Facility</div><div className="text-xs text-muted-foreground">Add a partner facility</div></div>
            </button>
            <button onClick={() => setMode("call")} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary text-left transition-colors">
              <Phone className="w-5 h-5 text-cyan-400" /><div><div className="text-sm font-medium text-foreground">Log a Call</div><div className="text-xs text-muted-foreground">Record a contact on a facility</div></div>
            </button>
            <button onClick={() => setMode("task")} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary text-left transition-colors">
              <ClipboardList className="w-5 h-5 text-orange-400" /><div><div className="text-sm font-medium text-foreground">Add a Task</div><div className="text-xs text-muted-foreground">Create a follow-up on a facility</div></div>
            </button>
          </div>
        )}

        {mode !== "menu" && !facility && (
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input autoFocus placeholder="Search a facility…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {(facilities ?? []).slice(0, 10).map((f: any) => (
                <button key={f.id} onClick={() => setFacility({ id: f.id, name: f.name })} className="w-full text-left rounded-lg px-3 py-2 hover:bg-secondary text-sm text-foreground transition-colors">
                  {f.name}{f.city ? <span className="text-xs text-muted-foreground"> · {f.city}</span> : null}
                </button>
              ))}
              {q.trim().length < 2 && <p className="text-xs text-muted-foreground px-1 py-2">Type at least 2 letters to find a facility…</p>}
              {q.trim().length >= 2 && (facilities ?? []).length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No facilities found.</p>}
            </div>
          </div>
        )}

        {mode === "call" && facility && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Facility: <span className="font-medium text-foreground">{facility.name}</span></div>
            <Select value={callResult} onValueChange={setCallResult}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="connected">Connected</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
                <SelectItem value="no_answer">No Answer</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <textarea value={callSummary} onChange={(e) => setCallSummary(e.target.value)} placeholder="Notes / summary…" rows={3} className="w-full rounded-lg border border-border bg-background p-2 text-sm" />
            <Button className="w-full" disabled={createLog.isPending} onClick={() => createLog.mutate({ facilityId: facility.id, contactType: "call", contactDate: new Date().toISOString(), callResult: callResult as any, callType: "partner_checkin", summary: callSummary || undefined })}>
              {createLog.isPending ? "Saving…" : "Log Call"}
            </Button>
          </div>
        )}

        {mode === "task" && facility && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Facility: <span className="font-medium text-foreground">{facility.name}</span></div>
            <Input placeholder="What needs doing?" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <Select value={taskPriority} onValueChange={setTaskPriority}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
              </Select>
              <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="flex-1" />
            </div>
            <Button className="w-full" disabled={createTask.isPending || !taskTitle} onClick={() => createTask.mutate({ facilityId: facility.id, title: taskTitle, priority: taskPriority as any, dueDate: taskDue ? new Date(taskDue).toISOString() : undefined })}>
              {createTask.isPending ? "Saving…" : "Add Task"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
