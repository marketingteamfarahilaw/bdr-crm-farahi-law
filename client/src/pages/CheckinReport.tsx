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

// Embeddable Check-In matrix — rendered as a tab inside BDR Reports (/crm/reports).
export default function CheckinMatrix() {
  const { user } = useAuth();
  const isMgr = canManage(user?.role);
  const [month, setMonth] = useState(monthOptions(1)[0]);
  const [agent, setAgent] = useState("");
  const { data: team } = trpc.team.list.useQuery(undefined, { enabled: isMgr });
  const { data: blocks, isLoading } = trpc.crm.bdrReports.checkinMatrix.useQuery({ month, ...(isMgr && agent ? { agent } : {}) });
  const agentNames: string[] = Array.from(new Set((team ?? []).map((u: any) => u.agentName).filter(Boolean))).sort();

  const exportCsv = () => {
    if (!blocks?.length) return;
    const rows: any[][] = [];
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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-xl">Every facility called in the month — each date is a check-in, with the number of calls that day. Calls that didn't match a partner show by phone number.</p>
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
        blocks.map((b: any) => <RepBlock key={b.rep} block={b} />)
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
