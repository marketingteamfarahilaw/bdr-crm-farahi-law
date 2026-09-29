/**
 * Merge two facilities, or delete some, from the Facilities list's selection bar
 * (server/facilityMerge.ts). Managers and super admins only. Both show what
 * hangs off each facility first, and neither can be undone.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

type Fac = { id: number; name: string; category?: string | null; city?: string | null; phone?: string | null; assignedRepName?: string | null };
type Counts = { calls: number; recaps: number; tasks: number; referrals: number; gratitude: number; leads: number; signed: number; other: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const history = (c?: Counts) =>
  !c ? "…" : [plural(c.calls, "call/visit", "calls/visits"), plural(c.recaps, "recap/note", "recaps/notes"), plural(c.leads, "lead"),
    c.signed ? `${c.signed} signed` : "", plural(c.tasks, "task"), c.referrals ? plural(c.referrals, "referral") : "",
    c.gratitude ? plural(c.gratitude, "thank-you") : "", c.other ? `${c.other} expense/reward/tracker rows` : ""]
    .filter(Boolean).join(" · ");
/** Everything attached, for picking which facility to keep. */
const total = (c?: Counts) => (c ? c.calls + c.recaps + c.tasks + c.referrals + c.gratitude + c.leads + c.other : 0);
/** What a delete removes along with the facility. */
const lost = (c?: Counts) => (c ? c.calls + c.recaps + c.tasks + c.referrals + c.gratitude : 0);

export function MergeFacilitiesDialog({ pair, onClose, onDone }: { pair: [Fac, Fac] | null; onClose: () => void; onDone: () => void }) {
  const ids = pair ? [pair[0].id, pair[1].id] : [];
  const { data: counts } = trpc.crm.facilities.recordCounts.useQuery({ ids }, { enabled: !!pair });
  const [keepId, setKeepId] = useState<number | null>(null);
  // Keep the one with more history, unless the user picks.
  useEffect(() => {
    if (!pair) { setKeepId(null); return; }
    if (keepId != null || !counts) return;
    setKeepId(total(counts[pair[1].id]) > total(counts[pair[0].id]) ? pair[1].id : pair[0].id);
  }, [pair, counts, keepId]);
  const merge = trpc.crm.facilities.merge.useMutation({
    onSuccess: (r) => { toast.success(`Merged "${r.removedName}" into "${r.keptName}" — ${r.moved} records moved`); onDone(); },
    onError: (e) => toast.error(e.message),
  });
  if (!pair) return null;
  const keep = pair.find((f) => f.id === keepId);
  const drop = pair.find((f) => f.id !== keepId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge two facilities</DialogTitle>
          <DialogDescription>Pick the one to keep. Everything from the other moves onto it — calls, visits, recaps, tasks, leads, referrals and expenses — and the other is removed.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Facility to keep">
          {pair.map((f) => {
            const on = f.id === keepId;
            return (
              <button
                key={f.id} type="button" role="radio" aria-checked={on} onClick={() => setKeepId(f.id)}
                className={`text-left rounded-xl border p-3 transition-colors ${on ? "border-[var(--gold)] bg-[var(--gold)]/5 ring-1 ring-[var(--gold)]" : "border-border hover:bg-muted/40"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground text-sm">{f.name}</span>
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${on ? "text-foreground" : "text-muted-foreground"}`}>{on ? "Keep" : "Merge in"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{[f.city, f.phone, f.assignedRepName ? `Rep: ${f.assignedRepName}` : null].filter(Boolean).join(" · ") || "—"}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{history(counts?.[f.id])}</p>
              </button>
            );
          })}
        </div>
        {keep && drop && (
          <p className="text-sm text-muted-foreground">
            <b className="text-foreground">{drop.name}</b> will be merged into <b className="text-foreground">{keep.name}</b>. Its phone numbers,
            notes and any details {keep.name} is missing are kept. This can't be undone.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="border-border" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!keep || !drop || merge.isPending || !counts}
            onClick={() => keep && drop && merge.mutate({ keepId: keep.id, removeId: drop.id })}
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
          >
            {merge.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Merging…</> : "Merge"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFacilitiesDialog({ list, onClose, onDone }: { list: Fac[] | null; onClose: () => void; onDone: () => void }) {
  const ids = list?.map((f) => f.id) ?? [];
  const { data: counts, isError: countsFailed } = trpc.crm.facilities.recordCounts.useQuery({ ids }, { enabled: !!list?.length, retry: 1 });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const del = trpc.crm.facilities.delete.useMutation();
  useEffect(() => { if (!list) setTyped(""); }, [list]);
  if (!list?.length) return null;
  const withHistory = list.filter((f) => lost(counts?.[f.id]) > 0);
  const go = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const f of list) { await del.mutateAsync({ id: f.id }); done++; }
      toast.success(`Deleted ${plural(done, "facility", "facilities")}`);
      onDone();
    } catch (e: any) {
      toast.error(`${done ? `Deleted ${done}, then: ` : ""}${e?.message ?? "Delete failed"}`);
      if (done) onDone();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="bg-card border-border max-w-xl">
        <DialogHeader>
          <DialogTitle>Delete {plural(list.length, "facility", "facilities")}?</DialogTitle>
          <DialogDescription>
            Their calls, visits, recaps, tasks, referrals and thank-you gifts are deleted with them. Expenses, rewards and Lead Docket
            leads that named them are kept, no longer linked. The Google Sheet sync won't bring them back. If one is a duplicate of
            another facility, merge it instead so its history isn't lost.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 overflow-y-auto space-y-1.5 text-sm">
          {list.map((f) => (
            <li key={f.id} className="rounded-lg border border-border px-3 py-2">
              <span className="font-medium text-foreground">{f.name}</span>
              {f.city && <span className="text-muted-foreground"> · {f.city}</span>}
              <p className="text-xs text-muted-foreground mt-0.5">{history(counts?.[f.id])}</p>
            </li>
          ))}
        </ul>
        {withHistory.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-none" />
            {withHistory.length === list.length ? "All of these have" : `${withHistory.length} of these have`} history that will be deleted.
          </p>
        )}
        {countsFailed && <p className="text-sm text-muted-foreground">Couldn't load what's attached to them. You can still delete.</p>}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block" htmlFor="confirm-delete">Type <b>delete</b> to confirm</label>
          <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="bg-background border-border" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="border-border" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" disabled={busy || (!counts && !countsFailed) || typed.trim().toLowerCase() !== "delete"} onClick={go}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Deleting…</> : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
