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
}

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
  const pin = document.createElement("div");
  pin.style.cssText = `
    width: 34px;
    height: 34px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: ${tier.bg};
    border: 2.5px solid ${tier.border};
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 10px ${tier.glow}, 0 2px 8px rgba(0,0,0,0.4);
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
    background: linear-gradient(135deg, #0d1526 0%, #0f1a2e 100%);
    border: 1px solid #1e2d4a;
    border-radius: 12px;
    padding: 0;
    min-width: 260px;
    max-width: 300px;
    color: #e2e8f0;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
    overflow: hidden;
  `;

  const stars = lead.rating
    ? "★".repeat(Math.round(lead.rating)) + "☆".repeat(5 - Math.round(lead.rating))
    : "";

  container.innerHTML = `
    <!-- Header band -->
    <div style="
      background: linear-gradient(90deg, ${tier.bg}22, ${tier.bg}08);
      border-bottom: 1px solid ${tier.bg}33;
      padding: 12px 14px 10px;
    ">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;color:#f1f5f9;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lead.name}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${cat.emoji} ${catLabel}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
          <span style="
            display:inline-flex;align-items:center;gap:3px;
            padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;
            background:${tier.bg}22;color:${tier.bg};border:1px solid ${tier.bg}55;
          ">${tier.icon} ${tier.label}</span>
          <span style="font-size:11px;font-weight:700;color:${tier.bg};">${lead.qualificationScore}/100</span>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:12px 14px;">
      <!-- Rating -->
      ${lead.rating ? `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="color:#fbbf24;font-size:12px;letter-spacing:-1px;">${stars}</span>
          <span style="font-size:12px;color:#94a3b8;">${lead.rating} (${(lead.reviewCount ?? 0).toLocaleString()} reviews)</span>
        </div>
      ` : ""}

      <!-- Address -->
      <div style="font-size:11px;color:#64748b;margin-bottom:6px;display:flex;align-items:flex-start;gap:5px;">
        <span style="flex-shrink:0;margin-top:1px;">📍</span>
        <span style="line-height:1.4;">${lead.address}</span>
      </div>

      <!-- Phone -->
      ${lead.phone ? `
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;display:flex;align-items:center;gap:5px;">
          <span>📞</span>
          <a href="tel:${lead.phone}" style="color:#60a5fa;text-decoration:none;">${lead.phone}</a>
        </div>
      ` : ""}

      <!-- CRM status -->
      ${lead.inCrm ? `
        <div style="
          display:flex;align-items:center;gap:5px;
          background:#D4AF3722;border:1px solid #D4AF3744;
          border-radius:6px;padding:5px 8px;margin-bottom:8px;
        ">
          <span style="color:#D4AF37;font-size:12px;">★</span>
          <span style="font-size:11px;color:#D4AF37;font-weight:600;">Added to CRM</span>
        </div>
      ` : ""}

      <!-- Annotation -->
      ${lead.annotation ? `
        <div style="
          background:#1e2d4a;border-radius:6px;padding:6px 8px;margin-bottom:8px;
          font-size:11px;color:#94a3b8;font-style:italic;line-height:1.4;
        ">"${lead.annotation}"</div>
      ` : ""}

      <!-- Actions -->
      <div style="display:flex;gap:6px;margin-top:4px;">
        ${!lead.inCrm ? `
          <div id="iw-save" style="
            flex:1;padding:7px 0;background:#D4AF37;color:#0a0f1e;
            border:none;border-radius:6px;font-size:11px;font-weight:700;
            cursor:pointer;text-align:center;transition:background 0.15s;
          ">+ Save Lead</div>
        ` : `
          <div id="iw-crm" style="
            flex:1;padding:7px 0;background:#D4AF3722;color:#D4AF37;
            border:1px solid #D4AF3744;border-radius:6px;font-size:11px;font-weight:700;
            cursor:pointer;text-align:center;transition:background 0.15s;
          ">Open CRM →</div>
        `}
        <div id="iw-search" style="
          flex:1;padding:7px 0;background:#1e2d4a;color:#94a3b8;
          border:none;border-radius:6px;font-size:11px;font-weight:600;
          cursor:pointer;text-align:center;transition:background 0.15s;
        ">Search Area</div>
      </div>
    </div>
  `;

  const saveBtn = container.querySelector("#iw-save") as HTMLElement | null;
  if (saveBtn) {
    saveBtn.onmouseenter = () => { saveBtn.style.background = "#c9a227"; };
    saveBtn.onmouseleave = () => { saveBtn.style.background = "#D4AF37"; };
    saveBtn.onclick = onSaveLead;
  }

  const crmBtn = container.querySelector("#iw-crm") as HTMLElement | null;
  if (crmBtn) {
    crmBtn.onmouseenter = () => { crmBtn.style.background = "#D4AF3733"; };
    crmBtn.onmouseleave = () => { crmBtn.style.background = "#D4AF3722"; };
    crmBtn.onclick = onOpenCrm;
  }

  const searchBtn = container.querySelector("#iw-search") as HTMLElement | null;
  if (searchBtn) {
    searchBtn.onmouseenter = () => { searchBtn.style.background = "#243552"; };
    searchBtn.onmouseleave = () => { searchBtn.style.background = "#1e2d4a"; };
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
      }));
  }, [savedLeads, crmPlaceIds, crmFacilities]);

  // Filtered pins
  const visiblePins = useMemo(() => {
    return allPins.filter(p =>
      (tierFilter === "all" || p.scoreTier === tierFilter) &&
      activeCats.has(p.category)
    );
  }, [allPins, tierFilter, activeCats]);

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
    <div className="relative w-full h-full flex flex-col" style={{ background: "#080d1a" }}>
      {/* ── Top stats bar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[#1e2d4a] bg-[#0d1526]">
        <div className="flex items-center gap-1.5 mr-2">
          <MapPin size={15} className="text-[#D4AF37]" />
          <span className="text-sm font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            California Lead Map
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1">
          {/* Stat pills */}
          <div className="flex items-center gap-1.5 bg-[#1e2d4a] rounded-full px-3 py-1">
            <Activity size={11} className="text-[#94a3b8]" />
            <span className="text-xs text-[#94a3b8]"><span className="font-bold text-white">{stats.total}</span> saved leads</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#ef444422] border border-[#ef444433] rounded-full px-3 py-1">
            <span className="text-xs">🔥</span>
            <span className="text-xs font-bold text-[#ef4444]">{stats.hot}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#f59e0b22] border border-[#f59e0b33] rounded-full px-3 py-1">
            <span className="text-xs">♨️</span>
            <span className="text-xs font-bold text-[#f59e0b]">{stats.warm}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#60a5fa22] border border-[#60a5fa33] rounded-full px-3 py-1">
            <span className="text-xs">❄️</span>
            <span className="text-xs font-bold text-[#60a5fa]">{stats.cold}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#D4AF3722] border border-[#D4AF3733] rounded-full px-3 py-1">
            <span className="text-xs">★</span>
            <span className="text-xs font-bold text-[#D4AF37]">{stats.inCrm} in CRM</span>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-7 px-3 text-xs border-[#1e2d4a] text-[#94a3b8] hover:text-white hover:border-[#D4AF37]"
          onClick={() => setShowFilters(v => !v)}
        >
          <Filter size={11} className="mr-1" />
          Filters
        </Button>
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
          <div className="absolute top-3 left-3 z-10 w-56 flex flex-col gap-2">
            {/* Temperature filter */}
            <div className="bg-[#0d1526]/95 backdrop-blur-md border border-[#1e2d4a] rounded-xl p-3 shadow-2xl">
              <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-widest mb-2">Lead Temperature</div>
              <div className="flex flex-col gap-1.5">
                {([
                  ["all",  "⚡", "All Leads",  "#94a3b8"],
                  ["hot",  "🔥", "Hot",         "#ef4444"],
                  ["warm", "♨️", "Warm",        "#f59e0b"],
                  ["cold", "❄️", "Cold",        "#60a5fa"],
                ] as const).map(([val, icon, label, color]) => (
                  <button
                    key={val}
                    onClick={() => setTierFilter(val)}
                    style={{
                      background: tierFilter === val ? `${color}22` : "transparent",
                      border: `1px solid ${tierFilter === val ? color + "55" : "#1e2d4a"}`,
                      color: tierFilter === val ? color : "#64748b",
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer w-full text-left"
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                    {val !== "all" && (
                      <span className="ml-auto text-[10px] opacity-70">
                        {val === "hot" ? stats.hot : val === "warm" ? stats.warm : stats.cold}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter */}
            <div className="bg-[#0d1526]/95 backdrop-blur-md border border-[#1e2d4a] rounded-xl p-3 shadow-2xl">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-widest">Categories</div>
                <button
                  onClick={() => {
                    if (activeCats.size === CATEGORIES.length) setActiveCats(new Set());
                    else setActiveCats(new Set(CATEGORIES.map(c => c.value)));
                  }}
                  className="text-[9px] text-[#D4AF37] hover:text-[#c9a227] font-semibold"
                >
                  {activeCats.size === CATEGORIES.length ? "None" : "All"}
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {CATEGORIES.map(cat => {
                  const cfg = CATEGORY_CONFIG[cat.value] ?? { emoji: "📍", color: "#94a3b8" };
                  const active = activeCats.has(cat.value);
                  const count = allPins.filter(p => p.category === cat.value).length;
                  return (
                    <button
                      key={cat.value}
                      onClick={() => toggleCategory(cat.value)}
                      style={{
                        background: active ? `${cfg.color}18` : "transparent",
                        border: `1px solid ${active ? cfg.color + "44" : "#1e2d4a"}`,
                        color: active ? cfg.color : "#475569",
                        opacity: active ? 1 : 0.5,
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer w-full text-left"
                    >
                      <span>{cfg.emoji}</span>
                      <span className="truncate flex-1">{cat.label}</span>
                      <span className="text-[10px] opacity-70 flex-shrink-0">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Right: City quick-jump ── */}
        <div className="absolute top-3 right-3 z-10 bg-[#0d1526]/95 backdrop-blur-md border border-[#1e2d4a] rounded-xl p-3 shadow-2xl w-44">
          <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-widest mb-2">Jump to City</div>
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {CA_CITIES.map(city => (
              <button
                key={city.name}
                onClick={() => flyToCity(city)}
                className="text-left text-[11px] text-[#94a3b8] hover:text-[#D4AF37] hover:bg-[#D4AF3711] px-2 py-1 rounded-lg transition-all cursor-pointer"
              >
                📍 {city.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Bottom: Visible pin count ── */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-[#0d1526]/95 backdrop-blur-md border border-[#1e2d4a] rounded-full px-4 py-2 shadow-2xl flex items-center gap-2">
            <MapPin size={12} className="text-[#D4AF37]" />
            <span className="text-xs text-[#94a3b8]">
              Showing <span className="font-bold text-white">{visiblePins.length}</span> of <span className="font-bold text-white">{allPins.length}</span> saved leads
            </span>
            {allPins.length === 0 && (
              <span className="text-xs text-[#64748b] ml-1">— save leads from the search page to see them here</span>
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
