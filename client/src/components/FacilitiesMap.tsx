/// <reference types="@types/google.maps" />

import { useEffect, useRef, useCallback } from "react";
import { MapView } from "@/components/Map";
import { MapPin } from "lucide-react";

// ── Status → pin color mapping ────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  active_partner:   { bg: "#2c4a73", border: "#1a2c50", label: "Active Partner" },
  warm_lead:        { bg: "#F59E0B", border: "#D97706", label: "Warm Lead" },
  cold:             { bg: "#60A5FA", border: "#3B82F6", label: "Cold" },
  churned:          { bg: "#6B7280", border: "#4B5563", label: "Churned" },
  do_not_contact:   { bg: "#EF4444", border: "#DC2626", label: "Do Not Contact" },
  needs_agent:      { bg: "#A78BFA", border: "#7C3AED", label: "Needs Agent" },
};

// Category → icon emoji for pin
const CATEGORY_EMOJI: Record<string, string> = {
  body_shop:           "🔧",
  chiropractor:        "🦴",
  physical_therapist:  "💪",
  medical_clinic:      "🏥",
  orthopedic_doctor:   "🩺",
  imaging_center:      "📷",
  other:               "🏢",
};

export interface MapFacility {
  id: number;
  name: string;
  category: string;
  relationshipStatus?: string | null;
  partnerStatus?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  contactName?: string | null;
  assignedRepName?: string | null;
  totalSignedCases?: number | null;
  totalLeadsSent?: number | null;
  totalLeadsReceived?: number | null;
  lastContactDate?: Date | string | null;
  nextFollowUpDate?: Date | string | null;
  notes?: string | null;
}

interface FacilitiesMapProps {
  facilities: MapFacility[];
  onFacilityClick: (id: number) => void;
  className?: string;
}

function createPinElement(facility: MapFacility): HTMLElement {
  const status = facility.relationshipStatus ?? facility.partnerStatus ?? "warm_lead";
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.warm_lead;
  const emoji = CATEGORY_EMOJI[facility.category] ?? "🏢";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    transition: transform 0.15s ease;
  `;
  wrapper.onmouseenter = () => { wrapper.style.transform = "scale(1.15) translateY(-2px)"; };
  wrapper.onmouseleave = () => { wrapper.style.transform = "scale(1)"; };

  // Pin circle
  const pin = document.createElement("div");
  pin.style.cssText = `
    width: 36px;
    height: 36px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: ${colors.bg};
    border: 2.5px solid ${colors.border};
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  `;

  const inner = document.createElement("span");
  inner.style.cssText = "transform: rotate(45deg); font-size: 16px; line-height: 1;";
  inner.textContent = emoji;
  pin.appendChild(inner);
  wrapper.appendChild(pin);

  // Stem
  const stem = document.createElement("div");
  stem.style.cssText = `
    width: 2px;
    height: 8px;
    background: ${colors.border};
    margin-top: -1px;
  `;
  wrapper.appendChild(stem);

  return wrapper;
}

function createInfoWindowContent(facility: MapFacility, onOpen: () => void): HTMLElement {
  const status = facility.relationshipStatus ?? facility.partnerStatus ?? "warm_lead";
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.warm_lead;
  const statusLabel = STATUS_COLORS[status]?.label ?? status;
  const categoryLabel = facility.category?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) ?? "";

  const lastContact = facility.lastContactDate
    ? new Date(facility.lastContactDate).toLocaleDateString()
    : "Never";

  const container = document.createElement("div");
  container.style.cssText = `
    font-family: Inter, system-ui, sans-serif;
    background: #0d1526;
    border: 1px solid #1e2d4a;
    border-radius: 10px;
    padding: 14px 16px;
    min-width: 220px;
    max-width: 280px;
    color: #e2e8f0;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  `;

  container.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">
      <div>
        <div style="font-weight:600;font-size:14px;color:#f1f5f9;line-height:1.3;">${facility.name}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${categoryLabel}</div>
      </div>
      <span style="
        display:inline-block;
        padding:2px 8px;
        border-radius:999px;
        font-size:10px;
        font-weight:600;
        background:${colors.bg}22;
        color:${colors.bg};
        border:1px solid ${colors.bg}55;
        white-space:nowrap;
        flex-shrink:0;
      ">${statusLabel}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">
      ${facility.contactName ? `<div><div style="font-size:10px;color:#64748b;margin-bottom:1px;">Contact</div><div style="font-size:12px;color:#cbd5e1;">${facility.contactName}</div></div>` : ""}
      ${facility.assignedRepName ? `<div><div style="font-size:10px;color:#64748b;margin-bottom:1px;">BD Rep</div><div style="font-size:12px;color:#cbd5e1;">${facility.assignedRepName}</div></div>` : ""}
      ${facility.city ? `<div><div style="font-size:10px;color:#64748b;margin-bottom:1px;">City</div><div style="font-size:12px;color:#cbd5e1;">${facility.city}</div></div>` : ""}
      <div><div style="font-size:10px;color:#64748b;margin-bottom:1px;">Last Contact</div><div style="font-size:12px;color:#cbd5e1;">${lastContact}</div></div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:2px;">
      <div style="flex:1;background:#1e2d4a;border-radius:6px;padding:6px 8px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:#2c4a73;">${facility.totalLeadsReceived ?? 0}</div>
        <div style="font-size:9px;color:#64748b;margin-top:1px;">Leads Received</div>
      </div>
      <div style="flex:1;background:#1e2d4a;border-radius:6px;padding:6px 8px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:#34d399;">${facility.totalSignedCases ?? 0}</div>
        <div style="font-size:9px;color:#64748b;margin-top:1px;">Signed Cases</div>
      </div>
    </div>
    <div id="iw-open-btn" style="
      margin-top:10px;
      width:100%;
      padding:7px 0;
      background:#2c4a73;
      color:#0a0f1e;
      border:none;
      border-radius:6px;
      font-size:12px;
      font-weight:600;
      cursor:pointer;
      text-align:center;
      transition:background 0.15s;
    ">Open Profile →</div>
  `;

  const btn = container.querySelector("#iw-open-btn") as HTMLElement;
  if (btn) {
    btn.onmouseenter = () => { btn.style.background = "#5588c4"; };
    btn.onmouseleave = () => { btn.style.background = "#2c4a73"; };
    btn.onclick = onOpen;
  }

  return container;
}

export default function FacilitiesMap({ facilities, onFacilityClick, className }: FacilitiesMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const withCoords = facilities.filter(f => f.latitude != null && f.longitude != null);
  const withoutCoords = facilities.length - withCoords.length;

  const buildMarkers = useCallback(() => {
    if (!mapRef.current || !window.google) return;

    // Clear existing markers
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    // Close any open info window
    infoWindowRef.current?.close();

    if (withCoords.length === 0) return;

    // Fit map to all markers
    const bounds = new window.google.maps.LatLngBounds();

    withCoords.forEach(facility => {
      const position = { lat: facility.latitude!, lng: facility.longitude! };
      bounds.extend(position);

      const pinEl = createPinElement(facility);

      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current!,
        position,
        title: facility.name,
        content: pinEl,
      });

      marker.addListener("click", () => {
        infoWindowRef.current?.close();

        const content = createInfoWindowContent(facility, () => {
          infoWindowRef.current?.close();
          onFacilityClick(facility.id);
        });

        const iw = new window.google.maps.InfoWindow({
          content,
          ariaLabel: facility.name,
          disableAutoPan: false,
        });

        // Remove default InfoWindow styling
        iw.addListener("domready", () => {
          // Hide the default white background and arrow
          const iwOuter = document.querySelector(".gm-style-iw-a") as HTMLElement;
          if (iwOuter) {
            const parent = iwOuter.parentElement;
            if (parent) parent.style.background = "transparent";
          }
          const closeBtn = document.querySelector(".gm-ui-hover-effect") as HTMLElement;
          if (closeBtn) {
            closeBtn.style.cssText = "top:4px!important;right:4px!important;background:#1e2d4a!important;border-radius:50%!important;";
          }
          // Remove default iw background
          const iwBg = document.querySelectorAll(".gm-style-iw, .gm-style-iw-c, .gm-style-iw-t, .gm-style-iw-tc");
          iwBg.forEach((el) => {
            (el as HTMLElement).style.background = "transparent";
            (el as HTMLElement).style.boxShadow = "none";
            (el as HTMLElement).style.padding = "0";
          });
        });

        iw.open({ map: mapRef.current!, anchor: marker });
        infoWindowRef.current = iw;
      });

      markersRef.current.push(marker);
    });

    if (withCoords.length === 1) {
      mapRef.current.setCenter({ lat: withCoords[0].latitude!, lng: withCoords[0].longitude! });
      mapRef.current.setZoom(14);
    } else {
      mapRef.current.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
    }
  }, [withCoords, onFacilityClick]);

  // Re-build markers whenever facilities change and map is ready
  useEffect(() => {
    if (mapRef.current) buildMarkers();
  }, [buildMarkers]);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    buildMarkers();
  }, [buildMarkers]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 bg-[#0d1526]/90 backdrop-blur-sm border border-[#1e2d4a] rounded-lg p-3 shadow-xl">
        <div className="text-xs font-semibold text-[#94a3b8] mb-2 uppercase tracking-wider">Status Legend</div>
        <div className="space-y-1.5">
          {Object.entries(STATUS_COLORS).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: val.bg, border: `1.5px solid ${val.border}` }}
              />
              <span className="text-xs text-[#cbd5e1]">{val.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats overlay */}
      <div className="absolute top-3 right-3 z-10 bg-[#0d1526]/90 backdrop-blur-sm border border-[#1e2d4a] rounded-lg px-3 py-2 shadow-xl">
        <div className="text-xs text-[#94a3b8]">
          <span className="font-semibold text-[#2c4a73]">{withCoords.length}</span> mapped
          {withoutCoords > 0 && (
            <span className="ml-2 text-amber-400">
              · {withoutCoords} missing location
            </span>
          )}
        </div>
      </div>

      {/* Empty state overlay */}
      {withCoords.length === 0 && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#080d1a]/80 rounded-lg">
          <MapPin className="w-10 h-10 text-[#1e2d4a] mb-3" />
          <p className="text-sm font-medium text-[#64748b]">No facilities have location data yet</p>
          <p className="text-xs text-[#475569] mt-1">Add an address when creating or editing a facility</p>
        </div>
      )}

      <MapView
        className="w-full rounded-lg"
        initialCenter={{ lat: 34.0522, lng: -118.2437 }} // Default: Los Angeles
        initialZoom={10}
        onMapReady={handleMapReady}
      />
    </div>
  );
}
