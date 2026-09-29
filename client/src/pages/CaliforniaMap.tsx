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
import "./CaliforniaMap.css";
import { CURRENT_TEAM, type TeamRole } from "@shared/team";

// ── Tier config ───────────────────────────────────────────────────────────────
// Colours live in CaliforniaMap.css (--hot, --warm, --cold and their text inks),
// so pins, cards and dark mode share one palette.
const TIER_CONFIG = {
  hot:  { fill: "var(--hot)",  ink: "var(--hot-ink)",  label: "Hot" },
  warm: { fill: "var(--warm)", ink: "var(--warm-ink)", label: "Warm" },
  cold: { fill: "var(--cold)", ink: "var(--cold-ink)", label: "Cold" },
} as const;

/** Text from Google or the CRM goes into HTML strings below: escape it. */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

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

// Map a CRM partner status to the map's lead-temperature buckets.
const statusToTier = (s: string | null | undefined): "hot" | "warm" | "cold" => {
  if (s === "priority_partner" || s === "active_partner") return "hot";
  if (s === "dormant" || s === "do_not_use" || s === "churned" || s === "cold") return "cold";
  return "warm";
};

// ── The team on the map ──────────────────────────────────────────────────────
// Partners carry their rep's name as the CRM spells it ("Lupe", "Miguel Flores"),
// and agent_zones as the Representative Zones page does, so match on first names.
const firstOf = (s?: string | null) => String(s ?? "").trim().split(/\s+/)[0].toLowerCase();
const initialsOf = (name: string) => name.split(/\s+/).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
/** Today's team by first name (@shared/team). Former reps have no zone or filter on the map. */
const CURRENT = new Map(
  (Object.entries(CURRENT_TEAM) as [TeamRole, readonly string[]][])
    .flatMap(([role, names]) => names.map((n) => [firstOf(n), { full: n, role }] as const)),
);

/**
 * A Field Rep's zone: the outline around the partners assigned to them, leaving
 * out the farthest 15% so one partner out of town doesn't stretch the whole zone,
 * and eased out a little so edge pins sit inside it. Null under three partners.
 */
function zoneOutline(points: { lat: number; lng: number }[]): { lat: number; lng: number }[] | null {
  if (points.length < 3) return null;
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const cLat = mid(points.map((p) => p.lat)), cLng = mid(points.map((p) => p.lng));
  const miles = (p: { lat: number; lng: number }) => Math.hypot((p.lat - cLat) * 69, (p.lng - cLng) * 57);
  const limit = points.map(miles).sort((a, b) => a - b)[Math.floor(points.length * 0.85)];
  const kept = points.filter((p) => miles(p) <= limit).sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (kept.length < 3) return null;
  // Monotone chain convex hull, x = lng, y = lat.
  const cross = (o: typeof kept[0], a: typeof kept[0], b: typeof kept[0]) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const half = (pts: typeof kept) => {
    const h: typeof kept = [];
    for (const p of pts) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
    return h.slice(0, -1);
  };
  const hull = [...half(kept), ...half([...kept].reverse())];
  if (hull.length < 3) return null;
  const hLat = hull.reduce((t, p) => t + p.lat, 0) / hull.length, hLng = hull.reduce((t, p) => t + p.lng, 0) / hull.length;
  return hull.map((p) => ({ lat: hLat + (p.lat - hLat) * 1.12, lng: hLng + (p.lng - hLng) * 1.12 }));
}

// ── Pin DOM element ───────────────────────────────────────────────────────────
// A teardrop in the lead's temperature, the category's emoji inside, ringed in
// the representative's colour when one is assigned; a small charcoal star when
// it's already in the CRM. Styles: .pm-pin* in CaliforniaMap.css.
function createLeadPin(lead: PinLead, agentColor: string | null): HTMLElement {
  const tier = TIER_CONFIG[lead.scoreTier];
  const cat = CATEGORY_CONFIG[lead.category] ?? { emoji: "📍", color: "#94a3b8" };

  const wrapper = document.createElement("div");
  wrapper.className = "pm-pin";
  wrapper.style.setProperty("--tier", tier.fill);
  if (agentColor) wrapper.style.setProperty("--ring", agentColor);

  const pin = document.createElement("div");
  pin.className = "pm-pin-body";
  const inner = document.createElement("span");
  inner.textContent = cat.emoji;
  pin.appendChild(inner);
  if (lead.inCrm) {
    const badge = document.createElement("div");
    badge.className = "pm-pin-crm";
    badge.textContent = "★";
    pin.appendChild(badge);
  }
  wrapper.appendChild(pin);

  const stem = document.createElement("div");
  stem.className = "pm-pin-stem";
  wrapper.appendChild(stem);
  return wrapper;
}

// ── Info Window content ───────────────────────────────────────────────────────
function createInfoWindowContent(
  lead: PinLead,
  agentColor: string | null,
  onSaveLead: () => void,
  onOpenCrm: () => void,
  onSearch: () => void,
): HTMLElement {
  const tier = TIER_CONFIG[lead.scoreTier];
  const cat = CATEGORY_CONFIG[lead.category] ?? { emoji: "📍", color: "#94a3b8" };
  const catLabel = getCategoryLabel(lead.category);
  const stars = lead.rating
    ? "★".repeat(Math.round(lead.rating)) + "☆".repeat(5 - Math.round(lead.rating))
    : "";

  const container = document.createElement("div");
  container.className = "pm-iw";
  container.style.setProperty("--tier", tier.fill);
  container.innerHTML = `
    <div class="pm-iw-head">
      <div class="who">
        <div class="pm-iw-name">${esc(lead.name)}</div>
        <div class="pm-iw-sub">${cat.emoji} ${esc(catLabel)}</div>
        <div style="margin-top:7px"><span class="pm-tier">${tier.label}</span></div>
      </div>
      ${lead.qualificationScore ? `<div class="pm-iw-score"><b>${lead.qualificationScore}</b><small>of 100</small></div>` : ""}
    </div>
    <div class="pm-iw-body">
      ${lead.rating ? `<div class="pm-iw-line"><span class="k pm-iw-stars">★</span><span><span class="pm-iw-stars">${stars}</span> ${lead.rating} · ${(lead.reviewCount ?? 0).toLocaleString()} reviews</span></div>` : ""}
      ${lead.address ? `<div class="pm-iw-line"><span class="k">📍</span><span>${esc(lead.address)}</span></div>` : ""}
      ${lead.phone ? `<div class="pm-iw-line"><span class="k">📞</span><a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a></div>` : ""}
      ${agentColor ? `<span class="pm-iw-tag" style="--c:${agentColor}"><span class="sw"></span>${esc(lead.assignedAgent)}</span>` : ""}
      ${lead.inCrm ? `<span class="pm-iw-tag crm">★ In the CRM</span>` : ""}
      ${lead.annotation ? `<div class="pm-iw-note">“${esc(lead.annotation)}”</div>` : ""}
      <div class="pm-iw-acts">
        ${!lead.inCrm ? `<div id="iw-save" class="main" role="button" tabindex="0">Save lead</div>` : `<div id="iw-crm" class="main" role="button" tabindex="0">Open in CRM</div>`}
        <div id="iw-search" class="alt" role="button" tabindex="0">Search this area</div>
      </div>
    </div>
  `;

  const saveBtn = container.querySelector("#iw-save") as HTMLElement | null;
  if (saveBtn) saveBtn.onclick = onSaveLead;
  const crmBtn = container.querySelector("#iw-crm") as HTMLElement | null;
  if (crmBtn) crmBtn.onclick = onOpenCrm;
  const searchBtn = container.querySelector("#iw-search") as HTMLElement | null;
  if (searchBtn) searchBtn.onclick = onSearch;

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
  // Today's team only (Sept 2026: "hide former team from the map"), by full name.
  const teamZones = useMemo(() => (agentZones as any[]).flatMap((z) => {
    const who = CURRENT.get(firstOf(z.agentName));
    return who ? [{ ...z, full: who.full, role: who.role as TeamRole }] : [];
  }), [agentZones]);
  const repColor = useMemo(() => new Map<string, string>(teamZones.map((z) => [firstOf(z.agentName), z.color])), [teamZones]);
  const assignLeadMutation = trpc.agentZones.assignLead.useMutation({
    onSuccess: () => {
      toast.success("Representative assigned!");
    },
    onError: () => toast.error("Failed to assign representative."),
  });

  // Map & markers
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const labelMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const territoryInfoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [showZones, setShowZones] = useState(true);

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

  // Saved leads + real CRM facilities — both rendered as map pins.
  const allPins: PinLead[] = useMemo(() => {
    const leadPins: PinLead[] = savedLeads
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
    const leadPlaceIds = new Set(leadPins.map((p) => p.placeId));
    const facilityPins: PinLead[] = (crmFacilities as any[])
      .filter((f) => f.latitude != null && f.longitude != null && (!f.placeId || !leadPlaceIds.has(f.placeId)))
      .map((f) => ({
        placeId: f.placeId ?? `facility-${f.id}`,
        name: f.name,
        address: f.city ?? "",
        phone: f.phone ?? null,
        website: null,
        rating: null,
        reviewCount: null,
        latitude: f.latitude,
        longitude: f.longitude,
        category: f.category,
        qualificationScore: 0,
        scoreTier: statusToTier(f.partnerStatus),
        annotation: null,
        inCrm: true,
        crmId: f.id,
        assignedAgent: f.assignedRepName ?? null,
      }));
    return [...leadPins, ...facilityPins];
  }, [savedLeads, crmPlaceIds, crmFacilities]);

  // Filtered pins
  const visiblePins = useMemo(() => {
    return allPins.filter(p =>
      (tierFilter === "all" || p.scoreTier === tierFilter) &&
      activeCats.has(p.category) &&
      (agentFilter === "all" || firstOf(p.assignedAgent) === firstOf(agentFilter))
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
      const color = repColor.get(firstOf(lead.assignedAgent)) ?? null;
      const pinEl = createLeadPin(lead, color);

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
          color,
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
            navigate("/search");
          }
        );

        const iw = new window.google.maps.InfoWindow({
          content,
          ariaLabel: lead.name,
          disableAutoPan: false,
        });

        iw.open({ map: mapRef.current!, anchor: marker });
        infoWindowRef.current = iw;
      });

      markersRef.current.push(marker);
    });
  }, [visiblePins, saveLeadMutation, navigate, repColor]);

  useEffect(() => {
    if (mapRef.current) buildMarkers();
  }, [buildMarkers]);

  // Field Reps' zones, from where their partners are. BDRs work the whole state by
  // phone, so a shape around their partners would cover most of California.
  const territories = useMemo(() => teamZones.filter((z) => z.role === "FR").flatMap((z) => {
    const pins = allPins.filter((p) => firstOf(p.assignedAgent) === firstOf(z.agentName));
    const paths = zoneOutline(pins.map((p) => ({ lat: p.latitude, lng: p.longitude })));
    return paths ? [{ agent: z.agentName, color: z.color as string, label: z.full, initials: initialsOf(z.full), paths, pins }] : [];
  }), [teamZones, allPins]);

  // Draw territory polygons
  const drawTerritories = useCallback((map: google.maps.Map) => {
    // Clear existing polygons
    polygonsRef.current.forEach(p => p.setMap(null));
    polygonsRef.current = [];
    labelMarkersRef.current.forEach(m => { m.map = null; });
    labelMarkersRef.current = [];
    territoryInfoWindowRef.current?.close();

    if (!showZones) return;

    territories.forEach(territory => {
      // Compute per-agent lead stats from allPins
      const agentPins = territory.pins;
      const hotCount = agentPins.filter(p => p.scoreTier === "hot").length;
      const warmCount = agentPins.filter(p => p.scoreTier === "warm").length;
      const coldCount = agentPins.filter(p => p.scoreTier === "cold").length;
      const crmCount = agentPins.filter(p => p.inCrm).length;
      const totalCount = agentPins.length;

      // Draw filled polygon
      const polygon = new window.google.maps.Polygon({
        paths: territory.paths,
        strokeColor: territory.color,
        strokeOpacity: 0.85,
        strokeWeight: 2.5,
        fillColor: territory.color,
        fillOpacity: 0.08,
        map,
        zIndex: 1,
        clickable: true,
      });
      polygonsRef.current.push(polygon);

      // Compute centroid for label
      const centroid = territory.paths.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / territory.paths.length, lng: acc.lng + p.lng / territory.paths.length }),
        { lat: 0, lng: 0 }
      );

      // Build territory popup content
      const buildTerritoryPopup = (): HTMLElement => {
        const el = document.createElement("div");
        el.className = "pm-tp";
        el.style.setProperty("--c", territory.color);
        const pct = (n: number) => (totalCount > 0 ? Math.round((n / totalCount) * 100) : 0);
        const row = (label: string, n: number, tier: keyof typeof TIER_CONFIG) =>
          `<div class="pm-tp-row" style="--tier:${TIER_CONFIG[tier].fill}"><span class="l"><i></i>${label}</span><span class="v"><b>${n}</b><span>${pct(n)}%</span></span></div>`;
        el.innerHTML = `
          <div class="pm-tp-head">
            <div class="av">${esc(territory.initials)}</div>
            <div>
              <div class="nm">${esc(territory.label)}</div>
              <div class="kick">Territory overview</div>
            </div>
            <div class="tot"><b>${totalCount}</b><small>leads</small></div>
          </div>
          <div class="pm-tp-body">
            <div class="pm-tp-h">Lead temperature</div>
            <div class="pm-tp-bar">
              ${hotCount > 0 ? `<i style="flex:${hotCount};background:${TIER_CONFIG.hot.fill}"></i>` : ""}
              ${warmCount > 0 ? `<i style="flex:${warmCount};background:${TIER_CONFIG.warm.fill}"></i>` : ""}
              ${coldCount > 0 ? `<i style="flex:${coldCount};background:${TIER_CONFIG.cold.fill}"></i>` : ""}
            </div>
            ${row("Hot", hotCount, "hot")}
            ${row("Warm", warmCount, "warm")}
            ${row("Cold", coldCount, "cold")}
            <div class="pm-tp-crm"><span>★ In the CRM</span><b>${crmCount}</b></div>
          </div>
        `;
        return el;
      };

      // Click handler on polygon
      polygon.addListener("click", (e: google.maps.MapMouseEvent) => {
        territoryInfoWindowRef.current?.close();
        infoWindowRef.current?.close();

        const iw = new window.google.maps.InfoWindow({
          content: buildTerritoryPopup(),
          position: e.latLng ?? centroid,
          disableAutoPan: false,
        });

        iw.open({ map });
        territoryInfoWindowRef.current = iw;
      });

      // Hover: brighten fill
      polygon.addListener("mouseover", () => {
        polygon.setOptions({ fillOpacity: 0.18, strokeOpacity: 1 });
      });
      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.08, strokeOpacity: 0.85 });
      });

      // Create label marker
      const labelEl = document.createElement("div");
      labelEl.className = "pm-zone";
      labelEl.style.setProperty("--c", territory.color);
      labelEl.innerHTML = `<span class="av">${esc(territory.initials)}</span><span class="nm">${esc(territory.label)}</span><span class="n">${totalCount}</span>`;

      const labelMarker = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position: centroid,
        content: labelEl,
        zIndex: 2,
      });
      labelMarkersRef.current.push(labelMarker);
    });
  }, [showZones, territories]);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    drawTerritories(map);
    buildMarkers();
  }, [buildMarkers, drawTerritories]);

  // Redraw territories when showZones changes
  useEffect(() => {
    if (mapRef.current) drawTerritories(mapRef.current);
  }, [drawTerritories]);

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
    <div className="pm">
      {/* ── Top bar: title, the counts, and the two toggles ── */}
      <div className="pm-top">
        <div className="pm-title">
          <span className="pm-logo"><MapPin size={15} strokeWidth={2.4} /></span>
          <h1>California Partner Map</h1>
        </div>
        <div className="pm-stats">
          <span className="pm-stat"><Activity /><b>{stats.total}</b> leads</span>
          <span className="pm-stat" style={{ ["--c" as any]: TIER_CONFIG.hot.fill }}><i /><b>{stats.hot}</b> hot</span>
          <span className="pm-stat" style={{ ["--c" as any]: TIER_CONFIG.warm.fill }}><i /><b>{stats.warm}</b> warm</span>
          <span className="pm-stat" style={{ ["--c" as any]: TIER_CONFIG.cold.fill }}><i /><b>{stats.cold}</b> cold</span>
          <span className="pm-stat"><Star /><b>{stats.inCrm}</b> in CRM</span>
        </div>
        <button type="button" className={cn("pm-btn", showZones && "on")} aria-pressed={showZones} onClick={() => setShowZones(v => !v)}>
          <Layers /> Zones
        </button>
        <button type="button" className={cn("pm-btn", showFilters && "on")} aria-pressed={showFilters} onClick={() => setShowFilters(v => !v)}>
          <Filter /> Filters
        </button>
      </div>

      {/* ── Main map area ── */}
      <div className="pm-body">
        <MapView
          className="w-full h-full rounded-none"
          initialCenter={{ lat: 36.7783, lng: -119.4179 }} // Center of California
          initialZoom={6}
          onMapReady={handleMapReady}
        />

        {/* ── Left filter panel ── */}
        {showFilters && (
          <div className="pm-left">
            {/* Temperature filter */}
            <div className="pm-card">
              <div className="pm-h">Lead temperature</div>
              <div className="pm-rows">
                {([
                  ["all",  "All leads", null,                  stats.total],
                  ["hot",  "Hot",       TIER_CONFIG.hot.fill,  stats.hot],
                  ["warm", "Warm",      TIER_CONFIG.warm.fill, stats.warm],
                  ["cold", "Cold",      TIER_CONFIG.cold.fill, stats.cold],
                ] as const).map(([val, label, color, count]) => (
                  <button key={val} type="button" className={cn("pm-row", tierFilter === val && "on")} aria-pressed={tierFilter === val} onClick={() => setTierFilter(val)}>
                    {color ? <span className="dot" style={{ ["--c" as any]: color }} /> : <span className="dot" style={{ ["--c" as any]: "var(--char)" }} />}
                    <span className="lbl">{label}</span>
                    <span className="pm-count">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter */}
            <div className="pm-card">
              <div className="pm-h">
                Categories
                <button
                  type="button"
                  className="pm-link"
                  onClick={() => {
                    if (activeCats.size === CATEGORIES.length) setActiveCats(new Set());
                    else setActiveCats(new Set(CATEGORIES.map(c => c.value)));
                  }}
                >
                  {activeCats.size === CATEGORIES.length ? "None" : "All"}
                </button>
              </div>
              <div className="pm-rows">
                {CATEGORIES.map(cat => {
                  const cfg = CATEGORY_CONFIG[cat.value] ?? { emoji: "📍", color: "#94a3b8" };
                  const active = activeCats.has(cat.value);
                  const count = allPins.filter(p => p.category === cat.value).length;
                  return (
                    <button key={cat.value} type="button" className={cn("pm-row", active ? "on" : "off-cat")} aria-pressed={active} onClick={() => toggleCategory(cat.value)}>
                      <span className="em">{cfg.emoji}</span>
                      <span className="lbl">{cat.label}</span>
                      <span className="pm-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Agent Zones panel */}
            {teamZones.length > 0 && (
              <div className="pm-card">
                <div className="pm-h">Representative zones</div>
                <div className="pm-rows">
                  <button type="button" className={cn("pm-row", agentFilter === "all" && "on")} aria-pressed={agentFilter === "all"} onClick={() => setAgentFilter("all")}>
                    <span className="pm-av" style={{ ["--c" as any]: "var(--char)", color: "var(--char-ink)" }}><Users size={12} /></span>
                    <span className="lbl">All representatives</span>
                    <span className="pm-count">{allPins.length}</span>
                  </button>
                  {teamZones.map((zone) => {
                    const active = agentFilter === zone.agentName;
                    const count = allPins.filter(p => firstOf(p.assignedAgent) === firstOf(zone.agentName)).length;
                    return (
                      <button key={zone.agentName} type="button" className={cn("pm-row", active && "on")} aria-pressed={active} onClick={() => setAgentFilter(active ? "all" : zone.agentName)}>
                        <span className="pm-av" style={{ ["--c" as any]: zone.color }}>{initialsOf(zone.full)}</span>
                        <span className="lbl">{zone.full}</span>
                        <span className="pm-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Right: City quick-jump ── */}
        <div className="pm-card pm-right">
          <div className="pm-h">Jump to city</div>
          <div className="pm-cities">
            {CA_CITIES.map(city => (
              <button key={city.name} type="button" className="pm-city" onClick={() => flyToCity(city)}>{city.name}</button>
            ))}
          </div>
        </div>

        {/* ── Bottom: Visible pin count ── */}
        <div className="pm-foot">
          <MapPin />
          <span>Showing <b>{visiblePins.length}</b> of <b>{allPins.length}</b> saved leads</span>
          {allPins.length === 0 && <span>— save leads from the search page</span>}
        </div>

        {/* ── Empty state ── */}
        {allPins.length === 0 && (
          <div className="pm-empty">
            <div>
              <div style={{ fontSize: 40 }}>🗺️</div>
              <h2>No saved leads yet</h2>
              <p>Search for leads in any California city, save them, and they'll appear as pins on this map, coloured by temperature.</p>
              <button type="button" className="pm-cta" onClick={() => navigate("/search")}>Start prospecting →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
