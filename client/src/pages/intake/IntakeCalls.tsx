/**
 * Intake Calls — every call captured from the intake team's RingCentral
 * extensions, with transcript, AI summary, recording playback, and the
 * link to (or creation of) its lead.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { PhoneCall, PhoneIncoming, PhoneOutgoing, RefreshCw, Loader2, ChevronDown, ChevronUp, ArrowUpRight, Plus } from "lucide-react";
import { IntakeGuard, fmtDur } from "./shared";

export default function IntakeCalls() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [openRows, setOpenRows] = useState<Record<number, boolean>>({});

  const { data: calls, isLoading } = trpc.intake.calls.list.useQuery({ unlinkedOnly });

  const sync = trpc.intake.calls.syncNow.useMutation({
    onSuccess: (r) => {
      toast.success(`Synced — ${r.logged} new call${r.logged === 1 ? "" : "s"}, ${r.transcribed} transcribed, +${r.leadsCreated} lead${r.leadsCreated === 1 ? "" : "s"}`);
      utils.intake.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createLead = trpc.intake.calls.createLeadFromCall.useMutation({
    onSuccess: (r) => { toast.success("Lead created"); utils.intake.invalidate(); navigate(`/intake/leads/${r.id}`); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><PhoneCall className="w-[18px] h-[18px] text-primary-foreground" /></div>
              <div>
                <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Intake Calls</h1>
                <p className="text-sm text-muted-foreground">Auto-captured from your RingCentral every 2 minutes — transcribed and analyzed.</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="unlinked" checked={unlinkedOnly} onCheckedChange={setUnlinkedOnly} />
                <Label htmlFor="unlinked" className="text-xs text-muted-foreground cursor-pointer">Unlinked only</Label>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => sync.mutate({})} disabled={sync.isPending}>
                {sync.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {sync.isPending ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : (calls ?? []).length === 0 ? (
              <div className="px-5 py-14 text-center">
                <PhoneCall className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No calls yet</p>
                <p className="text-xs text-muted-foreground mt-1">Connect your RingCentral in Settings — calls appear here automatically.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(calls ?? []).map((c: any) => (
                  <div key={c.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {c.direction === "Inbound"
                        ? <PhoneIncoming className="w-4 h-4 text-emerald-500 shrink-0" />
                        : <PhoneOutgoing className="w-4 h-4 text-sky-500 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{c.callerName || (c.direction === "Inbound" ? c.fromNumber : c.toNumber) || "Unknown"}</span>
                          <span className="text-muted-foreground"> · {c.callDate ? format(new Date(c.callDate), "MMM d, h:mm a") : "—"} · {fmtDur(c.durationSeconds)} · {c.callResult ?? ""}</span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.agentName ? `${c.agentName}` : ""}{c.aiSummary ? ` — ${c.aiSummary}` : c.transcript ? "" : " — no transcript (no recording)"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.hasRecording === 1 && (
                          <audio controls preload="none" className="h-8 max-w-[220px]" src={`/api/intake-recording/${c.id}`} />
                        )}
                        {c.transcript && (
                          <button onClick={() => setOpenRows((p) => ({ ...p, [c.id]: !p[c.id] }))}
                            className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
                            Transcript {openRows[c.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}
                        {c.leadId ? (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(`/intake/leads/${c.leadId}`)}>
                            Lead <ArrowUpRight className="w-3 h-3" />
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={createLead.isPending}
                            onClick={() => createLead.mutate({ callId: c.id })}>
                            <Plus className="w-3 h-3" /> Create lead
                          </Button>
                        )}
                      </div>
                    </div>
                    {openRows[c.id] && c.transcript && (
                      <pre className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap bg-secondary/40 border border-border rounded-xl p-4 max-h-72 overflow-y-auto font-sans">{c.transcript}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </IntakeGuard>
  );
}
