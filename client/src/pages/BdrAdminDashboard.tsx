import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Users, MapPin, DollarSign, Gift, ClipboardList, Network,
  TrendingUp, Award, CheckCircle, AlertCircle,
} from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  Gracel: "#6366f1",
  Queenie: "#f59e0b",
  Ally: "#10b981",
  Miguel: "#3b82f6",
  Rupert: "#ec4899",
};

const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];

function fmt$(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function KpiCard({
  icon: Icon, label, value, sub, color = "text-indigo-500",
}: { icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 flex items-start gap-4">
        <div className={`mt-0.5 ${color}`}><Icon className="w-8 h-8" /></div>
        <div>
          <p className="text-2xl font-bold leading-tight">{value}</p>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function BdrAdminDashboard() {
  const { user } = useAuth();
  if (user && user.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="text-lg font-semibold">Admin access required</p>
        <p className="text-muted-foreground text-sm mt-1">This dashboard is only visible to administrators.</p>
      </div>
    );
  }

  const { data, isLoading } = trpc.bdr.adminDashboard.useQuery();

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-6 text-muted-foreground">No data available.</div>;

  const { kpis, byAgent, byMonth, byErrandType, byReferralStatus, byRewardTier } = data;

  // Format month labels (2025-01 → Jan '25)
  const monthlyData = byMonth.map((m) => {
    const [year, month] = m.month.split("-");
    const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    return { ...m, label };
  });

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">BDR Admin Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Aggregated metrics across all agents and time periods</p>
      </div>

      {/* Top KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={MapPin} label="Total Field Visits" value={kpis.totalVisits} sub={`${kpis.totalFacilities} facilities visited`} color="text-indigo-500" />
        <KpiCard icon={DollarSign} label="Total Expenses" value={fmt$(kpis.totalExpenses)} sub="FR + BDR combined" color="text-rose-500" />
        <KpiCard icon={Gift} label="Rewards Paid Out" value={fmt$(kpis.totalRewardsPaid)} sub={`${kpis.totalReferrals} referrals tracked`} color="text-amber-500" />
        <KpiCard icon={Network} label="Successful Referrals" value={kpis.successfulReferrals} sub={`of ${kpis.totalReferrals} total`} color="text-emerald-500" />
        <KpiCard icon={ClipboardList} label="Total Errands" value={kpis.totalErrands} sub={`${kpis.completedErrands} completed`} color="text-blue-500" />
        <KpiCard icon={CheckCircle} label="Errand Completion" value={kpis.totalErrands > 0 ? `${Math.round((kpis.completedErrands / kpis.totalErrands) * 100)}%` : "—"} sub="completion rate" color="text-teal-500" />
        <KpiCard icon={TrendingUp} label="Referral Success Rate" value={kpis.totalReferrals > 0 ? `${Math.round((kpis.successfulReferrals / kpis.totalReferrals) * 100)}%` : "—"} sub="successful sends" color="text-purple-500" />
        <KpiCard icon={Users} label="Active Agents" value={byAgent.filter(a => a.visits > 0 || a.frExpenses > 0).length} sub="with recorded activity" color="text-orange-500" />
      </div>

      {/* Tabs for detailed charts */}
      <Tabs defaultValue="agents">
        <TabsList className="mb-4">
          <TabsTrigger value="agents">By Agent</TabsTrigger>
          <TabsTrigger value="trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdowns</TabsTrigger>
          <TabsTrigger value="table">Agent Table</TabsTrigger>
        </TabsList>

        {/* ── By Agent ── */}
        <TabsContent value="agents" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Visits by agent */}
            <Card>
              <CardHeader><CardTitle className="text-base">Field Visits by Agent</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byAgent} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="agent" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => [v, "Visits"]} />
                    <Bar dataKey="visits" radius={[4, 4, 0, 0]}>
                      {byAgent.map((a) => (
                        <Cell key={a.agent} fill={AGENT_COLORS[a.agent] ?? "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Expenses by agent */}
            <Card>
              <CardHeader><CardTitle className="text-base">Total Expenses by Agent</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byAgent} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="agent" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt$(v), "Expenses"]} />
                    <Bar dataKey="frExpenses" name="FR Expenses" stackId="exp" radius={[0, 0, 0, 0]}>
                      {byAgent.map((a) => (
                        <Cell key={a.agent} fill={AGENT_COLORS[a.agent] ?? "#94a3b8"} fillOpacity={0.9} />
                      ))}
                    </Bar>
                    <Bar dataKey="bdrExpenses" name="BDR Expenses" stackId="exp" radius={[4, 4, 0, 0]}>
                      {byAgent.map((a) => (
                        <Cell key={a.agent} fill={AGENT_COLORS[a.agent] ?? "#94a3b8"} fillOpacity={0.5} />
                      ))}
                    </Bar>
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Referrals by agent */}
            <Card>
              <CardHeader><CardTitle className="text-base">Referrals by Agent</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byAgent} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="agent" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="referrals" name="Total" stackId="ref" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="referralsSuccessful" name="Successful" stackId="ref2" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Errands by agent */}
            <Card>
              <CardHeader><CardTitle className="text-base">Errands by Agent</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byAgent} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="agent" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="errands" name="Total" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="errandsCompleted" name="Completed" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Monthly Trends ── */}
        <TabsContent value="trends" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Field Visits Over Time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="visits" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Visits" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Expenses Over Time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt$(v)]} />
                    <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Expenses" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Rewards Paid Over Time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt$(v)]} />
                    <Line type="monotone" dataKey="rewards" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Rewards" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Visits + Expenses Combined</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number, name: string) => name === "Expenses" ? [fmt$(v), name] : [v, name]} />
                    <Bar yAxisId="left" dataKey="visits" name="Visits" fill="#6366f1" radius={[4, 4, 0, 0]} opacity={0.85} />
                    <Bar yAxisId="right" dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.85} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Breakdowns ── */}
        <TabsContent value="breakdown" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Referral status pie */}
            <Card>
              <CardHeader><CardTitle className="text-base">Referral Status</CardTitle></CardHeader>
              <CardContent className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={byReferralStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {byReferralStatus.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {byReferralStatus.map((s, i) => (
                    <Badge key={s.status} variant="outline" style={{ borderColor: PIE_COLORS[i % PIE_COLORS.length], color: PIE_COLORS[i % PIE_COLORS.length] }}>
                      {s.status}: {s.count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Errand type pie */}
            <Card>
              <CardHeader><CardTitle className="text-base">Errand Types</CardTitle></CardHeader>
              <CardContent className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={byErrandType} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""} labelLine={false}>
                      {byErrandType.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                  {byErrandType.slice(0, 5).map((e, i) => (
                    <Badge key={e.type} variant="outline" style={{ borderColor: PIE_COLORS[i % PIE_COLORS.length], color: PIE_COLORS[i % PIE_COLORS.length] }}>
                      {e.type}: {e.count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Reward type bar */}
            <Card>
              <CardHeader><CardTitle className="text-base">Rewards by Referral Type</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={byRewardTier} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="tier" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip formatter={(v: number) => [fmt$(v), "Total Paid"]} />
                    <Bar dataKey="total" name="Total Paid" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Agent Table ── */}
        <TabsContent value="table">
          <Card>
            <CardHeader><CardTitle className="text-base">Agent Performance Summary</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Agent</th>
                    <th className="text-right py-2 px-3 font-medium">Visits</th>
                    <th className="text-right py-2 px-3 font-medium">Facilities</th>
                    <th className="text-right py-2 px-3 font-medium">Hours</th>
                    <th className="text-right py-2 px-3 font-medium">FR Exp.</th>
                    <th className="text-right py-2 px-3 font-medium">BDR Exp.</th>
                    <th className="text-right py-2 px-3 font-medium">Total Exp.</th>
                    <th className="text-right py-2 px-3 font-medium">Rewards</th>
                    <th className="text-right py-2 px-3 font-medium">Errands</th>
                    <th className="text-right py-2 px-3 font-medium">Referrals</th>
                    <th className="text-right py-2 pl-3 font-medium">Successful</th>
                  </tr>
                </thead>
                <tbody>
                  {byAgent.map((a) => (
                    <tr key={a.agent} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: AGENT_COLORS[a.agent] ?? "#94a3b8" }} />
                          <span className="font-medium">{a.agent}</span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">{a.visits}</td>
                      <td className="text-right py-2.5 px-3">{a.facilities}</td>
                      <td className="text-right py-2.5 px-3">{a.hours.toFixed(1)}</td>
                      <td className="text-right py-2.5 px-3">{fmt$(a.frExpenses)}</td>
                      <td className="text-right py-2.5 px-3">{fmt$(a.bdrExpenses)}</td>
                      <td className="text-right py-2.5 px-3 font-medium">{fmt$(a.totalExpenses)}</td>
                      <td className="text-right py-2.5 px-3">{fmt$(a.rewardsPaid)}</td>
                      <td className="text-right py-2.5 px-3">
                        {a.errands > 0 ? (
                          <span>{a.errandsCompleted}/{a.errands}</span>
                        ) : "—"}
                      </td>
                      <td className="text-right py-2.5 px-3">{a.referrals}</td>
                      <td className="text-right py-2.5 pl-3">
                        {a.referrals > 0 ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                            {a.referralsSuccessful} ({Math.round((a.referralsSuccessful / a.referrals) * 100)}%)
                          </Badge>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold bg-muted/20">
                    <td className="py-2.5 pr-4">Total</td>
                    <td className="text-right py-2.5 px-3">{kpis.totalVisits}</td>
                    <td className="text-right py-2.5 px-3">{kpis.totalFacilities}</td>
                    <td className="text-right py-2.5 px-3">{byAgent.reduce((s, a) => s + a.hours, 0).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(byAgent.reduce((s, a) => s + a.frExpenses, 0))}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(byAgent.reduce((s, a) => s + a.bdrExpenses, 0))}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.totalExpenses)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.totalRewardsPaid)}</td>
                    <td className="text-right py-2.5 px-3">{kpis.completedErrands}/{kpis.totalErrands}</td>
                    <td className="text-right py-2.5 px-3">{kpis.totalReferrals}</td>
                    <td className="text-right py-2.5 pl-3">{kpis.successfulReferrals}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
