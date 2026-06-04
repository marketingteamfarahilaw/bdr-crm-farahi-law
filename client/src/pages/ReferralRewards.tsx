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
import { Plus, Pencil, Trash2, Gift } from "lucide-react";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];
const REFERRAL_TYPES = ["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"] as const;
const TIERS = ["Standard", "Medium", "High", "Rank X"] as const;
const STATUSES = ["Pending", "Accepted", "Denied"] as const;

type FormData = {
  agentName: string;
  sudName: string;
  referralType: typeof REFERRAL_TYPES[number];
  facilityName: string;
  clientName: string;
  tier: typeof TIERS[number];
  payoutAmount: string;
  status: typeof STATUSES[number];
  caseNumber: string;
  notes: string;
};

const defaultForm: FormData = {
  agentName: "",
  sudName: "",
  referralType: "Chiro",
  facilityName: "",
  clientName: "",
  tier: "Standard",
  payoutAmount: "0.00",
  status: "Pending",
  caseNumber: "",
  notes: "",
};

const statusColors: Record<string, string> = {
  Accepted: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  Denied: "bg-red-100 text-red-800 border-red-200",
};

export default function ReferralRewards() {
  const { user } = useAuth();
  const isAdmin = seesAllData(user?.role);
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState<BdrFilterValues>({});

  const queryInput = isAdmin
    ? (Object.keys(filters).length > 0 ? filters : undefined)
    : { agent: (user as any)?.agentName ?? undefined };

  const { data: rewards, isLoading } = trpc.bdr.referralRewards.list.useQuery(queryInput);
  const createMutation = trpc.bdr.referralRewards.create.useMutation({
    onSuccess: () => { utils.bdr.referralRewards.list.invalidate(); toast.success("Referral reward added"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.referralRewards.update.useMutation({
    onSuccess: () => { utils.bdr.referralRewards.list.invalidate(); toast.success("Referral reward updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.referralRewards.delete.useMutation({
    onSuccess: () => { utils.bdr.referralRewards.list.invalidate(); toast.success("Referral reward deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);

  function openCreate() { setEditing(null); setForm({ ...defaultForm, agentName: isAdmin ? "" : ((user as any)?.agentName ?? "") }); setOpen(true); }

  function openEdit(r: NonNullable<typeof rewards>[0]) {
    setEditing(r.id);
    setForm({
      agentName: r.agentName,
      sudName: r.sud ?? "",
      referralType: (r.referralType as typeof REFERRAL_TYPES[number]) ?? "Chiro",
      facilityName: r.facilityName ?? "",
      clientName: r.clientName ?? "",
      tier: (r.clientTier as typeof TIERS[number]) ?? "Standard",
      payoutAmount: String(r.payoutAmount ?? "0.00"),
      status: (r.status as typeof STATUSES[number]) ?? "Pending",
      caseNumber: r.caseNumber ?? "",
      notes: r.notes ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    if (!form.agentName) return toast.error("Agent name required");
    if (editing !== null) {
      updateMutation.mutate({ id: editing, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const totalPayout = rewards?.filter(r => r.status === "Accepted").reduce((s, r) => s + parseFloat(String(r.payoutAmount ?? 0)), 0) ?? 0;
  const pending = rewards?.filter(r => r.status === "Pending").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Referral Rewards</h1>
          <p className="text-muted-foreground text-sm mt-1">Client referrals with tier, payout, and status tracking</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Referral</Button>
      </div>

      <BdrFilterBar
        filters={filters}
        onChange={setFilters}
        show={{ agent: true, dateRange: true, year: true, status: true, search: true }}
        statusOptions={["Pending", "Accepted", "Denied"]}
        showAgentFilter={isAdmin}
      />

      {rewards && rewards.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Gift className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">${totalPayout.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Accepted Payouts</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Gift className="w-8 h-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{pending}</p>
                <p className="text-xs text-muted-foreground">Pending Rewards</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Gift className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{rewards.length}</p>
                <p className="text-xs text-muted-foreground">Total Referrals</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Referral Reward Log {rewards ? `(${rewards.length})` : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !rewards || rewards.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No referral rewards found. Adjust filters or click "Add Referral".</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>SUD</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Case #</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline">{r.agentName}</Badge></TableCell>
                    <TableCell>{r.sud ?? "—"}</TableCell>
                    <TableCell>{r.referralType}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{r.facilityName ?? "—"}</TableCell>
                    <TableCell>{r.clientName ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{r.clientTier}</Badge></TableCell>
                    <TableCell className="font-medium text-emerald-600">${parseFloat(String(r.payoutAmount ?? 0)).toFixed(2)}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColors[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell>{r.caseNumber ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate({ id: r.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
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
          <DialogHeader><DialogTitle>{editing !== null ? "Edit Referral" : "Add Referral Reward"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Agent *</Label>
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
                <Label>SUD (Sign-Up Date)</Label>
                <Input placeholder="e.g. 05/01/2026" value={form.sudName} onChange={(e) => setForm({ ...form, sudName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Referral Type</Label>
                <Select value={form.referralType} onValueChange={(v) => setForm({ ...form, referralType: v as typeof REFERRAL_TYPES[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REFERRAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Facility</Label>
                <Input placeholder="Facility name" value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Client Name</Label>
                <Input placeholder="Client full name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Tier</Label>
                <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v as typeof TIERS[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Payout ($)</Label>
                <Input type="number" step="0.01" min="0" value={form.payoutAmount} onChange={(e) => setForm({ ...form, payoutAmount: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as typeof STATUSES[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Case #</Label>
                <Input placeholder="Case number" value={form.caseNumber} onChange={(e) => setForm({ ...form, caseNumber: e.target.value })} />
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
              {editing !== null ? "Save Changes" : "Add Referral"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
