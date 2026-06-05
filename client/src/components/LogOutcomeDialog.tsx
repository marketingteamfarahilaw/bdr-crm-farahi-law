/**
 * LogOutcomeDialog — one-tap call/visit outcome logging.
 *
 * Lets a rep log the result of a touch (call or visit) + an optional note and a
 * "follow up in N days" task, without leaving My Day / the Pipeline board. Reuses
 * the existing contactLogs.create + tasks.create mutations and invalidates the
 * live queries so cadence and task lists refresh immediately.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Loader2 } from "lucide-react";

type Outcome = "connected" | "voicemail" | "no_answer" | "busy" | "other";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "other", label: "Other" },
];

const FOLLOWUPS: { value: string; label: string }[] = [
  { value: "0", label: "No follow-up" },
  { value: "1", label: "Tomorrow" },
  { value: "3", label: "In 3 days" },
  { value: "7", label: "In 1 week" },
  { value: "14", label: "In 2 weeks" },
];

export function LogOutcomeDialog({
  facilityId,
  facilityName,
  trigger,
}: {
  facilityId: number;
  facilityName?: string;
  trigger?: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [contactType, setContactType] = useState<"call" | "visit">("call");
  const [outcome, setOutcome] = useState<Outcome>("connected");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("0");

  const logContact = trpc.crm.contactLogs.create.useMutation();
  const createTask = trpc.crm.tasks.create.useMutation();
  const busy = logContact.isPending || createTask.isPending;

  const reset = () => { setContactType("call"); setOutcome("connected"); setNote(""); setFollowUp("0"); };

  const submit = async () => {
    try {
      await logContact.mutateAsync({
        facilityId,
        contactType,
        contactDate: new Date().toISOString(),
        callResult: contactType === "call" ? outcome : undefined,
        callType: "partner_checkin",
        summary: note.trim() || undefined,
      });
      const days = parseInt(followUp, 10);
      if (days > 0) {
        const due = new Date(); due.setDate(due.getDate() + days);
        await createTask.mutateAsync({
          facilityId,
          title: `Follow up with ${facilityName ?? "partner"}`,
          dueDate: due.toISOString(),
          priority: "medium",
          assignToSelf: true,
        });
      }
      toast.success(`Logged ${contactType}${days > 0 ? ` · follow-up in ${days}d` : ""}`);
      utils.crm.contactLogs.list.invalidate();
      utils.crm.facilities.list.invalidate();
      utils.crm.facilities.get.invalidate();
      utils.crm.tasks.listMine.invalidate();
      utils.crm.tasks.listByFacility.invalidate();
      utils.crm.tasks.listOverdue.invalidate();
      setOpen(false); reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not log the outcome");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger ?? (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <ClipboardCheck className="w-3 h-3" /> Log
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Log outcome{facilityName ? ` — ${facilityName}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(["call", "visit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setContactType(t)}
                className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  contactType === t ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {contactType === "call" && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Outcome</label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What happened? (optional)"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Follow-up</label>
            <Select value={followUp} onValueChange={setFollowUp}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent>{FOLLOWUPS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
