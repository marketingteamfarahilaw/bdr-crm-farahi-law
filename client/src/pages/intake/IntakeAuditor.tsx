/**
 * Intake Auditor — the Eve-style matrix over every lead.
 * One row per potential client, one column per audit signal (severity,
 * fracture, TBI, surgery, scarring, liability, coverage, SOL…), with preset
 * views that surface what needs attention: High Value, Evidence Gaps,
 * Carrier & Coverage Gaps, SOL Risk.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "@/lib/datetime";
import { Search, ScanSearch } from "lucide-react";
import { STATUS_META, TIER_META, SOL_META, CASE_TYPES, leadName, IntakeGuard } from "./shared";

type Tone = "teal" | "yellow" | "red" | "gray";
const TONE_CLS: Record<Tone, string> = {
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  yellow: "bg-amber-400/20 text-amber-700 dark:text-amber-300 border-amber-500/30",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  gray: "bg-secondary text-muted-foreground border-border",
};

function Cell({ label, tone = "gray" }: { label: string; tone?: Tone }) {
  return <span className={`inline-flex items-center text-[11px] font-medium rounded-md border px-2 py-0.5 whitespace-nowrap ${TONE_CLS[tone]}`}>{label}</span>;
}

// value → [label, tone] maps for each audit signal
const V = {
  severity: { catastrophic: ["Catastrophic", "red"], severe: ["Severe", "teal"], moderate: ["Significant", "teal"], minor: ["Minor", "yellow"], none: ["None", "gray"], unknown: ["Unknown", "gray"] },
  liability: { clear_other_party: ["Clear", "teal"], mostly_other_party: ["Mostly Clear", "teal"], shared: ["Shared", "yellow"], unclear: ["Undetermined", "yellow"], client_at_fault: ["Client At Fault", "red"], unknown: ["Unknown", "gray"] },
  diagnosed: { diagnosed: ["Diagnosed", "teal"], suspected: ["Potentially Undiagnosed", "yellow"], no_indication: ["No Indication", "gray"] },
  surgery: { completed: ["Complete", "teal"], recommended: ["Outstanding", "yellow"], no_indication: ["No Indication", "gray"] },
  scarring: { present: ["Present", "teal"], possible: ["Possible", "yellow"], no_indication: ["No Indication", "gray"] },
  impairment: { likely: ["Likely", "teal"], possible: ["Potentially Undiagnosed", "yellow"], no_indication: ["No Indication", "gray"] },
  loc: { yes: ["Yes", "teal"], no: ["No", "gray"], unknown: ["Unknown", "gray"] },
  priorInjury: { yes: ["Prior Same Region", "red"], no: ["None", "teal"], unknown: ["Unknown", "gray"] },
  treatment: { hospitalized: ["Hospitalized", "teal"], er_visit: ["ER Visit", "teal"], ongoing: ["In Progress", "teal"], completed: ["Completed", "teal"], none: ["No Treatment", "yellow"], unknown: ["Unknown", "gray"] },
  ynuGood: { yes: ["Yes", "teal"], no: ["No", "yellow"], unknown: ["Unknown", "gray"] },
  priorAttorney: { yes: ["Represented", "red"], no: ["None", "teal"], unknown: ["Unknown", "gray"] },
  govt: { yes: ["Yes — 6mo deadline", "yellow"], no: ["No", "gray"], unknown: ["Unknown", "gray"] },
  employment: { employed_full_time: ["Full Time", "teal"], employed_part_time: ["Part Time", "teal"], self_employed: ["Self Employed", "teal"], unemployed: ["Unemployed", "gray"], retired: ["Retired", "gray"], student: ["Student", "gray"], disabled: ["Disabled", "gray"], unknown: ["Unknown", "gray"] },
} as const;

const pick = (map: Record<string, readonly [string, string]>, v?: string | null): [string, Tone] => {
  const hit = v ? map[v] : undefined;
  return hit ? [hit[0], hit[1] as Tone] : ["—", "gray"];
};

const VIEWS = ["All", "Quality Leads", "High Value", "Evidence Gaps", "Coverage Gaps", "SOL Risk", "Open"] as const;

export default function IntakeAuditor() {
  const [, navigate] = useLocation();
  const [view, setView] = useState<(typeof VIEWS)[number]>("All");
  const [search, setSearch] = useState("");
  const { data: leads, isLoading } = trpc.intake.leads.list.useQuery({});

  const rows = useMemo(() => {
    let list = (leads ?? []) as any[];
    const x = (l: any) => l.aiAnalysis?.extraction ?? {};
    const fl = (l: any) => x(l).injuryFlags ?? {};
    if (view === "Quality Leads") {
      list = list.filter((l) => x(l) && l.aiAnalysis?.firmCriteria?.quality);
    } else if (view === "High Value") {
      list = list.filter((l) =>
        ["severe", "catastrophic"].includes(l.injurySeverity) ||
        (l.qualificationScore ?? 0) >= 75 ||
        fl(l).fracture === "diagnosed" || fl(l).headInjury === "diagnosed" ||
        fl(l).surgery !== undefined && fl(l).surgery !== "no_indication" ||
        fl(l).permanentImpairment === "likely");
    } else if (view === "Evidence Gaps") {
      list = list.filter((l) => l.policeReport !== "yes" || !l.incidentDate || (x(l).missingInfo?.length ?? 0) > 2);
    } else if (view === "Coverage Gaps") {
      list = list.filter((l) => !l.defendantInsurer && l.umCoverage !== "yes");
    } else if (view === "SOL Risk") {
      list = list.filter((l) => ["warning", "urgent", "expired"].includes(l.solRisk));
    } else if (view === "Open") {
      list = list.filter((l) => ["new", "reviewing"].includes(l.status));
    }
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((l) => leadName(l).toLowerCase().includes(s) || (l.phone ?? "").includes(s));
    return list;
  }, [leads, view, search]);

  const COLS = [
    "Score", "Firm Qualified", "Quality Lead", "Severity", "Case Type", "Liability", "Police Report", "Fracture", "TBI / Head", "LOC",
    "Surgery", "Scarring", "Perm. Impair.", "Prior Injury", "Treatment", "Their Carrier", "Client Carrier",
    "UM/UIM", "Health Ins.", "Lost Wages", "Employment", "Prior Attorney", "Govt. Entity", "SOL",
    "Incident", "Status", "Assigned",
  ];

  return (
    <IntakeGuard>
      <div className="min-h-full bg-background p-6 lg:p-8 overflow-y-auto" style={{ height: "100%" }}>
        <div className="max-w-[1400px] mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0"><ScanSearch className="w-[18px] h-[18px] text-primary-foreground" /></div>
              <div>
                <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Auditor</h1>
                <p className="text-sm text-muted-foreground">Every lead, every signal — {rows.length} of {(leads ?? []).length} leads in this view · {COLS.length + 1} columns.</p>
              </div>
            </div>
            <div className="relative w-[260px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lead name or phone" className="pl-9 bg-card border-border h-9" />
            </div>
          </div>

          {/* View tabs */}
          <div className="flex flex-wrap gap-1 border-b border-border">
            {VIEWS.map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`text-sm px-3.5 py-2 border-b-2 -mb-px transition-colors ${view === v ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Matrix */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : rows.length === 0 ? (
              <p className="px-5 py-14 text-sm text-muted-foreground text-center">No leads in this view.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse min-w-max">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
                      <th className="px-4 py-2.5 font-semibold sticky left-0 bg-card z-10 border-r border-border min-w-[190px]">Lead</th>
                      {COLS.map((c) => <th key={c} className="px-3 py-2.5 font-semibold whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l: any) => {
                      const ex = l.aiAnalysis?.extraction ?? {};
                      const f = ex.injuryFlags ?? {};
                      const tier = l.qualificationTier;
                      const fc = l.aiAnalysis?.firmCriteria;
                      const cells: Array<[string, Tone] | string> = [
                        [String(l.qualificationScore ?? "—"), (tier === "hot" ? "red" : tier === "qualified" ? "teal" : tier === "review" ? "yellow" : "gray") as Tone],
                        [fc ? (fc.qualified ? "Qualified" : "Not Qualified") : "—", (fc?.qualified ? "teal" : fc ? "red" : "gray") as Tone],
                        [fc ? (fc.quality ? "Quality ✓" : "Pending") : "—", (fc?.quality ? "teal" : fc ? "yellow" : "gray") as Tone],
                        pick(V.severity as any, l.injurySeverity),
                        l.caseType ? CASE_TYPES[l.caseType] ?? l.caseType : "—",
                        pick(V.liability as any, l.liabilityAssessment),
                        pick(V.ynuGood as any, l.policeReport),
                        pick(V.diagnosed as any, f.fracture ?? "no_indication"),
                        pick(V.diagnosed as any, f.headInjury ?? "no_indication"),
                        pick(V.loc as any, f.lossOfConsciousness ?? "unknown"),
                        pick(V.surgery as any, f.surgery ?? "no_indication"),
                        pick(V.scarring as any, f.scarring ?? "no_indication"),
                        pick(V.impairment as any, f.permanentImpairment ?? "no_indication"),
                        pick(V.priorInjury as any, f.priorInjurySameRegion ?? "unknown"),
                        pick(V.treatment as any, l.treatmentStatus),
                        l.defendantInsurer ?? "—",
                        l.clientInsurer ?? "—",
                        pick(V.ynuGood as any, l.umCoverage),
                        l.healthInsurance ?? "—",
                        pick(V.ynuGood as any, l.lostWages),
                        pick(V.employment as any, ex.employment ?? "unknown"),
                        pick(V.priorAttorney as any, l.priorAttorney),
                        pick(V.govt as any, l.governmentEntity),
                        [SOL_META[l.solRisk ?? "unknown"]?.label ?? "—", (l.solRisk === "expired" || l.solRisk === "urgent" ? "red" : l.solRisk === "warning" ? "yellow" : l.solRisk === "ok" ? "teal" : "gray") as Tone],
                        l.incidentDate ? format(new Date(l.incidentDate), "MMM d, yyyy") : "—",
                        [STATUS_META[l.status]?.label ?? l.status, "gray"],
                        l.assignedToName ?? "—",
                      ];
                      return (
                        <tr key={l.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5 sticky left-0 bg-card z-10 border-r border-border">
                            <button onClick={() => navigate(`/intake/leads/${l.id}`)} className="text-primary font-medium hover:underline text-left whitespace-nowrap">
                              {leadName(l)}
                            </button>
                          </td>
                          {cells.map((c, i) => (
                            <td key={i} className="px-3 py-2.5 whitespace-nowrap">
                              {typeof c === "string"
                                ? <span className="text-xs text-foreground">{c}</span>
                                : <Cell label={c[0]} tone={c[1]} />}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Signals come from the AI's analysis of the call transcripts and your team's edits. "Potentially Undiagnosed" = symptoms point at it but no doctor has confirmed — worth a follow-up question. Leads analyzed before today fill in after a "Re-run AI".
          </p>
        </div>
      </div>
    </IntakeGuard>
  );
}
