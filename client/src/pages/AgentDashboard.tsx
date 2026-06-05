import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, MapPin, Clock, DollarSign, Gift, CheckCircle } from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  "Gracel": "#6366f1",
  "Queenie": "#ec4899",
  "Ally": "#10b981",
  "Miguel": "#f59e0b",
  "Rupert": "#3b82f6",
};

function getAgentColor(name: string) {
  const key = Object.keys(AGENT_COLORS).find((k) => name.toLowerCase().includes(k.toLowerCase()));
  return key ? AGENT_COLORS[key] : "#94a3b8";
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3 border border-border">
      <div className="rounded-lg p-2" style={{ backgroundColor: color + "22" }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function AgentDashboard() {
  const { data: kpis, isLoading } = trpc.bdr.dashboardKpis.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          KPI summary per BDR agent — visits, expenses, rewards, and errands
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && (!kpis || kpis.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No agent data yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Start logging field visits, expenses, and rewards to see KPIs here.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && kpis && kpis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {kpis.map((agent) => {
            const color = getAgentColor(agent.agentName);
            return (
              <Card key={agent.agentName} className="overflow-hidden">
                <CardHeader className="pb-3" style={{ borderBottom: `3px solid ${color}` }}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: color }}
                    >
                      {agent.agentName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-base">{agent.agentName}</CardTitle>
                      <Badge variant="outline" className="text-xs mt-0.5">BDR Agent</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 grid grid-cols-2 gap-2">
                  <KpiCard
                    icon={MapPin}
                    label="Field Visits"
                    value={agent.totalVisits}
                    sub={`${agent.totalFacilitiesVisited} facilities`}
                    color={color}
                  />
                  <KpiCard
                    icon={Clock}
                    label="Hours Worked"
                    value={agent.totalHoursWorked.toFixed(1)}
                    sub="total hours"
                    color={color}
                  />
                  <KpiCard
                    icon={DollarSign}
                    label="FR Expenses"
                    value={`$${agent.totalFrExpenses.toFixed(2)}`}
                    color={color}
                  />
                  <KpiCard
                    icon={DollarSign}
                    label="BDR Expenses"
                    value={`$${agent.totalBdrExpenses.toFixed(2)}`}
                    color={color}
                  />
                  <KpiCard
                    icon={Gift}
                    label="Referral Rewards"
                    value={`$${agent.totalReferralRewards.toFixed(2)}`}
                    sub={`${agent.acceptedRewards} accepted · ${agent.pendingRewards} pending`}
                    color={color}
                  />
                  <KpiCard
                    icon={CheckCircle}
                    label="Errands"
                    value={`${agent.completedErrands}/${agent.totalErrands}`}
                    sub="completed"
                    color={color}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
