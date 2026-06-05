import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { seesAllData } from "@shared/permissions";
import { LogOutcomeDialog } from "@/components/LogOutcomeDialog";
import { formatDistanceToNow } from "date-fns";
import { Building2, User, Search, GripVertical, Send, Workflow, ArrowRight } from "lucide-react";

// Pipeline stages, in flow order, using the EXISTING partnerStatus values
// (no schema change). BDR drives the left side (acquisition); FR drives the
// right side (nurturing + reactivation).
const STAGES = [
  { key: "prospect", label: "Prospect", accent: "sky", hint: "New — not yet contacted" },
  { key: "needs_follow_up", label: "Working / Follow-Up", accent: "orange", hint: "In conversation" },
  { key: "active_partner", label: "Active Partner", accent: "emerald", hint: "Sending referrals" },
  { key: "priority_partner", label: "Priority Partner", accent: "amber", hint: "Top relationships" },
  { key: "dormant", label: "Dormant", accent: "slate", hint: "Went cold — reactivate" },
  { key: "do_not_use", label: "Do Not Use", accent: "red", hint: "Excluded" },
] as const;

const ACCENT: Record<string, { dot: string; ring: string; text: string; head: string }> = {
  sky: { dot: "bg-sky-400", ring: "ring-sky-500/50", text: "text-sky-400", head: "border-sky-500/30" },
  orange: { dot: "bg-orange-400", ring: "ring-orange-500/50", text: "text-orange-400", head: "border-orange-500/30" },
  emerald: { dot: "bg-emerald-400", ring: "ring-emerald-500/50", text: "text-emerald-400", head: "border-emerald-500/30" },
  amber: { dot: "bg-amber-400", ring: "ring-amber-500/50", text: "text-amber-400", head: "border-amber-500/30" },
  slate: { dot: "bg-slate-400", ring: "ring-slate-500/50", text: "text-slate-400", head: "border-slate-500/30" },
  red: { dot: "bg-red-400", ring: "ring-red-500/50", text: "text-red-300", head: "border-red-900/40" },
};

const CATEGORY_LABELS: Record<string, string> = {
  body_shop: "Body Shop",
  chiropractor: "Chiropractor",
  physical_therapist: "Physical Therapist",
  medical_clinic: "Medical Clinic",
  orthopedic_doctor: "Orthopedic Doctor",
  imaging_center: "Imaging Center",
  other: "Other",
};

export default function Pipeline() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isManager = seesAllData(user?.role);

  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Optimistic status overrides keyed by facility id, kept until the refetch lands.
  const [optimistic, setOptimistic] = useState<Record<number, string>>({});

  const { data: facilities, isLoading } = trpc.crm.facilities.list.useQuery(undefined, { retry: false });

  const updateStatus = trpc.crm.facilities.update.useMutation({
    onSuccess: async (_d, vars: any) => {
      await utils.crm.facilities.list.invalidate();
      setOptimistic((o) => {
        const n = { ...o };
        delete n[vars.id];
        return n;
      });
    },
    onError: (e, vars: any) => {
      toast.error(e.message || "Couldn't move that partner.");
      setOptimistic((o) => {
        const n = { ...o };
        delete n[vars.id];
        return n;
      });
    },
  });

  const statusOf = (f: any): string => optimistic[f.id] ?? f.partnerStatus ?? "prospect";

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const g: Record<string, any[]> = {};
    for (const s of STAGES) g[s.key] = [];
    for (const f of facilities ?? []) {
      if (q && !`${f.name ?? ""} ${f.assignedRepName ?? ""} ${f.address ?? ""}`.toLowerCase().includes(q)) continue;
      const key = statusOf(f);
      (g[key] ?? g.prospect).push(f);
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilities, search, optimistic]);

  const move = (id: number, toStage: string, from?: string) => {
    if (from === toStage) return;
    setOptimistic((o) => ({ ...o, [id]: toStage }));
    updateStatus.mutate({ id, partnerStatus: toStage as any });
    toast.success(`Moved to ${STAGES.find((s) => s.key === toStage)?.label ?? toStage}`);
  };

  const total = facilities?.length ?? 0;

  return (
    <div className="dashboard-mesh min-h-full flex flex-col">
      {/* Header */}
      <div className="px-6 lg:px-8 pt-6 pb-4 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Workflow className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Partner Pipeline
              </h1>
              <p className="text-sm text-muted-foreground">
                {isManager ? "Every partner across the team" : "Your partners"} · drag a card to move it through the pipeline
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search partners…"
              className="pl-9 bg-card border-border"
            />
          </div>
        </div>
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-4 px-6 lg:px-8 pb-6 overflow-x-auto">
          {STAGES.map((s) => (
            <div key={s.key} className="min-w-[300px] w-[300px] space-y-3">
              <Skeleton className="h-9 rounded-lg" />
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
          <Building2 className="w-12 h-12 text-muted-foreground/40 mb-3" />
          <p className="text-foreground font-medium">No partners yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add facilities and they'll show up here as cards.</p>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 px-6 lg:px-8 pb-6 overflow-x-auto">
          {STAGES.map((stage) => {
            const a = ACCENT[stage.accent];
            const cards = grouped[stage.key] ?? [];
            const isOver = overStage === stage.key;
            return (
              <div
                key={stage.key}
                className={`min-w-[300px] w-[300px] flex flex-col rounded-2xl border bg-card/40 transition-all ${
                  isOver ? `ring-2 ${a.ring} border-transparent` : "border-border/60"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overStage !== stage.key) setOverStage(stage.key);
                }}
                onDragLeave={(e) => {
                  // only clear if leaving the column entirely
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((s) => (s === stage.key ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = Number(e.dataTransfer.getData("text/plain"));
                  const f = (facilities ?? []).find((x: any) => x.id === id);
                  if (id) move(id, stage.key, f ? statusOf(f) : undefined);
                  setOverStage(null);
                  setDragId(null);
                }}
              >
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2.5 border-b ${a.head}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full ${a.dot} shrink-0`} />
                    <span className="font-semibold text-sm text-foreground truncate">{stage.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums bg-secondary/60 rounded-full px-2 py-0.5 shrink-0">
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-230px)]">
                  {cards.length === 0 && (
                    <div className="text-[11px] text-muted-foreground/60 text-center py-6 px-2">{stage.hint}</div>
                  )}
                  {cards.map((f: any) => {
                    const last = f.lastContact?.contactDate ? new Date(f.lastContact.contactDate) : null;
                    return (
                      <div
                        key={f.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(f.id));
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(f.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        onClick={() => navigate(`/crm/facilities/${f.id}`)}
                        className={`group premium-card rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-all ${
                          dragId === f.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0 group-hover:text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground leading-tight truncate">{f.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {CATEGORY_LABELS[f.category] ?? f.category ?? "—"}
                              {f.address ? ` · ${f.address}` : ""}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {isManager && f.assignedRepName && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <User className="w-3 h-3" /> {f.assignedRepName}
                                </span>
                              )}
                              {(f.totalLeadsSent ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/90">
                                  <Send className="w-3 h-3" /> {f.totalLeadsSent}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {last ? formatDistanceToNow(last, { addSuffix: true }) : "no contact yet"}
                              </span>
                            </div>
                            <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <LogOutcomeDialog
                                facilityId={f.id}
                                facilityName={f.name}
                                trigger={
                                  <button onClick={(e) => e.stopPropagation()} className="w-full text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-card hover:bg-accent">
                                    Log call / visit
                                  </button>
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Flow hint footer */}
      <div className="px-6 lg:px-8 pb-4 shrink-0 hidden md:flex items-center gap-2 text-[11px] text-muted-foreground/70">
        <span className="font-medium">Flow:</span>
        {STAGES.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className={ACCENT[s.accent].text}>{s.label}</span>
            {i < STAGES.length - 1 && <ArrowRight className="w-3 h-3 opacity-50" />}
          </span>
        ))}
      </div>
    </div>
  );
}
