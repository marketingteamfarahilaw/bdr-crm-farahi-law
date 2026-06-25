import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Building2, Clock, ChevronRight, ChevronLeft, Check, RotateCcw, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { format } from "@/lib/datetime";

const COLUMNS = [
  { key: "open", label: "To Do", cls: "bg-slate-500/10 border-slate-500/30" },
  { key: "in_progress", label: "In Progress", cls: "bg-blue-500/10 border-blue-500/30" },
  { key: "completed", label: "Done", cls: "bg-emerald-500/10 border-emerald-500/30" },
] as const;
const PRIORITY: Record<string, string> = { high: "bg-red-500/15 text-red-600 dark:text-red-400", medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400", low: "bg-slate-500/15 text-slate-500" };
const TYPE_LABEL: Record<string, string> = { thank_you: "Thank you", send_lead: "Send lead", ask_for_referral: "Ask referral", request_update: "Request update", check_relationship: "Check-in", reconnect: "Reconnect", other: "Other" };

export default function TaskBoard() {
  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.crm.tasks.listAll.useQuery();
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const setStatus = trpc.crm.tasks.setStatus.useMutation({
    onMutate: () => toast.loading("Moving…", { id: "tb" }),
    onSuccess: () => { toast.success("Updated", { id: "tb" }); utils.crm.tasks.listAll.invalidate(); },
    onError: (e) => toast.error(e.message, { id: "tb" }),
  });

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (tasks ?? []).filter((t: any) =>
      (priority === "all" || t.priority === priority) &&
      (!term || t.title?.toLowerCase().includes(term) || t.facilityName?.toLowerCase().includes(term) || t.assignedToName?.toLowerCase().includes(term))
    );
  }, [tasks, search, priority]);

  const byCol = (k: string) => filtered.filter((t: any) => t.status === k);
  const overdue = (t: any) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "completed";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Task Board</h1>
          <p className="text-sm text-muted-foreground mt-1">Every task across all partners in one place. Move cards through To Do → In Progress → Done.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8 w-56" placeholder="Search task / partner / rep" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All priority</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : !tasks?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground"><ListChecks className="w-8 h-8 mx-auto mb-2" />No tasks yet. Tasks created on partner profiles show up here.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = byCol(col.key);
            return (
              <div key={col.key}>
                <div className={`rounded-t-xl border px-3 py-2 ${col.cls} flex items-center justify-between`}>
                  <span className="font-semibold text-sm text-foreground">{col.label}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="rounded-b-xl border border-t-0 border-border bg-muted/20 p-2 space-y-2 min-h-[200px] max-h-[72vh] overflow-y-auto">
                  {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">—</p>}
                  {items.map((t: any) => (
                    <Card key={t.id} className="shadow-none">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground leading-tight">{t.title}</p>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${PRIORITY[t.priority] ?? ""}`}>{t.priority}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> {t.facilityName || "—"}{t.assignedToName ? ` · ${t.assignedToName}` : ""}</p>
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="text-[11px] flex items-center gap-2">
                            {t.followUpReason && <span className="text-muted-foreground">{TYPE_LABEL[t.followUpReason] ?? t.followUpReason}</span>}
                            {t.dueDate && <span className={overdue(t) ? "text-red-500 font-medium flex items-center gap-0.5" : "text-muted-foreground flex items-center gap-0.5"}><Clock className="w-3 h-3" />{format(new Date(t.dueDate), "MMM d")}</span>}
                          </span>
                          <div className="flex gap-0.5">
                            {col.key !== "open" && <Button size="icon" variant="ghost" className="h-6 w-6" title="Back" onClick={() => setStatus.mutate({ id: t.id, status: col.key === "completed" ? "in_progress" : "open" })}><ChevronLeft className="w-3.5 h-3.5" /></Button>}
                            {col.key === "completed"
                              ? <Button size="icon" variant="ghost" className="h-6 w-6" title="Reopen" onClick={() => setStatus.mutate({ id: t.id, status: "open" })}><RotateCcw className="w-3.5 h-3.5" /></Button>
                              : <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-600" title={col.key === "open" ? "Start" : "Done"} onClick={() => setStatus.mutate({ id: t.id, status: col.key === "open" ? "in_progress" : "completed" })}>{col.key === "open" ? <ChevronRight className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}</Button>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
