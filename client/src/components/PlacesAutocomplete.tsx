/// <reference types="@types/google.maps" />

import { useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";

const API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;
const FORGE_BASE_URL =
  import.meta.env.VITE_FRONTEND_FORGE_API_URL ||
  "https://forge.butterfly-effect.dev";
const MAPS_PROXY_URL = `${FORGE_BASE_URL}/v1/maps/proxy`;

declare global {
  interface Window {
    google?: typeof google;
    _mapsScriptLoading?: Promise<void>;
  }
}

function loadMapsScript(): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve();
  if (window._mapsScriptLoading) return window._mapsScriptLoading;

  window._mapsScriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${MAPS_PROXY_URL}/maps/api/js?key=${API_KEY}&v=weekly&libraries=places,geocoding,geometry,marker&loading=async`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return window._mapsScriptLoading;
}

export interface PlaceResult {
  description: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
}

export function PlacesAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "e.g. Los Angeles, CA",
  className,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const initializedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Keep stable refs to callbacks so the effect never needs to re-run
  const onChangeRef = useRef(onChange);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { onPlaceSelectRef.current = onPlaceSelect; });

  // Initialize ONCE — no dependency on onChange/onPlaceSelect
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    setIsLoading(true);
    loadMapsScript()
      .then(() => {
        if (!inputRef.current) return;

        autocompleteRef.current = new window.google!.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ["geocode"],
            fields: ["formatted_address", "geometry", "place_id", "name"],
          }
        );

        autocompleteRef.current.addListener("place_changed", () => {
          const place = autocompleteRef.current!.getPlace();
          if (!place.geometry?.location) return;

          const description =
            place.formatted_address || place.name || inputRef.current?.value || "";
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const placeId = place.place_id || "";

          // Use refs so we always call the latest callbacks
          onChangeRef.current(description);
          onPlaceSelectRef.current({ description, lat, lng, placeId });
        });

        setIsReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize Places Autocomplete:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => {
      if (autocompleteRef.current) {
        window.google?.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []); // empty deps — runs exactly once per mount

  const handleClear = () => {
    onChangeRef.current("");
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  };

  return (
    <div className="relative">
      <MapPin
        size={14}
        className={cn(
          "absolute left-3 top-1/2 -translate-y-1/2 shrink-0 transition-colors",
          isReady ? "text-primary" : "text-muted-foreground"
        )}
      />
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        placeholder={isLoading ? "Loading maps..." : placeholder}
        disabled={isLoading}
        onChange={(e) => onChangeRef.current(e.target.value)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 text-foreground",
          "pl-8",
          value ? "pr-8" : "",
          className
        )}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
