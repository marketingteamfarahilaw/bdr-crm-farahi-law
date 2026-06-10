/**
 * Intake Lead Queue — every potential client, AI-scored and filterable.
 * New leads can be added manually or by pasting any text (web form message,
 * email, transcript) for instant AI analysis.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import { Inbox, Plus, Search, Sparkles, Loader2, Wand2 } from "lucide-react";
import { STATUS_META, TIER_META, SOL_META, CASE_TYPES, leadName, Chip, ScoreRing, IntakeGuard } from "./shared";

const ALL = "__all__";

export default function IntakeLeads() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { user } = useAuth();

  // Seed filters from ?status= / ?tier= (dashboard tiles link here).
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [status, setStatus] = useState<string>(params.get("status") ?? ALL);
  const [tier, setTier] = useState<string>(params.get("tier") ?? ALL);
  const [caseType, setCaseType] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "mine">("all");

  const { data: allLeads, isLoading } = trpc.intake.leads.list.useQuery({
    status: status === ALL ? undefined : (status as any),
    tier: tier === ALL ? undefined : (tier as any),
    caseType: caseType === ALL ? undefined : caseType,
    search: search.trim() || undefined,
  });
  const leads = useMemo(() => {
    const list = (allLeads ?? []) as any[];
    if (tab === "mine") return list.filter((l) => l.assignedToId === user?.id || (!l.assignedToId && l.createdById === user?.id));
    return list;
  }, [allLeads, tab, user?.id]);

  // ── New lead (manual) ──
  const [addOpen, setAddOpen] = useState(false);
  const [nFirst, setNFirst] = useState(""); const [nLast, setNLast] = useState("");
  const [nPhone, setNPhone] = useState(""); const [nType, setNType] = useState<string>("");
  const [nDesc, setNDesc] = useState("");
  const create = trpc.intake.leads.create.useMutation({
    onSuccess: (r) => {
      toast.success("Lead created");
      utils.intake.invalidate();
      setAddOpen(false);
      setNFirst(""); setNLast(""); setNPhone(""); setNType(""); setNDesc("");
      navigate(`/intake/leads/${r.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Paste & analyze ──
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const analyze = trpc.intake.leads.analyzeText.useMutation({
    onSuccess: (r) => {
      toast.success("Analyzed — lead created with AI case facts");
      utils.intake.invalidate();
      setAiOpen(false); setAiText("");
      navigate(`/intake/leads/${r.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><Inbox className="w-[18px] h-[18px] text-primary-foreground" /></div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Lead Queue</h1>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {([["all", "All Leads"], ["mine", "My Leads"]] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setTab(k)}
                        className={`text-xs font-medium px-3 py-1.5 transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{leads?.length ?? 0} lead{(leads?.length ?? 0) === 1 ? "" : "s"} — AI-scored, newest first.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setAiOpen(true)}>
                <Wand2 className="w-4 h-4" /> Paste &amp; Analyze
              </Button>
              <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" /> New Lead
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, description…" className="pl-9 bg-card border-border h-9" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-card border-border h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="bg-card border-border h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tiers</SelectItem>
                {Object.entries(TIER_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={caseType} onValueChange={setCaseType}>
              <SelectTrigger className="bg-card border-border h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All case types</SelectItem>
                {Object.entries(CASE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* List */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : (leads ?? []).length === 0 ? (
              <div className="px-5 py-14 text-center">
                <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No leads match</p>
                <p className="text-xs text-muted-foreground mt-1">Leads appear automatically from intake calls, or add one manually.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5 font-semibold">Lead</th>
                      <th className="px-4 py-2.5 font-semibold">Case</th>
                      <th className="px-4 py-2.5 font-semibold">Score</th>
                      <th className="px-4 py-2.5 font-semibold">Summary</th>
                      <th className="px-4 py-2.5 font-semibold">SOL</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Assigned</th>
                      <th className="px-4 py-2.5 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(leads ?? []).map((l: any) => (
                      <tr key={l.id} onClick={() => navigate(`/intake/leads/${l.id}`)}
                        className="border-b border-border/60 last:border-0 hover:bg-secondary/40 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{leadName(l)}</p>
                          <p className="text-xs text-muted-foreground">{l.phone ?? "no phone"}{l.preferredLanguage && l.preferredLanguage !== "English" ? ` · ${l.preferredLanguage}` : ""}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{l.caseType ? CASE_TYPES[l.caseType] ?? l.caseType : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ScoreRing score={l.qualificationScore} tier={l.qualificationTier} size={36} />
                            {l.qualificationTier && <Chip meta={TIER_META[l.qualificationTier]} />}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[280px]">
                          <p className="text-xs text-muted-foreground truncate" title={l.aiSummary ?? ""}>{l.aiSummary ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3"><Chip meta={SOL_META[l.solRisk ?? "unknown"]} /></td>
                        <td className="px-4 py-3"><Chip meta={STATUS_META[l.status]} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{l.assignedToName ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{l.createdAt ? format(new Date(l.createdAt), "MMM d, h:mm a") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* New lead dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New intake lead</DialogTitle>
              <DialogDescription>For walk-ins, web forms, or referrals taken outside RingCentral.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">First name</Label><Input value={nFirst} onChange={(e) => setNFirst(e.target.value)} className="bg-card border-border" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Last name</Label><Input value={nLast} onChange={(e) => setNLast(e.target.value)} className="bg-card border-border" /></div>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Phone</Label><Input value={nPhone} onChange={(e) => setNPhone(e.target.value)} placeholder="(555) 123-4567" className="bg-card border-border" /></div>
              <div className="space-y-1.5">
                <Label className="text-xs">Case type</Label>
                <Select value={nType} onValueChange={setNType}>
                  <SelectTrigger className="bg-card border-border"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{Object.entries(CASE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">What happened?</Label><Textarea value={nDesc} onChange={(e) => setNDesc(e.target.value)} rows={3} className="bg-card border-border" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                disabled={create.isPending || (!nFirst.trim() && !nLast.trim() && !nPhone.trim())}
                onClick={() => create.mutate({
                  firstName: nFirst.trim() || undefined, lastName: nLast.trim() || undefined,
                  phone: nPhone.trim() || undefined, caseType: (nType || undefined) as any,
                  incidentDescription: nDesc.trim() || undefined, source: "manual",
                })}
                className="gap-2"
              >
                {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Create lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Paste & analyze dialog */}
        <Dialog open={aiOpen} onOpenChange={setAiOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-primary" /> Paste &amp; Analyze</DialogTitle>
              <DialogDescription>Paste a web-form message, email, or call transcript — the AI extracts the case facts, computes the SOL deadline, and scores the lead.</DialogDescription>
            </DialogHeader>
            <Textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={10}
              placeholder="Paste the text here… (English or Spanish)" className="bg-card border-border text-sm" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAiOpen(false)}>Cancel</Button>
              <Button disabled={analyze.isPending || aiText.trim().length < 20} onClick={() => analyze.mutate({ text: aiText.trim() })} className="gap-2">
                {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {analyze.isPending ? "Analyzing…" : "Analyze & create lead"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </IntakeGuard>
  );
}
