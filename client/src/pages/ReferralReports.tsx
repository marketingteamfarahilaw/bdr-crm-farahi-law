import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, CheckCircle, AlertCircle, Building2, User } from "lucide-react";

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
              <p className="text-muted-foreground text-sm text-center py-8">No data yet.</p>
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
                          <TableCell className="font-medium max-w-[160px] truncate">{f.facility}</TableCell>
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
              <p className="text-muted-foreground text-sm text-center py-8">No data yet.</p>
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
                        <TableCell><Badge variant="outline">{a.agent}</Badge></TableCell>
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
                .map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium">{status}</span>
                    <Badge>{count}</Badge>
                  </div>
                ))}
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
                {lowActivity.map(f => (
                  <TableRow key={f.facility}>
                    <TableCell className="font-medium">{f.facility}</TableCell>
                    <TableCell className="text-center">{f.sent}</TableCell>
                    <TableCell className="text-center">{f.received}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.sent === 0 ? "Receiving leads but not sending referrals back" : "Sent referrals but no leads received yet"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {summary.totalOutbound === 0 && summary.totalInbound === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No referral data yet</p>
          <p className="text-sm mt-1">Start by adding outbound referrals or inbound leads in the Partner Referral Tracker.</p>
        </div>
      )}
    </div>
  );
}
