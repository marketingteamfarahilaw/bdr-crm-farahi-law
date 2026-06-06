import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Phone, CheckCircle2, PhoneCall, FileText, Sparkles, RefreshCw, MonitorSmartphone, Clock } from "lucide-react";

export default function RingCentralSettings() {
  const { data: status } = trpc.crm.ringcentral.status.useQuery();
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
    onError: (e) => toast.error(e.message || "Sync failed. Check the RingCentral connection."),
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          RingCentral — Calls &amp; Auto-Sync
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Call from your RingCentral app or desk phone — the CRM automatically pulls each call in with a transcript, an AI summary, and follow-up tasks.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
      {/* Auto-sync — the primary mechanism */}
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
              Calls are pulled in <strong className="text-foreground">automatically every 5 minutes</strong>. Each call is matched to its facility by phone number; recorded calls get transcribed and summarized, with action items turned into tasks. Already-synced calls are never duplicated.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => sync.mutate({ lookbackMinutes: 1440 })} disabled={sync.isPending} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? "Syncing…" : "Sync now"}
            </Button>
            <span className="text-xs text-muted-foreground">Pulls the last 24 hours immediately.</span>
          </div>
          {last && (
            <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2 text-xs text-muted-foreground">
              Last sync: <strong className="text-foreground">{last.logged}</strong> new · <strong className="text-foreground">{last.transcribed}</strong> transcribed · {last.matched}/{last.scanned} matched a facility.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Phone className="w-4 h-4" />
            RingCentral connection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status?.connected ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Connected as <span className="text-green-400">{status.ownerName}</span>
                </p>
                {status.tokenExpiry && (
                  <p className="text-xs text-muted-foreground mt-0.5">Session active · renews automatically</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
              </div>
              <p className="text-sm text-muted-foreground">
                Server-side sync uses your RingCentral JWT — it stays connected on its own. If sync errors, check the credentials in the server <code>.env</code>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* How it works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How to use it</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">1</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><MonitorSmartphone className="w-3.5 h-3.5" /> Call from the RingCentral app</p>
              <p className="text-xs mt-0.5">Use the RingCentral <strong className="text-foreground">desktop app</strong>, mobile app, or your desk phone — whatever's most reliable. Calls just need to go through your RingCentral number.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">2</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> The CRM syncs automatically</p>
              <p className="text-xs mt-0.5">Within a few minutes the call appears on the matching facility's <strong className="text-foreground">Contact Log</strong>. Need it instantly? Hit <strong className="text-foreground">Sync now</strong> above.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">3</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-blue-400" /> Transcript, summary &amp; tasks</p>
              <p className="text-xs mt-0.5">Recorded calls are transcribed and summarized by AI (what was discussed, commitments, next steps) on the facility's <strong className="text-foreground">Updates</strong> tab, and action items become follow-up <strong className="text-foreground">tasks</strong>.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0 text-xs w-6 h-6 flex items-center justify-center p-0 rounded-full">4</Badge>
            <div>
              <p className="text-foreground font-medium flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5" /> Or per-facility</p>
              <p className="text-xs mt-0.5">On any facility profile you can also <strong className="text-foreground">Sync calls</strong> just for that partner.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        The in-app phone widget (bottom-right) still works for click-to-dial if you prefer it, but it's optional — the desktop app plus auto-sync is the reliable path.
      </p>
    </div>
  );
}
