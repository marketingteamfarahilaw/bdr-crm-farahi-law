import { useState } from "react";
import { trpc } from "@/lib/trpc";
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

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];

type FormData = {
  expenseDate: string;
  reportMonth: string;
  agentName: string;
  facilityName: string;
  facilityPhone: string;
  storeName: string;
  reason: string;
  amount: string;
  notes: string;
};

const defaultForm: FormData = {
  expenseDate: new Date().toISOString().split("T")[0],
  reportMonth: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  agentName: "",
  facilityName: "",
  facilityPhone: "",
  storeName: "",
  reason: "",
  amount: "0.00",
  notes: "",
};

export default function BdrExpenses() {
  const utils = trpc.useUtils();
  const { data: expenses, isLoading } = trpc.bdr.bdrExpenses.list.useQuery();
  const createMutation = trpc.bdr.bdrExpenses.create.useMutation({
    onSuccess: () => { utils.bdr.bdrExpenses.list.invalidate(); toast.success("Expense added"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.bdrExpenses.update.useMutation({
    onSuccess: () => { utils.bdr.bdrExpenses.list.invalidate(); toast.success("Expense updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.bdrExpenses.delete.useMutation({
    onSuccess: () => { utils.bdr.bdrExpenses.list.invalidate(); toast.success("Expense deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);

  // Export date range state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");

  function openCreate() { setEditing(null); setForm(defaultForm); setOpen(true); }

  function openEdit(e: NonNullable<typeof expenses>[0]) {
    setEditing(e.id);
    setForm({
      expenseDate: e.expenseDate ? new Date(e.expenseDate).toISOString().split("T")[0] : "",
      reportMonth: e.month ?? "",
      agentName: e.agentName,
      facilityName: e.facilityName ?? "",
      facilityPhone: e.facilityPhone ?? "",
      storeName: (e as any).store ?? "",
      reason: e.reason ?? "",
      amount: String(e.amount ?? "0.00"),
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

    if (filtered.length === 0) {
      toast.error("No expenses found in the selected date range");
      return;
    }

    const headers = ["Month", "Date", "Agent", "Facility", "Facility Phone", "Store", "Reason", "Amount", "Notes"];
    const rows = filtered.map((e) => [
      e.month ?? "",
      e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : "",
      e.agentName,
      e.facilityName ?? "",
      e.facilityPhone ?? "",
      (e as any).store ?? "",
      e.reason ?? "",
      parseFloat(String(e.amount ?? 0)).toFixed(2),
      e.notes ?? "",
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = from || to
      ? `${exportFrom || "start"}_to_${exportTo || "end"}`
      : new Date().toISOString().split("T")[0];
    a.download = `bdr-expenses-${suffix}.csv`;
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
          <h1 className="text-2xl font-bold">BDR Expenses</h1>
          <p className="text-muted-foreground text-sm mt-1">Business development rep expense log</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setExportOpen(true)}
            disabled={!expenses || expenses.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Expense</Button>
        </div>
      </div>

      {expenses && expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <DollarSign className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">${totalAmount.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Total BDR Expenses</p>
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
        <CardHeader><CardTitle>BDR Expense Log</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !expenses || expenses.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No BDR expenses logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground">{e.month ?? "—"}</TableCell>
                    <TableCell>{e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{e.agentName}</Badge></TableCell>
                    <TableCell className="max-w-[120px] truncate">{e.facilityName ?? "—"}</TableCell>
                    <TableCell>{e.facilityPhone ?? "—"}</TableCell>
                    <TableCell>{(e as any).store ?? "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-muted-foreground">{e.reason ?? "—"}</TableCell>
                    <TableCell className="font-medium text-emerald-600">${parseFloat(String(e.amount ?? 0)).toFixed(2)}</TableCell>
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

      {/* Export Date Range Dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-4 h-4" /> Export BDR Expenses
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select a date range to filter the export. Leave both fields blank to export all records.
            </p>
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
                min={exportFrom || undefined}
              />
            </div>
            {exportFrom && exportTo && (
              <p className="text-xs text-muted-foreground">
                Exporting expenses from {new Date(exportFrom).toLocaleDateString()} to {new Date(exportTo).toLocaleDateString()}
              </p>
            )}
            {(!exportFrom && !exportTo) && (
              <p className="text-xs text-muted-foreground">
                No date range set — all {expenses?.length ?? 0} records will be exported.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setExportOpen(false); setExportFrom(""); setExportTo(""); }}>
              Cancel
            </Button>
            <Button onClick={runExport}>
              <Download className="w-4 h-4 mr-2" /> Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing !== null ? "Edit BDR Expense" : "Add BDR Expense"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Month</Label>
                <Input placeholder="e.g. May 2026" value={form.reportMonth} onChange={(e) => setForm({ ...form, reportMonth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Agent *</Label>
                <Select value={form.agentName} onValueChange={(v) => setForm({ ...form, agentName: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{AGENTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Facility</Label>
                <Input placeholder="Facility name" value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility Phone</Label>
                <Input placeholder="(555) 000-0000" value={form.facilityPhone} onChange={(e) => setForm({ ...form, facilityPhone: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Store</Label>
                <Input placeholder="e.g. Costco, DoorDash" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input placeholder="Reason for expense" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
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
