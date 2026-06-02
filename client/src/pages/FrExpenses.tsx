import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, DollarSign, Download } from "lucide-react";
import { BdrFilterBar, BdrFilterValues } from "@/components/BdrFilterBar";
import { DatePickerField } from "@/components/DatePickerField";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];
const CARD_TYPES = ["Company", "Personal"] as const;

type FormData = {
  expenseDate: string;
  agentName: string;
  facilityName: string;
  storeName: string;
  reason: string;
  amount: string;
  cardType: "Company" | "Personal";
  notes: string;
};

const defaultForm: FormData = {
  expenseDate: new Date().toISOString().split("T")[0],
  agentName: "",
  facilityName: "",
  storeName: "",
  reason: "",
  amount: "0.00",
  cardType: "Company",
  notes: "",
};

export default function FrExpenses() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState<BdrFilterValues>({});

  const queryInput = isAdmin
    ? (Object.keys(filters).length > 0 ? filters : undefined)
    : { agent: (user as any)?.agentName ?? undefined };

  const { data: expenses, isLoading } = trpc.bdr.frExpenses.list.useQuery(queryInput);

  const createMutation = trpc.bdr.frExpenses.create.useMutation({
    onSuccess: () => { utils.bdr.frExpenses.list.invalidate(); toast.success("Expense added"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.frExpenses.update.useMutation({
    onSuccess: () => { utils.bdr.frExpenses.list.invalidate(); toast.success("Expense updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.frExpenses.delete.useMutation({
    onSuccess: () => { utils.bdr.frExpenses.list.invalidate(); toast.success("Expense deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  function openCreate() {
    setEditing(null);
    setForm({ ...defaultForm, agentName: isAdmin ? "" : ((user as any)?.agentName ?? "") });
    setOpen(true);
  }

  function openEdit(e: NonNullable<typeof expenses>[0]) {
    setEditing(e.id);
    setForm({
      expenseDate: e.expenseDate ? new Date(e.expenseDate).toISOString().split("T")[0] : "",
      agentName: e.agentName,
      facilityName: e.facilityName ?? "",
      storeName: (e as any).store ?? "",
      reason: e.reason ?? "",
      amount: String(e.amount ?? "0.00"),
      cardType: (e.cardType as "Company" | "Personal") ?? "Company",
      notes: e.notes ?? "",
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

  function runExport() {
    if (!expenses || expenses.length === 0) return toast.error("No data to export");
    const from = exportFrom ? new Date(exportFrom + "T00:00:00") : null;
    const to = exportTo ? new Date(exportTo + "T23:59:59") : null;
    const filtered = expenses.filter((e) => {
      if (!e.expenseDate) return !from && !to;
      const d = new Date(e.expenseDate);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    if (filtered.length === 0) return toast.error("No expenses found in the selected date range");
    const headers = ["Date", "Agent", "Facility", "Store", "Reason", "Amount", "Card Type", "Notes"];
    const rows = filtered.map((e) => [
      e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : "",
      e.agentName, e.facilityName ?? "", (e as any).store ?? "",
      e.reason ?? "", parseFloat(String(e.amount ?? 0)).toFixed(2), e.cardType ?? "", e.notes ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = from || to ? `${exportFrom || "start"}_to_${exportTo || "end"}` : new Date().toISOString().split("T")[0];
    a.download = `fr-expenses-${suffix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} expense${filtered.length !== 1 ? "s" : ""}`);
    setExportOpen(false);
  }

  const totalAmount = expenses?.reduce((s, e) => s + parseFloat(String(e.amount ?? 0)), 0) ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">FR Expenses</h1>
          <p className="text-muted-foreground text-sm mt-1">Field rep expense log per facility visit</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)} disabled={!expenses?.length}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Expense</Button>
        </div>
      </div>

      <BdrFilterBar
        filters={filters}
        onChange={setFilters}
        show={{ agent: true, dateRange: true, year: true, status: true, search: true }}
        statusOptions={["Company", "Personal"]}
        showAgentFilter={isAdmin}
      />

      {expenses && expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <DollarSign className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">${totalAmount.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Total Expenses</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <DollarSign className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{expenses.length}</p>
                <p className="text-xs text-muted-foreground">Expense Entries</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Expense Log {expenses ? `(${expenses.length})` : ""}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !expenses || expenses.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No expenses found. Adjust filters or click "Add Expense".</p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-24">Agent</TableHead>
                  <TableHead className="w-36">Facility</TableHead>
                  <TableHead className="w-28">Store</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-24">Amount</TableHead>
                  <TableHead className="w-24">Card</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{e.agentName}</Badge></TableCell>
                    <TableCell className="max-w-[144px] truncate">{e.facilityName ?? "—"}</TableCell>
                    <TableCell className="max-w-[112px] truncate">{(e as any).store ?? "—"}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground">{e.reason ?? "—"}</TableCell>
                    <TableCell className="font-medium text-emerald-600 whitespace-nowrap">${parseFloat(String(e.amount ?? 0)).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={e.cardType === "Personal" ? "secondary" : "default"}>{e.cardType}</Badge>
                    </TableCell>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Download className="w-4 h-4" /> Export FR Expenses</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Select a date range to filter the export. Leave blank to export all records.</p>
            <div className="space-y-1"><Label>From Date</Label><DatePickerField value={exportFrom} onChange={setExportFrom} placeholder="Start date" /></div>
            <div className="space-y-1"><Label>To Date</Label><DatePickerField value={exportTo} onChange={setExportTo} placeholder="End date" /></div>
            {(!exportFrom && !exportTo) && <p className="text-xs text-muted-foreground">No date range — all {expenses?.length ?? 0} records will be exported.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExportOpen(false); setExportFrom(""); setExportTo(""); }}>Cancel</Button>
            <Button onClick={runExport}><Download className="w-4 h-4 mr-2" /> Download CSV</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing !== null ? "Edit Expense" : "Add FR Expense"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <DatePickerField value={form.expenseDate} onChange={(v) => setForm({ ...form, expenseDate: v })} />
              </div>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility</Label>
                <Input placeholder="Facility name" value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Store</Label>
                <Input placeholder="e.g. UberEats, Walmart" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Input placeholder="e.g. Partner check-in food delivery" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Card Type</Label>
                <Select value={form.cardType} onValueChange={(v) => setForm({ ...form, cardType: v as "Company" | "Personal" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CARD_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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
              {editing !== null ? "Save Changes" : "Add Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
