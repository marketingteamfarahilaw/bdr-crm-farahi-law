import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
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
import { Plus, Pencil, Trash2, Network, CheckCircle2, Clock, XCircle, Send, CircleDashed, Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];
const STATUSES = ["Pending", "In Progress", "Successful Sent", "Demo Sent", "Unsuccessful"] as const;
const PARTNER_STATUSES = ["Partner", "Non-Partner", "Prospect"];
const FACILITY_TYPES = ["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"];

type FormData = {
  reportMonth: string;
  clientName: string;
  pdCoordinator: string;
  partnerStatus: string;
  facilityName: string;
  facilityType: string;
  bdrAgent: string;
  status: typeof STATUSES[number];
  notes: string;
};

const defaultForm: FormData = {
  reportMonth: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  clientName: "",
  pdCoordinator: "",
  partnerStatus: "Prospect",
  facilityName: "",
  facilityType: "Chiro",
  bdrAgent: "",
  status: "Pending",
  notes: "",
};

const statusColors: Record<string, string> = {
  "Successful Sent": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  "Demo Sent": "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  "In Progress": "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "Pending": "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  "Unsuccessful": "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

const statusIcons: Record<string, LucideIcon> = {
  "Successful Sent": CheckCircle2,
  "Demo Sent": Send,
  "In Progress": Clock,
  "Pending": CircleDashed,
  "Unsuccessful": XCircle,
};

export default function ReferralTracker() {
  const { user } = useAuth();
  const isAdmin = seesAllData(user?.role);
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState<BdrFilterValues>({});

  const queryInput = isAdmin
    ? (Object.keys(filters).length > 0 ? filters : undefined)
    : { agent: (user as any)?.agentName ?? undefined };

  const { data: trackers, isLoading } = trpc.bdr.referralTracker.list.useQuery(queryInput);
  const createMutation = trpc.bdr.referralTracker.create.useMutation({
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Tracker entry added"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.referralTracker.update.useMutation({
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Tracker entry updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.referralTracker.delete.useMutation({
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Tracker entry deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);

  function openCreate() { setEditing(null); setForm({ ...defaultForm, bdrAgent: isAdmin ? "" : ((user as any)?.agentName ?? "") }); setOpen(true); }

  function openEdit(t: NonNullable<typeof trackers>[0]) {
    setEditing(t.id);
    setForm({
      reportMonth: t.month ?? "",
      clientName: t.clientName,
      pdCoordinator: t.pdCoordinator ?? "",
      partnerStatus: t.partnerStatus ?? "Prospect",
      facilityName: t.facilityName ?? "",
      facilityType: t.facilityType ?? "Chiro",
      bdrAgent: t.bdrAssigned ?? "",
      status: (t.status as typeof STATUSES[number]) ?? "Pending",
      notes: t.notes ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!form.clientName) return toast.error("Client name required");
    if (editing !== null) {
      updateMutation.mutate({ id: editing, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const successful = trackers?.filter(t => t.status === "Successful Sent").length ?? 0;
  const partners = trackers?.filter(t => t.partnerStatus === "Partner").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Referral-Friendly Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">Track which facility each client was referred to</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Entry</Button>
      </div>

      <BdrFilterBar
        filters={filters}
        onChange={setFilters}
        show={{ agent: true, month: true, year: true, status: true, search: true }}
        statusOptions={["Pending", "In Progress", "Successful Sent", "Demo Sent", "Unsuccessful"]}
        showAgentFilter={isAdmin}
      />

      {trackers && trackers.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Network className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{successful}</p>
                <p className="text-xs text-muted-foreground">Successful Sends</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Network className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{partners}</p>
                <p className="text-xs text-muted-foreground">Partner Facilities</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Network className="w-8 h-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{trackers.length}</p>
                <p className="text-xs text-muted-foreground">Total Entries</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Referral Tracker {trackers ? `(${trackers.length})` : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !trackers || trackers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
              <Inbox className="w-10 h-10 mx-auto text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">No referral entries found</p>
              <p className="mt-1 text-xs text-muted-foreground">Adjust your filters or click "Add Entry" to start tracking referrals.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>PD Coord.</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Partner</TableHead>
                  <TableHead>BDR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trackers.map((t) => {
                  const StatusIcon = statusIcons[t.status];
                  return (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{t.month ?? "—"}</TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate" title={t.clientName}>{t.clientName}</TableCell>
                    <TableCell className="max-w-[120px] truncate" title={t.pdCoordinator ?? undefined}>{t.pdCoordinator ?? "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate" title={t.facilityName ?? undefined}>{t.facilityName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.facilityType ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={t.partnerStatus === "Partner" ? "default" : "secondary"}>
                        {t.partnerStatus ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge variant="outline">{t.bdrAssigned ?? "—"}</Badge></TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusColors[t.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                        {StatusIcon && <StatusIcon className="w-3 h-3" />}
                        {t.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate({ id: t.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing !== null ? "Edit Entry" : "Add Tracker Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Month</Label>
                <Input placeholder="e.g. May 2026" value={form.reportMonth} onChange={(e) => setForm({ ...form, reportMonth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Client Name *</Label>
                <Input placeholder="Client full name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>PD Coordinator</Label>
                <Input placeholder="Coordinator name" value={form.pdCoordinator} onChange={(e) => setForm({ ...form, pdCoordinator: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Partner Status</Label>
                <Select value={form.partnerStatus} onValueChange={(v) => setForm({ ...form, partnerStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PARTNER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility</Label>
                <Input placeholder="Facility name" value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Facility Type</Label>
                <Select value={form.facilityType} onValueChange={(v) => setForm({ ...form, facilityType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>BDR Agent</Label>
                {isAdmin ? (
                  <Select value={form.bdrAgent} onValueChange={(v) => setForm({ ...form, bdrAgent: v })}>
                    <SelectTrigger><SelectValue placeholder="Select BDR" /></SelectTrigger>
                    <SelectContent>{AGENTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.bdrAgent} disabled className="bg-muted" />
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
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editing !== null ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
