import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Car, Target, CheckCircle2, Upload, Download, Printer, TrendingUp, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const PD_STATUS: Record<string, { label: string; color: string; chip: string }> = {
  new_case: { label: "New Case", color: "#64748b", chip: "bg-slate-500/15 text-slate-500" },
  waiting_liability: { label: "Waiting for Liability", color: "#f59e0b", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  waiting_dec_page: { label: "Waiting for Dec Page", color: "#eab308", chip: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400" },
  waiting_pl: { label: "Waiting on PL", color: "#f97316", chip: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  team_working: { label: "Team Working", color: "#3b82f6", chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  bdr_shop: { label: "BDR Shop", color: "#10b981", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  pl_shop: { label: "PL's Shop", color: "#8b5cf6", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  refer_by_fbs: { label: "Refer by FBS", color: "#06b6d4", chip: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  total_loss: { label: "Total Loss", color: "#ef4444", chip: "bg-red-500/15 text-red-600 dark:text-red-400" },
  cant_refer: { label: "Can't Refer", color: "#dc2626", chip: "bg-red-600/15 text-red-700 dark:text-red-400" },
  check: { label: "Check", color: "#a855f7", chip: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  drop_case: { label: "Drop Case", color: "#94a3b8", chip: "bg-slate-400/15 text-slate-500" },
};
const STATUS_KEYS = Object.keys(PD_STATUS);

// Minimal CSV parser (handles quoted fields + commas)
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (field !== "" || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; } if (ch === "\r" && text[i + 1] === "\n") i++; }
    else field += ch;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const pick = (o: Record<string, string>, keys: string[]) => { for (const k of Object.keys(o)) if (keys.some((kk) => k.includes(kk))) { if (o[k]) return o[k]; } return ""; };

export default function PdTracker() {
  const utils = trpc.useUtils();
  const { data: dash, isLoading: dashLoading } = trpc.pd.dashboard.useQuery();
  const fileRef = useRef<HTMLInputElement>(null);
  const bulkImport = trpc.pd.bulkImport.useMutation({
    onSuccess: (r) => { toast.success(`Imported ${r.inserted} new cars (${r.skipped} already tracked)`); utils.pd.dashboard.invalidate(); utils.pd.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const onFile = async (f: File) => {
    const text = await f.text();
    const parsed = parseCsv(text);
    if (!parsed.length) return toast.error("No rows found in CSV");
    const rows = parsed.map((o) => ({
      clientName: pick(o, ["client", "name", "first primary"]),
      caseNumber: pick(o, ["case number", "case #", "case"]),
      filevineProjectId: pick(o, ["project id", "projectid", "project", "filevine"]),
      caseType: pick(o, ["project type", "case type", "type"]) || "Auto",
      vehicleInfo: pick(o, ["vehicle", "car", "make", "model"]),
      isDriver: 1,
    })).filter((r) => r.clientName || r.caseNumber);
    if (!rows.length) return toast.error("Couldn't find client/case columns in the CSV");
    bulkImport.mutate({ batch: new Date().toISOString().slice(0, 10), rows });
  };

  const rate = dash ? Math.round((dash.referralRate || 0) * 100) : 0;
  const targetPct = dash ? Math.round((dash.target || 0.7) * 100) : 70;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>PD Car Referral Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">Body-shop pipeline — work each driver's car to a BDR-shop referral. Import the Filevine auto-case export, then update status per car.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={bulkImport.isPending}><Upload className="w-4 h-4" /> Import CSV</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4" /> Dashboard PDF</Button>
        </div>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard"><TrendingUp className="w-4 h-4 mr-1" /> Dashboard</TabsTrigger>
          <TabsTrigger value="list"><Car className="w-4 h-4 mr-1" /> Working List</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4 space-y-5">
          {dashLoading || !dash ? <Skeleton className="h-72 rounded-xl" /> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi icon={Car} label="Driver cars" value={dash.driverCount} sub={`${dash.total} total cases`} />
                <Kpi icon={CheckCircle2} label="Eligible to refer" value={dash.eligible} />
                <Kpi icon={Target} label="BDR shop referrals" value={dash.bdrShop} color="text-emerald-500" />
                <Kpi icon={TrendingUp} label="Referral rate" value={`${rate}%`} sub={`target ${targetPct}%`} color={rate >= targetPct ? "text-emerald-500" : "text-amber-500"} />
              </div>

              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-sm mb-2"><span className="font-medium text-foreground">Referral rate vs target</span><span className="text-muted-foreground">{dash.bdrShop} of {dash.eligible} eligible · target {targetPct}%</span></div>
                  <div className="relative h-4 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, rate)}%`, background: rate >= targetPct ? "#10b981" : "#f59e0b" }} />
                    <div className="absolute top-0 h-full border-l-2 border-foreground/60" style={{ left: `${targetPct}%` }} title={`Target ${targetPct}%`} />
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Tracked-case breakdown</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={STATUS_KEYS.filter((k) => (dash.byStatus[k] || 0) > 0).map((k) => ({ name: PD_STATUS[k].label, value: dash.byStatus[k], fill: PD_STATUS[k].color }))} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                          {STATUS_KEYS.filter((k) => (dash.byStatus[k] || 0) > 0).map((k) => <Cell key={k} fill={PD_STATUS[k].color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 justify-center text-[11px]">
                      {STATUS_KEYS.filter((k) => (dash.byStatus[k] || 0) > 0).map((k) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: PD_STATUS[k].color }} />{PD_STATUS[k].label} ({dash.byStatus[k]})</span>)}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardHeader><CardTitle className="text-base">Case reconciliation</CardTitle></CardHeader>
                    <CardContent className="space-y-1.5">
                      {dash.reconciliation.map((r: any, i: number) => (
                        <div key={i} className={`flex justify-between text-sm ${r.label === "Eligible" || r.label === "BDR shop" ? "font-semibold text-foreground border-t border-border pt-1.5" : "text-muted-foreground"}`}>
                          <span>{r.label}</span><span className={r.value < 0 ? "text-red-500" : ""}>{r.value > 0 && r.label.startsWith("−") ? "" : ""}{r.value}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-base">Team-working breakdown</CardTitle></CardHeader>
                    <CardContent>
                      {Object.keys(dash.teamWorking).length === 0 ? <p className="text-sm text-muted-foreground">No cars in "Team Working".</p> : (
                        <ResponsiveContainer width="100%" height={Math.max(120, Object.keys(dash.teamWorking).length * 34)}>
                          <BarChart layout="vertical" data={Object.entries(dash.teamWorking).map(([rep, n]) => ({ rep, n }))} margin={{ left: 10 }}>
                            <XAxis type="number" hide /><YAxis type="category" dataKey="rep" width={90} tick={{ fontSize: 11 }} />
                            <Tooltip /><Bar dataKey="n" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
              <ManagementNotes />
            </>
          )}
        </TabsContent>

        <TabsContent value="list" className="mt-4"><WorkingList /></TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, color = "text-foreground" }: { icon: any; label: string; value: any; sub?: string; color?: string }) {
  return <Card className="bg-card border-border"><CardContent className="p-4"><div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{label}</span></div><p className={`text-2xl font-bold ${color}`}>{value}</p>{sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}</CardContent></Card>;
}

function ManagementNotes() {
  const [note, setNote] = useState(() => localStorage.getItem("pd_mgmt_notes") || "");
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Management notes</CardTitle></CardHeader>
      <CardContent>
        <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm min-h-[80px]" value={note} placeholder="Notes for leadership…" onChange={(e) => { setNote(e.target.value); localStorage.setItem("pd_mgmt_notes", e.target.value); }} />
      </CardContent>
    </Card>
  );
}

function WorkingList() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const { data: rows, isLoading } = trpc.pd.list.useQuery({ ...(status !== "all" ? { status: status as any } : {}), ...(search ? { search } : {}) });
  const { data: shops } = trpc.pd.bodyShops.useQuery();
  const update = trpc.pd.update.useMutation({
    onSuccess: () => { utils.pd.list.invalidate(); utils.pd.dashboard.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const exportCsv = () => {
    if (!rows?.length) return;
    const head = ["Client", "Case #", "Vehicle", "Status", "Body shop", "Assigned", "Notes"];
    const out = [head, ...rows.map((r: any) => [r.clientName, r.caseNumber, r.vehicleInfo, PD_STATUS[r.status]?.label, r.facilityName, r.assignedRepName, r.notes])];
    const csv = out.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "PD Referrals.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8 w-56" placeholder="Search client / case / shop" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUS_KEYS.map((k) => <SelectItem key={k} value={k}>{PD_STATUS[k].label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}><Download className="w-4 h-4" /> Export</Button>
        <span className="text-sm text-muted-foreground ml-auto">{rows?.length ?? 0} cars</span>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No cars yet — import the Filevine auto-case CSV to get started.</div>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Case #</TableHead><TableHead>Vehicle</TableHead><TableHead>Status</TableHead><TableHead>Body shop</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">{r.clientName || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.caseNumber || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.vehicleInfo || "—"}</TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => update.mutate({ id: r.id, status: v as any })}>
                      <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_KEYS.map((k) => <SelectItem key={k} value={k}>{PD_STATUS[k].label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={r.facilityId ? String(r.facilityId) : "none"} onValueChange={(v) => { const s = shops?.find((x: any) => String(x.id) === v); update.mutate({ id: r.id, facilityId: v === "none" ? null : Number(v), facilityName: s?.name ?? null, ...(v !== "none" && !r.dateReferred ? { dateReferred: new Date().toISOString() } : {}) }); }}>
                      <SelectTrigger className="w-48 h-8"><SelectValue placeholder="— assign —" /></SelectTrigger>
                      <SelectContent className="max-h-72"><SelectItem value="none">— none —</SelectItem>{(shops ?? []).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
