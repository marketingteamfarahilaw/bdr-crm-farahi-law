import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Users, PhoneCall, Star, AlertTriangle,
  Clock, TrendingUp, CheckCircle2, ChevronRight
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active_partner: { label: "Active Partner", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  warm_lead: { label: "Warm Lead", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  cold: { label: "Cold", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  churned: { label: "Churned", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  do_not_contact: { label: "Do Not Contact", color: "bg-red-900/30 text-red-300 border-red-900/50" },
  needs_agent: { label: "Needs Agent", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export default function ManagementDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: stats, isLoading: statsLoading } = trpc.crm.management.dashboard.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const { data: flagged, isLoading: flaggedLoading } = trpc.crm.management.flaggedFacilities.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const { data: overdueTasks } = trpc.crm.tasks.listOverdue.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  if (user?.role !== "admin") {
    return (
      <div className="p-6 text-center py-20">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4 opacity-60" />
        <p className="text-lg font-medium text-foreground">Admin Access Required</p>
        <p className="text-muted-foreground mt-1">This dashboard is only visible to admin users.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          Management Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of all facility relationships and BD team activity</p>
      </div>

      {/* KPI Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Facilities", value: stats?.totalFacilities ?? 0, icon: Building2, color: "text-blue-400" },
            { label: "Active Partners", value: stats?.activePartners ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
            { label: "Warm Leads", value: stats?.warmLeads ?? 0, icon: TrendingUp, color: "text-amber-400" },
            { label: "Flagged", value: stats?.flaggedCount ?? 0, icon: AlertTriangle, color: "text-red-400" },
            { label: "Total Referrals", value: stats?.totalReferrals ?? 0, icon: Star, color: "text-[var(--gold)]" },
            { label: "Total Leads Sent", value: stats?.totalLeadsSent ?? 0, icon: Users, color: "text-purple-400" },
            { label: "Open Tasks", value: stats?.openTasks ?? 0, icon: Clock, color: "text-orange-400" },
            { label: "Contact Logs", value: stats?.totalContactLogs ?? 0, icon: PhoneCall, color: "text-cyan-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Flagged Facilities */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Flagged for Management
              {flagged && flagged.length > 0 && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs ml-auto">{flagged.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {flaggedLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : flagged?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No flagged facilities</p>
            ) : (
              <div className="space-y-2">
                {flagged?.slice(0, 8).map((f: { id: number; name: string | null; managementNote: string | null; relationshipStatus: string }) => {
                  const status = STATUS_LABELS[f.relationshipStatus] ?? STATUS_LABELS.warm_lead;
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-background hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/crm/facilities/${f.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        {f.managementNote && (
                          <p className="text-xs text-muted-foreground truncate">{f.managementNote}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <Badge className={`text-xs border ${status.color} flex-shrink-0`}>{status.label}</Badge>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Overdue Tasks */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-400" />
              Overdue Tasks
              {overdueTasks && overdueTasks.length > 0 && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs ml-auto">{overdueTasks.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!overdueTasks ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : overdueTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No overdue tasks</p>
            ) : (
              <div className="space-y-2">
                {overdueTasks.slice(0, 8).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between p-3 rounded-lg bg-background hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/crm/facilities/${task.facilityId}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {task.dueDate && (
                          <span className="text-red-400">
                            Due {format(new Date(task.dueDate), "MMM d")}
                          </span>
                        )}
                        {task.assignedToName && <span>· {task.assignedToName}</span>}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs border-border flex-shrink-0 ml-2 ${task.priority === "high" ? "text-red-400 border-red-400/30" : task.priority === "low" ? "text-slate-400" : "text-amber-400 border-amber-400/30"}`}
                    >
                      {task.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Referrers */}
      {stats?.topReferrers && stats.topReferrers.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="w-4 h-4 text-[var(--gold)]" />
              Top Referral Partners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(stats.topReferrers as Array<{ id: number; name: string; city: string | null; totalReferrals: number }>).map((f, i) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-background hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/crm/facilities/${f.id}`)}
                >
                  <span className="text-sm font-bold text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{f.city ?? ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[var(--gold)]">{f.totalReferrals}</p>
                    <p className="text-xs text-muted-foreground">referrals</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Breakdown */}
      {stats?.statusBreakdown && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Relationship Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.statusBreakdown as Record<string, number>).map(([status, count]) => {
                const s = STATUS_LABELS[status];
                if (!s || count === 0) return null;
                return (
                  <div key={status} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${s.color}`}>
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="text-lg font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
