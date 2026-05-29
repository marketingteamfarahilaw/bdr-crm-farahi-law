import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, MapPin, Clock, Users } from "lucide-react";
import { toast } from "sonner";

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];

type FormData = {
  visitDate: string;
  agentName: string;
  facilityCount: number;
  hoursWorked: string;
  facilityNames: string;
  notes: string;
};

const defaultForm: FormData = {
  visitDate: new Date().toISOString().split("T")[0],
  agentName: "",
  facilityCount: 0,
  hoursWorked: "",
  facilityNames: "",
  notes: "",
};

export default function FieldVisits() {
  const utils = trpc.useUtils();
  const { data: visits, isLoading } = trpc.bdr.fieldVisits.list.useQuery();
  const createMutation = trpc.bdr.fieldVisits.create.useMutation({
    onSuccess: () => { utils.bdr.fieldVisits.list.invalidate(); toast.success("Visit logged"); setOpen(false); setForm(defaultForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.fieldVisits.update.useMutation({
    onSuccess: () => { utils.bdr.fieldVisits.list.invalidate(); toast.success("Visit updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.fieldVisits.delete.useMutation({
    onSuccess: () => { utils.bdr.fieldVisits.list.invalidate(); toast.success("Visit deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(defaultForm);

  function openCreate() {
    setEditing(null);
    setForm(defaultForm);
    setOpen(true);
  }

  function openEdit(v: NonNullable<typeof visits>[0]) {
    setEditing(v.id);
    setForm({
      visitDate: v.visitDate ? new Date(v.visitDate).toISOString().split("T")[0] : "",
      agentName: v.agentName,
      facilityCount: v.facilityCount ?? 0,
      hoursWorked: v.hoursWorked ?? "",
      facilityNames: Array.isArray(v.facilitiesVisited)
        ? (v.facilitiesVisited as { name: string }[]).map((f) => f.name).join("\n")
        : "",
      notes: v.notes ?? "",
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Field Visits</h1>
          <p className="text-muted-foreground text-sm mt-1">Daily log of facility visits by FR/BDR agents</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Log Visit</Button>
      </div>

      {/* Summary cards */}
      {visits && visits.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <MapPin className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{visits.length}</p>
                <p className="text-xs text-muted-foreground">Total Visits</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Users className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{visits.reduce((s, v) => s + (v.facilityCount ?? 0), 0)}</p>
                <p className="text-xs text-muted-foreground">Facilities Visited</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Clock className="w-8 h-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">
                  {visits.reduce((s, v) => s + (v.hoursWorked ? parseFloat(v.hoursWorked) || 0 : 0), 0).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">Total Hours</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Visit Log</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !visits || visits.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No visits logged yet. Click "Log Visit" to add one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Facilities</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.visitDate ? new Date(v.visitDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{v.agentName}</Badge></TableCell>
                    <TableCell>{v.facilityCount ?? 0}</TableCell>
                    <TableCell>{v.hoursWorked ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{v.notes ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate({ id: v.id })}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
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
          <DialogHeader><DialogTitle>{editing !== null ? "Edit Visit" : "Log Field Visit"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Agent *</Label>
                <Select value={form.agentName} onValueChange={(v) => setForm({ ...form, agentName: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                  <SelectContent>{AGENTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility Count</Label>
                <Input type="number" min={0} value={form.facilityCount} onChange={(e) => setForm({ ...form, facilityCount: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <Label>Hours Worked</Label>
                <Input placeholder="e.g. 7.5" value={form.hoursWorked} onChange={(e) => setForm({ ...form, hoursWorked: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Facilities Visited (one per line)</Label>
              <Textarea rows={4} placeholder="Body Shop A&#10;Chiro Clinic B&#10;..." value={form.facilityNames} onChange={(e) => setForm({ ...form, facilityNames: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editing !== null ? "Save Changes" : "Log Visit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
