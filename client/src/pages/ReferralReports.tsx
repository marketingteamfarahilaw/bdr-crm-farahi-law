import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, CheckCircle, AlertCircle, Building2, User, CheckCircle2, Clock, XCircle, Inbox } from "lucide-react";

export default function ReferralReports() {
  const { data: stats, isLoading } = trpc.referralWorkflow.stats.useQuery();

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">Loading referral reports...</p>
      </div>
    );
  }

  const summary = stats?.summary ?? { totalOutbound: 0, totalInbound: 0, totalSigned: 0 };
  const byFacility = stats?.byFacility ?? [];
  const byAgent = stats?.byAgent ?? [];
  const outbound = stats?.outbound ?? [];
  const inbound = stats?.inbound ?? [];

  // Status breakdown for outbound
  const statusCounts: Record<string, number> = {};
  for (const r of outbound) {
    const s = r.status ?? "Unknown";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  // Facilities with low activity (sent leads but received none back, or vice versa)
  const lowActivity = byFacility.filter(f => f.facility !== "Unknown" && (f.sent === 0 || f.received === 0));

  // Sign rate
  const signRate = summary.totalInbound > 0
    ? Math.round((summary.totalSigned / summary.totalInbound) * 100)
    : 0;

  // Theme-aware status pill styling derived from the status text
  const statusPill = (status: string) => {
    const s = status.toLowerCase();
    const positive = /(accept|sign|complet|success|active|won|approv|retain)/.test(s);
    const pending = /(pending|progress|review|sent|open|awaiting|follow)/.test(s);
    const negative = /(den|reject|fail|declin|lost|not|closed|inactive|dead)/.test(s);
    if (positive) {
      return {
        className:
          "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
        Icon: CheckCircle2,
      };
    }
    if (negative) {
      return {
        className:
          "bg-destructive/15 text-destructive dark:text-red-400 border-destructive/30",
        Icon: XCircle,
      };
    }
    if (pending) {
      return {
        className:
          "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
        Icon: Clock,
      };
    }
    return {
      className: "bg-muted text-muted-foreground border-border",
      Icon: AlertCircle,
    };
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Referral Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Partner activity summary — leads sent, received, signed, and relationship balance
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <ArrowUpRight className="w-8 h-8 text-indigo-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{summary.totalOutbound}</p>
              <p className="text-xs text-muted-foreground">Referrals Sent</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <ArrowDownLeft className="w-8 h-8 text-emerald-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{summary.totalInbound}</p>
              <p className="text-xs text-muted-foreground">Leads Received</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-teal-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{summary.totalSigned}</p>
              <p className="text-xs text-muted-foreground">Signed Cases</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-orange-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{signRate}%</p>
              <p className="text-xs text-muted-foreground">Sign Rate</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Facility */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="w-4 h-4" /> Lead Balance by Facility
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {byFacility.length === 0 ? (
              <div className="m-4 rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
                <Building2 className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="mt-3 text-sm font-medium text-foreground">No facility activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Lead balance appears once referrals are tracked.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facility</TableHead>
                    <TableHead className="text-center">Sent</TableHead>
                    <TableHead className="text-center">Received</TableHead>
                    <TableHead className="text-center">Signed</TableHead>
                    <TableHead className="text-center">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byFacility
                    .sort((a, b) => (b.received + b.sent) - (a.received + a.sent))
                    .map(f => {
                      const balance = f.received - f.sent;
                      return (
                        <TableRow key={f.facility}>
                          <TableCell className="font-medium max-w-[180px] truncate" title={f.facility}>{f.facility}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-indigo-600 border-indigo-200">{f.sent}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-emerald-600 border-emerald-200">{f.received}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-teal-600 border-teal-200">{f.signed}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-sm font-semibold ${balance > 0 ? "text-emerald-600" : balance < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                              {balance > 0 ? `+${balance}` : balance}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* By Agent */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="w-4 h-4" /> Activity by Agent
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {byAgent.length === 0 ? (
              <div className="m-4 rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
                <User className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="mt-3 text-sm font-medium text-foreground">No agent activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Per-agent referral activity appears here once logged.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-center">Referrals Sent</TableHead>
                    <TableHead className="text-center">Leads Received</TableHead>
                    <TableHead className="text-center">Total Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byAgent
                    .sort((a, b) => (b.sent + b.received) - (a.sent + a.received))
                    .map(a => (
                      <TableRow key={a.agent}>
                        <TableCell className="max-w-[200px]"><Badge variant="outline" className="max-w-full truncate" title={a.agent}>{a.agent}</Badge></TableCell>
                        <TableCell className="text-center text-indigo-600 font-medium">{a.sent}</TableCell>
                        <TableCell className="text-center text-emerald-600 font-medium">{a.received}</TableCell>
                        <TableCell className="text-center font-bold">{a.sent + a.received}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Outbound Status Breakdown */}
      {outbound.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outbound Referral Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(statusCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => {
                  const { className, Icon } = statusPill(status);
                  return (
                    <div key={status} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
                        <Icon className="w-3.5 h-3.5" />
                        <span className="max-w-[160px] truncate" title={status}>{status}</span>
                      </span>
                      <Badge>{count}</Badge>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Low Activity Facilities */}
      {lowActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" /> Facilities Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead className="text-center">Sent</TableHead>
                  <TableHead className="text-center">Received</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowActivity.map(f => {
                  const note = f.sent === 0
                    ? "Receiving leads but not sending referrals back"
                    : "Sent referrals but no leads received yet";
                  return (
                    <TableRow key={f.facility}>
                      <TableCell className="font-medium max-w-[180px] truncate" title={f.facility}>{f.facility}</TableCell>
                      <TableCell className="text-center">{f.sent}</TableCell>
                      <TableCell className="text-center">{f.received}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate" title={note}>
                        {note}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {summary.totalOutbound === 0 && summary.totalInbound === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
          <Inbox className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="mt-3 text-lg font-medium text-foreground">No referral data yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start by adding outbound referrals or inbound leads in the Partner Referral Tracker.</p>
        </div>
      )}
    </div>
  );
}
