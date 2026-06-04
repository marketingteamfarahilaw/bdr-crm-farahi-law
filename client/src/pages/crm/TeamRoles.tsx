import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ROLE_LABELS, ASSIGNABLE_ROLES, canAssignRoles, canManage, normalizeRole } from "@shared/permissions";
import { Shield, AlertTriangle } from "lucide-react";

const ROLE_COLOR: Record<string, string> = {
  super_admin: "text-primary",
  bdr_manager: "text-emerald-400",
  fr_manager: "text-cyan-400",
  bdr_agent: "text-sky-400",
  fr_agent: "text-orange-400",
};

export default function TeamRoles() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isManager = canManage(user?.role);
  const canEdit = canAssignRoles(user?.role);

  const { data: users, isLoading } = trpc.team.list.useQuery(undefined, { enabled: isManager, retry: false });
  const setRole = trpc.team.setRole.useMutation({
    onSuccess: () => { toast.success("Role updated"); utils.team.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (user && !isManager) {
    return (
      <div className="p-8 text-center py-20">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3 opacity-60" />
        <p className="text-lg font-medium text-foreground">Managers only</p>
        <p className="text-muted-foreground text-sm mt-1">This page is visible to managers and the super admin.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-mesh min-h-full">
      <div className="max-w-[900px] mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Team &amp; Roles</h1>
            <p className="text-sm text-muted-foreground">
              {canEdit ? "Assign each person's role and access level." : "Your team and their roles (only the super admin can change them)."}
            </p>
          </div>
        </div>

        <div className="premium-card rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u: any) => {
                  const r = normalizeRole(u.role);
                  return (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {u.name || "—"}{u.id === user?.id && <span className="ml-2 text-[10px] text-primary">(you)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{u.email || "—"}</td>
                      <td className="px-4 py-2.5">
                        {canEdit ? (
                          <Select value={r} onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as any })}>
                            <SelectTrigger className="w-44 h-8 bg-card border-border text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{ASSIGNABLE_ROLES.map((opt) => <SelectItem key={opt} value={opt}>{ROLE_LABELS[opt]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <span className={`text-xs font-semibold ${ROLE_COLOR[r] ?? "text-foreground"}`}>{ROLE_LABELS[r]}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(users ?? []).length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No team members yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
