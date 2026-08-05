import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Map, Search, UserCheck, Pencil, Merge, Wand2, Building2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

const FR_REPS = ["Genysys", "Jezel", "Lupe", "Zulema"];
const BDR_REPS = ["Ally", "Grace", "Malvin", "Queenie", "Miguel"];

export default function Territories() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.territories.list.useQuery();
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [alsoReassign, setAlsoReassign] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeTo, setMergeTo] = useState("");
  const [drill, setDrill] = useState<string | null>(null);

  const done = (msg: string) => {
    toast.success(msg, { id: "terr" });
    utils.territories.list.invalidate();
    utils.crm.facilities.territories.invalidate();
    setSelected(new Set());
  };
  const opts = {
    onMutate: () => toast.loading("Working…", { id: "terr" }),
    onError: (e: any) => toast.error(e.message, { id: "terr" }),
  };
  const setOwner = trpc.territories.setOwner.useMutation({
    ...opts,
    onSuccess: (r) => { setAssigning(null); done(r.reassigned ? `Assigned · ${r.reassigned} partners reassigned` : "Assigned"); },
  });
  const rename = trpc.territories.rename.useMutation({
    ...opts, onSuccess: (r) => { setRenaming(null); done(`Renamed — ${r.updated} partners updated`); },
  });
  const merge = trpc.territories.merge.useMutation({
    ...opts, onSuccess: (r) => { setMerging(false); done(`Merged — ${r.updated} partners moved to ${r.to}`); },
  });
  const autofill = trpc.territories.autofill.useMutation({
    ...opts, onSuccess: (r) => done(`Filled ${r.updated} partners across ${r.territories} territories`),
  });

  const rows = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (data?.territories ?? []).filter((t) =>
      (!term || t.name.toLowerCase().includes(term) || (t.owner ?? "").toLowerCase().includes(term)) &&
      (ownerFilter === "all" || (ownerFilter === "unowned" ? !t.owner : t.owner === ownerFilter))
    );
  }, [data, search, ownerFilter]);

  const toggle = (name: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });

  const ownerNames = useMemo(
    () => Array.from(new Set([...(data?.owners ?? []).map((o) => o.agentName), ...FR_REPS, ...BDR_REPS])).sort(),
    [data]
  );

  if (isLoading) {
    return <div className="p-6 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  const unassigned = data?.unassigned ?? 0;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Map className="w-6 h-6" /> Territories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.territories.length ?? 0} territories · owners shown here also colour the California map
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 1 && (
            <Button size="sm" variant="outline" onClick={() => { setMergeTo(Array.from(selected)[0]); setMerging(true); }}>
              <Merge className="w-4 h-4 mr-1.5" /> Merge {selected.size}
            </Button>
          )}
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="w-4 h-4 mr-1.5" /> Clear</Button>
          )}
        </div>
      </div>

      {unassigned > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="font-medium">{unassigned} partners have no territory</div>
                <div className="text-muted-foreground">
                  {data?.assignable.byCity ?? 0} can be filled from their city, {data?.assignable.byZip ?? 0} from their ZIP.
                  The remaining {Math.max(0, unassigned - (data?.assignable.byCity ?? 0) - (data?.assignable.byZip ?? 0))} have neither and need editing by hand.
                </div>
              </div>
            </div>
            {(data?.assignable.byCity ?? 0) + (data?.assignable.byZip ?? 0) > 0 && (
              <Button size="sm" onClick={() => autofill.mutate({ source: "both", dryRun: false })} disabled={autofill.isPending}>
                <Wand2 className="w-4 h-4 mr-1.5" /> Fill {(data?.assignable.byCity ?? 0) + (data?.assignable.byZip ?? 0)} from city / ZIP
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search territory or owner…" className="pl-9" />
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            <SelectItem value="unowned">No owner yet</SelectItem>
            {(data?.owners ?? []).map((o) => <SelectItem key={o.agentName} value={o.agentName}>{o.agentName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 p-3" />
                  <th className="text-left p-3 font-medium">Territory</th>
                  <th className="text-right p-3 font-medium">Partners</th>
                  <th className="text-left p-3 font-medium">Owner</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.name} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="p-3">
                      <Checkbox checked={selected.has(t.name)} onCheckedChange={() => toggle(t.name)} aria-label={`Select ${t.name}`} />
                    </td>
                    <td className="p-3">
                      <button className="hover:underline text-left font-medium" onClick={() => setDrill(t.name)}>{t.name}</button>
                    </td>
                    <td className="p-3 text-right tabular-nums">{t.facilities}</td>
                    <td className="p-3">
                      {t.owner ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.ownerColor ?? "#94a3b8" }} />
                          {t.owner}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => { setAssigning(t.name); setAssignTo(t.owner ?? ""); setAlsoReassign(false); }}>
                        <UserCheck className="w-4 h-4 mr-1.5" /> Assign
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRenaming(t.name); setRenameTo(t.name); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No territories match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Assign owner */}
      <Dialog open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign “{assigning}”</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Team member</label>
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger><SelectValue placeholder="Choose someone…" /></SelectTrigger>
                <SelectContent>
                  {ownerNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}{FR_REPS.includes(n) ? " · FR" : BDR_REPS.includes(n) ? " · BDR" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={alsoReassign} onCheckedChange={(v) => setAlsoReassign(!!v)} className="mt-0.5" />
              <span>
                Also reassign the partners in this territory to them
                <span className="block text-xs text-muted-foreground">Changes who owns the accounts, not just the area.</span>
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            {assigning && (
              <Button variant="ghost" onClick={() => setOwner.mutate({ territory: assigning, agentName: null, reassignFacilities: false })}>
                Remove owner
              </Button>
            )}
            <Button
              disabled={!assignTo || setOwner.isPending}
              onClick={() => assigning && setOwner.mutate({ territory: assigning, agentName: assignTo, reassignFacilities: alsoReassign })}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename “{renaming}”</DialogTitle></DialogHeader>
          <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="New name" />
          <p className="text-xs text-muted-foreground">Updates every partner in this territory.</p>
          <DialogFooter>
            <Button
              disabled={!renameTo.trim() || renameTo === renaming || rename.isPending}
              onClick={() => renaming && rename.mutate({ from: renaming, to: renameTo.trim() })}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge */}
      <Dialog open={merging} onOpenChange={setMerging}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge {selected.size} territories</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Everything below becomes one territory. Pick the name to keep.</p>
          <Select value={mergeTo} onValueChange={setMergeTo}>
            <SelectTrigger><SelectValue placeholder="Keep which name?" /></SelectTrigger>
            <SelectContent>
              {Array.from(selected).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            Merging: {Array.from(selected).filter((s) => s !== mergeTo).join(", ") || "—"} → <strong>{mergeTo || "…"}</strong>
          </div>
          <DialogFooter>
            <Button
              disabled={!mergeTo || merge.isPending}
              onClick={() => merge.mutate({ from: Array.from(selected), to: mergeTo })}
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drill-down */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> {drill}</DialogTitle></DialogHeader>
          <TerritoryFacilities name={drill} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TerritoryFacilities({ name }: { name: string | null }) {
  const { data, isLoading } = trpc.territories.facilities.useQuery({ name: name ?? "" }, { enabled: !!name });
  if (isLoading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No partners in this territory.</p>;
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left p-2 font-medium">Partner</th>
            <th className="text-left p-2 font-medium">City</th>
            <th className="text-left p-2 font-medium">Rep</th>
          </tr>
        </thead>
        <tbody>
          {data.map((f) => (
            <tr key={f.id} className="border-b border-border/50">
              <td className="p-2">
                <a href={`/crm/facilities/${f.id}`} className="hover:underline">{f.name}</a>
              </td>
              <td className="p-2 text-muted-foreground">{f.city || f.zipCode || "—"}</td>
              <td className="p-2 text-muted-foreground">{f.assignedRepName || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
