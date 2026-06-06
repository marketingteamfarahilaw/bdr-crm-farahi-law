import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Phone, PhoneCall, Users, TrendingUp, CheckCircle2, AlertCircle,
  BarChart3, Building2, Calendar, Download, Trophy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { toast } from "sonner";

const AGENTS = ["All", "Ally", "Gracel", "Queenie", "Miguel", "Rupert"];

const CALL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  partner_checkin: { label: "Partner Check-In", color: "bg-emerald-500/20 text-emerald-400" },
  bdr_checkin: { label: "BDR Check-In", color: "bg-blue-500/20 text-blue-400" },
  fr_checkin: { label: "FR Check-In", color: "bg-purple-500/20 text-purple-400" },
  internal: { label: "Internal", color: "bg-slate-500/20 text-slate-400" },
  potential_lead: { label: "Potential Lead", color: "bg-amber-500/20 text-amber-400" },
  other: { label: "Other", color: "bg-muted/50 text-muted-foreground" },
};

function StatCard({ icon: Icon, label, value, sub, color = "text-foreground" }: {
  icon: React.ElementType; label: string; value: number | string; sub?: string; color?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Active Partners Table ───────────────────────────────────────────────────

function ActivePartnersTable({ agentFilter }: { agentFilter?: string }) {
  const { data: allFacilities, isLoading } = trpc.crm.facilities.list.useQuery({});
  const facilities = allFacilities?.filter((f: any) =>
    (f.partnerStatus === "active_partner" || f.partnerStatus === "priority_partner") &&
    (!agentFilter || f.assignedRepName === agentFilter)
  );

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  if (!facilities || facilities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
        <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
        <p className="text-sm font-medium text-foreground">No active partners yet</p>
        <p className="text-xs text-muted-foreground mt-1">Mark facilities as Active Partner to see them here.</p>
      </div>
    );
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4" />
          Active Partners ({facilities.length})
        </CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Agent</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Type</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Facility Name</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Contact</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Last Check-In</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f: any) => (
              <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{f.assignedRepName || "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground capitalize text-xs">{(f.category || "").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 font-medium text-foreground">
                  <a
                    href={`/crm/facilities/${f.id}`}
                    title={f.name}
                    className="block max-w-[14rem] truncate hover:text-primary transition-colors"
                  >
                    {f.name}
                  </a>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                  {f.contactName ? (
                    <span className="block max-w-[12rem] truncate text-foreground" title={f.contactName}>
                      {f.contactName}
                    </span>
                  ) : null}
                  {f.phone ? (
                    <span className="block mt-0.5">
                      <ClickToCallButton phoneNumber={f.phone} />
                    </span>
                  ) : null}
                  {!f.contactName && !f.phone ? <span>—</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                    f.partnerStatus === "priority_partner"
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  }`}>
                    <CheckCircle2 className="w-3 h-3" />
                    {(f.partnerStatus || "").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {f.lastContact?.contactDate
                    ? new Date(f.lastContact.contactDate).toLocaleDateString()
                    : <span className="text-amber-600 dark:text-amber-400">Never</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function BdrReports() {
  const [selectedAgent, setSelectedAgent] = useState("All");
  const [selectedMonth, setSelectedMonth] = useState("all");

  const agentFilter = selectedAgent === "All" ? undefined : selectedAgent;
  const monthFilter = selectedMonth === "all" ? undefined : selectedMonth;

  const { data: callActivity, isLoading: loadingCalls } = trpc.crm.bdrReports.callActivity.useQuery({
    repName: agentFilter,
    month: monthFilter,
  });
  const { data: partnerCheckins, isLoading: loadingCheckins } = trpc.crm.bdrReports.partnerCheckins.useQuery({
    repName: agentFilter,
  });
  const { data: topFacilities, isLoading: loadingTop } = trpc.crm.bdrReports.topFacilities.useQuery({ limit: 20 });

  // Derive available months from call activity
  const availableMonths = useMemo(() => {
    if (!callActivity) return [];
    const months = new Set(callActivity.map((r) => r.month));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [callActivity]);

  // Aggregate totals for the summary row
  const totals = useMemo(() => {
    if (!callActivity) return null;
    return callActivity.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        connected: acc.connected + r.connected,
        voicemail: acc.voicemail + r.voicemail,
        noAnswer: acc.noAnswer + r.noAnswer,
        partnerCheckin: acc.partnerCheckin + r.partnerCheckin,
        bdrCheckin: acc.bdrCheckin + r.bdrCheckin,
        frCheckin: acc.frCheckin + r.frCheckin,
        internal: acc.internal + r.internal,
        potentialLead: acc.potentialLead + r.potentialLead,
      }),
      { total: 0, connected: 0, voicemail: 0, noAnswer: 0, partnerCheckin: 0, bdrCheckin: 0, frCheckin: 0, internal: 0, potentialLead: 0 }
    );
  }, [callActivity]);

  // Group call activity by agent for the per-agent summary
  const byAgent = useMemo(() => {
    if (!callActivity) return {};
    const map: Record<string, typeof callActivity[0] & { months: number }> = {};
    for (const row of callActivity) {
      if (!map[row.repName]) {
        map[row.repName] = { ...row, months: 1 };
      } else {
        map[row.repName].total += row.total;
        map[row.repName].connected += row.connected;
        map[row.repName].voicemail += row.voicemail;
        map[row.repName].noAnswer += row.noAnswer;
        map[row.repName].partnerCheckin += row.partnerCheckin;
        map[row.repName].bdrCheckin += row.bdrCheckin;
        map[row.repName].frCheckin += row.frCheckin;
        map[row.repName].internal += row.internal;
        map[row.repName].potentialLead += row.potentialLead;
        map[row.repName].months++;
      }
    }
    return map;
  }, [callActivity]);

  const agentRows = Object.values(byAgent).sort((a, b) => b.connected - a.connected);

  function exportCsv() {
    const headers = ["Agent", "Total Calls", "Connected", "Voicemail", "No Answer", "Check-ins", "Potential Leads", "Connect %"];
    const rows = agentRows.map((a) => [a.repName, a.total, a.connected, a.voicemail, a.noAnswer, a.partnerCheckin + a.bdrCheckin + a.frCheckin, a.potentialLead, a.total ? Math.round((a.connected / a.total) * 100) + "%" : "0%"]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bdr-report-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} agent${rows.length !== 1 ? "s" : ""}`);
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            BDR Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Call activity, partner check-ins, and facility engagement metrics.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={selectedAgent} onValueChange={setSelectedAgent}>
            <SelectTrigger className="w-36 bg-card border-border">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              {AGENTS.map((a) => (
                <SelectItem key={a} value={a}>{a === "All" ? "All Agents" : a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-36 bg-card border-border">
              <SelectValue placeholder="All Months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {availableMonths.map((m) => (
                <SelectItem key={m} value={m}>
                  {new Date(m + "-01").toLocaleDateString("en-US", { year: "numeric", month: "long" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5" disabled={agentRows.length === 0}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {loadingCalls ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : totals ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Phone} label="Total Calls" value={totals.total} color="text-primary" />
          <StatCard icon={CheckCircle2} label="Connected" value={totals.connected}
            sub={`${totals.total > 0 ? Math.round((totals.connected / totals.total) * 100) : 0}% connect rate`}
            color="text-emerald-600 dark:text-emerald-400" />
          <StatCard icon={PhoneCall} label="Partner Check-Ins" value={totals.partnerCheckin + totals.bdrCheckin + totals.frCheckin} />
          <StatCard icon={TrendingUp} label="Potential Leads" value={totals.potentialLead} color="text-amber-600 dark:text-amber-400" />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm font-medium text-foreground">No call activity data yet</p>
          <p className="text-xs text-muted-foreground mt-1">Log calls from facility profiles to see reports here.</p>
        </div>
      )}

      {/* Agent Leaderboard */}
      {agentRows.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> Agent Leaderboard
              <span className="text-xs font-normal text-muted-foreground">· ranked by connected calls</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {agentRows.map((a, i) => {
              const max = agentRows[0]?.connected || 1;
              return (
                <div key={a.repName} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? "bg-primary/20 text-primary" : i < 3 ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>{i + 1}</span>
                  <span className="w-28 truncate text-sm font-medium text-foreground">{a.repName}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.round((a.connected / max) * 100)}%`, background: "linear-gradient(90deg,#2c4a73,#6a9bd8)" }} />
                  </div>
                  <span className="w-24 text-right text-xs text-muted-foreground"><span className="font-bold text-foreground">{a.connected}</span> connected</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="activity">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="activity">Call Activity</TabsTrigger>
          <TabsTrigger value="checkins">Partner Check-Ins</TabsTrigger>
          <TabsTrigger value="active-partners">Active Partners</TabsTrigger>
          <TabsTrigger value="top">Top Facilities</TabsTrigger>
        </TabsList>

        {/* ── Call Activity Tab ── */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          {/* Per-Agent Summary Cards */}
          {Object.keys(byAgent).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.values(byAgent)
                .sort((a, b) => b.total - a.total)
                .map((agent) => (
                  <Card key={agent.repName} className="bg-card border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        {agent.repName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Calls</span>
                        <span className="font-bold text-foreground text-sm">{agent.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Connected</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{agent.connected}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Voicemail</span>
                        <span className="text-amber-600 dark:text-amber-400">{agent.voicemail}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Partner Check-Ins</span>
                        <span className="text-blue-600 dark:text-blue-400">{agent.partnerCheckin + agent.bdrCheckin + agent.frCheckin}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Potential Leads</span>
                        <span className="text-amber-600 dark:text-amber-400">{agent.potentialLead}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-border">
                        <span className="text-muted-foreground">Connect Rate</span>
                        <span className="font-medium text-foreground">
                          {agent.total > 0 ? Math.round((agent.connected / agent.total) * 100) : 0}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* Monthly Breakdown Table */}
          {loadingCalls ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : callActivity && callActivity.length > 0 ? (
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Monthly Breakdown
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Agent</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Month</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Total</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Connected</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Voicemail</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Partner CI</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">BDR CI</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">FR CI</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Pot. Lead</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callActivity.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          <span className="block max-w-[10rem] truncate" title={row.repName}>{row.repName}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          {new Date(row.month + "-01").toLocaleDateString("en-US", { year: "numeric", month: "short" })}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-primary">{row.total}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400">{row.connected}</td>
                        <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-400">{row.voicemail}</td>
                        <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400">{row.partnerCheckin}</td>
                        <td className="px-4 py-2.5 text-right text-purple-600 dark:text-purple-400">{row.bdrCheckin}</td>
                        <td className="px-4 py-2.5 text-right text-indigo-600 dark:text-indigo-400">{row.frCheckin}</td>
                        <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-400">{row.potentialLead}</td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {row.total > 0 ? `${Math.round((row.connected / row.total) * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
              <Phone className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-foreground">No call activity logged yet</p>
              <p className="text-xs text-muted-foreground mt-1">Logged calls will appear in this monthly breakdown.</p>
            </div>
          )}

          {/* Call Type Legend */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground self-center">Call types:</span>
            {Object.entries(CALL_TYPE_LABELS).map(([key, { label, color }]) => (
              <Badge key={key} className={`text-xs border-0 ${color}`}>{label}</Badge>
            ))}
          </div>
        </TabsContent>

        {/* ── Partner Check-Ins Tab ── */}
        <TabsContent value="checkins" className="mt-4">
          {loadingCheckins ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : partnerCheckins && partnerCheckins.length > 0 ? (
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Partner Check-In Status by Agent
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Agent</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Total Partners</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Check-Ins (This Month)</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Check-Ins (30 Days)</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Need Check-In</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerCheckins.map((row, i) => {
                      const coverage = row.totalPartners > 0
                        ? Math.round(((row.totalPartners - row.facilitiesNeedingCheckin) / row.totalPartners) * 100)
                        : 0;
                      return (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            <span className="block max-w-[10rem] truncate" title={row.repName}>{row.repName}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground">{row.totalPartners}</td>
                          <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400">{row.checkinsThisMonth}</td>
                          <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400">{row.checkinsLast30Days}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={row.facilitiesNeedingCheckin > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                              {row.facilitiesNeedingCheckin}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${coverage >= 80 ? "bg-emerald-500" : coverage >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                  style={{ width: `${coverage}%` }}
                                />
                              </div>
                              <span className={`text-xs font-medium ${coverage >= 80 ? "text-emerald-600 dark:text-emerald-400" : coverage >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                                {coverage}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-border bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  <AlertCircle className="w-3.5 h-3.5 inline mr-1 text-amber-600 dark:text-amber-400" />
                  "Need Check-In" = partners with no contact in the last 30 days. Coverage = partners checked in / total partners.
                </p>
              </div>
            </Card>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-foreground">No partner check-in data yet</p>
              <p className="text-xs text-muted-foreground mt-1">Assign facilities to reps and log check-in calls to see data here.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Active Partners Tab ── */}
        <TabsContent value="active-partners" className="mt-4">
          <ActivePartnersTable agentFilter={agentFilter} />
        </TabsContent>

        {/* ── Top Facilities Tab ── */}
        <TabsContent value="top" className="mt-4">
          {loadingTop ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : topFacilities && topFacilities.length > 0 ? (
            <Card className="bg-card border-border overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Most Contacted Facilities
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">#</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Facility</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Type</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">City</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">BD Rep</th>
                      <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Total Calls</th>
                      <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Reps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFacilities.map((row, i) => (
                      <tr key={row.facilityId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          <a
                            href={`/crm/facilities/${row.facilityId}`}
                            title={row.name}
                            className="block max-w-[16rem] truncate hover:text-primary transition-colors"
                          >
                            {row.name}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground capitalize whitespace-nowrap">
                          {row.category.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          <span className="block max-w-[10rem] truncate" title={row.city || undefined}>{row.city || "—"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          <span className="block max-w-[10rem] truncate" title={row.assignedRepName || undefined}>{row.assignedRepName || "—"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-primary">{row.callCount}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          <span className="block max-w-[12rem] truncate" title={row.reps || undefined}>{row.reps || "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
              <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-foreground">No facility contact data yet</p>
              <p className="text-xs text-muted-foreground mt-1">Log calls against facilities to surface the most-contacted ones.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
