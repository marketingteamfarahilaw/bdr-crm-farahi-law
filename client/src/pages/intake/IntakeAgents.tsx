/**
 * Intake Agents — the AI workforce (Eve's "Agents" menu).
 * Today: Maya, the 24/7 voice intake specialist (Retell AI) — status, the
 * calls she's handled, and the go-live checklist for routing a number to her.
 */
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isSuperAdmin } from "@shared/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { Bot, PhoneIncoming, CheckCircle2, Circle, ArrowUpRight, Sparkles, FlaskConical, Rocket } from "lucide-react";
import { IntakeGuard, fmtDur } from "./shared";

export default function IntakeAgents() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user?.role);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.intake.agents.status.useQuery(undefined, { refetchInterval: 60_000, enabled: superAdmin, retry: false });
  const setMode = trpc.intake.agents.setMode.useMutation({
    onSuccess: (r) => { toast.success(r.mode === "live" ? "Maya is LIVE — her calls now create leads for the whole team." : "Test mode — Maya's calls are visible only to you, no leads created."); utils.intake.agents.status.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (!superAdmin) {
    return (
      <IntakeGuard>
        <div className="min-h-full flex items-center justify-center p-10">
          <div className="text-center max-w-sm">
            <FlaskConical className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">AI Agents — coming soon</p>
            <p className="text-xs text-muted-foreground mt-1">The AI voice intake specialist is in testing and will be enabled for the team once approved.</p>
          </div>
        </div>
      </IntakeGuard>
    );
  }

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><Bot className="w-[18px] h-[18px] text-primary-foreground" /></div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Agents</h1>
              <p className="text-sm text-muted-foreground">Your AI workforce — agents that answer, interview, and qualify alongside the team.</p>
            </div>
          </div>

          {/* Test/Live mode banner */}
          {data && (
            <div className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${data.mode === "live" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
              <div className="flex items-center gap-3">
                {data.mode === "live" ? <Rocket className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> : <FlaskConical className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                <div>
                  <p className="text-sm font-semibold text-foreground">{data.mode === "live" ? "LIVE — Maya's calls create leads for the whole team" : "TEST MODE — only you see Maya's calls; no leads are created"}</p>
                  <p className="text-xs text-muted-foreground">{data.mode === "live" ? "Switch back to test mode to pause lead creation." : "Test freely — the intake team won't see anything until you go live."}</p>
                </div>
              </div>
              <Button size="sm" variant={data.mode === "live" ? "outline" : "default"} className="gap-2"
                disabled={setMode.isPending}
                onClick={() => setMode.mutate({ mode: data.mode === "live" ? "test" : "live" })}>
                {data.mode === "live" ? <><FlaskConical className="w-4 h-4" /> Back to test mode</> : <><Rocket className="w-4 h-4" /> Go live for the team</>}
              </Button>
            </div>
          )}

          {isLoading ? <Skeleton className="h-64 rounded-2xl" /> : (
            <>
              {/* Maya card */}
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="p-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
                      <Sparkles className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Maya — AI Intake Specialist</p>
                      <p className="text-sm text-muted-foreground mt-0.5 max-w-xl">
                        Answers intake calls 24/7 in English and Spanish, interviews the caller like a trained specialist
                        (incident, injuries, treatment, insurance, prior attorney), and her calls flow through the same
                        AI qualification as the team's — scored leads land in the queue automatically.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        <span className={`text-[11px] font-semibold rounded-full border px-2 py-0.5 ${data?.configured ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-secondary text-muted-foreground border-border"}`}>
                          {data?.configured ? "Agent created ✓" : "Not configured"}
                        </span>
                        <span className={`text-[11px] font-semibold rounded-full border px-2 py-0.5 ${data?.webhookReady ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "bg-secondary text-muted-foreground border-border"}`}>
                          {data?.webhookReady ? "CRM connection ✓" : "Webhook pending"}
                        </span>
                        {data?.live && <span className="text-[11px] font-semibold rounded-full border px-2 py-0.5 bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30">Voice: {data.live.voice} · {data.live.language}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-foreground leading-none" style={{ fontFamily: "'Playfair Display', serif" }}>{data?.stats.calls ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">calls handled</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-2">{data?.stats.leadsCreated ?? 0} leads</p>
                  </div>
                </div>

                {/* Go-live checklist */}
                <div className="border-t border-border px-5 py-4 bg-secondary/20">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Go-live checklist</p>
                  <div className="space-y-1.5 text-sm">
                    <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Agent created &amp; intake script installed</p>
                    <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Connected to the CRM — her calls auto-qualify into the Lead Queue</p>
                    <p className="flex items-center gap-2"><Circle className="w-4 h-4 text-muted-foreground" /> Get Maya a phone number: Retell dashboard → Phone Numbers → Buy/Import → assign to "Farahi Intake Specialist (Maya)"</p>
                    <p className="flex items-center gap-2"><Circle className="w-4 h-4 text-muted-foreground" /> In RingCentral admin: forward the intake line to Maya's number when unanswered / after hours</p>
                    <p className="flex items-center gap-2"><Circle className="w-4 h-4 text-muted-foreground" /> Place a test call and watch the lead appear in the queue</p>
                  </div>
                </div>
              </div>

              {/* Maya's calls */}
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2"><PhoneIncoming className="w-4 h-4 text-primary" /> Calls handled by Maya</span>
                  <button onClick={() => navigate("/intake/calls")} className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">All calls <ArrowUpRight className="w-3 h-3" /></button>
                </div>
                {(data?.recent ?? []).length === 0 ? (
                  <p className="px-5 py-10 text-sm text-muted-foreground text-center">No calls yet — they appear here the moment Maya answers her first one.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {(data?.recent ?? []).map((c: any) => (
                      <div key={c.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground"><span className="font-medium">{c.subject || c.fromNumber || "Call"}</span>
                            <span className="text-muted-foreground"> · {c.callDate ? format(new Date(c.callDate), "MMM d, h:mm a") : ""} · {fmtDur(c.durationSeconds)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{c.fromNumber}{c.aiSummary ? ` — ${c.aiSummary}` : ""}</p>
                        </div>
                        {c.recordingUrl && <audio controls preload="none" className="h-8 max-w-[220px]" src={c.recordingUrl} />}
                        {c.leadId && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(`/intake/leads/${c.leadId}`)}>
                            Lead <ArrowUpRight className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </IntakeGuard>
  );
}
