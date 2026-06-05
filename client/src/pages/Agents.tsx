import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Phone,
  Mail,
  Building2,
  MapPin,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  UserCheck,
  UserX,
  Briefcase,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const AGENT_COLOR_OPTIONS = [
  { label: "Orange",  value: "#FF6B35" },
  { label: "Teal",    value: "#4ECDC4" },
  { label: "Purple",  value: "#A855F7" },
  { label: "Steel",   value: "#6a9bd8" },
  { label: "Blue",    value: "#3B82F6" },
  { label: "Green",   value: "#22C55E" },
  { label: "Pink",    value: "#EC4899" },
  { label: "Red",     value: "#EF4444" },
  { label: "Gray",    value: "#94A3B8" },
];

interface AgentFormData {
  firstName: string;
  lastName: string;
  employer: string;
  phone: string;
  email: string;
  title: string;
  notes: string;
  color: string;
  active: boolean;
}

const EMPTY_FORM: AgentFormData = {
  firstName: "",
  lastName: "",
  employer: "Farahi Law",
  phone: "",
  email: "",
  title: "Business Development Representative",
  notes: "",
  color: "#4ECDC4",
  active: true,
};

const LABEL_CLS =
  "block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wider";
const INPUT_CLS = "bg-card border-border";

export default function AgentsPage() {
  const utils = trpc.useUtils();
  const { data: agents = [], isLoading } = trpc.agentZones.list.useQuery();
  const { data: savedLeads = [] } = trpc.savedLeads.list.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AgentFormData>(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const createMutation = trpc.agentZones.create.useMutation({
    onSuccess: () => {
      toast.success("Agent created successfully!");
      utils.agentZones.list.invalidate();
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message || "Failed to create agent"),
  });

  const updateMutation = trpc.agentZones.update.useMutation({
    onSuccess: () => {
      toast.success("Agent updated successfully!");
      utils.agentZones.list.invalidate();
      setEditingId(null);
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message || "Failed to update agent"),
  });

  const deleteMutation = trpc.agentZones.delete.useMutation({
    onSuccess: () => {
      toast.success("Agent deleted.");
      utils.agentZones.list.invalidate();
      setDeleteConfirmId(null);
    },
    onError: (e) => toast.error(e.message || "Failed to delete agent"),
  });

  const handleSubmit = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First name and last name are required.");
      return;
    }
    const agentName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, agentName, ...form });
    } else {
      createMutation.mutate({ agentName, ...form, cities: [] });
    }
  };

  const handleEdit = (agent: any) => {
    setEditingId(agent.id);
    setForm({
      firstName: agent.firstName ?? "",
      lastName: agent.lastName ?? "",
      employer: agent.employer ?? "Farahi Law",
      phone: agent.phone ?? "",
      email: agent.email ?? "",
      title: agent.title ?? "",
      notes: agent.notes ?? "",
      color: agent.color ?? "#4ECDC4",
      active: agent.active ?? true,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const getLeadCount = (agentName: string) =>
    savedLeads.filter((l: any) => l.assignedAgent === agentName).length;

  const getHotCount = (agentName: string) =>
    savedLeads.filter((l: any) => l.assignedAgent === agentName && l.scoreTier === "hot").length;

  const stats = [
    {
      label: "Total Agents",
      value: agents.length,
      icon: Users,
      numCls: "text-primary",
      badgeCls: "bg-primary/10 text-primary border-primary/20",
    },
    {
      label: "Active Agents",
      value: agents.filter((a: any) => a.active !== false).length,
      icon: UserCheck,
      numCls: "text-green-600 dark:text-green-400",
      badgeCls: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    },
    {
      label: "Leads Assigned",
      value: savedLeads.filter((l: any) => l.assignedAgent).length,
      icon: MapPin,
      numCls: "text-blue-600 dark:text-blue-400",
      badgeCls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
  ];

  return (
    <div className="min-h-full bg-background p-6 md:p-8">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0">
              <Users size={18} className="text-primary-foreground" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Agent Management
            </h1>
          </div>
          <p className="text-sm text-muted-foreground ml-12">
            Manage your Business Development Representatives and their territories
          </p>
        </div>
        {!showForm && (
          <Button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
            className="gap-2"
          >
            <Plus size={15} strokeWidth={2.5} />
            Add Agent
          </Button>
        )}
      </div>

      {/* ── Create / Edit Form ── */}
      {showForm && (
        <div className="mb-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-base font-bold text-foreground">
                {editingId !== null ? "Edit Agent" : "New Agent"}
              </div>
              <div className="text-xs mt-0.5 text-muted-foreground">
                {editingId !== null ? "Update agent profile information" : "Fill in the agent's profile details"}
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close form"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={LABEL_CLS}>First Name <span className="text-destructive">*</span></label>
              <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="e.g. Miguel" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Last Name <span className="text-destructive">*</span></label>
              <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="e.g. Flores" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Employer</label>
              <Input value={form.employer} onChange={e => setForm(f => ({ ...f, employer: e.target.value }))} placeholder="e.g. Farahi Law" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Job Title</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Business Development Representative" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Phone Number</label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. (213) 555-0100" type="tel" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Email Address</label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. miguel@farahilaw.com" type="email" className={INPUT_CLS} />
            </div>
          </div>

          {/* Territory Color */}
          <div className="mb-4">
            <label className={`${LABEL_CLS} mb-2`}>Territory Color</label>
            <div className="flex flex-wrap gap-2">
              {AGENT_COLOR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setForm(f => ({ ...f, color: opt.value }))}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: opt.value,
                    border: form.color === opt.value ? `3px solid var(--foreground)` : `2px solid transparent`,
                    boxShadow: form.color === opt.value ? `0 0 12px ${opt.value}80` : "none",
                  }}
                  title={opt.label}
                >
                  {form.color === opt.value && <Check size={14} color="#fff" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          {/* Active toggle */}
          <div className="mb-5">
            <label className={`${LABEL_CLS} mb-2`}>Status</label>
            <div className="flex gap-3">
              {[{ v: true, label: "Active", icon: <UserCheck size={13} /> }, { v: false, label: "Inactive", icon: <UserX size={13} /> }].map(opt => {
                const selected = form.active === opt.v;
                const cls = selected
                  ? (opt.v
                      ? "bg-green-500/12 border-green-500/40 text-green-600 dark:text-green-400"
                      : "bg-destructive/12 border-destructive/40 text-destructive")
                  : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground";
                return (
                  <button
                    key={String(opt.v)}
                    onClick={() => setForm(f => ({ ...f, active: opt.v }))}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg border text-xs font-semibold transition-all ${cls}`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="mb-6">
            <label className={LABEL_CLS}>Notes</label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this agent's territory, performance, or contact preferences..."
              rows={3}
              className={`${INPUT_CLS} resize-none`}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} className="gap-2">
              <Check size={14} strokeWidth={2.5} />
              {editingId !== null ? "Save Changes" : "Create Agent"}
            </Button>
            <Button variant="outline" onClick={handleCancel} className="border-border">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-[10px] border flex items-center justify-center ${stat.badgeCls}`}>
                <stat.icon size={16} />
              </div>
              <div>
                <div className={`text-2xl font-extrabold leading-none tracking-tight ${stat.numCls}`}>
                  {stat.value}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 font-medium">{stat.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Agent cards ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading agents...</div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-8 py-12 text-center shadow-sm">
          <div className="text-5xl mb-4">👥</div>
          <div className="text-lg font-bold text-foreground mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
            No Agents Yet
          </div>
          <div className="text-sm text-muted-foreground mb-5">
            Add your first Business Development Representative to get started.
          </div>
          <Button onClick={() => setShowForm(true)}>Add First Agent</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {agents.map((agent: any) => {
            const isExpanded = expandedId === agent.id;
            const leadCount = getLeadCount(agent.agentName);
            const hotCount = getHotCount(agent.agentName);
            const initials = agent.agentName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
            const isActive = agent.active !== false;

            return (
              <div
                key={agent.id}
                className="rounded-2xl border bg-card overflow-hidden shadow-sm transition-all"
                style={{ borderColor: `${agent.color}40` }}
              >
                {/* Card header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                  style={{
                    background: isExpanded ? `linear-gradient(90deg, ${agent.color}12 0%, transparent 100%)` : "transparent",
                    borderBottom: isExpanded ? `1px solid ${agent.color}20` : "none",
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-base font-extrabold shrink-0 text-white"
                    style={{
                      background: `linear-gradient(135deg, ${agent.color}, ${agent.color}aa)`,
                      boxShadow: `0 0 18px ${agent.color}50`,
                    }}
                  >
                    {initials}
                  </div>

                  {/* Name & title */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-bold text-foreground">{agent.agentName}</span>
                      {!isActive && (
                        <span className="text-[10px] font-bold text-destructive bg-destructive/12 border border-destructive/25 rounded-full px-2 py-0.5 tracking-wider">
                          INACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {agent.title || "Business Development Representative"}
                      {agent.employer ? ` · ${agent.employer}` : ""}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 border"
                      style={{ background: `${agent.color}14`, borderColor: `${agent.color}33` }}
                    >
                      <MapPin size={10} color={agent.color} />
                      <span className="text-[11px] font-bold" style={{ color: agent.color }}>{leadCount}</span>
                      <span className="text-[10px] text-muted-foreground">leads</span>
                    </div>
                    {hotCount > 0 && (
                      <div className="flex items-center gap-1 rounded-full px-2.5 py-1 bg-destructive/10 border border-destructive/25">
                        <span className="text-[10px]">🔥</span>
                        <span className="text-[11px] font-bold text-destructive">{hotCount}</span>
                      </div>
                    )}
                    <div className="text-muted-foreground ml-1">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 mb-5">
                      {agent.phone && (
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                            <Phone size={12} className="text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-0.5">Phone</div>
                            <ClickToCallButton phoneNumber={agent.phone} className="text-primary hover:text-primary/80 font-semibold text-xs" />
                          </div>
                        </div>
                      )}
                      {agent.email && (
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <Mail size={12} className="text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-0.5">Email</div>
                            <a href={`mailto:${agent.email}`} className="text-xs text-primary font-semibold hover:underline truncate block">{agent.email}</a>
                          </div>
                        </div>
                      )}
                      {agent.employer && (
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                            <Building2 size={12} className="text-purple-600 dark:text-purple-400" />
                          </div>
                          <div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-0.5">Employer</div>
                            <div className="text-xs text-foreground font-semibold">{agent.employer}</div>
                          </div>
                        </div>
                      )}
                      {agent.title && (
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                            <Briefcase size={12} className="text-green-600 dark:text-green-400" />
                          </div>
                          <div>
                            <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-0.5">Title</div>
                            <div className="text-xs text-foreground font-semibold">{agent.title}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Notes */}
                    {agent.notes && (
                      <div className="rounded-xl bg-secondary/40 border border-border px-4 py-3 mb-4">
                        <div className="flex items-center gap-2 mb-1.5">
                          <StickyNote size={11} className="text-muted-foreground" />
                          <span className="text-[9px] text-muted-foreground uppercase tracking-widest">Notes</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed m-0">{agent.notes}</p>
                      </div>
                    )}

                    {/* Territory cities */}
                    {Array.isArray(agent.cities) && agent.cities.length > 0 && (
                      <div className="mb-4">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-widest mb-2">Territory Cities</div>
                        <div className="flex flex-wrap gap-1.5">
                          {(agent.cities as string[]).map((city: string) => (
                            <span
                              key={city}
                              className="text-[10px] font-semibold rounded-full px-2.5 py-0.5 border"
                              style={{ background: `${agent.color}14`, borderColor: `${agent.color}33`, color: agent.color }}
                            >
                              {city}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleEdit(agent)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-semibold transition-all"
                        style={{ background: `${agent.color}18`, borderColor: `${agent.color}38`, color: agent.color }}
                      >
                        <Edit2 size={12} />
                        Edit Agent
                      </button>

                      {deleteConfirmId === agent.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-destructive">Confirm delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate({ id: agent.id })}
                            className="px-3.5 py-1.5 rounded-md bg-destructive/15 border border-destructive/40 text-destructive text-[11px] font-bold"
                          >
                            Yes, Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-3.5 py-1.5 rounded-md bg-secondary/40 border border-border text-muted-foreground text-[11px] font-semibold hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(agent.id)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-destructive/8 border border-destructive/20 text-destructive/80 text-xs font-semibold hover:bg-destructive/12 hover:text-destructive transition-all"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
