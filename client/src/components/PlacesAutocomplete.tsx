/// <reference types="@types/google.maps" />

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Shared Maps loader (mirrors Map.tsx — uses the same window flags) ───────
const DIRECT_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const PROXY_API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY as string | undefined;
const API_KEY = DIRECT_API_KEY || PROXY_API_KEY || "";
const MAPS_BASE_URL = DIRECT_API_KEY
  ? "https://maps.googleapis.com"
  : "/api/maps-proxy";

function loadMapsScript(): Promise<void> {
  if ((window as any)._mapsReady) return Promise.resolve();
  if ((window as any)._mapsScriptLoading) {
    return (window as any)._mapsScriptLoading.then(() => {});
  }

  (window as any)._mapsScriptLoading = new Promise<void>((resolve) => {
    (window as any).initGoogleMapsCallback = () => {
      (window as any)._mapsReady = true;
      resolve();
    };
    const script = document.createElement("script");
    script.src = `${MAPS_BASE_URL}/maps/api/js?key=${API_KEY}&v=weekly&libraries=places,geocoding,geometry,marker&callback=initGoogleMapsCallback`;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  return (window as any)._mapsScriptLoading;
}
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceResult {
  description: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface Suggestion {
  description: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChangeRef = useRef(onChange);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { onPlaceSelectRef.current = onPlaceSelect; });

  // Initialize services once
  useEffect(() => {
    setIsLoading(true);
    loadMapsScript().then(() => {
      if (window.google?.maps?.places?.AutocompleteService) {
        serviceRef.current = new window.google.maps.places.AutocompleteService();
        geocoderRef.current = new window.google.maps.Geocoder();
        sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
      }
      setIsLoading(false);
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSuggestions = useCallback((input: string) => {
    if (!serviceRef.current || input.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    setIsFetching(true);
    serviceRef.current.getPlacePredictions(
      {
        input,
        types: ["geocode"],
        sessionToken: sessionTokenRef.current ?? undefined,
        componentRestrictions: { country: "us" },
      },
      (predictions, status) => {
        setIsFetching(false);
        if (
          status === window.google.maps.places.PlacesServiceStatus.OK &&
          predictions
        ) {
          setSuggestions(
            predictions.map((p) => ({
              description: p.description,
              placeId: p.place_id,
            }))
          );
          setShowDropdown(true);
        } else {
          setSuggestions([]);
          setShowDropdown(false);
        }
      }
    );
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChangeRef.current(val);
    setActiveIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 250);
  };

  const handleSelectSuggestion = async (suggestion: Suggestion) => {
    onChangeRef.current(suggestion.description);
    setSuggestions([]);
    setShowDropdown(false);
    setActiveIndex(-1);

    // Refresh session token after selection
    sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();

    // Geocode to get lat/lng
    if (!geocoderRef.current) return;
    try {
      const result = await geocoderRef.current.geocode({ placeId: suggestion.placeId });
      if (result.results[0]?.geometry?.location) {
        const loc = result.results[0].geometry.location;
        onPlaceSelectRef.current({
          description: suggestion.description,
          lat: loc.lat(),
          lng: loc.lng(),
          placeId: suggestion.placeId,
        });
      }
    } catch (err) {
      console.error("Geocode failed:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    onChangeRef.current("");
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <MapPin
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 shrink-0 text-muted-foreground z-10"
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={isLoading ? "Loading maps..." : placeholder}
        disabled={isLoading}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setShowDropdown(true);
        }}
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
      {/* Right icon: spinner while fetching, X to clear */}
      {isFetching ? (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
        </div>
      ) : value ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={13} />
        </button>
      ) : null}

      {/* Suggestions dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden py-1">
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur before click
                  handleSelectSuggestion(s);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <MapPin size={12} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
