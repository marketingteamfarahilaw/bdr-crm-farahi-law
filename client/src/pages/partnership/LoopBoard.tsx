import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronRight, Star, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, LOOP_STAGES, stageMeta } from "./shared";

export default function LoopBoard() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.partnership.loop.board.useQuery();
  const [q, setQ] = useState("");

  const setStage = trpc.partnership.loop.setStage.useMutation({
    onMutate: () => toast.loading("Moving…", { id: "loop" }),
    onSuccess: () => { toast.success("Stage updated", { id: "loop" }); utils.partnership.loop.board.invalidate(); },
    onError: (e) => toast.error(e.message, { id: "loop" }),
  });
  const flagVisit = trpc.partnership.requests.set.useMutation({
    onSuccess: () => { utils.partnership.loop.board.invalidate(); utils.partnership.requests.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    const term = q.toLowerCase().trim();
    const out: Record<string, any[]> = {};
    for (const s of LOOP_STAGES) {
      out[s.key] = (data.stages[s.key] ?? []).filter((f: any) =>
        !term || f.name?.toLowerCase().includes(term) || f.city?.toLowerCase().includes(term) || f.assignedRepName?.toLowerCase().includes(term)
      );
    }
    return out;
  }, [data, q]);

  const nextStage = (cur: string) => {
    const i = LOOP_STAGES.findIndex((s) => s.key === cur);
    return i >= 0 && i < LOOP_STAGES.length - 1 ? LOOP_STAGES[i + 1] : null;
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Coordinated Loop" subtitle="Every action by one role sets up the next. Move partners through the loop: Research → First Contact → Appointment → Visit → Post-Visit → Nurture.">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8 w-60" placeholder="Search facility / city / rep" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </PageHeader>

      {isLoading || !filtered ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LOOP_STAGES.map((s) => {
            const items = filtered[s.key] ?? [];
            const total = data?.counts[s.key] ?? items.length;
            const next = nextStage(s.key);
            return (
              <div key={s.key} className="min-w-[260px] w-[260px] flex-shrink-0">
                <div className={`rounded-t-xl border px-3 py-2 ${s.color}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{s.label}</span>
                    <span className="text-xs font-medium">{total}</span>
                  </div>
                  <p className="text-[11px] opacity-80 mt-0.5">{s.desc}</p>
                </div>
                <div className="rounded-b-xl border border-t-0 border-border bg-muted/20 p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
                  {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">—</p>}
                  {items.map((f: any) => (
                    <Card key={f.id} className="shadow-none">
                      <CardContent className="p-2.5 space-y-1.5">
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-sm font-medium text-foreground leading-tight">{f.name}</p>
                          <button title="Partner wants an in-person visit" onClick={() => flagVisit.mutate({ facilityId: f.id, requested: !f.visitRequested })}>
                            <Star className={`w-4 h-4 ${f.visitRequested ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {f.city || "—"}{f.assignedRepName ? ` · ${f.assignedRepName}` : ""}
                        </p>
                        {next && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] w-full justify-between"
                            onClick={() => setStage.mutate({ facilityId: f.id, stage: next.key as any })}>
                            Move to {next.label} <ChevronRight className="w-3 h-3" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {items.length < total && <p className="text-[11px] text-muted-foreground text-center py-1">+{total - items.length} more — use search</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
