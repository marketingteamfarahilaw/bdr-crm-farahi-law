import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import RingCentralConnectCard from "@/components/RingCentralConnectCard";
import { Phone, CheckCircle2, PhoneCall, Sparkles, RefreshCw, MonitorSmartphone, Clock, Users } from "lucide-react";

export default function RingCentralSettings() {
  const { data: status } = trpc.crm.ringcentral.status.useQuery();
  const isManager = !!status?.canManage;
  const { data: agents } = trpc.crm.ringcentral.connectedAgents.useQuery(undefined, { enabled: isManager });
  const utils = trpc.useUtils();
  const [last, setLast] = useState<{ logged: number; transcribed: number; matched: number; scanned: number } | null>(null);

  const sync = trpc.crm.ringcentral.syncRecent.useMutation({
    onSuccess: (res) => {
      setLast(res);
      if (res.logged > 0) {
        toast.success(`Synced ${res.logged} new call${res.logged !== 1 ? "s" : ""}`, {
          description: `${res.transcribed} transcribed · ${res.matched} matched a facility (of ${res.scanned} recent calls)`,
        });
      } else {
        toast.info("You're up to date", { description: `No new calls in the last 24h (${res.scanned} checked).` });
      }
      utils.crm.facilities.list.invalidate();
      utils.crm.updates.list.invalidate();
      utils.crm.tasks.listMine.invalidate();
      utils.crm.tasks.listOverdue.invalidate();
    },
    onError: (e) => toast.error(e.message || "Sync failed. Connect your RingCentral account first."),
  });

  const connectedCount = (agents ?? []).filter((a) => a.connected).length;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          RingCentral — Calls &amp; Auto-Sync
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect <strong className="text-foreground">your own</strong> RingCentral account, then call from your RingCentral app or desk phone — the CRM pulls each of your calls in with a transcript, an AI summary, and follow-up tasks, all logged under your name.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* Per-agent connection — the primary action */}
        <RingCentralConnectCard />

        {/* Auto-sync */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" />
              Automatic call sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">
                Your calls are pulled in <strong className="text-foreground">automatically every couple of minutes</strong>. Each is matched to its facility by phone number; recorded calls get transcribed and summarized, with action items turned into tasks. Already-synced calls are never duplicated.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => sync.mutate({ lookbackMinutes: 1440 })} disabled={sync.isPending} className="gap-2">
                <RefreshCw className={`w-4 h-4 ${sync.isPending ? "animate-spin" : ""}`} />
                {sync.isPending ? "Syncing…" : "Sync my calls now"}
              </Button>
              <span className="text-xs text-muted-foreground">Pulls your last 24 hours immediately.</span>
            </div>
            {last && (
              <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                Last sync: <strong className="text-foreground">{last.logged}</strong> new · <strong className="text-foreground">{last.transcribed}</strong> transcribed · {last.matched}/{last.scanned} matched a facility.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Manager overview — who has connected */}
      {isManager && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Team RingCentral connections
              <Badge variant="outline" className="ml-1 text-[11px]">{connectedCount}/{agents?.length ?? 0} connected</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                    <th className="py-1.5 px-2 font-semibold">Agent</th>
                    <th className="py-1.5 px-2 font-semibold">RingCentral</th>
                    <th className="py-1.5 px-2 font-semibold">Status</th>
                    <th className="py-1.5 px-2 font-semibold">Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {(agents ?? []).map((a) => (
                    <tr key={a.userId} className="border-b border-border/40">
                      <td className="py-1.5 px-2">
                        <span className="text-foreground font-medium">{a.agentName ?? a.name ?? a.email ?? `User #${a.userId}`}</span>
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground">
                        {a.connected ? (a.ownerEmail ?? a.ownerName ?? "—") : <span className="text-muted-foreground/60">Not connected</span>}
                      </td>
                      <td className="py-1.5 px-2">
                        {a.connected ? (
                          <span className="inline-flex items-center gap-1 text-green-500"><CheckCircle2 className="w-3.5 h-3.5" /> Connected</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-yellow-500/90"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Pending</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-muted-foreground text-xs">
                        {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {(agents ?? []).length === 0 && (
                    <tr><td colSpan={4} className="py-3 px-2 text-center text-muted-foreground text-xs">No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Each agent connects from this page (or their Profile). Until they do, their calls won't be attributed to them. Each agent must have their own RingCentral user/extension.
            </p>
          </CardContent>
        </Card>
      )}

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How to use it</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">1</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Connect your RingCentral</p>
              <p className="text-xs mt-0.5">Click <strong className="text-foreground">Connect my RingCentral</strong> above and sign into <strong className="text-foreground">your own</strong> RingCentral account. One time only.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">2</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><MonitorSmartphone className="w-3.5 h-3.5" /> Call as usual</p>
              <p className="text-xs mt-0.5">Use the RingCentral <strong className="text-foreground">desktop app</strong>, mobile app, or your desk phone. The call just needs to go through your own RingCentral number.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">3</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> The CRM syncs automatically</p>
              <p className="text-xs mt-0.5">Within a few minutes the call appears on the matching facility's <strong className="text-foreground">Contact Log</strong>, logged under your name. Need it instantly? Hit <strong className="text-foreground">Sync my calls now</strong>.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">4</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-400" /> Transcript, summary &amp; tasks</p>
              <p className="text-xs mt-0.5">Recorded calls are transcribed and summarized by AI on the facility's <strong className="text-foreground">Updates</strong> tab, and action items become follow-up <strong className="text-foreground">tasks</strong>.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
        <PhoneCall className="w-3.5 h-3.5" />
        Click-to-call (RingOut) from any facility also uses your connected RingCentral, so those calls are attributed to you too.
      </p>
    </div>
  );
}
