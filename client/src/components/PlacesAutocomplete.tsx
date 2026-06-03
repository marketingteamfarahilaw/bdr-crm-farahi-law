import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [debouncedInput, setDebouncedInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const onChangeRef = useRef(onChange);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { onPlaceSelectRef.current = onPlaceSelect; });

  // Server-side autocomplete via tRPC
  const { data: suggestions = [], isFetching } = trpc.leads.autocomplete.useQuery(
    { input: debouncedInput },
    { enabled: debouncedInput.length >= 2, staleTime: 30_000 }
  );

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChangeRef.current(val);
    setActiveIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedInput(val);
      if (val.length >= 2) setShowDropdown(true);
      else setShowDropdown(false);
    }, 250);
  };

  // Geocode the selected place using the Maps proxy
  const handleSelectSuggestion = useCallback(async (suggestion: { description: string; placeId: string }) => {
    onChangeRef.current(suggestion.description);
    setShowDropdown(false);
    setActiveIndex(-1);

    // Use the geocoding API via the maps proxy to get lat/lng
    try {
      const resp = await fetch(
        `/api/maps-proxy/maps/api/geocode/json?place_id=${encodeURIComponent(suggestion.placeId)}`
      );
      const data = await resp.json() as {
        status: string;
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
      };
      if (data.status === "OK" && data.results[0]) {
        const loc = data.results[0].geometry.location;
        onPlaceSelectRef.current({
          description: suggestion.description,
          lat: loc.lat,
          lng: loc.lng,
          placeId: suggestion.placeId,
        });
      }
    } catch (err) {
      console.error("Geocode failed:", err);
    }
  }, []);

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
    setDebouncedInput("");
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
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setShowDropdown(true);
        }}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "text-foreground pl-8",
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
                  e.preventDefault();
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
