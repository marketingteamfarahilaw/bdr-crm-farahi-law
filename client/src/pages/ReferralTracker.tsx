import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { CURRENT_TEAM } from "@shared/team";
import { REFERRAL_STATUSES, referralStatus, type ReferralStatus } from "@shared/referralTracker";
import { format } from "@/lib/datetime";
import { toast } from "sonner";
import { BdrFilterBar, BdrFilterValues } from "@/components/BdrFilterBar";
import { DatePickerField } from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Network, CheckCircle2, CalendarClock, XCircle, CircleDashed, Inbox, Check, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FACILITY_TYPES = ["Chiro", "Body Shop", "Towing", "Medical", "Physical Therapy", "Other"];
const OTHER_BDR = "__other__";
const MIN_SEARCH = 2;

/** A client or facility chosen from the suggestions. id is null only for a
 *  sheet-era row's existing name, kept as it was until someone re-picks it. */
type Picked = { id: number | null; name: string };

type FormData = {
  referralDate: string; // "YYYY-MM-DD", Pacific
  client: Picked | null;
  clientText: string;
  facility: Picked | null;
  facilityText: string;
  pdCoordinator: string;
  facilityType: string;
  bdrAgent: string;
  bdrOther: boolean;
  status: ReferralStatus;
  notes: string;
};

const today = () => format(new Date(), "yyyy-MM-dd");

const emptyForm = (): FormData => ({
  referralDate: today(),
  client: null,
  clientText: "",
  facility: null,
  facilityText: "",
  pdCoordinator: "",
  facilityType: "Chiro",
  bdrAgent: "",
  bdrOther: false,
  status: "Pending",
  notes: "",
});

const statusColors: Record<ReferralStatus, string> = {
  "Successful": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  "Appointment/Delivery Scheduled": "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  "Pending": "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  "Unsuccessful": "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

const statusIcons: Record<ReferralStatus, LucideIcon> = {
  "Successful": CheckCircle2,
  "Appointment/Delivery Scheduled": CalendarClock,
  "Pending": CircleDashed,
  "Unsuccessful": XCircle,
};

/** The typed text, settled — so the search runs once the user pauses, not per key. */
function useSettled(value: string, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

type Suggestion = { id: number; name: string; subtitle?: string | null };

/**
 * A text box that suggests matches as the user types. Typing clears the pick,
 * so the form can tell a chosen suggestion from free text.
 */
function SuggestInput({ text, picked, onText, onPick, suggestions, loading, placeholder, emptyText }: {
  text: string;
  picked: boolean;
  onText: (v: string) => void;
  onPick: (s: Suggestion) => void;
  suggestions: Suggestion[] | undefined;
  loading: boolean;
  placeholder: string;
  emptyText: string;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const searching = !picked && text.trim().length >= MIN_SEARCH;
  const open = focused && searching;
  const list = suggestions ?? [];
  useEffect(() => setActive(0), [suggestions]);

  const pick = (s: Suggestion) => { onPick(s); setFocused(false); };

  return (
    <div className="relative">
      <Input
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        className={picked ? "pr-8" : undefined}
        onChange={(e) => onText(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delay so a click on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(list[active]); }
          else if (e.key === "Escape") setFocused(false);
        }}
      />
      {picked && <Check className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600" />}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md max-h-64 overflow-y-auto">
          {loading && !list.length ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Searching…</p>
          ) : !list.length ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
          ) : list.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`block w-full text-left px-3 py-2 text-sm ${i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="font-medium">{s.name}</span>
              {s.subtitle && <span className="block text-xs text-muted-foreground">{s.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Entry added"); setOpen(false); setForm(emptyForm()); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.bdr.referralTracker.update.useMutation({
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Entry updated"); setOpen(false); setEditing(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.bdr.referralTracker.delete.useMutation({
    onSuccess: () => { utils.bdr.referralTracker.list.invalidate(); toast.success("Entry deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  type Row = NonNullable<typeof trackers>[number];
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const clientQ = useSettled(form.clientText.trim());
  const facilityQ = useSettled(form.facilityText.trim());
  const leads = trpc.bdr.referralTracker.searchLeads.useQuery(
    { q: clientQ },
    { enabled: open && !form.client && clientQ.length >= MIN_SEARCH, placeholderData: (p) => p },
  );
  const facilities = trpc.bdr.referralTracker.searchFacilities.useQuery(
    { q: facilityQ },
    { enabled: open && !form.facility && facilityQ.length >= MIN_SEARCH, placeholderData: (p) => p },
  );

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm(), bdrAgent: isAdmin ? "" : ((user as any)?.agentName ?? "") });
    setOpen(true);
  }

  function openEdit(t: Row) {
    setEditing(t);
    const bdr = t.bdrAssigned ?? "";
    setForm({
      referralDate: t.createdAt ? format(t.createdAt, "yyyy-MM-dd") : today(),
      client: { id: t.leadId ?? null, name: t.clientName },
      clientText: t.clientName,
      facility: t.facilityName ? { id: t.facilityId ?? null, name: t.facilityName } : null,
      facilityText: t.facilityName ?? "",
      pdCoordinator: t.pdCoordinator ?? "",
      facilityType: t.facilityType ?? "Chiro",
      bdrAgent: bdr,
      bdrOther: !!bdr && !CURRENT_TEAM.BDR.includes(bdr),
      status: referralStatus(t.status),
      notes: t.notes ?? "",
    });
    setOpen(true);
  }

  function handleSubmit() {
    // Names are only ever taken from the suggestions, never typed free.
    if (!form.client) return toast.error("Pick the client from the lead suggestions.");
    if (!form.facility) return toast.error("Pick the facility from the suggestions.");
    if (!form.referralDate) return toast.error("Pick a date.");
    const common = {
      pdCoordinator: form.pdCoordinator,
      facilityType: form.facilityType,
      bdrAgent: form.bdrAgent.trim(),
      status: form.status,
      notes: form.notes,
    };
    if (editing) {
      const origDate = editing.createdAt ? format(editing.createdAt, "yyyy-MM-dd") : "";
      updateMutation.mutate({
        id: editing.id,
        ...common,
        // Only what changed: a sheet-era row keeps its month label and names
        // unless someone actually picks a new date, client or facility.
        ...(form.referralDate !== origDate ? { referralDate: form.referralDate } : {}),
        ...(form.client.id != null && form.client.id !== editing.leadId ? { leadId: form.client.id } : {}),
        ...(form.facility.id != null && form.facility.id !== editing.facilityId ? { facilityId: form.facility.id } : {}),
      });
    } else {
      if (form.client.id == null || form.facility.id == null) return toast.error("Pick the client and facility from the suggestions.");
      createMutation.mutate({ ...common, referralDate: form.referralDate, leadId: form.client.id, facilityId: form.facility.id });
    }
  }

  const statuses = trackers?.map((t) => referralStatus(t.status)) ?? [];
  const successful = statuses.filter((s) => s === "Successful").length;
  const scheduled = statuses.filter((s) => s === "Appointment/Delivery Scheduled").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Referral-Friendly List</h1>
          <p className="text-muted-foreground text-sm mt-1">Track which facility each client was referred to</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Entry</Button>
      </div>

      <BdrFilterBar
        filters={filters}
        onChange={setFilters}
        show={{ agent: true, month: true, year: true, status: true, search: true }}
        statusOptions={[...REFERRAL_STATUSES]}
        showAgentFilter={isAdmin}
      />

      {trackers && trackers.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Network className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{successful}</p>
                <p className="text-xs text-muted-foreground">Successful</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Network className="w-8 h-8 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{scheduled}</p>
                <p className="text-xs text-muted-foreground">Appointment/Delivery Scheduled</p>
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
        <CardHeader><CardTitle>Referral-Friendly List {trackers ? `(${trackers.length})` : ""}</CardTitle></CardHeader>
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
                  <TableHead>Case Mgr / PD Coord.</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>BDR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trackers.map((t) => {
                  const status = referralStatus(t.status);
                  const StatusIcon = statusIcons[status];
                  return (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{t.month ?? "—"}</TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate" title={t.clientName}>{t.clientName}</TableCell>
                    <TableCell className="max-w-[120px] truncate" title={t.pdCoordinator ?? undefined}>{t.pdCoordinator || "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate" title={t.facilityName ?? undefined}>{t.facilityName || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{t.facilityType || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{t.bdrAssigned || "—"}</Badge></TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusColors[status]}`}>
                        <StatusIcon className="w-3 h-3" />
                        {status}
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
          <DialogHeader><DialogTitle>{editing ? "Edit Entry" : "Add Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <DatePickerField value={form.referralDate} onChange={(v) => setForm({ ...form, referralDate: v })} />
              </div>
              <div className="space-y-1">
                <Label>Client Name *</Label>
                <SuggestInput
                  text={form.clientText}
                  picked={!!form.client}
                  onText={(v) => setForm({ ...form, clientText: v, client: null })}
                  onPick={(s) => setForm({ ...form, client: { id: s.id, name: s.name }, clientText: s.name })}
                  suggestions={leads.data}
                  loading={leads.isFetching}
                  placeholder="Search leads…"
                  emptyText="No lead by that name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Facility *</Label>
                <SuggestInput
                  text={form.facilityText}
                  picked={!!form.facility}
                  onText={(v) => setForm({ ...form, facilityText: v, facility: null })}
                  onPick={(s) => setForm({ ...form, facility: { id: s.id, name: s.name }, facilityText: s.name })}
                  suggestions={facilities.data?.map((f) => ({ id: f.id, name: f.name, subtitle: f.city }))}
                  loading={facilities.isFetching}
                  placeholder="Search facilities…"
                  emptyText="No facility by that name"
                />
              </div>
              <div className="space-y-1">
                <Label>Facility Type</Label>
                <Select value={form.facilityType} onValueChange={(v) => setForm({ ...form, facilityType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Case Manager / PD Coordinator</Label>
              <Input placeholder="Name" value={form.pdCoordinator} onChange={(e) => setForm({ ...form, pdCoordinator: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>BDR Representative</Label>
                {isAdmin ? (
                  <>
                    <Select
                      value={form.bdrOther ? OTHER_BDR : form.bdrAgent}
                      onValueChange={(v) => setForm(v === OTHER_BDR
                        ? { ...form, bdrOther: true, bdrAgent: "" }
                        : { ...form, bdrOther: false, bdrAgent: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select BDR" /></SelectTrigger>
                      <SelectContent>
                        {CURRENT_TEAM.BDR.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                        <SelectItem value={OTHER_BDR}>Other…</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.bdrOther && (
                      <Input className="mt-2" placeholder="Name" value={form.bdrAgent} onChange={(e) => setForm({ ...form, bdrAgent: e.target.value })} />
                    )}
                  </>
                ) : (
                  // A rep's entries are theirs: the list shows a rep only rows under their own name.
                  <Input value={form.bdrAgent} disabled className="bg-muted" />
                )}
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ReferralStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REFERRAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
            <Button
              onClick={handleSubmit}
              disabled={!form.client || !form.facility || !form.referralDate || createMutation.isPending || updateMutation.isPending}
            >
              {editing ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
