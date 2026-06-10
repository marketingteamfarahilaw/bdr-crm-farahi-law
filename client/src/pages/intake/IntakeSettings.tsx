/**
 * Intake Settings — per-user RingCentral connection (everyone) and the
 * Filevine intake webhook (managers).
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { canManageIntake } from "@shared/permissions";
import RingCentralConnectCard from "@/components/RingCentralConnectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Settings, Link2, Loader2, Sparkles, PhoneCall, Gauge, Send } from "lucide-react";
import { IntakeGuard } from "./shared";

export default function IntakeSettings() {
  const { user } = useAuth();
  const isMgr = canManageIntake(user?.role);
  const utils = trpc.useUtils();

  const { data: settings, isLoading } = trpc.intake.settings.get.useQuery(undefined, { enabled: isMgr, retry: false });
  const [url, setUrl] = useState("");
  useEffect(() => { if (settings) setUrl(settings.webhookUrl ?? ""); }, [settings]);

  const save = trpc.intake.settings.set.useMutation({
    onSuccess: () => { toast.success("Webhook saved"); utils.intake.settings.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><Settings className="w-[18px] h-[18px] text-primary-foreground" /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Intake Settings</h1>
              <p className="text-sm text-muted-foreground">Your call connection and the Filevine hand-off.</p>
            </div>
          </div>

          {/* Per-user RingCentral connection — the engine of the whole desk */}
          <RingCentralConnectCard />

          {/* How the pipeline works */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> How the AI Case Desk works</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex gap-2.5"><PhoneCall className="w-4 h-4 mt-0.5 shrink-0 text-primary" /> Every call on your RingCentral extension is captured automatically (every ~2 minutes) and recorded calls are transcribed — English or Spanish.</li>
                <li className="flex gap-2.5"><Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary" /> The AI fills the intake sheet: incident, injuries, treatment, liability, insurance, prior attorney — and computes the California statute-of-limitations deadline.</li>
                <li className="flex gap-2.5"><Gauge className="w-4 h-4 mt-0.5 shrink-0 text-primary" /> Each lead is scored 0–100 (liability 30 · injury 30 · coverage 20 · SOL 10 · client 10) and tiered: Hot, Qualified, Needs Review, Unqualified. Your edits always win over the AI.</li>
                <li className="flex gap-2.5"><Send className="w-4 h-4 mt-0.5 shrink-0 text-primary" /> Marking a lead Qualified or Signed pushes the full case package to Filevine through the webhook below. Signed leads also create the PI-client record.</li>
              </ol>
            </CardContent>
          </Card>

          {/* Filevine webhook (managers) */}
          {isMgr && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Filevine intake webhook</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Qualified &amp; signed leads POST here as JSON (<code className="text-[11px] bg-secondary px-1 py-0.5 rounded">event: "intake_lead"</code> with client info, case facts, score, and red flags).
                  Point it at your Zapier / n8n flow that creates the Filevine project. Leave empty to fall back to the shared call-recap webhook.
                </p>
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Webhook URL</Label>
                      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" className="bg-card border-border font-mono text-xs" />
                    </div>
                    {settings?.effectiveUrl && !url && (
                      <p className="text-[11px] text-muted-foreground">Currently inheriting: <span className="font-mono">{settings.effectiveUrl}</span></p>
                    )}
                    <Button size="sm" className="gap-2" onClick={() => save.mutate({ webhookUrl: url.trim() })} disabled={save.isPending}>
                      {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save webhook
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </IntakeGuard>
  );
}
