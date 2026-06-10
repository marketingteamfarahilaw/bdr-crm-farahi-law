/**
 * Intake Lead Detail — the AI case file.
 * Left: editable case facts (human corrections are never overwritten by the AI).
 * Right: the AI evaluation — score, rubric, red flags, missing info, next questions.
 * Below: every call with player + transcript, and the activity timeline.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { canManageIntake } from "@shared/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "@/lib/datetime";
import {
  ArrowLeft, Sparkles, Phone, AlertTriangle, HelpCircle, ListChecks, Send,
  Loader2, Pencil, X, Check, Trash2, PlayCircle, ChevronDown, ChevronUp,
  FileText, StickyNote, Scale, Flag, UserRound,
} from "lucide-react";
import { STATUS_META, TIER_META, SOL_META, CASE_TYPES, leadName, Chip, ScoreRing, IntakeGuard, fmtDur } from "./shared";

const YNU_OPTS = [["yes", "Yes"], ["no", "No"], ["unknown", "Unknown"]] as const;
const SEVERITY_OPTS = [["catastrophic", "Catastrophic"], ["severe", "Severe"], ["moderate", "Moderate"], ["minor", "Minor"], ["none", "None"], ["unknown", "Unknown"]] as const;
const TREATMENT_OPTS = [["hospitalized", "Hospitalized"], ["er_visit", "ER visit"], ["ongoing", "Ongoing treatment"], ["completed", "Completed"], ["none", "No treatment"], ["unknown", "Unknown"]] as const;
const LIABILITY_OPTS = [["clear_other_party", "Clear — other party"], ["mostly_other_party", "Mostly other party"], ["shared", "Shared fault"], ["unclear", "Unclear"], ["client_at_fault", "Client at fault"], ["unknown", "Unknown"]] as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2 grid grid-cols-[140px_1fr] gap-3 items-start border-b border-border/50 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-0.5">{label}</span>
      <span className="text-sm text-foreground min-w-0">{children ?? "—"}</span>
    </div>
  );
}

function RubricBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-semibold text-foreground">{value}<span className="text-muted-foreground font-normal">/{max}</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function IntakeLeadDetail() {
  const params = useParams<{ id: string }>();
  const leadId = parseInt(params.id, 10);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isMgr = canManageIntake(user?.role);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.intake.leads.get.useQuery({ id: leadId }, { enabled: !!leadId });
  const { data: team } = trpc.intake.team.list.useQuery(undefined, { enabled: isMgr });
  const lead: any = data?.lead;
  const refresh = () => { utils.intake.leads.get.invalidate({ id: leadId }); utils.intake.leads.list.invalidate(); utils.intake.dashboard.stats.invalidate(); };

  const onErr = (e: any) => toast.error(e.message);
  const updateStatus = trpc.intake.leads.updateStatus.useMutation({ onSuccess: () => { toast.success("Status updated"); refresh(); }, onError: onErr });
  const assign = trpc.intake.leads.assign.useMutation({ onSuccess: () => { toast.success("Assignment updated"); refresh(); }, onError: onErr });
  const reanalyze = trpc.intake.leads.reanalyze.useMutation({ onSuccess: () => { toast.success("AI re-analysis complete"); refresh(); }, onError: onErr });
  const sendFv = trpc.intake.leads.sendToFilevine.useMutation({ onSuccess: () => { toast.success("Pushed to Filevine"); refresh(); }, onError: onErr });
  const del = trpc.intake.leads.delete.useMutation({ onSuccess: () => { toast.success("Lead deleted"); navigate("/intake/leads"); }, onError: onErr });
  const addNote = trpc.intake.leads.addNote.useMutation({ onSuccess: () => { setNote(""); refresh(); }, onError: onErr });
  const update = trpc.intake.leads.update.useMutation({ onSuccess: () => { toast.success("Case facts saved — score recalculated"); setEditing(false); refresh(); }, onError: onErr });

  // ── Edit mode ──
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => {
    if (lead && editing) {
      setForm({
        firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", phone: lead.phone ?? "", email: lead.email ?? "",
        clientLocation: lead.clientLocation ?? "", caseType: lead.caseType ?? "",
        incidentDate: lead.incidentDate ? format(new Date(lead.incidentDate), "yyyy-MM-dd") : "",
        incidentLocation: lead.incidentLocation ?? "", incidentDescription: lead.incidentDescription ?? "",
        injuries: lead.injuries ?? "", injurySeverity: lead.injurySeverity ?? "unknown",
        treatmentStatus: lead.treatmentStatus ?? "unknown", treatmentDetails: lead.treatmentDetails ?? "",
        liabilityAssessment: lead.liabilityAssessment ?? "unknown", liabilityNotes: lead.liabilityNotes ?? "",
        policeReport: lead.policeReport ?? "unknown", defendantInsurer: lead.defendantInsurer ?? "",
        clientInsurer: lead.clientInsurer ?? "", umCoverage: lead.umCoverage ?? "unknown",
        healthInsurance: lead.healthInsurance ?? "", priorAttorney: lead.priorAttorney ?? "unknown",
        governmentEntity: lead.governmentEntity ?? "unknown", referredBy: lead.referredBy ?? "",
      });
    }
  }, [editing, lead]);
  const f = (k: string) => form[k] ?? "";
  const setF = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const saveEdit = () => {
    update.mutate({
      id: leadId,
      patch: {
        firstName: f("firstName").trim() || null, lastName: f("lastName").trim() || null,
        phone: f("phone").trim() || null, email: f("email").trim() || null,
        clientLocation: f("clientLocation").trim() || null,
        caseType: f("caseType") || null,
        incidentDate: f("incidentDate") || null,
        incidentLocation: f("incidentLocation").trim() || null,
        incidentDescription: f("incidentDescription").trim() || null,
        injuries: f("injuries").trim() || null,
        injurySeverity: f("injurySeverity"), treatmentStatus: f("treatmentStatus"),
        treatmentDetails: f("treatmentDetails").trim() || null,
        liabilityAssessment: f("liabilityAssessment"),
        liabilityNotes: f("liabilityNotes").trim() || null,
        policeReport: f("policeReport"),
        defendantInsurer: f("defendantInsurer").trim() || null,
        clientInsurer: f("clientInsurer").trim() || null,
        umCoverage: f("umCoverage"),
        healthInsurance: f("healthInsurance").trim() || null,
        priorAttorney: f("priorAttorney"), governmentEntity: f("governmentEntity"),
        referredBy: f("referredBy").trim() || null,
      },
    });
  };

  // ── Status change (terminal ones ask for a note) ──
  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const applyStatus = (s: string) => {
    if (["unqualified", "referred_out", "lost", "duplicate"].includes(s)) { setStatusDialog(s); setStatusNote(""); }
    else updateStatus.mutate({ id: leadId, status: s as any });
  };

  const [note, setNote] = useState("");
  const [openTranscripts, setOpenTranscripts] = useState<Record<number, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const analysis: any = lead?.aiAnalysis ?? {};
  const extraction: any = analysis.extraction ?? {};
  const rubric: any = analysis.rubric ?? null;
  const ynu = (v?: string | null) => (v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown");

  const events = useMemo(() => (data?.events ?? []) as any[], [data]);
  const calls = useMemo(() => (data?.calls ?? []) as any[], [data]);

  if (isLoading || !lead) {
    return (
      <div className="min-h-full bg-background p-6 lg:p-8"><div className="max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-24 rounded-2xl" /><div className="grid lg:grid-cols-2 gap-4"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      </div></div>
    );
  }

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-6xl mx-auto space-y-5">
          {/* Header */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <button onClick={() => navigate("/intake/leads")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3">
              <ArrowLeft className="w-3.5 h-3.5" /> Lead Queue
            </button>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <ScoreRing score={lead.qualificationScore} tier={lead.qualificationTier} size={64} />
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-foreground truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{leadName(lead)}</h1>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {lead.qualificationTier && <Chip meta={TIER_META[lead.qualificationTier]} />}
                    <Chip meta={STATUS_META[lead.status]} />
                    <Chip meta={SOL_META[lead.solRisk ?? "unknown"]} />
                    {lead.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
                    {lead.preferredLanguage && <span className="text-xs text-muted-foreground">· {lead.preferredLanguage}</span>}
                    {lead.solDate && <span className="text-xs text-muted-foreground">· SOL deadline {format(new Date(lead.solDate), "MMM d, yyyy")}</span>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={lead.status} onValueChange={applyStatus} disabled={updateStatus.isPending}>
                  <SelectTrigger className="bg-card border-border h-9 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
                {isMgr && (
                  <Select value={lead.assignedToId ? String(lead.assignedToId) : "__none__"}
                    onValueChange={(v) => assign.mutate({ id: leadId, userId: v === "__none__" ? null : parseInt(v, 10) })}>
                    <SelectTrigger className="bg-card border-border h-9 w-[170px]"><UserRound className="w-3.5 h-3.5 mr-1 text-muted-foreground" /><SelectValue placeholder="Assign…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {(team ?? []).map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" className="gap-2" onClick={() => reanalyze.mutate({ id: leadId })} disabled={reanalyze.isPending}>
                  {reanalyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Re-run AI
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => sendFv.mutate({ id: leadId })} disabled={sendFv.isPending}>
                  {sendFv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {lead.filevineSyncedAt ? "Re-send to Filevine" : "Send to Filevine"}
                </Button>
                {isMgr && (
                  <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            {lead.filevineSyncedAt && (
              <p className="text-[11px] text-muted-foreground mt-3">Filevine: last pushed {formatDistanceToNow(new Date(lead.filevineSyncedAt), { addSuffix: true })}</p>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* ── Case facts ── */}
            <div className="rounded-2xl border border-border bg-card shadow-sm">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Case Facts</span>
                {editing ? (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setEditing(false)}><X className="w-3.5 h-3.5" /> Cancel</Button>
                    <Button size="sm" className="h-7 gap-1" onClick={saveEdit} disabled={update.isPending}>
                      {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-muted-foreground" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                )}
              </div>
              <div className="px-5 py-3">
                {!editing ? (
                  <>
                    <Fact label="Client">{leadName(lead)}{lead.callerName && lead.callerName !== leadName(lead) ? ` (caller: ${lead.callerName}${lead.callerRelationship ? `, ${lead.callerRelationship}` : ""})` : ""}</Fact>
                    <Fact label="Contact">{[lead.phone, lead.email].filter(Boolean).join(" · ") || "—"}</Fact>
                    <Fact label="Location">{lead.clientLocation ?? "—"}</Fact>
                    <Fact label="Case type">{lead.caseType ? CASE_TYPES[lead.caseType] ?? lead.caseType : "—"}</Fact>
                    <Fact label="Incident date">{lead.incidentDate ? format(new Date(lead.incidentDate), "MMMM d, yyyy") : "—"}</Fact>
                    <Fact label="Where">{lead.incidentLocation ?? "—"}</Fact>
                    <Fact label="What happened">{lead.incidentDescription ?? "—"}</Fact>
                    <Fact label="Injuries">{lead.injuries ?? "—"}{lead.injurySeverity && lead.injurySeverity !== "unknown" ? ` (${lead.injurySeverity})` : ""}</Fact>
                    <Fact label="Treatment">{(TREATMENT_OPTS.find(([k]) => k === lead.treatmentStatus)?.[1]) ?? "Unknown"}{lead.treatmentDetails ? ` — ${lead.treatmentDetails}` : ""}</Fact>
                    <Fact label="Liability">{(LIABILITY_OPTS.find(([k]) => k === lead.liabilityAssessment)?.[1]) ?? "Unknown"}{lead.liabilityNotes ? ` — ${lead.liabilityNotes}` : ""}</Fact>
                    <Fact label="Police report">{ynu(lead.policeReport)}</Fact>
                    <Fact label="Their insurance">{lead.defendantInsurer ?? "Unknown"}</Fact>
                    <Fact label="Client insurance">{[lead.clientInsurer, lead.healthInsurance && `health: ${lead.healthInsurance}`].filter(Boolean).join(" · ") || "Unknown"}</Fact>
                    <Fact label="UM/UIM coverage">{ynu(lead.umCoverage)}</Fact>
                    <Fact label="Lost wages">{ynu(lead.lostWages)}</Fact>
                    <Fact label="Prior attorney">{ynu(lead.priorAttorney)}</Fact>
                    <Fact label="Govt. entity">{ynu(lead.governmentEntity)}</Fact>
                    <Fact label="Referred by">{lead.referredBy ?? "—"}</Fact>
                  </>
                ) : (
                  <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs">First name</Label><Input value={f("firstName")} onChange={(e) => setF("firstName", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Last name</Label><Input value={f("lastName")} onChange={(e) => setF("lastName", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={f("phone")} onChange={(e) => setF("phone", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={f("email")} onChange={(e) => setF("email", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Client location</Label><Input value={f("clientLocation")} onChange={(e) => setF("clientLocation", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Case type</Label>
                        <Select value={f("caseType") || "__none__"} onValueChange={(v) => setF("caseType", v === "__none__" ? "" : v)}>
                          <SelectTrigger className="bg-card border-border h-8"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="__none__">Unknown</SelectItem>{Object.entries(CASE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Incident date</Label><Input type="date" value={f("incidentDate")} onChange={(e) => setF("incidentDate", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Incident location</Label><Input value={f("incidentLocation")} onChange={(e) => setF("incidentLocation", e.target.value)} className="bg-card border-border h-8" /></div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">What happened</Label><Textarea value={f("incidentDescription")} onChange={(e) => setF("incidentDescription", e.target.value)} rows={3} className="bg-card border-border text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs">Injuries</Label><Textarea value={f("injuries")} onChange={(e) => setF("injuries", e.target.value)} rows={2} className="bg-card border-border text-sm" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        ["injurySeverity", "Injury severity", SEVERITY_OPTS],
                        ["treatmentStatus", "Treatment", TREATMENT_OPTS],
                        ["liabilityAssessment", "Liability", LIABILITY_OPTS],
                        ["policeReport", "Police report", YNU_OPTS],
                        ["umCoverage", "UM/UIM coverage", YNU_OPTS],
                        ["priorAttorney", "Prior attorney", YNU_OPTS],
                        ["governmentEntity", "Government entity", YNU_OPTS],
                      ] as const).map(([key, label, opts]) => (
                        <div key={key} className="space-y-1"><Label className="text-xs">{label}</Label>
                          <Select value={f(key)} onValueChange={(v) => setF(key, v)}>
                            <SelectTrigger className="bg-card border-border h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{opts.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      ))}
                      <div className="space-y-1"><Label className="text-xs">Defendant insurer</Label><Input value={f("defendantInsurer")} onChange={(e) => setF("defendantInsurer", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Client insurer</Label><Input value={f("clientInsurer")} onChange={(e) => setF("clientInsurer", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Health insurance</Label><Input value={f("healthInsurance")} onChange={(e) => setF("healthInsurance", e.target.value)} className="bg-card border-border h-8" /></div>
                      <div className="space-y-1"><Label className="text-xs">Referred by</Label><Input value={f("referredBy")} onChange={(e) => setF("referredBy", e.target.value)} className="bg-card border-border h-8" /></div>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Liability notes</Label><Textarea value={f("liabilityNotes")} onChange={(e) => setF("liabilityNotes", e.target.value)} rows={2} className="bg-card border-border text-sm" /></div>
                  </div>
                )}
              </div>
            </div>

            {/* ── AI evaluation ── */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card shadow-sm">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> AI Case Evaluation</span>
                  {analysis.lastAnalyzedAt && <span className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(analysis.lastAnalyzedAt), { addSuffix: true })}</span>}
                </div>
                <div className="p-5 space-y-4">
                  {!rubric ? (
                    <p className="text-sm text-muted-foreground">Not analyzed yet — link a call with a transcript or use “Re-run AI”.</p>
                  ) : (
                    <>
                      {lead.aiSummary && <p className="text-sm text-foreground leading-relaxed">{lead.aiSummary}</p>}
                      <div className="grid grid-cols-2 gap-x-5 gap-y-3 pt-1">
                        <RubricBar label="Liability" value={rubric.liability ?? 0} max={30} />
                        <RubricBar label="Injury & damages" value={rubric.injury ?? 0} max={30} />
                        <RubricBar label="Insurance coverage" value={rubric.coverage ?? 0} max={20} />
                        <RubricBar label="Time to SOL" value={rubric.sol ?? 0} max={10} />
                        <RubricBar label="Client factors" value={rubric.client ?? 0} max={10} />
                        <div className="flex items-end justify-end">
                          <span className="text-xs text-muted-foreground mr-2 mb-0.5">Total</span>
                          <span className="text-2xl font-bold text-foreground leading-none" style={{ fontFamily: "'Playfair Display', serif" }}>{rubric.total ?? 0}<span className="text-sm text-muted-foreground font-normal">/100</span></span>
                        </div>
                      </div>
                      {(rubric.caps ?? []).length > 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">Score capped: {(rubric.caps as string[]).join("; ")}</p>
                      )}
                      {lead.aiRecommendation && (
                        <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1 flex items-center gap-1.5"><Flag className="w-3 h-3" /> Recommendation</p>
                          <p className="text-sm text-foreground">{lead.aiRecommendation}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {((extraction.redFlags ?? []).length > 0 || (extraction.missingInfo ?? []).length > 0 || (extraction.suggestedQuestions ?? []).length > 0) && (
                <div className="rounded-2xl border border-border bg-card shadow-sm p-5 space-y-4">
                  {(extraction.redFlags ?? []).length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-destructive mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Red flags</p>
                      <ul className="space-y-1">{(extraction.redFlags as string[]).map((r, i) => <li key={i} className="text-sm text-foreground flex gap-2"><span className="text-destructive">•</span>{r}</li>)}</ul>
                    </div>
                  )}
                  {(extraction.missingInfo ?? []).length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5"><ListChecks className="w-3 h-3" /> Still missing</p>
                      <ul className="space-y-1">{(extraction.missingInfo as string[]).map((r, i) => <li key={i} className="text-sm text-muted-foreground flex gap-2"><span>•</span>{r}</li>)}</ul>
                    </div>
                  )}
                  {(extraction.suggestedQuestions ?? []).length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-2 flex items-center gap-1.5"><HelpCircle className="w-3 h-3" /> Ask next</p>
                      <ol className="space-y-1 list-decimal list-inside">{(extraction.suggestedQuestions as string[]).map((q, i) => <li key={i} className="text-sm text-foreground">{q}</li>)}</ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Calls ── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> Calls ({calls.length})</span>
            </div>
            {calls.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No calls linked yet — intake calls auto-link by phone number.</p>
            ) : (
              <div className="divide-y divide-border">
                {calls.map((c) => (
                  <div key={c.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <PlayCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          {c.direction ?? "Call"} · {c.callDate ? format(new Date(c.callDate), "MMM d, yyyy h:mm a") : "—"} · {fmtDur(c.durationSeconds)} · {c.callResult ?? ""}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{c.agentName ? `Handled by ${c.agentName}` : ""}{c.aiSummary ? ` — ${c.aiSummary}` : ""}</p>
                      </div>
                      {c.hasRecording === 1 && (
                        <audio controls preload="none" className="h-8 max-w-[260px]" src={`/api/intake-recording/${c.id}`} />
                      )}
                      {c.transcript && (
                        <button onClick={() => setOpenTranscripts((p) => ({ ...p, [c.id]: !p[c.id] }))}
                          className="text-xs text-primary font-medium flex items-center gap-1 hover:underline shrink-0">
                          Transcript {openTranscripts[c.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                    {openTranscripts[c.id] && c.transcript && (
                      <pre className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap bg-secondary/40 border border-border rounded-xl p-4 max-h-72 overflow-y-auto font-sans">{c.transcript}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Activity ── */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2"><StickyNote className="w-4 h-4 text-primary" /> Activity</span>
            </div>
            <div className="px-5 py-3 border-b border-border flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="bg-card border-border h-9"
                onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) addNote.mutate({ id: leadId, note: note.trim() }); }} />
              <Button size="sm" className="h-9" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate({ id: leadId, note: note.trim() })}>
                {addNote.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {events.length === 0 && <p className="px-5 py-6 text-sm text-muted-foreground">No activity yet.</p>}
              {events.map((ev) => (
                <div key={ev.id} className="px-5 py-3 flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                    {ev.eventType === "ai_analysis" ? <Sparkles className="w-3.5 h-3.5 text-primary" />
                      : ev.eventType === "note" ? <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
                      : ev.eventType === "signed" ? <Scale className="w-3.5 h-3.5 text-primary" />
                      : ev.eventType === "filevine_push" ? <Send className="w-3.5 h-3.5 text-muted-foreground" />
                      : ev.eventType === "call_linked" ? <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      : <Flag className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{ev.title}</p>
                    {ev.detail && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{ev.detail}</p>}
                    <p className="text-[11px] text-muted-foreground mt-1">{ev.actorName ? `${ev.actorName} · ` : ""}{ev.createdAt ? format(new Date(ev.createdAt), "MMM d, yyyy h:mm a") : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Terminal-status note dialog */}
        <Dialog open={!!statusDialog} onOpenChange={(o) => !o && setStatusDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mark as {statusDialog ? STATUS_META[statusDialog]?.label : ""}</DialogTitle>
              <DialogDescription>Add a short reason — it goes on the lead's record.</DialogDescription>
            </DialogHeader>
            <Textarea value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={3} placeholder="Reason…" className="bg-card border-border text-sm" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancel</Button>
              <Button onClick={() => { updateStatus.mutate({ id: leadId, status: statusDialog as any, note: statusNote.trim() || undefined }); setStatusDialog(null); }} disabled={updateStatus.isPending}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete this lead?</DialogTitle>
              <DialogDescription>The lead, its events, and call links are removed. Calls themselves stay in the call log. This can't be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => del.mutate({ id: leadId })} disabled={del.isPending}>
                {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </IntakeGuard>
  );
}
