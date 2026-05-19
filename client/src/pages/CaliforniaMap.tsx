/// <reference types="@types/google.maps" />

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { CATEGORIES, getCategoryLabel } from "@/types/lead";
import { useLocation as useWouter } from "wouter";
import { toast } from "sonner";
import {
  Flame,
  Thermometer,
  Snowflake,
  MapPin,
  Star,
  Phone,
  Globe,
  Building2,
  CheckCircle2,
  PlusCircle,
  ExternalLink,
  Filter,
  X,
  Layers,
  TrendingUp,
  Users,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Tier config ───────────────────────────────────────────────────────────────
const TIER_CONFIG = {
  hot:  { bg: "#ef4444", border: "#dc2626", glow: "#ef444466", label: "Hot",  icon: "🔥" },
  warm: { bg: "#f59e0b", border: "#d97706", glow: "#f59e0b55", label: "Warm", icon: "♨️" },
  cold: { bg: "#60a5fa", border: "#3b82f6", glow: "#60a5fa44", label: "Cold", icon: "❄️" },
} as const;

// ── Category config ───────────────────────────────────────────────────────────
const CATEGORY_CONFIG: Record<string, { emoji: string; color: string }> = {
  body_shop:           { emoji: "🔧", color: "#f97316" },
  chiropractor:        { emoji: "🦴", color: "#a78bfa" },
  physical_therapist:  { emoji: "💪", color: "#34d399" },
  medical_clinic:      { emoji: "🏥", color: "#38bdf8" },
  orthopedic_doctor:   { emoji: "🩺", color: "#fb7185" },
  imaging_center:      { emoji: "📷", color: "#fbbf24" },
};

type TierFilter = "all" | "hot" | "warm" | "cold";
type AgentFilter = "all" | string;

interface PinLead {
  placeId: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number;
  longitude: number;
  category: string;
  qualificationScore: number;
  scoreTier: "hot" | "warm" | "cold";
  annotation: string | null;
  inCrm: boolean;
  crmId?: number;
  assignedAgent: string | null;
}

// ── Agent color map ──────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  "Miguel Flores":    "#FF6B35",
  "Youssef El Karmi": "#4ECDC4",
  "Rupert Musni":     "#A855F7",
  "David Carrillo":   "#F59E0B",
};

// ── Pin DOM element ───────────────────────────────────────────────────────────
function createLeadPin(lead: PinLead): HTMLElement {
  const tier = TIER_CONFIG[lead.scoreTier];
  const cat = CATEGORY_CONFIG[lead.category] ?? { emoji: "📍", color: "#94a3b8" };

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    transition: transform 0.15s ease;
    filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5));
  `;
  wrapper.onmouseenter = () => { wrapper.style.transform = "scale(1.2) translateY(-3px)"; };
  wrapper.onmouseleave = () => { wrapper.style.transform = "scale(1)"; };

  // Pin body
  const agentColor = lead.assignedAgent ? (AGENT_COLORS[lead.assignedAgent] ?? null) : null;

  const pin = document.createElement("div");
  pin.style.cssText = `
    width: 34px;
    height: 34px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: ${tier.bg};
    border: 2.5px solid ${agentColor ?? tier.border};
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 10px ${tier.glow}, 0 2px 8px rgba(0,0,0,0.4)${agentColor ? `, 0 0 0 1.5px ${agentColor}88` : ""};
    position: relative;
  `;

  const inner = document.createElement("span");
  inner.style.cssText = "transform: rotate(45deg); font-size: 15px; line-height: 1;";
  inner.textContent = cat.emoji;
  pin.appendChild(inner);

  // CRM badge
  if (lead.inCrm) {
    const badge = document.createElement("div");
    badge.style.cssText = `
      position: absolute;
      top: -4px;
      right: -4px;
      transform: rotate(45deg);
      width: 12px;
      height: 12px;
      background: #D4AF37;
      border-radius: 50%;
      border: 1.5px solid #0a0f1e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 7px;
    `;
    badge.textContent = "★";
    pin.appendChild(badge);
  }

  wrapper.appendChild(pin);

  // Stem
  const stem = document.createElement("div");
  stem.style.cssText = `
    width: 2px;
    height: 8px;
    background: ${tier.border};
    margin-top: -1px;
  `;
  wrapper.appendChild(stem);

  return wrapper;
}

// ── Info Window content ───────────────────────────────────────────────────────
function createInfoWindowContent(
  lead: PinLead,
  onSaveLead: () => void,
  onOpenCrm: () => void,
  onSearch: () => void,
): HTMLElement {
  const tier = TIER_CONFIG[lead.scoreTier];
  const cat = CATEGORY_CONFIG[lead.category] ?? { emoji: "📍", color: "#94a3b8" };
  const catLabel = getCategoryLabel(lead.category);

  const container = document.createElement("div");
  container.style.cssText = `
    font-family: Inter, system-ui, sans-serif;
    background: linear-gradient(160deg, rgba(10,18,35,0.98) 0%, rgba(7,14,28,0.98) 100%);
    border: 1px solid rgba(212,175,55,0.2);
    border-radius: 14px;
    padding: 0;
    min-width: 270px;
    max-width: 310px;
    color: #e2e8f0;
    box-shadow: 0 20px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 24px rgba(212,175,55,0.06);
    overflow: hidden;
    backdrop-filter: blur(24px);
  `;

  const stars = lead.rating
    ? "★".repeat(Math.round(lead.rating)) + "☆".repeat(5 - Math.round(lead.rating))
    : "";

  container.innerHTML = `
    <!-- Header band -->
    <div style="
      background: linear-gradient(90deg, ${tier.bg}1a 0%, ${tier.bg}06 100%);
      border-bottom: 1px solid ${tier.bg}28;
      padding: 13px 15px 11px;
    ">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13.5px;color:#f8fafc;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.01em;">${lead.name}</div>
          <div style="font-size:10.5px;color:rgba(148,163,184,0.7);margin-top:3px;letter-spacing:0.02em;">${cat.emoji} ${catLabel}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
          <span style="
            display:inline-flex;align-items:center;gap:3px;
            padding:2px 9px;border-radius:999px;font-size:9.5px;font-weight:700;letter-spacing:0.04em;
            background:${tier.bg}18;color:${tier.bg};border:1px solid ${tier.bg}40;
            box-shadow: 0 0 8px ${tier.bg}20;
          ">${tier.icon} ${tier.label.toUpperCase()}</span>
          <span style="font-size:18px;font-weight:800;color:${tier.bg};line-height:1;letter-spacing:-0.02em;">${lead.qualificationScore}<span style="font-size:10px;font-weight:500;opacity:0.6;">/100</span></span>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:12px 15px 13px;">
      <!-- Rating -->
      ${lead.rating ? `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="color:#fbbf24;font-size:11px;letter-spacing:1px;">${stars}</span>
          <span style="font-size:11px;color:rgba(148,163,184,0.7);">${lead.rating} &bull; ${(lead.reviewCount ?? 0).toLocaleString()} reviews</span>
        </div>
      ` : ""}

      <!-- Address -->
      <div style="font-size:10.5px;color:rgba(100,116,139,0.9);margin-bottom:6px;display:flex;align-items:flex-start;gap:6px;">
        <span style="flex-shrink:0;margin-top:1px;opacity:0.6;">📍</span>
        <span style="line-height:1.45;">${lead.address}</span>
      </div>

      <!-- Phone -->
      ${lead.phone ? `
        <div style="font-size:11.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <span style="opacity:0.6;">📞</span>
          <a href="tel:${lead.phone}" style="color:#60a5fa;text-decoration:none;font-weight:500;">${lead.phone}</a>
        </div>
      ` : ""}

      <!-- Agent badge -->
      ${lead.assignedAgent ? `
        <div style="
          display:flex;align-items:center;gap:6px;
          background:${AGENT_COLORS[lead.assignedAgent] ?? '#94a3b8'}14;border:1px solid ${AGENT_COLORS[lead.assignedAgent] ?? '#94a3b8'}30;
          border-radius:8px;padding:5px 10px;margin-bottom:8px;
        ">
          <div style="width:8px;height:8px;border-radius:50%;background:${AGENT_COLORS[lead.assignedAgent] ?? '#94a3b8'};flex-shrink:0;"></div>
          <span style="font-size:10.5px;color:${AGENT_COLORS[lead.assignedAgent] ?? '#94a3b8'};font-weight:600;letter-spacing:0.02em;">👤 ${lead.assignedAgent}</span>
        </div>
      ` : ""}

      <!-- CRM status -->
      ${lead.inCrm ? `
        <div style="
          display:flex;align-items:center;gap:6px;
          background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.25);
          border-radius:8px;padding:6px 10px;margin-bottom:10px;
          box-shadow: 0 0 10px rgba(212,175,55,0.08);
        ">
          <span style="color:#D4AF37;font-size:13px;">★</span>
          <span style="font-size:11px;color:#D4AF37;font-weight:600;letter-spacing:0.02em;">Added to CRM</span>
        </div>
      ` : ""}

      <!-- Annotation -->
      ${lead.annotation ? `
        <div style="
          background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:7px 10px;margin-bottom:10px;
          font-size:10.5px;color:rgba(148,163,184,0.7);font-style:italic;line-height:1.5;
        ">&ldquo;${lead.annotation}&rdquo;</div>
      ` : ""}

      <!-- Actions -->
      <div style="display:flex;gap:7px;margin-top:6px;">
        ${!lead.inCrm ? `
          <div id="iw-save" style="
            flex:1;padding:8px 0;
            background:linear-gradient(135deg,#D4AF37 0%,#c9a227 100%);
            color:#07101f;
            border:none;border-radius:8px;font-size:11px;font-weight:800;
            cursor:pointer;text-align:center;transition:all 0.15s;
            letter-spacing:0.04em;
            box-shadow:0 2px 12px rgba(212,175,55,0.35);
          ">+ SAVE LEAD</div>
        ` : `
          <div id="iw-crm" style="
            flex:1;padding:8px 0;
            background:rgba(212,175,55,0.1);color:#D4AF37;
            border:1px solid rgba(212,175,55,0.3);border-radius:8px;font-size:11px;font-weight:700;
            cursor:pointer;text-align:center;transition:all 0.15s;
            letter-spacing:0.03em;
          ">Open CRM →</div>
        `}
        <div id="iw-search" style="
          flex:1;padding:8px 0;
          background:rgba(255,255,255,0.04);color:rgba(148,163,184,0.8);
          border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:11px;font-weight:600;
          cursor:pointer;text-align:center;transition:all 0.15s;
          letter-spacing:0.03em;
        ">Search Area</div>
      </div>
    </div>
  `;

  const saveBtn = container.querySelector("#iw-save") as HTMLElement | null;
  if (saveBtn) {
    saveBtn.onmouseenter = () => { saveBtn.style.opacity = "0.88"; saveBtn.style.transform = "translateY(-1px)"; };
    saveBtn.onmouseleave = () => { saveBtn.style.opacity = "1"; saveBtn.style.transform = "none"; };
    saveBtn.onclick = onSaveLead;
  }

  const crmBtn = container.querySelector("#iw-crm") as HTMLElement | null;
  if (crmBtn) {
    crmBtn.onmouseenter = () => { crmBtn.style.background = "rgba(212,175,55,0.18)"; crmBtn.style.transform = "translateY(-1px)"; };
    crmBtn.onmouseleave = () => { crmBtn.style.background = "rgba(212,175,55,0.1)"; crmBtn.style.transform = "none"; };
    crmBtn.onclick = onOpenCrm;
  }

  const searchBtn = container.querySelector("#iw-search") as HTMLElement | null;
  if (searchBtn) {
    searchBtn.onmouseenter = () => { searchBtn.style.background = "rgba(255,255,255,0.08)"; searchBtn.style.color = "#f1f5f9"; };
    searchBtn.onmouseleave = () => { searchBtn.style.background = "rgba(255,255,255,0.04)"; searchBtn.style.color = "rgba(148,163,184,0.8)"; };
    searchBtn.onclick = onSearch;
  }

  return container;
}

// ── Major California cities with coordinates ──────────────────────────────────
const CA_CITIES = [
  { name: "Los Angeles",    lat: 34.0522,  lng: -118.2437 },
  { name: "San Francisco",  lat: 37.7749,  lng: -122.4194 },
  { name: "San Diego",      lat: 32.7157,  lng: -117.1611 },
  { name: "Sacramento",     lat: 38.5816,  lng: -121.4944 },
  { name: "San Jose",       lat: 37.3382,  lng: -121.8863 },
  { name: "Fresno",         lat: 36.7378,  lng: -119.7871 },
  { name: "Long Beach",     lat: 33.7701,  lng: -118.1937 },
  { name: "Oakland",        lat: 37.8044,  lng: -122.2712 },
  { name: "Bakersfield",    lat: 35.3733,  lng: -119.0187 },
  { name: "Anaheim",        lat: 33.8366,  lng: -117.9143 },
  { name: "Riverside",      lat: 33.9806,  lng: -117.3755 },
  { name: "Stockton",       lat: 37.9577,  lng: -121.2908 },
  { name: "Irvine",         lat: 33.6846,  lng: -117.8265 },
  { name: "Santa Ana",      lat: 33.7455,  lng: -117.8677 },
  { name: "Chula Vista",    lat: 32.6401,  lng: -117.0842 },
];

// ── Main Component ────────────────────────────────────────────────────────────
export default function CaliforniaMapPage() {
  const [, navigate] = useWouter();

  // Filters
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [activeCats, setActiveCats] = useState<Set<string>>(
    () => new Set(CATEGORIES.map(c => c.value))
  );
  const [showFilters, setShowFilters] = useState(true);
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");

  // Agent zones data
  const { data: agentZones = [] } = trpc.agentZones.list.useQuery();
  const assignLeadMutation = trpc.agentZones.assignLead.useMutation({
    onSuccess: () => {
      toast.success("Agent assigned!");
    },
    onError: () => toast.error("Failed to assign agent."),
  });

  // Map & markers
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // Data
  const { data: savedLeads = [] } = trpc.savedLeads.list.useQuery();
  const { data: crmFacilities = [] } = trpc.crm.map.allFacilities.useQuery();
  const saveLeadMutation = trpc.savedLeads.save.useMutation({
    onSuccess: (d) => {
      if (d.alreadyExisted) toast.info("Already saved.");
      else toast.success("Lead saved!");
    },
    onError: () => toast.error("Failed to save lead."),
  });

  // Build a set of placeIds that are in CRM
  const crmPlaceIds = useMemo(() => {
    const s = new Set<string>();
    crmFacilities.forEach((f: any) => { if (f.placeId) s.add(f.placeId); });
    return s;
  }, [crmFacilities]);

  // Convert saved leads to PinLead
  const allPins: PinLead[] = useMemo(() => {
    return savedLeads
      .filter((l: any) => l.latitude != null && l.longitude != null)
      .map((l: any) => ({
        placeId: l.placeId,
        name: l.name,
        address: l.address ?? "",
        phone: l.phone ?? null,
        website: l.website ?? null,
        rating: l.rating ?? null,
        reviewCount: l.reviewCount ?? null,
        latitude: l.latitude!,
        longitude: l.longitude!,
        category: l.category,
        qualificationScore: l.qualificationScore ?? 0,
        scoreTier: (l.scoreTier ?? "cold") as "hot" | "warm" | "cold",
        annotation: l.annotation ?? null,
        inCrm: crmPlaceIds.has(l.placeId),
        crmId: crmFacilities.find((f: any) => f.placeId === l.placeId)?.id,
        assignedAgent: l.assignedAgent ?? null,
      }));
  }, [savedLeads, crmPlaceIds, crmFacilities]);

  // Filtered pins
  const visiblePins = useMemo(() => {
    return allPins.filter(p =>
      (tierFilter === "all" || p.scoreTier === tierFilter) &&
      activeCats.has(p.category) &&
      (agentFilter === "all" || p.assignedAgent === agentFilter)
    );
  }, [allPins, tierFilter, activeCats, agentFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: allPins.length,
    hot: allPins.filter(p => p.scoreTier === "hot").length,
    warm: allPins.filter(p => p.scoreTier === "warm").length,
    cold: allPins.filter(p => p.scoreTier === "cold").length,
    inCrm: allPins.filter(p => p.inCrm).length,
  }), [allPins]);

  const buildMarkers = useCallback(() => {
    if (!mapRef.current || !window.google) return;

    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];
    infoWindowRef.current?.close();

    if (visiblePins.length === 0) return;

    visiblePins.forEach(lead => {
      const position = { lat: lead.latitude, lng: lead.longitude };
      const pinEl = createLeadPin(lead);

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current!,
        position,
        title: lead.name,
        content: pinEl,
      });

      marker.addListener("click", () => {
        infoWindowRef.current?.close();

        const content = createInfoWindowContent(
          lead,
          () => {
            // Save lead
            saveLeadMutation.mutate({
              placeId: lead.placeId,
              source: "google" as const,
              name: lead.name,
              address: lead.address,
              phone: lead.phone,
              website: lead.website,
              email: null,
              rating: lead.rating,
              reviewCount: lead.reviewCount,
              latitude: lead.latitude ?? null,
              longitude: lead.longitude ?? null,
              category: lead.category,
              qualificationScore: lead.qualificationScore,
              scoreTier: lead.scoreTier,
              scoreBreakdown: { ratingScore: 0, reviewScore: 0, proximityScore: 0, categoryScore: 0, total: lead.qualificationScore, tier: lead.scoreTier },
            });
            infoWindowRef.current?.close();
          },
          () => {
            infoWindowRef.current?.close();
            if (lead.crmId) navigate(`/crm/facilities/${lead.crmId}`);
            else navigate("/crm/facilities");
          },
          () => {
            infoWindowRef.current?.close();
            sessionStorage.setItem("rerunSearch", JSON.stringify({
              category: lead.category,
              location: lead.address.split(",").slice(-2).join(",").trim(),
              lat: lead.latitude,
              lng: lead.longitude,
              radiusMiles: 10,
            }));
            navigate("/");
          }
        );

        const iw = new window.google.maps.InfoWindow({
          content,
          ariaLabel: lead.name,
          disableAutoPan: false,
        });

        iw.addListener("domready", () => {
          const iwBg = document.querySelectorAll(".gm-style-iw, .gm-style-iw-c, .gm-style-iw-t, .gm-style-iw-tc");
          iwBg.forEach((el) => {
            (el as HTMLElement).style.background = "transparent";
            (el as HTMLElement).style.boxShadow = "none";
            (el as HTMLElement).style.padding = "0";
          });
          const closeBtn = document.querySelector(".gm-ui-hover-effect") as HTMLElement;
          if (closeBtn) {
            closeBtn.style.cssText = "top:4px!important;right:4px!important;background:#1e2d4a!important;border-radius:50%!important;opacity:1!important;";
          }
        });

        iw.open({ map: mapRef.current!, anchor: marker });
        infoWindowRef.current = iw;
      });

      markersRef.current.push(marker);
    });
  }, [visiblePins, saveLeadMutation, navigate]);

  useEffect(() => {
    if (mapRef.current) buildMarkers();
  }, [buildMarkers]);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    buildMarkers();
  }, [buildMarkers]);

  const toggleCategory = (cat: string) => {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const flyToCity = (city: typeof CA_CITIES[0]) => {
    if (!mapRef.current) return;
    mapRef.current.panTo({ lat: city.lat, lng: city.lng });
    mapRef.current.setZoom(12);
  };

  return (
    <div className="relative w-full h-full flex flex-col" style={{ background: "#060b16" }}>
      {/* ── Top stats bar ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-5 py-2"
        style={{
          background: "linear-gradient(90deg, #07101f 0%, #0a1628 60%, #07101f 100%)",
          borderBottom: "1px solid rgba(212,175,55,0.15)",
          boxShadow: "0 1px 0 rgba(212,175,55,0.06), 0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        {/* Logo / title */}
        <div className="flex items-center gap-2 mr-3 flex-shrink-0">
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #D4AF37 0%, #c9a227 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 12px rgba(212,175,55,0.4)",
          }}>
            <MapPin size={14} color="#07101f" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold tracking-wide" style={{ color: "#f1f5f9", fontFamily: "'Playfair Display', serif", letterSpacing: "0.02em" }}>
            California Lead Map
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        <div className="flex items-center gap-2 flex-1">
          {/* Stat pills — premium glass style */}
          {([
            { icon: <Activity size={10} />, val: stats.total, label: "leads", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.15)", color: "#94a3b8", valColor: "#f1f5f9" },
            { icon: <span style={{fontSize:11}}>🔥</span>, val: stats.hot, label: "hot", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", color: "#ef4444", valColor: "#ef4444" },
            { icon: <span style={{fontSize:11}}>♨️</span>, val: stats.warm, label: "warm", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", color: "#f59e0b", valColor: "#f59e0b" },
            { icon: <span style={{fontSize:11}}>❄️</span>, val: stats.cold, label: "cold", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.25)", color: "#60a5fa", valColor: "#60a5fa" },
            { icon: <span style={{fontSize:11}}>★</span>, val: stats.inCrm, label: "in CRM", bg: "rgba(212,175,55,0.1)", border: "rgba(212,175,55,0.3)", color: "#D4AF37", valColor: "#D4AF37" },
          ] as const).map((s, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 5,
              background: s.bg,
              border: `1px solid ${s.border}`,
              borderRadius: 999,
              padding: "3px 10px 3px 8px",
              backdropFilter: "blur(8px)",
            }}>
              <span style={{ color: s.color, display: "flex", alignItems: "center" }}>{s.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.valColor, fontVariantNumeric: "tabular-nums" }}>{s.val}</span>
              <span style={{ fontSize: 10, color: "rgba(148,163,184,0.7)", fontWeight: 500 }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filters button */}
        <button
          onClick={() => setShowFilters(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px",
            background: showFilters
              ? "linear-gradient(135deg, rgba(212,175,55,0.2) 0%, rgba(212,175,55,0.1) 100%)"
              : "rgba(255,255,255,0.04)",
            border: `1px solid ${showFilters ? "rgba(212,175,55,0.5)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 8,
            color: showFilters ? "#D4AF37" : "#94a3b8",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
            backdropFilter: "blur(8px)",
            letterSpacing: "0.03em",
            flexShrink: 0,
          }}
        >
          <Filter size={11} />
          Filters
        </button>
      </div>

      {/* ── Main map area ── */}
      <div className="relative flex-1 overflow-hidden">
        <MapView
          className="w-full h-full rounded-none"
          initialCenter={{ lat: 36.7783, lng: -119.4179 }} // Center of California
          initialZoom={6}
          onMapReady={handleMapReady}
        />

        {/* ── Left filter panel ── */}
        {showFilters && (
          <div className="absolute top-3 left-3 z-10 w-60 flex flex-col gap-2.5">
            {/* Temperature filter */}
            <div style={{
              background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
              backdropFilter: "blur(28px) saturate(180%)",
              border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: 16,
              padding: "15px 14px 13px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 30px rgba(212,175,55,0.04)",
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(212,175,55,0.7)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 11, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 16, height: 1.5, background: "linear-gradient(90deg, rgba(212,175,55,0.6), transparent)" }} />
                Lead Temperature
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {([
                  ["all",  "⚡", "All Leads",  "#94a3b8", null],
                  ["hot",  "🔥", "Hot",         "#ef4444", stats.hot],
                  ["warm", "♨️", "Warm",        "#f59e0b", stats.warm],
                  ["cold", "❄️", "Cold",        "#60a5fa", stats.cold],
                ] as const).map(([val, icon, label, color, count]) => {
                  const active = tierFilter === val;
                  return (
                    <button
                      key={val}
                      onClick={() => setTierFilter(val)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 11px",
                        borderRadius: 10,
                        border: `1px solid ${active ? color + "55" : "rgba(255,255,255,0.06)"}`,
                        background: active
                          ? `linear-gradient(100deg, ${color}22 0%, ${color}0a 100%)`
                          : "rgba(255,255,255,0.025)",
                        color: active ? color : "rgba(148,163,184,0.55)",
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        width: "100%",
                        textAlign: "left",
                        boxShadow: active ? `0 2px 16px ${color}28, 0 0 0 1px ${color}18 inset` : "none",
                        letterSpacing: active ? "0.01em" : "0",
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{icon}</span>
                      <span style={{ flex: 1 }}>{label}</span>
                      {count !== null && (
                        <span style={{
                          fontSize: 10, fontWeight: 800,
                          background: active ? `linear-gradient(135deg, ${color}30, ${color}18)` : "rgba(255,255,255,0.06)",
                          color: active ? color : "rgba(148,163,184,0.45)",
                          borderRadius: 999, padding: "2px 8px",
                          border: `1px solid ${active ? color + "35" : "rgba(255,255,255,0.06)"}`,
                          boxShadow: active ? `0 0 8px ${color}20` : "none",
                          minWidth: 28, textAlign: "center",
                        }}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category filter */}
            <div style={{
              background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
              backdropFilter: "blur(28px) saturate(180%)",
              border: "1px solid rgba(212,175,55,0.2)",
              borderRadius: 16,
              padding: "15px 14px 13px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 30px rgba(212,175,55,0.04)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(212,175,55,0.7)", letterSpacing: "0.15em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 16, height: 1.5, background: "linear-gradient(90deg, rgba(212,175,55,0.6), transparent)" }} />
                  Categories
                </div>
                <button
                  onClick={() => {
                    if (activeCats.size === CATEGORIES.length) setActiveCats(new Set());
                    else setActiveCats(new Set(CATEGORIES.map(c => c.value)));
                  }}
                  style={{
                    fontSize: 10, fontWeight: 800, color: "#D4AF37",
                    background: "linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.08))",
                    border: "1px solid rgba(212,175,55,0.3)",
                    borderRadius: 7, padding: "3px 10px", cursor: "pointer",
                    transition: "all 0.15s",
                    letterSpacing: "0.04em",
                    boxShadow: "0 0 10px rgba(212,175,55,0.12)",
                  }}
                >
                  {activeCats.size === CATEGORIES.length ? "None" : "All"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {CATEGORIES.map(cat => {
                  const cfg = CATEGORY_CONFIG[cat.value] ?? { emoji: "📍", color: "#94a3b8" };
                  const active = activeCats.has(cat.value);
                  const count = allPins.filter(p => p.category === cat.value).length;
                  return (
                    <button
                      key={cat.value}
                      onClick={() => toggleCategory(cat.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 11px",
                        borderRadius: 10,
                        border: `1px solid ${active ? cfg.color + "50" : "rgba(255,255,255,0.05)"}`,
                        background: active
                          ? `linear-gradient(100deg, ${cfg.color}1e 0%, ${cfg.color}08 100%)`
                          : "rgba(255,255,255,0.025)",
                        color: active ? cfg.color : "rgba(71,85,105,0.7)",
                        opacity: active ? 1 : 0.7,
                        fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        width: "100%",
                        textAlign: "left",
                        boxShadow: active ? `0 2px 14px ${cfg.color}22, 0 0 0 1px ${cfg.color}15 inset` : "none",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{cfg.emoji}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 800,
                        background: active ? `linear-gradient(135deg, ${cfg.color}28, ${cfg.color}14)` : "rgba(255,255,255,0.06)",
                        color: active ? cfg.color : "rgba(100,116,139,0.5)",
                        borderRadius: 999, padding: "2px 8px",
                        border: `1px solid ${active ? cfg.color + "30" : "rgba(255,255,255,0.05)"}`,
                        flexShrink: 0,
                        minWidth: 28, textAlign: "center",
                        boxShadow: active ? `0 0 8px ${cfg.color}18` : "none",
                      }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Agent Zones panel */}
            {agentZones.length > 0 && (
              <div style={{
                background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
                backdropFilter: "blur(28px) saturate(180%)",
                border: "1px solid rgba(212,175,55,0.2)",
                borderRadius: 16,
                padding: "15px 14px 13px",
                boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 30px rgba(212,175,55,0.04)",
              }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(212,175,55,0.7)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 16, height: 1.5, background: "linear-gradient(90deg, rgba(212,175,55,0.6), transparent)" }} />
                  Agent Zones
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {/* All agents button */}
                  <button
                    onClick={() => setAgentFilter("all")}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 11px",
                      borderRadius: 10,
                      border: `1px solid ${agentFilter === "all" ? "rgba(212,175,55,0.5)" : "rgba(255,255,255,0.06)"}`,
                      background: agentFilter === "all"
                        ? "linear-gradient(100deg, rgba(212,175,55,0.18) 0%, rgba(212,175,55,0.08) 100%)"
                        : "rgba(255,255,255,0.025)",
                      color: agentFilter === "all" ? "#D4AF37" : "rgba(148,163,184,0.55)",
                      fontSize: 12, fontWeight: agentFilter === "all" ? 700 : 500,
                      cursor: "pointer", transition: "all 0.2s ease", width: "100%", textAlign: "left",
                      boxShadow: agentFilter === "all" ? "0 2px 16px rgba(212,175,55,0.2), 0 0 0 1px rgba(212,175,55,0.12) inset" : "none",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>👥</span>
                    <span style={{ flex: 1 }}>All Agents</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800,
                      background: agentFilter === "all" ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.06)",
                      color: agentFilter === "all" ? "#D4AF37" : "rgba(148,163,184,0.45)",
                      borderRadius: 999, padding: "2px 8px",
                      border: `1px solid ${agentFilter === "all" ? "rgba(212,175,55,0.3)" : "rgba(255,255,255,0.06)"}`,
                      minWidth: 28, textAlign: "center",
                    }}>{allPins.length}</span>
                  </button>

                  {/* Per-agent buttons */}
                  {agentZones.map((zone: any) => {
                    const active = agentFilter === zone.agentName;
                    const count = allPins.filter(p => p.assignedAgent === zone.agentName).length;
                    const initials = zone.agentName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={zone.agentName}
                        onClick={() => setAgentFilter(active ? "all" : zone.agentName)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 11px",
                          borderRadius: 10,
                          border: `1px solid ${active ? zone.color + "55" : "rgba(255,255,255,0.06)"}`,
                          background: active
                            ? `linear-gradient(100deg, ${zone.color}22 0%, ${zone.color}0a 100%)`
                            : "rgba(255,255,255,0.025)",
                          color: active ? zone.color : "rgba(148,163,184,0.55)",
                          fontSize: 11, fontWeight: active ? 700 : 500,
                          cursor: "pointer", transition: "all 0.2s ease", width: "100%", textAlign: "left",
                          boxShadow: active ? `0 2px 16px ${zone.color}28, 0 0 0 1px ${zone.color}18 inset` : "none",
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%",
                          background: `linear-gradient(135deg, ${zone.color}40, ${zone.color}20)`,
                          border: `1.5px solid ${zone.color}60`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, fontWeight: 800, color: zone.color, flexShrink: 0,
                          boxShadow: active ? `0 0 8px ${zone.color}40` : "none",
                        }}>{initials}</div>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zone.agentName}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 800,
                          background: active ? `linear-gradient(135deg, ${zone.color}28, ${zone.color}14)` : "rgba(255,255,255,0.06)",
                          color: active ? zone.color : "rgba(148,163,184,0.45)",
                          borderRadius: 999, padding: "2px 8px",
                          border: `1px solid ${active ? zone.color + "35" : "rgba(255,255,255,0.06)"}`,
                          flexShrink: 0, minWidth: 28, textAlign: "center",
                          boxShadow: active ? `0 0 8px ${zone.color}20` : "none",
                        }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Right: City quick-jump ── */}
        <div style={{
          position: "absolute", top: 12, right: 12, zIndex: 10,
          background: "linear-gradient(160deg, rgba(8,18,36,0.97) 0%, rgba(5,12,24,0.97) 100%)",
          backdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(212,175,55,0.2)",
          borderRadius: 16,
          padding: "15px 12px 13px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 30px rgba(212,175,55,0.04)",
          width: 162,
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(212,175,55,0.7)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 16, height: 1.5, background: "linear-gradient(90deg, rgba(212,175,55,0.6), transparent)" }} />
            Jump to City
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 280, overflowY: "auto" }}>
            {CA_CITIES.map(city => (
              <button
                key={city.name}
                onClick={() => flyToCity(city)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "6px 9px",
                  borderRadius: 9,
                  border: "1px solid transparent",
                  background: "transparent",
                  color: "rgba(148,163,184,0.65)",
                  fontSize: 11, fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                  textAlign: "left",
                  width: "100%",
                  letterSpacing: "0.01em",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#D4AF37";
                  (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(100deg, rgba(212,175,55,0.12), rgba(212,175,55,0.05))";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,175,55,0.28)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 10px rgba(212,175,55,0.1)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = "rgba(148,163,184,0.65)";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
                }}
              >
                <span style={{ fontSize: 8, opacity: 0.4, color: "#D4AF37" }}>◆</span>
                {city.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Bottom: Visible pin count ── */}
        <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "linear-gradient(90deg, rgba(8,18,36,0.95), rgba(5,12,24,0.95))",
            backdropFilter: "blur(28px) saturate(180%)",
            border: "1px solid rgba(212,175,55,0.25)",
            borderRadius: 999,
            padding: "8px 20px",
            boxShadow: "0 6px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 20px rgba(212,175,55,0.06)",
          }}>
            <MapPin size={12} color="#D4AF37" />
            <span style={{ fontSize: 12, color: "rgba(148,163,184,0.8)" }}>
              Showing{" "}
              <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{visiblePins.length}</span>
              {" "}of{" "}
              <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{allPins.length}</span>
              {" "}saved leads
            </span>
            {allPins.length === 0 && (
              <span style={{ fontSize: 11, color: "rgba(100,116,139,0.7)", marginLeft: 4 }}>— save leads from the search page</span>
            )}
          </div>
        </div>

        {/* ── Empty state ── */}
        {allPins.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
            <div className="bg-[#0d1526]/90 backdrop-blur-md border border-[#1e2d4a] rounded-2xl p-8 text-center max-w-sm shadow-2xl pointer-events-auto">
              <div className="text-5xl mb-4">🗺️</div>
              <div className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No Saved Leads Yet
              </div>
              <div className="text-sm text-[#64748b] mb-5 leading-relaxed">
                Search for leads in any California city, save them, and they'll appear as pins on this map — color-coded by temperature.
              </div>
              <button
                onClick={() => navigate("/")}
                className="bg-[#D4AF37] text-[#0a0f1e] font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-[#c9a227] transition-colors cursor-pointer"
              >
                Start Prospecting →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
