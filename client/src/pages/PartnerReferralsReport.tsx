/**
 * Partner Referrals Report (server/partnerReferralsReport.ts): referrals sent to
 * partners and received from them over the dates picked — by partner, by
 * representative and one by one. Read-only; referrals are added and edited in
 * the Partner Referral Tracker. Replaces the old Referral Reports page and keeps
 * what it showed (lead balance, one-way partners, the outbound status
 * breakdown), now for a date range and with the same counts as the partner
 * profiles. Agents see their own referrals; managers everyone's.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowDownLeft, ArrowUpRight, AlertCircle, Building2, CheckCircle2, Clock, Download, Loader2, Users, XCircle, ListChecks,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { CURRENT_TEAM } from "@shared/team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { iso, presets, rangeLabel } from "./SignupsDashboard";

const dayLabel = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const OUTCOME: Record<string, string> = {
  signed: "Signed", pending: "Pending", not_signed: "Not signed", not_qualified: "Not qualified", duplicate: "Duplicate", unknown: "Unknown",
};
const statusText = (s: string) => OUTCOME[s] ?? s;

// Pill colour from the words of the status, so tracker statuses and lead
// outcomes share one scheme (as the old Referral Reports page did).
function pill(status: string) {
  const s = status.toLowerCase();
  if (/(sign|complet|attend|confirm)/.test(s) && !/not/.test(s)) return { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 };
  if (/(not|issue|duplicate)/.test(s)) return { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: XCircle };
  if (/(pending|sent|scheduled|assigned|selected|review)/.test(s)) return { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", Icon: Clock };
  return { cls: "bg-muted text-muted-foreground border-border", Icon: AlertCircle };
}
function StatusPill({ status }: { status: string }) {
  const { cls, Icon } = pill(statusText(status));
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}><Icon className="w-3 h-3" />{statusText(status)}</span>;
}

function Stat({ icon: Icon, label, value, sub, color = "text-foreground" }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{label}</span></div>
        <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PartnerName({ id, name }: { id: number | null; name: string }) {
  if (id == null) return <span className="text-muted-foreground" title="Not linked to a partner in the CRM">{name}</span>;
  return <Link href={`/crm/facilities/${id}`} className="font-medium text-foreground hover:text-primary">{name}</Link>;
}

export default function PartnerReferralsReport() {
  const { user } = useAuth();
  const isMgr = seesAllData(user?.role);
  const today = new Date();
  const periods = presets(today);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [rep, setRep] = useState("");
  const [direction, setDirection] = useState<"all" | "sent" | "received">("all");
  const [showAll, setShowAll] = useState(false);
  const active = periods.find((p) => p.from === from && p.to === to)?.label;

  const { data, isLoading, isFetching, isError, error, refetch } = trpc.referralWorkflow.report.useQuery(
    { from, to, ...(isMgr && rep ? { rep } : {}) },
    { placeholderData: (p) => p },
  );

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => direction === "all" || r.direction === direction), [data, direction]);
  const shown = showAll ? rows : rows.slice(0, 100);
  const repOptions = [...CURRENT_TEAM.BDR, ...CURRENT_TEAM.FR];

  const exportCsv = () => {
    if (!data) return;
    const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [
      c(`PARTNER REFERRALS REPORT — ${rangeLabel(from, to)}${rep ? ` — ${rep}` : ""}`),
      ["Referrals sent", "Referrals received", "Signed", "Sign rate", "Partners"].map(c).join(","),
      [data.summary.sent, data.summary.received, data.summary.signed, data.summary.signRate == null ? "" : `${data.summary.signRate}%`, data.summary.partners].join(","),
      "",
      c("BY PARTNER"),
      ["Partner", "Owner", "Sent to partner", "Received from partner", "Signed", "Balance", "Last referral"].map(c).join(","),
      ...data.byPartner.map((p) => [c(p.partner), c(p.owner), p.sent, p.received, p.signed, p.received - p.sent, p.last].join(",")),
      "",
      c("BY REPRESENTATIVE"),
      ["Representative", "Sent", "Received", "Signed", "Partners"].map(c).join(","),
      ...data.byRep.map((r) => [c(r.rep), r.sent, r.received, r.signed, r.partners].join(",")),
      "",
      c("REFERRALS"),
      ["Date", "Direction", "Partner", "Owner", "Representative", "Client / lead", "Status", "Signed"].map(c).join(","),
      ...data.rows.map((r) => [r.date, r.direction === "sent" ? "Sent to partner" : "Received from partner", c(r.partner), c(r.owner), c(r.rep), c(r.client), c(statusText(r.status)), r.signed ? "yes" : ""].join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `partner-referrals-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Partner Referrals Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rangeLabel(from, to)} · referrals sent to partners and received from them{rep ? ` · ${rep}` : isMgr ? "" : " · your referrals"}
            {isFetching && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin" />}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1">
            {periods.map((p) => (
              <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`text-xs font-medium rounded-lg px-2.5 py-2 border transition-colors ${p.label === active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="bg-card border-border h-9 w-[140px]" aria-label="From" />
          <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="bg-card border-border h-9 w-[140px]" aria-label="To" />
          {isMgr && (
            <Select value={rep || "__all__"} onValueChange={(v) => setRep(v === "__all__" ? "" : v)}>
              <SelectTrigger className="bg-card border-border h-9 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All representatives</SelectItem>
                {repOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={!data?.rows.length}><Download className="w-4 h-4" /> Export CSV</Button>
        </div>
      </div>

      {!data ? (
        isError && !isLoading ? (
          <Card className="bg-card border-border"><CardContent className="p-5 flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 text-destructive" /><span className="flex-1">Couldn't load the report. {error?.message}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat icon={ArrowUpRight} label="Referrals sent to partners" value={data.summary.sent} color="text-indigo-600 dark:text-indigo-400"
              sub={data.summary.attended ? `${data.summary.attended} client${data.summary.attended === 1 ? "" : "s"} attended` : undefined} />
            <Stat icon={ArrowDownLeft} label="Referrals from partners" value={data.summary.received} color="text-emerald-600 dark:text-emerald-400" />
            <Stat icon={CheckCircle2} label="Signed from partners" value={data.summary.signed} color="text-teal-600 dark:text-teal-400"
              sub={data.summary.signRate == null ? undefined : `${data.summary.signRate}% of referrals received`} />
            <Stat icon={Building2} label="Partners involved" value={data.summary.partners} />
            <Stat icon={AlertCircle} label="Needs attention" value={data.summary.needsAttention} color={data.summary.needsAttention ? "text-orange-600 dark:text-orange-400" : "text-foreground"}
              sub={`${data.summary.pipeline} outbound not sent yet`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5">
            {/* By partner */}
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> By partner <span className="text-xs font-normal text-muted-foreground">· {data.byPartner.length}</span></CardTitle></CardHeader>
              {!data.byPartner.length ? <CardContent className="text-sm text-muted-foreground">No partner referrals in these dates.</CardContent> : (
                <div className="overflow-x-auto max-h-[480px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 border-border">
                        <TableHead className="text-xs">Partner</TableHead>
                        <TableHead className="text-xs">Owner</TableHead>
                        <TableHead className="text-xs text-right" title="Referrals we sent to the partner">Sent</TableHead>
                        <TableHead className="text-xs text-right" title="Referrals the partner sent us">Received</TableHead>
                        <TableHead className="text-xs text-right">Signed</TableHead>
                        <TableHead className="text-xs text-right" title="Received − sent">Balance</TableHead>
                        <TableHead className="text-xs whitespace-nowrap">Last</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byPartner.map((p) => {
                        const balance = p.received - p.sent;
                        // The old report's "needs attention" list: a relationship running one way.
                        const oneWay = p.sent === 0 ? "Sends us referrals, none sent back" : p.received === 0 ? "We send referrals, none received" : null;
                        return (
                          <TableRow key={`${p.facilityId ?? p.partner}`} className="border-border">
                            <TableCell className="py-1.5 text-sm max-w-[260px]">
                              <span className="block truncate" title={p.partner}><PartnerName id={p.facilityId} name={p.partner} /></span>
                              {oneWay && <span className="block text-[11px] text-orange-600 dark:text-orange-400">{oneWay}</span>}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{p.owner ?? "—"}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums text-indigo-600 dark:text-indigo-400">{p.sent || ""}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums text-emerald-600 dark:text-emerald-400">{p.received || ""}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums font-semibold">{p.signed || ""}</TableCell>
                            <TableCell className={`py-1.5 text-sm text-right tabular-nums font-semibold ${balance > 0 ? "text-emerald-600 dark:text-emerald-400" : balance < 0 ? "text-destructive" : "text-muted-foreground"}`}>{balance > 0 ? `+${balance}` : balance}</TableCell>
                            <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{dayLabel(p.last)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            <div className="space-y-5">
              {/* By representative */}
              <Card className="bg-card border-border overflow-hidden">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> By representative</CardTitle></CardHeader>
                {!data.byRep.length ? <CardContent className="text-sm text-muted-foreground">No referrals in these dates.</CardContent> : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 border-border">
                          <TableHead className="text-xs">Representative</TableHead>
                          <TableHead className="text-xs text-right">Sent</TableHead>
                          <TableHead className="text-xs text-right">Received</TableHead>
                          <TableHead className="text-xs text-right">Signed</TableHead>
                          <TableHead className="text-xs text-right">Partners</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.byRep.map((r) => (
                          <TableRow key={r.rep} className={`border-border ${isMgr ? "cursor-pointer hover:bg-muted/20" : ""} ${rep && r.rep === rep ? "bg-primary/10" : ""}`}
                            onClick={() => isMgr && r.rep !== "Unassigned" && setRep(rep === r.rep ? "" : r.rep)}>
                            <TableCell className="py-1.5 text-sm font-medium whitespace-nowrap">{r.rep}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums text-indigo-600 dark:text-indigo-400">{r.sent}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.received}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums font-semibold">{r.signed}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums">{r.partners}</TableCell>
                          </TableRow>
                        ))}
                        {data.byRep.length > 1 && (
                          <TableRow className="border-border bg-muted/40 font-semibold">
                            <TableCell className="py-1.5 text-sm">Total</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums">{data.summary.sent}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums">{data.summary.received}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums">{data.summary.signed}</TableCell>
                            <TableCell className="py-1.5 text-sm text-right tabular-nums">{data.summary.partners}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              {/* Outbound pipeline, from the Partner Referral Tracker */}
              <Card className="bg-card border-border overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap"><ListChecks className="w-4 h-4" /> Outbound referral status
                    <Link href="/referral/tracker" className="text-xs font-normal text-primary hover:underline">open the tracker</Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {!data.statuses.length ? <p className="text-sm text-muted-foreground">No outbound referrals logged in these dates.</p> : (
                    <div className="flex flex-wrap gap-2">
                      {data.statuses.map((s) => (
                        <span key={s.status} className="inline-flex items-center gap-1.5"><StatusPill status={s.status} /><span className="text-xs font-semibold tabular-nums">{s.count}</span></span>
                      ))}
                    </div>
                  )}
                  {data.attention.length > 0 && (
                    <div className="rounded-lg border border-border divide-y divide-border max-h-[220px] overflow-y-auto">
                      {data.attention.map((a) => (
                        <div key={a.id} className="px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="font-medium text-foreground">{a.client}</span>
                            <span className="text-muted-foreground"> · {a.partner ?? "no partner picked"} · {a.rep} · {dayLabel(a.date)}</span>
                          </span>
                          <StatusPill status={a.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Every referral */}
          <Card className="bg-card border-border overflow-hidden">
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
              <CardTitle className="text-sm flex items-center gap-2"><ArrowDownLeft className="w-4 h-4" /> Referrals <span className="text-xs font-normal text-muted-foreground">· {rows.length} · newest first</span></CardTitle>
              <div className="flex gap-1">
                {(["all", "sent", "received"] as const).map((d) => (
                  <button key={d} onClick={() => { setDirection(d); setShowAll(false); }}
                    className={`text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${direction === d ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
                    {d === "all" ? "All" : d === "sent" ? "Sent to partners" : "Received from partners"}
                  </button>
                ))}
              </div>
            </CardHeader>
            {!rows.length ? <CardContent className="text-sm text-muted-foreground">No referrals.</CardContent> : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 border-border">
                        <TableHead className="text-xs whitespace-nowrap">Date</TableHead>
                        <TableHead className="text-xs">Direction</TableHead>
                        <TableHead className="text-xs">Partner</TableHead>
                        <TableHead className="text-xs">Owner</TableHead>
                        <TableHead className="text-xs">Representative</TableHead>
                        <TableHead className="text-xs">Client / lead</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.map((r) => (
                        <TableRow key={r.id} className="border-border">
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{dayLabel(r.date)}</TableCell>
                          <TableCell className="py-1.5 text-xs whitespace-nowrap">
                            {r.direction === "sent"
                              ? <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400"><ArrowUpRight className="w-3 h-3" /> Sent</span>
                              : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowDownLeft className="w-3 h-3" /> Received</span>}
                          </TableCell>
                          <TableCell className="py-1.5 text-sm max-w-[240px]"><span className="block truncate" title={r.partner}><PartnerName id={r.facilityId} name={r.partner} /></span></TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.owner ?? "—"}</TableCell>
                          <TableCell className="py-1.5 text-xs whitespace-nowrap">{r.rep}</TableCell>
                          <TableCell className="py-1.5 text-xs max-w-[200px]"><span className="block truncate" title={r.client ?? undefined}>{r.client ?? "—"}</span></TableCell>
                          <TableCell className="py-1.5"><StatusPill status={r.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {rows.length > shown.length && (
                  <div className="p-3 flex justify-center border-t border-border">
                    <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>Show all {rows.length} referrals</Button>
                  </div>
                )}
              </>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">
            Counts match the partner profiles and the Command Center. Sent: referrals that went out to a partner (from the Partner Referral
            Tracker and the Referral-Friendly sheet) plus leads logged as sent on a partner's profile. Received: leads a partner referred, from
            Lead Docket or logged on the profile; a lead whose referrer matches no partner counts for its representative elsewhere but not here.
            Signed is a received referral that signed up. The status breakdown covers every outbound referral dated in the range, including ones not
            sent yet. Dates are Pacific.
          </p>
        </>
      )}
    </div>
  );
}
