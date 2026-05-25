/**
 * GOOGLE MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<google.maps.Map | null>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 40.7128, lng: -74.0060 }}
 *   initialZoom={15}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // Store to control map from parent anytime, google map itself is in charge of the re-rendering, not react state.
 * </MapView>
 *
 * ======
 * Available Libraries and Core Features:
 * -------------------------------
 * 📍 MARKER (from `marker` library)
 * - Attaches to map using { map, position }
 * new google.maps.marker.AdvancedMarkerElement({
 *   map,
 *   position: { lat: 37.7749, lng: -122.4194 },
 *   title: "San Francisco",
 * });
 *
 * -------------------------------
 * 🏢 PLACES (from `places` library)
 * - Does not attach directly to map; use data with your map manually.
 * const place = new google.maps.places.Place({ id: PLACE_ID });
 * await place.fetchFields({ fields: ["displayName", "location"] });
 * map.setCenter(place.location);
 * new google.maps.marker.AdvancedMarkerElement({ map, position: place.location });
 *
 * -------------------------------
 * 🧭 GEOCODER (from `geocoding` library)
 * - Standalone service; manually apply results to map.
 * const geocoder = new google.maps.Geocoder();
 * geocoder.geocode({ address: "New York" }, (results, status) => {
 *   if (status === "OK" && results[0]) {
 *     map.setCenter(results[0].geometry.location);
 *     new google.maps.marker.AdvancedMarkerElement({
 *       map,
 *       position: results[0].geometry.location,
 *     });
 *   }
 * });
 *
 * -------------------------------
 * 📐 GEOMETRY (from `geometry` library)
 * - Pure utility functions; not attached to map.
 * const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
 *
 * -------------------------------
 * 🛣️ ROUTES (from `routes` library)
 * - Combines DirectionsService (standalone) + DirectionsRenderer (map-attached)
 * const directionsService = new google.maps.DirectionsService();
 * const directionsRenderer = new google.maps.DirectionsRenderer({ map });
 * directionsService.route(
 *   { origin, destination, travelMode: "DRIVING" },
 *   (res, status) => status === "OK" && directionsRenderer.setDirections(res)
 * );
 *
 * -------------------------------
 * 🌦️ MAP LAYERS (attach directly to map)
 * - new google.maps.TrafficLayer().setMap(map);
 * - new google.maps.TransitLayer().setMap(map);
 * - new google.maps.BicyclingLayer().setMap(map);
 *
 * -------------------------------
 * ✅ SUMMARY
 * - “map-attached” → AdvancedMarkerElement, DirectionsRenderer, Layers.
 * - “standalone” → Geocoder, DirectionsService, DistanceMatrixService, ElevationService.
 * - “data-only” → Place, Geometry utilities.
 */

/// <reference types="@types/google.maps" />

import React, { useEffect, useRef } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    google?: typeof google;
  }
}

// Load Google Maps directly from the CDN using the VITE_GOOGLE_MAPS_API_KEY.
// Falls back to the server-side proxy if the direct key is not set.
const DIRECT_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const PROXY_API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;
const API_KEY = DIRECT_API_KEY || PROXY_API_KEY;
const MAPS_PROXY_URL = DIRECT_API_KEY
  ? "https://maps.googleapis.com"
  : "/api/maps-proxy";

function loadMapScript(): Promise<{ ok: boolean; error?: string }> {
  // Already fully initialized
  if ((window as any)._mapsReady && window.google?.maps?.Map) {
    return Promise.resolve({ ok: true });
  }

  // Already loading — return the existing promise
  if ((window as any)._mapsScriptLoading) return (window as any)._mapsScriptLoading;

  (window as any)._mapsScriptLoading = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    // Detect ApiNotActivatedMapError from Google's own error reporting
    const origConsoleError = console.error;
    const errorListener = (...args: any[]) => {
      const msg = args.join(" ");
      if (msg.includes("ApiNotActivatedMapError") || msg.includes("api-not-activated")) {
        (window as any)._mapsLoadError = "Maps JavaScript API is not enabled for this key. Please enable it in Google Cloud Console.";
      }
      origConsoleError(...args);
    };
    console.error = errorListener;

    // Set up the callback that Google Maps will call when fully ready
    (window as any).initGoogleMapsCallback = () => {
      console.error = origConsoleError;
      if ((window as any)._mapsLoadError) {
        resolve({ ok: false, error: (window as any)._mapsLoadError });
      } else {
        (window as any)._mapsReady = true;
        resolve({ ok: true });
      }
    };

    const script = document.createElement("script");
    script.src = `${MAPS_PROXY_URL}/maps/api/js?key=${API_KEY}&v=weekly&libraries=marker,places,geocoding,geometry&callback=initGoogleMapsCallback`;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      console.error = origConsoleError;
      resolve({ ok: false, error: "Failed to load Google Maps script. Check your API key and network connection." });
    };

    // Timeout fallback — if callback never fires, check for error
    setTimeout(() => {
      if (!(window as any)._mapsReady) {
        console.error = origConsoleError;
        resolve({
          ok: false,
          error: (window as any)._mapsLoadError ||
            "Google Maps failed to initialize. The Maps JavaScript API may not be enabled for this key.",
        });
      }
    }, 8000);

    document.head.appendChild(script);
  });

  return (window as any)._mapsScriptLoading;
}

interface MapViewProps {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  onMapReady?: (map: google.maps.Map) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.7749, lng: -122.4194 },
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [mapError, setMapError] = React.useState<string | null>(null);

  const init = usePersistFn(async () => {
    const result = await loadMapScript();
    if (!result.ok) {
      setMapError(result.error ?? "Google Maps failed to load.");
      return;
    }
    if (!mapContainer.current) {
      setMapError("Map container not found.");
      return;
    }
    // Guard: make sure the Maps API actually loaded
    if (!window.google?.maps?.Map) {
      setMapError("Google Maps API is not available. The Maps JavaScript API may not be enabled for this key.");
      return;
    }
    try {
      map.current = new window.google.maps.Map(mapContainer.current, {
        zoom: initialZoom,
        center: initialCenter,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        streetViewControl: true,
        mapId: "DEMO_MAP_ID",
      });
      if (onMapReady) {
        onMapReady(map.current);
      }
    } catch (err: any) {
      setMapError(err?.message ?? "Failed to initialize Google Maps.");
    }
  });

  useEffect(() => {
    init();
  }, [init]);

  if (mapError) {
    return (
      <div className={cn("w-full h-[500px] flex flex-col items-center justify-center bg-slate-900/60 rounded-lg border border-slate-700 text-center px-6", className)}>
        <div className="text-4xl mb-3">🗺️</div>
        <p className="text-slate-300 font-semibold text-base mb-1">Map unavailable</p>
        <p className="text-slate-500 text-sm max-w-sm">{mapError}</p>
        <p className="text-slate-600 text-xs mt-3">Enable the <strong className="text-slate-400">Maps JavaScript API</strong> in Google Cloud Console for your API key, then reload the page.</p>
      </div>
    );
  }

  return (
    <div ref={mapContainer} className={cn("w-full h-[500px]", className)} />
  );
}
