/**
 * Lead Capture / Intake — mirrors the team's Excel intake sheet.
 * Capture a lead with all the tracked fields, see them in a table, export to CSV.
 * Agents see their own captures; managers see everyone's.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Plus, Download, Trash2, Loader2, Mail, CheckCircle2, Clock, XCircle, Circle } from "lucide-react";
import { LeadFormFields } from "@/components/LeadFormFields";
import { ClickToCallButton } from "@/components/RingCentralWidget";

// Theme-aware status pill for outcome/disposition-style text.
const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";
function statusTone(value: string): { className: string; Icon: typeof CheckCircle2 } {
  const v = value.toLowerCase();
  if (/(accept|sign|signed|complete|success|won|active|qualified|hot|retained)/.test(v))
    return { className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 };
  if (/(pending|progress|follow|callback|warm|review|waiting|hold)/.test(v))
    return { className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", Icon: Clock };
  if (/(deni|reject|declin|fail|lost|not\b|no\b|dead|disqualif|unqualif|cold|dnq)/.test(v))
    return { className: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle };
  return { className: "bg-muted text-muted-foreground border-border", Icon: Circle };
}
function StatusPill({ value }: { value: string }) {
  const { className, Icon } = statusTone(value);
  return (
    <span className={`${PILL_BASE} ${className}`}>
      <Icon className="w-3 h-3" />
      <span className="truncate max-w-[160px]" title={value}>{value}</span>
    </span>
  );
}

// Render a single cell value with the right premium treatment per field.
function renderCell(key: string, value: string) {
  if (key === "phone") return <ClickToCallButton phoneNumber={value} />;
  if (key === "email")
    return (
      <a href={`mailto:${value}`} className="inline-flex items-center gap-1 text-primary hover:underline" title={value}>
        <Mail className="w-3.5 h-3.5" />
        <span className="truncate max-w-[180px]">{value}</span>
      </a>
    );
  if (key === "outcome" || key === "disposition" || key === "classification" || key === "liability")
    return <StatusPill value={value} />;
  if (key === "value") {
    const num = Number(String(value).replace(/[^0-9.-]/g, ""));
    const display = Number.isFinite(num) && String(value).trim() !== "" && /\d/.test(value)
      ? `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : value;
    return <span className="whitespace-nowrap font-medium text-foreground">{display}</span>;
  }
  // Long free-text fields: keep rows single-line and compact.
  return <span className="block truncate max-w-[220px]" title={value}>{value}</span>;
}

const FIELDS = [
  { key: "leadDate", label: "Date", type: "date" },
  { key: "role", label: "Role" },
  { key: "member", label: "Member" },
  { key: "leadName", label: "Lead Name", required: true },
  { key: "lastName", label: "Last Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "value", label: "Value" },
  { key: "outcome", label: "Outcome" },
  { key: "classification", label: "Classification" },
  { key: "sud", label: "SUD" },
  { key: "liability", label: "Liability" },
  { key: "disposition", label: "Disposition" },
  { key: "facility", label: "Facility" },
  { key: "typeOfFacility", label: "Type of Facility" },
  { key: "clientLocation", label: "Client's Location" },
  { key: "fvDocumentation", label: "FV Documentation" },
] as const;

const emptyForm = () => Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as Record<string, string>;

export default function LeadCapture() {
  const utils = trpc.useUtils();
  const { data: leads, isLoading } = trpc.crm.leadIntake.list.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(emptyForm());

  const create = trpc.crm.leadIntake.create.useMutation({
    onSuccess: () => { toast.success("Lead captured"); utils.crm.leadIntake.list.invalidate(); setOpen(false); setForm(emptyForm()); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.crm.leadIntake.delete.useMutation({
    onSuccess: () => utils.crm.leadIntake.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (!form.leadName?.trim()) return toast.error("Lead Name is required.");
    const payload: Record<string, string> = {};
    for (const f of FIELDS) { const v = form[f.key]?.trim(); if (v) payload[f.key] = v; }
    create.mutate(payload as any);
  };

  const exportCsv = () => {
    const header = FIELDS.map((f) => f.label).join(",");
    const rows = (leads ?? []).map((l: any) =>
      FIELDS.map((f) => {
        let v = l[f.key] ?? "";
        if (f.key === "leadDate" && v) v = new Date(v).toLocaleDateString();
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lead-intake.csv";
    a.click();
  };

  return (
    <div className="dashboard-mesh min-h-full">
      <div className="max-w-[1400px] mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Lead Capture</h1>
              <p className="text-sm text-muted-foreground">{leads?.length ?? 0} lead{(leads?.length ?? 0) === 1 ? "" : "s"} logged</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" /> Export CSV</Button>
            <Button onClick={() => { setForm(emptyForm()); setOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Add Lead</Button>
          </div>
        </div>

        <div className="premium-card rounded-2xl overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          ) : (
            <table className="w-full text-sm min-w-[1200px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {FIELDS.map((f) => <th key={f.key} className="px-3 py-2.5 font-medium whitespace-nowrap">{f.label}</th>)}
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {(leads ?? []).map((l: any) => (
                  <tr key={l.id} className="border-b border-border/50 hover:bg-secondary/30">
                    {FIELDS.map((f) => {
                      const raw = f.key === "leadDate"
                        ? (l.leadDate ? new Date(l.leadDate).toLocaleDateString() : "")
                        : (l[f.key] ?? "");
                      const value = String(raw).trim();
                      return (
                        <td key={f.key} className="px-3 py-2 align-middle text-foreground/90">
                          {value
                            ? (f.key === "leadDate" ? <span className="whitespace-nowrap">{value}</span> : renderCell(f.key, value))
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <button onClick={() => del.mutate({ id: l.id })} className="text-muted-foreground hover:text-destructive" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(leads ?? []).length === 0 && (
                  <tr>
                    <td colSpan={FIELDS.length + 1} className="p-4">
                      <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
                        <div className="mx-auto mb-3 w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <ClipboardList className="w-5 h-5 text-primary" />
                        </div>
                        <p className="text-sm font-medium text-foreground">No leads yet</p>
                        <p className="text-xs text-muted-foreground mt-1">Click "Add Lead" to capture your first intake.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Capture a lead</DialogTitle></DialogHeader>
          <div className="py-1">
            <LeadFormFields form={form} setForm={setForm} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending} className="gap-2">
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
