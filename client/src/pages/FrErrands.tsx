import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { BdrFilterBar, BdrFilterValues } from "@/components/BdrFilterBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, ClipboardList } from "lucide-react";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];
const TIERS = ["Standard", "Medium", "High", "Rank X"] as const;
const STATUSES = ["In Progress", "Completed", "Not Completed"] as const;
const TASK_TYPES = [
  "Acquire video footage",
  "Welfare check",
  "Get witness statement",
  "Deliver documents",
  "Follow-up visit",
  "Other",
];

type FormData = {
  errandDate: string;
  clientName: string;
  tier: typeof TIERS[number];
  taskType: string;
  agentName: string;
  status: typeof STATUSES[number];
  address: string;
  notes: string;
};

const defaultForm: FormData = {
  errandDate: new Date().toISOString().split("T")[0],
  clientName: "",
  tier: "Standard",
  taskType: "",
  agentName: "",
  status: "In Progress",
  address: "",
  notes: "",
};

const statusColors: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  "In Progress": "bg-amber-100 text-amber-800 border-amber-200",
  "Not Completed": "bg-red-100 text-red-800 border-red-200",
};

export default function FrErrands() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState<BdrFilterValues>({});

  const queryInput = isAdmin
    ? (Object.keys(filters).length > 0 ? filters : undefined)
    : { agent: (user as any)?.agentName ?? undefined };

  const { data: errands, isLoading } = trpc.bdr.frErrands.list.useQuery(queryInput);
  const createMutation = trpc.bdr.frErrands.create.useMutation({
    onSuccess: () => { utils.bdr.frErrands.list.invalidate(); toast.success("Errand added"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.frErrands.update.useMutation({
    onSuccess: () => { utils.bdr.frErrands.list.invalidate(); toast.success("Errand updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.frErrands.delete.useMutation({
    onSuccess: () => { utils.bdr.frErrands.list.invalidate(); toast.success("Errand deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);

  function openCreate() { setEditing(null); setForm({ ...defaultForm, agentName: isAdmin ? "" : ((user as any)?.agentName ?? "") }); setOpen(true); }

  function openEdit(e: NonNullable<typeof errands>[0]) {
    setEditing(e.id);
    setForm({
      errandDate: e.errandDate ? new Date(e.errandDate).toISOString().split("T")[0] : "",
      clientName: e.clientName,
      tier: (e.clientTier as typeof TIERS[number]) ?? "Standard",
      taskType: e.taskType,
      agentName: e.agentName ?? "",
      status: (e.status as typeof STATUSES[number]) ?? "In Progress",
      address: e.address ?? "",
      notes: e.notes ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!form.clientName) return toast.error("Client name required");
    if (!form.taskType) return toast.error("Task type required");
    if (editing !== null) {
      updateMutation.mutate({ id: editing, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const completed = errands?.filter(e => e.status === "Completed").length ?? 0;
  const inProgress = errands?.filter(e => e.status === "In Progress").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FR Errands</h1>
          <p className="text-muted-foreground text-sm mt-1">Field errands per client — welfare checks, video footage, witness statements</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Errand</Button>
      </div>

      <BdrFilterBar
        filters={filters}
        onChange={setFilters}
        show={{ agent: true, dateRange: true, year: true, status: true, search: true }}
        statusOptions={["In Progress", "Completed", "Not Completed"]}
        showAgentFilter={isAdmin}
      />

      {errands && errands.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <ClipboardList className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <ClipboardList className="w-8 h-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{inProgress}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <ClipboardList className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{errands.length}</p>
                <p className="text-xs text-muted-foreground">Total Errands</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Errand Log {errands ? `(${errands.length})` : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !errands || errands.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No errands found. Adjust filters or click "Add Errand".</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errands.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.errandDate ? new Date(e.errandDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="font-medium">{e.clientName}</TableCell>
                    <TableCell><Badge variant="secondary">{e.clientTier}</Badge></TableCell>
                    <TableCell className="max-w-[140px] truncate">{e.taskType}</TableCell>
                    <TableCell><Badge variant="outline">{e.agentName ?? "—"}</Badge></TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColors[e.status] ?? ""}`}>
                        {e.status}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate text-muted-foreground">{e.address ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate({ id: e.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing !== null ? "Edit Errand" : "Add FR Errand"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" value={form.errandDate} onChange={(e) => setForm({ ...form, errandDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Client Name *</Label>
                <Input placeholder="Client full name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Tier</Label>
                <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v as typeof TIERS[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Task Type *</Label>
                <Select value={form.taskType} onValueChange={(v) => setForm({ ...form, taskType: v })}>
                  <SelectTrigger><SelectValue placeholder="Select task" /></SelectTrigger>
                  <SelectContent>{TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Agent</Label>
                {isAdmin ? (
                  <Select value={form.agentName} onValueChange={(v) => setForm({ ...form, agentName: v })}>
                    <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>{AGENTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.agentName} disabled className="bg-muted" />
                )}
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof STATUSES[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input placeholder="Client address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editing !== null ? "Save Changes" : "Add Errand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
