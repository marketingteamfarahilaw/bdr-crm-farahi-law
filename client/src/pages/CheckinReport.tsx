import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Phone, PhoneCall, Users2 } from "lucide-react";
import { canManage } from "@shared/permissions";

const MAX_COLS = 6; // Excel shows 4; we render up to 6 day-columns, then "+n more"
const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"];

const monthOptions = (count = 8): string[] => {
  const out: string[] = []; const d = new Date();
  for (let i = 0; i < count; i++) { out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
};
const monthLabel = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }); };
const dayLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };

export default function CheckinReport() {
  const { user } = useAuth();
  const isMgr = canManage(user?.role);
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [agent, setAgent] = useState("");
  const { data: team } = trpc.team.list.useQuery(undefined, { enabled: isMgr });
  const { data: blocks, isLoading } = trpc.crm.bdrReports.checkinMatrix.useQuery({ month, ...(isMgr && agent ? { agent } : {}) });
  const agentNames: string[] = Array.from(new Set((team ?? []).map((u: any) => u.agentName).filter(Boolean))).sort();

  // Summary distribution (the sheet's top table): per rep, how many facilities
  // got exactly 1 / 2 / 3 / 4+ check-ins (a check-in = a distinct day called).
  const summary = (blocks ?? []).map((b: any) => {
    const dist = [0, 0, 0, 0];
    for (const r of b.rows) dist[Math.min(r.checkIns.length, 4) - 1]++;
    return { rep: b.rep, facilities: b.rows.length, dist, calls: b.totals.calls };
  });
  const summaryTotal = summary.reduce(
    (a, s) => ({ facilities: a.facilities + s.facilities, dist: a.dist.map((d, i) => d + s.dist[i]), calls: a.calls + s.calls }),
    { facilities: 0, dist: [0, 0, 0, 0], calls: 0 }
  );

  const exportCsv = () => {
    if (!blocks?.length) return;
    const rows: any[][] = [];
    rows.push(["MTD CHECK-IN REPORT", monthLabel(month)]);
    rows.push(["NAME", "NO. OF BDR FACILITIES", "1 Check-In", "2 Check-Ins", "3 Check-Ins", "4 Check-Ins"]);
    for (const s of summary) rows.push([s.rep.toUpperCase(), s.facilities, ...s.dist]);
    rows.push(["TOTAL", summaryTotal.facilities, ...summaryTotal.dist]);
    rows.push([]);
    for (const b of blocks) {
      rows.push([b.rep.toUpperCase()]);
      rows.push(["#", "FACILITY NAME / PHONE", ...Array.from({ length: MAX_COLS }, (_, i) => [`${ORDINAL[i]} CHECK-IN`, "#"]).flat(), "TOTAL CHECK-IN"]);
      b.rows.forEach((r: any, i: number) => {
        const cells: any[] = [i + 1, r.label];
        for (let k = 0; k < MAX_COLS; k++) { const c = r.checkIns[k]; cells.push(c ? dayLabel(c.date) : "", c ? c.count : ""); }
        cells.push(r.total);
        rows.push(cells);
      });
      rows.push([]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `Check-In Report ${month}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Check-In Report</h1>
          <p className="text-sm text-muted-foreground mt-1">Every facility called in the month — each date is a check-in, with the number of calls that day. Calls that didn't match a partner show by phone number.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {isMgr && (
            <Select value={agent || "all"} onValueChange={(v) => setAgent(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All agents" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All agents</SelectItem>{agentNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{monthOptions(8).map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!blocks?.length}><Download className="w-4 h-4" /> Export</Button>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : !blocks?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground"><PhoneCall className="w-8 h-8 mx-auto mb-2" />No calls logged for {monthLabel(month)}.</div>
      ) : (
        <>
          {/* MTD summary — the sheet's top table: facilities per rep + check-in distribution */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <h2 className="font-bold text-foreground uppercase tracking-wide">Business Development Representatives</h2>
                <p className="text-xs text-muted-foreground mt-0.5">MTD CHECK-IN REPORT · {monthLabel(month)}</p>
              </div>
              <div className="rounded-xl border border-border overflow-x-auto max-w-3xl">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card hover:bg-card border-border">
                      <TableHead className="text-muted-foreground text-xs min-w-[140px]">NAME</TableHead>
                      <TableHead className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 text-right whitespace-nowrap">NO. OF BDR FACILITIES</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right whitespace-nowrap">1 Check-In</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right whitespace-nowrap">2 Check-Ins</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right whitespace-nowrap">3 Check-Ins</TableHead>
                      <TableHead className="text-muted-foreground text-xs text-right whitespace-nowrap">4 Check-Ins</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.map((s) => (
                      <TableRow key={s.rep} className="border-border">
                        <TableCell className="py-1.5 text-sm font-medium text-foreground uppercase">{s.rep}</TableCell>
                        <TableCell className="py-1.5 text-sm font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 text-right">{s.facilities}</TableCell>
                        {s.dist.map((d, i) => <TableCell key={i} className="py-1.5 text-sm text-foreground text-right">{d || ""}</TableCell>)}
                      </TableRow>
                    ))}
                    <TableRow className="border-border bg-muted/40 font-semibold">
                      <TableCell className="py-1.5 text-sm text-foreground">TOTAL</TableCell>
                      <TableCell className="py-1.5 text-sm font-bold text-foreground bg-amber-500/15 text-right">{summaryTotal.facilities}</TableCell>
                      {summaryTotal.dist.map((d, i) => <TableCell key={i} className="py-1.5 text-sm text-foreground text-right">{d}</TableCell>)}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {blocks.map((b: any) => <RepBlock key={b.rep} block={b} />)}
        </>
      )}
    </div>
  );
}

function RepBlock({ block }: { block: any }) {
  const [, nav] = useLocation();
  const cols = Math.min(MAX_COLS, Math.max(1, ...block.rows.map((r: any) => r.checkIns.length)));
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="font-bold text-foreground uppercase tracking-wide flex items-center gap-2"><Users2 className="w-4 h-4 text-primary" /> {block.rep}</h2>
          <span className="text-xs text-muted-foreground">{block.totals.facilities} facilities · {block.totals.calls} calls</span>
        </div>
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-card hover:bg-card border-border">
                <TableHead className="text-muted-foreground text-xs w-8">#</TableHead>
                <TableHead className="text-muted-foreground text-xs min-w-[220px]">FACILITY NAME</TableHead>
                {Array.from({ length: cols }, (_, i) => (
                  <TableHead key={i} className="text-muted-foreground text-xs whitespace-nowrap" colSpan={2}>{ORDINAL[i]} CHECK-IN · #</TableHead>
                ))}
                <TableHead className="text-xs font-semibold text-primary bg-primary/10 text-right whitespace-nowrap">TOTAL CHECK-IN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((r: any, i: number) => (
                <TableRow key={r.label + i} className={`border-border ${r.facilityId ? "cursor-pointer hover:bg-card/60" : ""}`} onClick={() => r.facilityId && nav(`/crm/facilities/${r.facilityId}`)}>
                  <TableCell className="py-1.5 text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="py-1.5 text-sm font-medium text-foreground">
                    {r.isPhoneOnly ? <span className="flex items-center gap-1.5 text-muted-foreground"><Phone className="w-3 h-3" /> {r.label}</span> : r.label}
                  </TableCell>
                  {Array.from({ length: cols }, (_, k) => {
                    const c = r.checkIns[k];
                    return [
                      <TableCell key={`d${k}`} className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{c ? dayLabel(c.date) : ""}</TableCell>,
                      <TableCell key={`n${k}`} className="py-1.5 text-xs font-semibold text-foreground bg-amber-500/5">{c ? c.count : ""}</TableCell>,
                    ];
                  })}
                  <TableCell className="py-1.5 text-sm font-bold text-primary bg-primary/10 text-right">
                    {r.total}{r.checkIns.length > cols && <span className="text-[10px] font-normal text-muted-foreground ml-1">(+{r.checkIns.length - cols} more days)</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
