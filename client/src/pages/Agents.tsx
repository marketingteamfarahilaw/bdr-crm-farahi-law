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
  Star,
  UserCheck,
  UserX,
  Briefcase,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

  return (
    <div
      className="min-h-full"
      style={{
        background: "linear-gradient(160deg, #060b16 0%, #080f1e 50%, #060b16 100%)",
        padding: "28px 32px",
      }}
    >
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: "linear-gradient(135deg, #2c4a73 0%, #4a73a8 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 16px rgba(212,175,55,0.4)",
              }}
            >
              <Users size={18} color="#07101f" strokeWidth={2.5} />
            </div>
            <h1
              className="text-2xl font-bold"
              style={{ color: "#f1f5f9", fontFamily: "'Playfair Display', serif" }}
            >
              Agent Management
            </h1>
          </div>
          <p className="text-sm" style={{ color: "rgba(148,163,184,0.6)", marginLeft: 48 }}>
            Manage your Business Development Representatives and their territories
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 20px",
              background: "linear-gradient(135deg, #2c4a73 0%, #4a73a8 100%)",
              border: "none",
              borderRadius: 10,
              color: "#07101f",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 20px rgba(212,175,55,0.35)",
              transition: "all 0.2s ease",
              letterSpacing: "0.02em",
            }}
          >
            <Plus size={15} strokeWidth={2.5} />
            Add Agent
          </button>
        )}
      </div>

      {/* ── Create / Edit Form ── */}
      {showForm && (
        <div
          className="mb-8"
          style={{
            background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
            backdropFilter: "blur(28px) saturate(180%)",
            border: "1px solid rgba(212,175,55,0.25)",
            borderRadius: 18,
            padding: "24px 28px",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 40px rgba(212,175,55,0.06)",
          }}
        >
          {/* Form header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-base font-bold" style={{ color: "#f1f5f9" }}>
                {editingId !== null ? "Edit Agent" : "New Agent"}
              </div>
              <div className="text-xs mt-0.5" style={{ color: "rgba(148,163,184,0.5)" }}>
                {editingId !== null ? "Update agent profile information" : "Fill in the agent's profile details"}
              </div>
            </div>
            <button onClick={handleCancel} style={{ color: "rgba(148,163,184,0.5)", cursor: "pointer", background: "none", border: "none" }}>
              <X size={18} />
            </button>
          </div>

          {/* Form grid */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* First Name */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                First Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <Input
                value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                placeholder="e.g. Miguel"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>

            {/* Last Name */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Last Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <Input
                value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                placeholder="e.g. Flores"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>

            {/* Employer */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Employer
              </label>
              <Input
                value={form.employer}
                onChange={e => setForm(f => ({ ...f, employer: e.target.value }))}
                placeholder="e.g. Farahi Law"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Job Title
              </label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Business Development Representative"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Phone Number
              </label>
              <Input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. (213) 555-0100"
                type="tel"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Email Address
              </label>
              <Input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="e.g. miguel@farahilaw.com"
                type="email"
                className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20"
              />
            </div>
          </div>

          {/* Territory Color */}
          <div className="mb-4">
            <label className="block text-xs font-600 mb-2" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Territory Color
            </label>
            <div className="flex flex-wrap gap-2">
              {AGENT_COLOR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setForm(f => ({ ...f, color: opt.value }))}
                  style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: opt.value,
                    border: form.color === opt.value ? `3px solid #fff` : `2px solid transparent`,
                    cursor: "pointer",
                    boxShadow: form.color === opt.value ? `0 0 12px ${opt.value}80` : "none",
                    transition: "all 0.15s",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  title={opt.label}
                >
                  {form.color === opt.value && <Check size={14} color="#07101f" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          {/* Active toggle */}
          <div className="mb-5">
            <label className="block text-xs font-600 mb-2" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Status
            </label>
            <div className="flex gap-3">
              {[{ v: true, label: "Active", icon: <UserCheck size={13} /> }, { v: false, label: "Inactive", icon: <UserX size={13} /> }].map(opt => (
                <button
                  key={String(opt.v)}
                  onClick={() => setForm(f => ({ ...f, active: opt.v }))}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: `1px solid ${form.active === opt.v ? (opt.v ? "#22c55e50" : "#ef444450") : "rgba(255,255,255,0.08)"}`,
                    background: form.active === opt.v ? (opt.v ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)") : "rgba(255,255,255,0.03)",
                    color: form.active === opt.v ? (opt.v ? "#22c55e" : "#ef4444") : "rgba(148,163,184,0.5)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="mb-6">
            <label className="block text-xs font-600 mb-1.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Notes
            </label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this agent's territory, performance, or contact preferences..."
              rows={3}
              className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#2c4a73] focus:ring-[#2c4a73]/20 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 24px",
                background: "linear-gradient(135deg, #2c4a73 0%, #4a73a8 100%)",
                border: "none",
                borderRadius: 9,
                color: "#07101f",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(212,175,55,0.3)",
                opacity: (createMutation.isPending || updateMutation.isPending) ? 0.6 : 1,
                transition: "all 0.2s ease",
              }}
            >
              <Check size={14} strokeWidth={2.5} />
              {editingId !== null ? "Save Changes" : "Create Agent"}
            </button>
            <button
              onClick={handleCancel}
              style={{
                padding: "10px 20px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 9,
                color: "rgba(148,163,184,0.7)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Agents", value: agents.length, icon: <Users size={16} />, color: "#2c4a73" },
          { label: "Active Agents", value: agents.filter((a: any) => a.active !== false).length, icon: <UserCheck size={16} />, color: "#22c55e" },
          { label: "Leads Assigned", value: savedLeads.filter((l: any) => l.assignedAgent).length, icon: <MapPin size={16} />, color: "#60a5fa" },
        ].map((stat, i) => (
          <div
            key={i}
            style={{
              background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
              backdropFilter: "blur(20px)",
              border: `1px solid ${stat.color}25`,
              borderRadius: 14,
              padding: "18px 20px",
              boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${stat.color}08`,
            }}
          >
            <div className="flex items-center gap-3">
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${stat.color}18`,
                border: `1px solid ${stat.color}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: stat.color,
              }}>
                {stat.icon}
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 11, color: "rgba(148,163,184,0.55)", marginTop: 2, fontWeight: 500 }}>
                  {stat.label}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Agent cards ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div style={{ color: "rgba(148,163,184,0.4)", fontSize: 14 }}>Loading agents...</div>
        </div>
      ) : agents.length === 0 ? (
        <div
          style={{
            background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
            border: "1px solid rgba(212,175,55,0.15)",
            borderRadius: 18,
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", marginBottom: 8, fontFamily: "'Playfair Display', serif" }}>
            No Agents Yet
          </div>
          <div style={{ fontSize: 13, color: "rgba(148,163,184,0.5)", marginBottom: 20 }}>
            Add your first Business Development Representative to get started.
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: "10px 24px",
              background: "linear-gradient(135deg, #2c4a73 0%, #4a73a8 100%)",
              border: "none", borderRadius: 9,
              color: "#07101f", fontSize: 13, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 4px 16px rgba(212,175,55,0.3)",
            }}
          >
            Add First Agent
          </button>
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
                style={{
                  background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
                  backdropFilter: "blur(28px)",
                  border: `1px solid ${agent.color}25`,
                  borderRadius: 16,
                  overflow: "hidden",
                  boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${agent.color}08`,
                  transition: "all 0.2s ease",
                }}
              >
                {/* Card header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : agent.id)}
                  style={{
                    background: isExpanded ? `linear-gradient(90deg, ${agent.color}10 0%, transparent 100%)` : "transparent",
                    borderBottom: isExpanded ? `1px solid ${agent.color}18` : "none",
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${agent.color}, ${agent.color}aa)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 800, color: "#07101f",
                    flexShrink: 0,
                    boxShadow: `0 0 20px ${agent.color}50`,
                  }}>
                    {initials}
                  </div>

                  {/* Name & title */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
                        {agent.agentName}
                      </span>
                      {!isActive && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: "#ef4444",
                          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
                          borderRadius: 999, padding: "1px 8px", letterSpacing: "0.06em",
                        }}>INACTIVE</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(148,163,184,0.55)", marginTop: 2 }}>
                      {agent.title || "Business Development Representative"}
                      {agent.employer ? ` · ${agent.employer}` : ""}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Lead count */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5,
                      background: `${agent.color}14`,
                      border: `1px solid ${agent.color}30`,
                      borderRadius: 999,
                      padding: "4px 12px",
                    }}>
                      <MapPin size={10} color={agent.color} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: agent.color }}>{leadCount}</span>
                      <span style={{ fontSize: 10, color: "rgba(148,163,184,0.5)" }}>leads</span>
                    </div>
                    {hotCount > 0 && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: 999,
                        padding: "4px 10px",
                      }}>
                        <span style={{ fontSize: 10 }}>🔥</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>{hotCount}</span>
                      </div>
                    )}

                    {/* Expand toggle */}
                    <div style={{ color: "rgba(148,163,184,0.4)", marginLeft: 4 }}>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px 20px" }}>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-5">
                      {agent.phone && (
                        <div className="flex items-center gap-3">
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Phone size={12} color="#60a5fa" />
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>Phone</div>
                            <ClickToCallButton phoneNumber={agent.phone} className="text-[#60a5fa] hover:text-[#93c5fd] font-semibold text-xs" />
                          </div>
                        </div>
                      )}
                      {agent.email && (
                        <div className="flex items-center gap-3">
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Mail size={12} color="#2c4a73" />
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>Email</div>
                            <a href={`mailto:${agent.email}`} style={{ fontSize: 12, color: "#2c4a73", fontWeight: 600, textDecoration: "none" }}>{agent.email}</a>
                          </div>
                        </div>
                      )}
                      {agent.employer && (
                        <div className="flex items-center gap-3">
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Building2 size={12} color="#a855f7" />
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>Employer</div>
                            <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{agent.employer}</div>
                          </div>
                        </div>
                      )}
                      {agent.title && (
                        <div className="flex items-center gap-3">
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Briefcase size={12} color="#22c55e" />
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>Title</div>
                            <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{agent.title}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Notes */}
                    {agent.notes && (
                      <div style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 10,
                        padding: "10px 14px",
                        marginBottom: 16,
                      }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <StickyNote size={11} color="rgba(148,163,184,0.4)" />
                          <span style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Notes</span>
                        </div>
                        <p style={{ fontSize: 12, color: "rgba(148,163,184,0.7)", lineHeight: 1.6, margin: 0 }}>{agent.notes}</p>
                      </div>
                    )}

                    {/* Territory cities */}
                    {Array.isArray(agent.cities) && agent.cities.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 9, color: "rgba(148,163,184,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                          Territory Cities
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(agent.cities as string[]).map((city: string) => (
                            <span
                              key={city}
                              style={{
                                fontSize: 10, fontWeight: 600,
                                background: `${agent.color}14`,
                                border: `1px solid ${agent.color}30`,
                                color: agent.color,
                                borderRadius: 999,
                                padding: "2px 9px",
                              }}
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
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "8px 16px",
                          background: `${agent.color}18`,
                          border: `1px solid ${agent.color}35`,
                          borderRadius: 8,
                          color: agent.color,
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        <Edit2 size={12} />
                        Edit Agent
                      </button>

                      {deleteConfirmId === agent.id ? (
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 11, color: "rgba(239,68,68,0.8)" }}>Confirm delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate({ id: agent.id })}
                            style={{
                              padding: "6px 14px",
                              background: "rgba(239,68,68,0.15)",
                              border: "1px solid rgba(239,68,68,0.35)",
                              borderRadius: 7,
                              color: "#ef4444", fontSize: 11, fontWeight: 700, cursor: "pointer",
                            }}
                          >
                            Yes, Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            style={{
                              padding: "6px 14px",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 7,
                              color: "rgba(148,163,184,0.6)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(agent.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "8px 14px",
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            borderRadius: 8,
                            color: "rgba(239,68,68,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                            transition: "all 0.15s",
                          }}
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
