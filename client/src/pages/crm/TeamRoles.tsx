import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ROLE_LABELS, ASSIGNABLE_ROLES, canAssignRoles, canManage, normalizeRole } from "@shared/permissions";
import { Shield, AlertTriangle, UserPlus, KeyRound, Check, Loader2 } from "lucide-react";

const ROLE_COLOR: Record<string, string> = {
  super_admin: "text-primary",
  bdr_manager: "text-emerald-400",
  fr_manager: "text-cyan-400",
  bdr_agent: "text-sky-400",
  fr_agent: "text-orange-400",
};

// Inline editor for a user's canonical agent name (used to scope BDR/FR records).
function AgentNameCell({ u, canEdit }: { u: any; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [val, setVal] = useState<string>(u.agentName ?? "");
  const save = trpc.team.setAgentName.useMutation({
    onSuccess: () => { toast.success("Agent name saved"); utils.team.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!canEdit) return <span className="text-xs text-muted-foreground">{u.agentName || "—"}</span>;
  const dirty = val.trim() !== (u.agentName || "");
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="—"
        className="h-8 w-36 text-xs bg-card border-border"
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) save.mutate({ userId: u.id, agentName: val.trim() }); }}
      />
      {dirty && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={save.isPending} onClick={() => save.mutate({ userId: u.id, agentName: val.trim() })}>
          {save.isPending ? "…" : "Save"}
        </Button>
      )}
    </div>
  );
}

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

  // --- Add user dialog ---
  const [addOpen, setAddOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nRole, setNRole] = useState<string>("bdr_agent");
  const [nPassword, setNPassword] = useState("");

  const createUser = trpc.team.createUser.useMutation({
    onSuccess: () => {
      toast.success("User added");
      utils.team.list.invalidate();
      setAddOpen(false);
      setNName(""); setNEmail(""); setNRole("bdr_agent"); setNPassword("");
    },
    onError: (e) => toast.error(e.message),
  });

  const submitAdd = () => {
    if (!nName.trim() || !nEmail.trim()) return toast.error("Name and email are required.");
    if (nPassword.length < 6) return toast.error("Password must be at least 6 characters.");
    createUser.mutate({ name: nName.trim(), email: nEmail.trim(), role: nRole as any, password: nPassword });
  };

  // --- Set password dialog ---
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState<{ id: number; name: string } | null>(null);
  const [pwValue, setPwValue] = useState("");

  const setPassword = trpc.team.setPassword.useMutation({
    onSuccess: () => {
      toast.success("Password set");
      utils.team.list.invalidate();
      setPwOpen(false); setPwValue(""); setPwUser(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const submitPw = () => {
    if (!pwUser) return;
    if (pwValue.length < 6) return toast.error("Password must be at least 6 characters.");
    setPassword.mutate({ userId: pwUser.id, password: pwValue });
  };

  const openPw = (u: { id: number; name?: string | null; email?: string | null }) => {
    setPwUser({ id: u.id, name: u.name || u.email || "User" });
    setPwValue("");
    setPwOpen(true);
  };

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
      <div className="max-w-[980px] mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Team &amp; Roles</h1>
              <p className="text-sm text-muted-foreground">
                {canEdit ? "Add people, set passwords, and assign each person's access level." : "Your team and their roles (only the super admin can change them)."}
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <UserPlus className="w-4 h-4" /> Add user
            </Button>
          )}
        </div>

        <div className="premium-card rounded-2xl overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Agent Name</th>
                  <th className="px-4 py-2.5 font-medium">Password</th>
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
                      <td className="px-4 py-2.5">
                        <AgentNameCell u={u} canEdit={isManager} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {u.hasPassword ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check className="w-3 h-3" /> Set</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-400"><AlertTriangle className="w-3 h-3" /> Not set</span>
                          )}
                          {canEdit && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => openPw(u)}>
                              <KeyRound className="w-3 h-3" /> {u.hasPassword ? "Reset" : "Set"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(users ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No team members yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {canEdit && (
          <p className="text-xs text-muted-foreground">
            Agents only see their own facilities &amp; activity. Managers (BDR &amp; FR) and the super admin see everyone's. Give each person a password so they can sign in.
          </p>
        )}
      </div>

      {/* Add user dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Add a team member</DialogTitle>
            <DialogDescription>They'll sign in with this email and password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="n-name" className="text-xs">Full name</Label>
              <Input id="n-name" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-email" className="text-xs">Email</Label>
              <Input id="n-email" type="email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="jane@farahilaw.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={nRole} onValueChange={setNRole}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent>{ASSIGNABLE_ROLES.map((opt) => <SelectItem key={opt} value={opt}>{ROLE_LABELS[opt]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-pw" className="text-xs">Temporary password</Label>
              <Input id="n-pw" type="text" value={nPassword} onChange={(e) => setNPassword(e.target.value)} placeholder="At least 6 characters" />
              <p className="text-[11px] text-muted-foreground">Share this with them — they can keep it or you can reset it later.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={createUser.isPending} className="gap-2">
              {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Add user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set password dialog */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> Set password</DialogTitle>
            <DialogDescription>{pwUser ? `For ${pwUser.name}.` : ""} They'll use this to sign in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="pw-val" className="text-xs">New password</Label>
            <Input id="pw-val" type="text" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="At least 6 characters" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button onClick={submitPw} disabled={setPassword.isPending} className="gap-2">
              {setPassword.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
