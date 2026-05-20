import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MapView } from "@/components/Map";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Phone,
  Mail,
  MapPin,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
  Building2,
  Navigation,
  Search,
  Filter,
  Clock,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CASE_STATUSES = [
  { value: "intake",   label: "Intake",   color: "#60a5fa" },
  { value: "active",   label: "Active",   color: "#22c55e" },
  { value: "settled",  label: "Settled",  color: "#D4AF37" },
  { value: "closed",   label: "Closed",   color: "#94a3b8" },
  { value: "lost",     label: "Lost",     color: "#ef4444" },
] as const;

const FACILITY_CATEGORIES = [
  { value: "all",                  label: "All Types",           emoji: "🏢" },
  { value: "body_shop",            label: "Auto Body Shops",     emoji: "🔧" },
  { value: "chiropractor",         label: "Chiropractors",       emoji: "🦴" },
  { value: "physical_therapist",   label: "Physical Therapists", emoji: "💪" },
  { value: "medical_clinic",       label: "Medical Clinics",     emoji: "🏥" },
  { value: "orthopedic_doctor",    label: "Orthopedic Doctors",  emoji: "🩺" },
  { value: "imaging_center",       label: "Imaging Centers",     emoji: "📷" },
  { value: "other",                label: "Other",               emoji: "🏢" },
] as const;

const CATEGORY_PIN_COLOR: Record<string, string> = {
  body_shop:          "#f97316",
  chiropractor:       "#60a5fa",
  physical_therapist: "#a78bfa",
  medical_clinic:     "#22c55e",
  orthopedic_doctor:  "#facc15",
  imaging_center:     "#38bdf8",
  other:              "#94a3b8",
};

const INCIDENT_TYPES = [
  "Auto Accident", "Slip & Fall", "Dog Bite", "Motorcycle Accident",
  "Truck Accident", "Pedestrian Accident", "Bicycle Accident", "Workplace Injury", "Other",
];

interface ClientFormData {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  incidentDate: string;
  incidentType: string;
  caseStatus: "intake" | "active" | "settled" | "closed" | "lost";
  address: string;
  city: string;
  zipCode: string;
  latitude: number | undefined;
  longitude: number | undefined;
  assignedAgentName: string;
  notes: string;
}

const EMPTY_FORM: ClientFormData = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  incidentDate: "",
  incidentType: "Auto Accident",
  caseStatus: "intake",
  address: "",
  city: "",
  zipCode: "",
  latitude: undefined,
  longitude: undefined,
  assignedAgentName: "",
  notes: "",
};

export default function PiClientsPage() {
  const utils = trpc.useUtils();
  const { data: clients = [], isLoading } = trpc.piClients.list.useQuery();
  const { data: agents = [] } = trpc.agentZones.list.useQuery();
  const { data: crmFacilities = [] } = trpc.crm.map.allFacilities.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ClientFormData>(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [nearbyClientId, setNearbyClientId] = useState<number | null>(null);
  const [nearbyRadius, setNearbyRadius] = useState(10);
  const [nearbyCategory, setNearbyCategory] = useState<string>("all");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [callLogClientId, setCallLogClientId] = useState<number | null>(null);

  // Fetch call logs for the currently-expanded client
  const { data: callLogs = [] } = trpc.piClients.getCallLogs.useQuery(
    { piClientId: expandedId ?? 0 },
    { enabled: expandedId !== null }
  );

  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const clientMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const createMutation = trpc.piClients.create.useMutation({
    onSuccess: () => {
      toast.success("PI Client added!");
      utils.piClients.list.invalidate();
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message || "Failed to add client"),
  });

  const updateMutation = trpc.piClients.update.useMutation({
    onSuccess: () => {
      toast.success("Client updated!");
      utils.piClients.list.invalidate();
      setEditingId(null);
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message || "Failed to update client"),
  });

  const deleteMutation = trpc.piClients.delete.useMutation({
    onSuccess: () => {
      toast.success("Client deleted.");
      utils.piClients.list.invalidate();
      setDeleteConfirmId(null);
      if (nearbyClientId === deleteConfirmId) setNearbyClientId(null);
    },
    onError: (e) => toast.error(e.message || "Failed to delete"),
  });

  const handleSubmit = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleEdit = (client: any) => {
    setEditingId(client.id);
    setForm({
      firstName: client.firstName ?? "",
      lastName: client.lastName ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
      incidentDate: client.incidentDate ? new Date(client.incidentDate).toISOString().split("T")[0] : "",
      incidentType: client.incidentType ?? "Auto Accident",
      caseStatus: client.caseStatus ?? "intake",
      address: client.address ?? "",
      city: client.city ?? "",
      zipCode: client.zipCode ?? "",
      latitude: client.latitude ?? undefined,
      longitude: client.longitude ?? undefined,
      assignedAgentName: client.assignedAgentName ?? "",
      notes: client.notes ?? "",
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Nearby partners map
  const nearbyClient = clients.find((c: any) => c.id === nearbyClientId);
  const nearbyFacilitiesAll = nearbyClient?.latitude && nearbyClient?.longitude
    ? (crmFacilities as any[]).filter((f: any) => {
        if (!f.latitude || !f.longitude) return false;
        const R = 3958.8;
        const dLat = ((f.latitude - nearbyClient.latitude!) * Math.PI) / 180;
        const dLng = ((f.longitude - nearbyClient.longitude!) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((nearbyClient.latitude! * Math.PI) / 180) *
            Math.cos((f.latitude * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return dist <= nearbyRadius;
      })
    : [];
  const nearbyFacilities = nearbyCategory === "all"
    ? nearbyFacilitiesAll
    : nearbyFacilitiesAll.filter((f: any) => f.category === nearbyCategory);
  const activeCategoryLabel = FACILITY_CATEGORIES.find(c => c.value === nearbyCategory)?.label ?? "All Types";
  const activeCategoryEmoji = FACILITY_CATEGORIES.find(c => c.value === nearbyCategory)?.emoji ?? "🏢";

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    if (!nearbyClient?.latitude || !nearbyClient?.longitude) return;

    // Client pin
    const clientEl = document.createElement("div");
    clientEl.innerHTML = `<div style="
      width:40px;height:40px;border-radius:50%;
      background:linear-gradient(135deg,#ef4444,#dc2626);
      border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-size:18px;
      box-shadow:0 0 20px rgba(239,68,68,0.6),0 4px 12px rgba(0,0,0,0.5);
      cursor:default;
    ">👤</div>`;

    clientMarkerRef.current = new window.google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: nearbyClient.latitude, lng: nearbyClient.longitude },
      title: `${nearbyClient.firstName} ${nearbyClient.lastName}`,
      content: clientEl,
      zIndex: 10,
    });

    // Radius circle
    new window.google.maps.Circle({
      map,
      center: { lat: nearbyClient.latitude, lng: nearbyClient.longitude },
      radius: nearbyRadius * 1609.34,
      strokeColor: "#ef4444",
      strokeOpacity: 0.4,
      strokeWeight: 1.5,
      fillColor: "#ef4444",
      fillOpacity: 0.04,
    });

    // Partner pins
    nearbyFacilities.forEach((f: any) => {
      const pinColor = CATEGORY_PIN_COLOR[f.category] ?? "#94a3b8";
      const catEntry = FACILITY_CATEGORIES.find(c => c.value === f.category);
      const emoji = catEntry?.emoji ?? "🏢";
      const el = document.createElement("div");
      el.innerHTML = `<div style="
        width:32px;height:32px;border-radius:50%;
        background:${pinColor}22;
        border:2px solid ${pinColor};
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
        box-shadow:0 0 12px ${pinColor}66,0 2px 8px rgba(0,0,0,0.4);
        cursor:pointer;
      ">${emoji}</div>`;

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: f.latitude, lng: f.longitude },
        title: f.name,
        content: el,
        zIndex: 5,
      });

      marker.addListener("click", () => {
        infoWindowRef.current?.close();
        const iw = new window.google.maps.InfoWindow({
          content: `<div style="font-family:Inter,sans-serif;background:#0d1526;border:1px solid #22c55e30;border-radius:10px;padding:12px 14px;min-width:180px;color:#e2e8f0;">
            <div style="font-weight:700;font-size:13px;color:#f8fafc;margin-bottom:4px;">${f.name}</div>
            <div style="font-size:11px;color:rgba(148,163,184,0.6);margin-bottom:6px;">${f.category?.replace(/_/g," ") ?? ""}</div>
            ${f.phone ? `<div style="font-size:11px;color:#60a5fa;">${f.phone}</div>` : ""}
            ${f.city ? `<div style="font-size:10px;color:rgba(100,116,139,0.7);margin-top:3px;">${f.city}</div>` : ""}
          </div>`,
          disableAutoPan: false,
        });
        iw.addListener("domready", () => {
          document.querySelectorAll(".gm-style-iw,.gm-style-iw-c,.gm-style-iw-t,.gm-style-iw-tc").forEach(el => {
            (el as HTMLElement).style.background = "transparent";
            (el as HTMLElement).style.boxShadow = "none";
            (el as HTMLElement).style.padding = "0";
          });
        });
        iw.open({ map, anchor: marker });
        infoWindowRef.current = iw;
      });

      markersRef.current.push(marker);
    });

    // Fit bounds
    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend({ lat: nearbyClient.latitude, lng: nearbyClient.longitude });
    nearbyFacilities.forEach((f: any) => bounds.extend({ lat: f.latitude, lng: f.longitude }));
    map.fitBounds(bounds, 60);
  }, [nearbyClient, nearbyFacilities, nearbyRadius]);

  const statusCfg = (s: string) => CASE_STATUSES.find(x => x.value === s) ?? CASE_STATUSES[0];

  return (
    <div className="min-h-full" style={{ background: "linear-gradient(160deg,#060b16 0%,#080f1e 50%,#060b16 100%)", padding: "28px 32px" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#ef4444,#dc2626)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 16px rgba(239,68,68,0.4)" }}>
              <Users size={18} color="#fff" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold" style={{ color:"#f1f5f9",fontFamily:"'Playfair Display',serif" }}>PI Clients</h1>
          </div>
          <p className="text-sm" style={{ color:"rgba(148,163,184,0.6)",marginLeft:48 }}>
            Track personal injury clients and find nearby facility partners
          </p>
        </div>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}
            style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 20px",background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 20px rgba(239,68,68,0.35)",transition:"all 0.2s ease" }}>
            <Plus size={15} strokeWidth={2.5} />
            Add PI Client
          </button>
        )}
      </div>

      {/* Nearby Partners Map */}
      {nearbyClientId && nearbyClient && (
        <div style={{ marginBottom:24,background:"linear-gradient(160deg,rgba(8,18,36,0.97),rgba(5,12,24,0.97))",backdropFilter:"blur(28px)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:18,overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,0.6)" }}>
          <div style={{ padding:"16px 20px",borderBottom:"1px solid rgba(34,197,94,0.15)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:14,fontWeight:700,color:"#f1f5f9" }}>
                Nearby Partners for {nearbyClient.firstName} {nearbyClient.lastName}
              </div>
              <div style={{ fontSize:11,color:"rgba(148,163,184,0.5)",marginTop:2 }}>
                {nearbyFacilities.length} of {nearbyFacilitiesAll.length} partner{nearbyFacilitiesAll.length !== 1 ? "s" : ""} within {nearbyRadius} miles{nearbyCategory !== "all" ? ` · ${activeCategoryLabel}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Category filter dropdown */}
              <div style={{ position:"relative" }}>
                <button
                  onClick={() => setShowCategoryDropdown(v => !v)}
                  style={{
                    display:"flex",alignItems:"center",gap:6,
                    padding:"5px 12px",
                    background:nearbyCategory==="all"?"rgba(255,255,255,0.05)":"rgba(99,102,241,0.12)",
                    border:`1px solid ${nearbyCategory==="all"?"rgba(255,255,255,0.12)":"rgba(99,102,241,0.35)"}`,
                    borderRadius:8,cursor:"pointer",
                    color:nearbyCategory==="all"?"rgba(148,163,184,0.7)":"#818cf8",
                    fontSize:11,fontWeight:700,
                    transition:"all 0.15s",
                  }}
                >
                  <Filter size={11} />
                  <span>{activeCategoryEmoji} {activeCategoryLabel}</span>
                  <ChevronDown size={10} style={{ opacity:0.6 }} />
                </button>
                {showCategoryDropdown && (
                  <div
                    style={{
                      position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:50,
                      background:"#0d1526",border:"1px solid rgba(99,102,241,0.25)",
                      borderRadius:10,overflow:"hidden",minWidth:190,
                      boxShadow:"0 12px 32px rgba(0,0,0,0.6)",
                    }}
                  >
                    {FACILITY_CATEGORIES.map(cat => {
                      const count = cat.value==="all"
                        ? nearbyFacilitiesAll.length
                        : nearbyFacilitiesAll.filter((f:any)=>f.category===cat.value).length;
                      const isActive = nearbyCategory === cat.value;
                      return (
                        <button
                          key={cat.value}
                          onClick={() => { setNearbyCategory(cat.value); setShowCategoryDropdown(false); }}
                          style={{
                            display:"flex",alignItems:"center",justifyContent:"space-between",
                            width:"100%",padding:"8px 14px",
                            background:isActive?"rgba(99,102,241,0.12)":"transparent",
                            border:"none",cursor:"pointer",
                            color:isActive?"#818cf8":"rgba(148,163,184,0.75)",
                            fontSize:12,fontWeight:isActive?700:400,
                            textAlign:"left",
                            transition:"background 0.1s",
                          }}
                        >
                          <span style={{ display:"flex",alignItems:"center",gap:7 }}>
                            <span>{cat.emoji}</span>
                            <span>{cat.label}</span>
                          </span>
                          <span style={{ fontSize:10,color:"rgba(148,163,184,0.4)",fontWeight:600 }}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span style={{ fontSize:11,color:"rgba(148,163,184,0.5)" }}>Radius:</span>
                {[5,10,15,25].map(r => (
                  <button key={r} onClick={() => setNearbyRadius(r)}
                    style={{ padding:"4px 10px",borderRadius:999,fontSize:11,fontWeight:700,cursor:"pointer",border:`1px solid ${nearbyRadius===r?"rgba(34,197,94,0.5)":"rgba(255,255,255,0.1)"}`,background:nearbyRadius===r?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.03)",color:nearbyRadius===r?"#22c55e":"rgba(148,163,184,0.5)",transition:"all 0.15s" }}>
                    {r}mi
                  </button>
                ))}
              </div>
              <button onClick={() => setNearbyClientId(null)}
                style={{ color:"rgba(148,163,184,0.4)",cursor:"pointer",background:"none",border:"none" }}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div style={{ height:360 }}>
            <MapView onMapReady={handleMapReady} />
          </div>
          {nearbyFacilitiesAll.length > 0 && (
            <div style={{ padding:"12px 20px",borderTop:"1px solid rgba(34,197,94,0.1)",display:"flex",flexWrap:"wrap",gap:8,alignItems:"center" }}>
              {nearbyFacilities.length === 0 && nearbyCategory !== "all" && (
                <span style={{ fontSize:11,color:"rgba(148,163,184,0.4)",fontStyle:"italic" }}>No {activeCategoryLabel.toLowerCase()} partners in this radius.</span>
              )}
              {nearbyFacilities.map((f: any) => {
                const pinColor = CATEGORY_PIN_COLOR[f.category] ?? "#94a3b8";
                const catEntry = FACILITY_CATEGORIES.find(c => c.value === f.category);
                return (
                  <div key={f.id} style={{ display:"flex",alignItems:"center",gap:6,background:`${pinColor}12`,border:`1px solid ${pinColor}33`,borderRadius:999,padding:"4px 12px" }}>
                    <span style={{ fontSize:11 }}>{catEntry?.emoji ?? "🏢"}</span>
                    <span style={{ fontSize:11,color:pinColor,fontWeight:600 }}>{f.name}</span>
                    {f.city && <span style={{ fontSize:10,color:"rgba(148,163,184,0.4)" }}>· {f.city}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ marginBottom:24,background:"linear-gradient(160deg,rgba(8,18,36,0.97),rgba(5,12,24,0.97))",backdropFilter:"blur(28px)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:18,padding:"24px 28px",boxShadow:"0 16px 48px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <div style={{ fontSize:15,fontWeight:700,color:"#f1f5f9" }}>{editingId ? "Edit PI Client" : "New PI Client"}</div>
              <div style={{ fontSize:11,color:"rgba(148,163,184,0.5)",marginTop:2 }}>Fill in the client's case and contact details</div>
            </div>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} style={{ color:"rgba(148,163,184,0.5)",cursor:"pointer",background:"none",border:"none" }}><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {[
              { key:"firstName", label:"First Name", placeholder:"e.g. John", required:true },
              { key:"lastName",  label:"Last Name",  placeholder:"e.g. Smith", required:true },
              { key:"phone",     label:"Phone",      placeholder:"(213) 555-0100", type:"tel" },
              { key:"email",     label:"Email",      placeholder:"john@email.com", type:"email" },
              { key:"address",   label:"Address",    placeholder:"123 Main St", colSpan:2 },
              { key:"city",      label:"City",       placeholder:"Los Angeles" },
              { key:"zipCode",   label:"ZIP Code",   placeholder:"90001" },
            ].map((field: any) => (
              <div key={field.key} className={field.colSpan === 2 ? "col-span-2" : ""}>
                <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>
                  {field.label} {field.required && <span style={{ color:"#ef4444" }}>*</span>}
                </label>
                <Input
                  value={(form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  type={field.type}
                  className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#ef4444] focus:ring-[#ef4444]/20"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Incident Date</label>
              <Input type="date" value={form.incidentDate} onChange={e => setForm(f => ({ ...f, incidentDate: e.target.value }))}
                className="bg-[#0d1526] border-[#1e2d4a] text-white focus:border-[#ef4444]" />
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Incident Type</label>
              <select value={form.incidentType} onChange={e => setForm(f => ({ ...f, incidentType: e.target.value }))}
                className="w-full bg-[#0d1526] border border-[#1e2d4a] text-white rounded-md px-3 py-2 text-sm focus:border-[#ef4444] focus:outline-none">
                {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Case Status</label>
              <select value={form.caseStatus} onChange={e => setForm(f => ({ ...f, caseStatus: e.target.value as any }))}
                className="w-full bg-[#0d1526] border border-[#1e2d4a] text-white rounded-md px-3 py-2 text-sm focus:border-[#ef4444] focus:outline-none">
                {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Assigned Agent</label>
              <select value={form.assignedAgentName} onChange={e => setForm(f => ({ ...f, assignedAgentName: e.target.value }))}
                className="w-full bg-[#0d1526] border border-[#1e2d4a] text-white rounded-md px-3 py-2 text-sm focus:border-[#ef4444] focus:outline-none">
                <option value="">— Unassigned —</option>
                {agents.map((a: any) => <option key={a.id} value={a.agentName}>{a.agentName}</option>)}
              </select>
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-xs font-600 mb-1.5" style={{ color:"rgba(148,163,184,0.7)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Notes</label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Case notes, injury details, special instructions..." rows={3}
              className="bg-[#0d1526] border-[#1e2d4a] text-white placeholder:text-[#334155] focus:border-[#ef4444] resize-none" />
          </div>

          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}
              style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 24px",background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 16px rgba(239,68,68,0.3)",opacity:(createMutation.isPending||updateMutation.isPending)?0.6:1 }}>
              <Check size={14} strokeWidth={2.5} />
              {editingId ? "Save Changes" : "Add Client"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
              style={{ padding:"10px 20px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,color:"rgba(148,163,184,0.7)",fontSize:13,fontWeight:600,cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label:"Total Clients", value:clients.length, color:"#ef4444" },
          { label:"Active Cases",  value:clients.filter((c:any)=>c.caseStatus==="active").length, color:"#22c55e" },
          { label:"Intake",        value:clients.filter((c:any)=>c.caseStatus==="intake").length, color:"#60a5fa" },
          { label:"Settled",       value:clients.filter((c:any)=>c.caseStatus==="settled").length, color:"#D4AF37" },
        ].map((s,i) => (
          <div key={i} style={{ background:"linear-gradient(160deg,rgba(8,18,36,0.97),rgba(5,12,24,0.97))",backdropFilter:"blur(20px)",border:`1px solid ${s.color}25`,borderRadius:14,padding:"16px 18px" }}>
            <div style={{ fontSize:22,fontWeight:800,color:s.color,lineHeight:1,letterSpacing:"-0.02em" }}>{s.value}</div>
            <div style={{ fontSize:11,color:"rgba(148,163,184,0.55)",marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Client list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div style={{ color:"rgba(148,163,184,0.4)",fontSize:14 }}>Loading clients...</div>
        </div>
      ) : clients.length === 0 ? (
        <div style={{ background:"linear-gradient(160deg,rgba(8,18,36,0.97),rgba(5,12,24,0.97))",border:"1px solid rgba(239,68,68,0.15)",borderRadius:18,padding:"48px 32px",textAlign:"center" }}>
          <div style={{ fontSize:48,marginBottom:16 }}>👤</div>
          <div style={{ fontSize:18,fontWeight:700,color:"#f1f5f9",marginBottom:8,fontFamily:"'Playfair Display',serif" }}>No PI Clients Yet</div>
          <div style={{ fontSize:13,color:"rgba(148,163,184,0.5)",marginBottom:20 }}>Add your first PI client to track their case and find nearby facility partners.</div>
          <button onClick={() => setShowForm(true)} style={{ padding:"10px 24px",background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer" }}>Add First Client</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clients.map((client: any) => {
            const isExpanded = expandedId === client.id;
            const sc = statusCfg(client.caseStatus);
            return (
              <div key={client.id} style={{ background:"linear-gradient(160deg,rgba(8,18,36,0.97),rgba(5,12,24,0.97))",backdropFilter:"blur(28px)",border:`1px solid ${sc.color}25`,borderRadius:14,overflow:"hidden",boxShadow:`0 6px 24px rgba(0,0,0,0.4)` }}>
                <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : client.id)}
                  style={{ background:isExpanded?`linear-gradient(90deg,${sc.color}0c 0%,transparent 100%)`:"transparent",borderBottom:isExpanded?`1px solid ${sc.color}15`:"none" }}>
                  <div style={{ width:40,height:40,borderRadius:"50%",background:`linear-gradient(135deg,${sc.color},${sc.color}aa)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,boxShadow:`0 0 14px ${sc.color}40` }}>👤</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:14,fontWeight:700,color:"#f1f5f9" }}>{client.firstName} {client.lastName}</div>
                    <div style={{ fontSize:11,color:"rgba(148,163,184,0.5)",marginTop:1 }}>
                      {client.incidentType ?? "PI Case"}{client.city ? ` · ${client.city}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span style={{ fontSize:10,fontWeight:700,background:`${sc.color}18`,border:`1px solid ${sc.color}35`,color:sc.color,borderRadius:999,padding:"2px 10px",letterSpacing:"0.05em" }}>{sc.label.toUpperCase()}</span>
                    {client.latitude && client.longitude && (
                      <button onClick={e => { e.stopPropagation(); setNearbyClientId(client.id); window.scrollTo({top:0,behavior:"smooth"}); }}
                        style={{ display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:8,color:"#22c55e",fontSize:11,fontWeight:600,cursor:"pointer" }}>
                        <Navigation size={11} />
                        Nearby Partners
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={15} color="rgba(148,163,184,0.4)" /> : <ChevronDown size={15} color="rgba(148,163,184,0.4)" />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding:"14px 18px 18px" }}>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {client.phone && (
                        <div style={{ fontSize:12,color:"#60a5fa" }}>
                          <span style={{ color:"rgba(148,163,184,0.4)",fontSize:10,display:"block",marginBottom:2 }}>PHONE</span>
                          <ClickToCallButton
                            phoneNumber={client.phone}
                            className="text-[#60a5fa] hover:text-[#93c5fd] font-semibold text-xs"
                          />
                        </div>
                      )}
                      {client.email && <div style={{ fontSize:12,color:"#D4AF37" }}><span style={{ color:"rgba(148,163,184,0.4)",fontSize:10,display:"block",marginBottom:2 }}>EMAIL</span><a href={`mailto:${client.email}`} style={{ textDecoration:"none",color:"#D4AF37",fontWeight:600 }}>{client.email}</a></div>}
                      {client.address && <div className="col-span-2" style={{ fontSize:12,color:"rgba(148,163,184,0.7)" }}><span style={{ color:"rgba(148,163,184,0.4)",fontSize:10,display:"block",marginBottom:2 }}>ADDRESS</span>{client.address}{client.city ? `, ${client.city}` : ""}{client.zipCode ? ` ${client.zipCode}` : ""}</div>}
                      {client.incidentDate && <div style={{ fontSize:12,color:"rgba(148,163,184,0.7)" }}><span style={{ color:"rgba(148,163,184,0.4)",fontSize:10,display:"block",marginBottom:2 }}>INCIDENT DATE</span>{new Date(client.incidentDate).toLocaleDateString()}</div>}
                      {client.assignedAgentName && <div style={{ fontSize:12,color:"rgba(148,163,184,0.7)" }}><span style={{ color:"rgba(148,163,184,0.4)",fontSize:10,display:"block",marginBottom:2 }}>ASSIGNED AGENT</span>{client.assignedAgentName}</div>}
                    </div>
                    {client.notes && <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"rgba(148,163,184,0.65)",lineHeight:1.6 }}>{client.notes}</div>}

                    {/* ── Call Log History ── */}
                    {isExpanded && (
                      <div style={{ marginTop:14,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14 }}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <PhoneCall size={13} color="#60a5fa" />
                            <span style={{ fontSize:12,fontWeight:700,color:"rgba(148,163,184,0.8)",letterSpacing:"0.06em",textTransform:"uppercase" }}>Call History</span>
                            {callLogs.filter((l:any) => l.piClientId === client.id).length > 0 && (
                              <span style={{ fontSize:10,background:"rgba(96,165,250,0.12)",border:"1px solid rgba(96,165,250,0.25)",color:"#60a5fa",borderRadius:999,padding:"1px 7px",fontWeight:700 }}>
                                {callLogs.filter((l:any) => l.piClientId === client.id).length}
                              </span>
                            )}
                          </div>
                        </div>
                        {callLogs.filter((l:any) => l.piClientId === client.id).length === 0 ? (
                          <div style={{ textAlign:"center",padding:"16px 0",color:"rgba(148,163,184,0.3)",fontSize:11 }}>
                            No calls logged yet. Click the phone number above to dial via RingCentral.
                          </div>
                        ) : (
                          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                            {callLogs.filter((l:any) => l.piClientId === client.id).map((log:any) => (
                              <div key={log.id} style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"10px 14px" }}>
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-2">
                                    {log.direction === "Inbound"
                                      ? <PhoneIncoming size={11} color="#22c55e" />
                                      : <PhoneOutgoing size={11} color="#60a5fa" />}
                                    <span style={{ fontSize:11,fontWeight:600,color:log.direction==="Inbound"?"#22c55e":"#60a5fa" }}>{log.direction ?? "Call"}</span>
                                    {log.result && <span style={{ fontSize:10,color:"rgba(148,163,184,0.4)" }}>· {log.result}</span>}
                                    {log.durationStr && <span style={{ fontSize:10,color:"rgba(148,163,184,0.4)" }}>· {log.durationStr}</span>}
                                  </div>
                                  <span style={{ fontSize:10,color:"rgba(148,163,184,0.35)" }}>
                                    {log.startTime ? new Date(log.startTime).toLocaleString() : new Date(log.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                {log.transcript && (
                                  <div style={{ marginTop:6,background:"rgba(96,165,250,0.05)",border:"1px solid rgba(96,165,250,0.12)",borderRadius:6,padding:"7px 10px",fontSize:11,color:"rgba(148,163,184,0.7)",lineHeight:1.6,maxHeight:120,overflowY:"auto" }}>
                                    <span style={{ fontSize:9,fontWeight:700,color:"#60a5fa",letterSpacing:"0.08em",textTransform:"uppercase",display:"block",marginBottom:4 }}>Transcript</span>
                                    {log.transcript}
                                  </div>
                                )}
                                {log.agentName && <div style={{ marginTop:4,fontSize:10,color:"rgba(148,163,184,0.35)" }}>Agent: {log.agentName}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(client)} style={{ display:"flex",alignItems:"center",gap:5,padding:"7px 14px",background:"rgba(96,165,250,0.1)",border:"1px solid rgba(96,165,250,0.25)",borderRadius:7,color:"#60a5fa",fontSize:12,fontWeight:600,cursor:"pointer" }}><Edit2 size={11} />Edit</button>
                      {deleteConfirmId === client.id ? (
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize:11,color:"rgba(239,68,68,0.8)" }}>Delete?</span>
                          <button onClick={() => deleteMutation.mutate({ id: client.id })} style={{ padding:"6px 12px",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.35)",borderRadius:7,color:"#ef4444",fontSize:11,fontWeight:700,cursor:"pointer" }}>Yes</button>
                          <button onClick={() => setDeleteConfirmId(null)} style={{ padding:"6px 12px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,color:"rgba(148,163,184,0.6)",fontSize:11,cursor:"pointer" }}>No</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(client.id)} style={{ display:"flex",alignItems:"center",gap:5,padding:"7px 12px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:7,color:"rgba(239,68,68,0.7)",fontSize:12,fontWeight:600,cursor:"pointer" }}><Trash2 size={11} />Delete</button>
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
