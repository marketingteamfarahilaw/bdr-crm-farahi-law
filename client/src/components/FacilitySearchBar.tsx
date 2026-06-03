import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Building2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  body_shop: "Body Shop",
  chiropractor: "Chiropractor",
  physical_therapist: "Physical Therapist",
  medical_clinic: "Medical Clinic",
  orthopedic_doctor: "Orthopedic Doctor",
  imaging_center: "Imaging Center",
  other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  active_partner: "text-emerald-500",
  warm_lead: "text-amber-500",
  cold: "text-blue-400",
  churned: "text-red-400",
  do_not_contact: "text-red-600",
  needs_agent: "text-purple-400",
};

export function FacilitySearchBar({ isCollapsed }: { isCollapsed: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 250);

  const { data: results, isFetching } = trpc.crm.facilities.quickSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );

  useEffect(() => {
    if (debouncedQuery.length >= 2) setOpen(true);
    else setOpen(false);
  }, [debouncedQuery]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (id: number) => {
    setQuery("");
    setOpen(false);
    setLocation(`/crm/facilities/${id}`);
  };

  const handleClear = () => {
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  if (isCollapsed) {
    return (
      <button
        onClick={() => {
          // When collapsed, navigate to facilities page
          setLocation("/crm/facilities");
        }}
        className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-accent transition-colors mx-auto"
        title="Search Facilities"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative px-3 pb-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search facilities..."
          className={cn(
            "w-full h-8 pl-8 pr-7 text-sm rounded-md border border-input bg-background/60",
            "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring",
            "transition-colors"
          )}
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {isFetching && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
          )}
          {!isFetching && results && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No facilities found</div>
          )}
          {!isFetching && results && results.length > 0 && (
            <ul className="py-1 max-h-64 overflow-y-auto">
              {results.map((facility: { id: number; name: string; category: string; city: string; phone: string; relationshipStatus: string }) => (
                <li key={facility.id}>
                  <button
                    onClick={() => handleSelect(facility.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-accent text-left transition-colors"
                  >
                    <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate text-foreground">{facility.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {CATEGORY_LABELS[facility.category] ?? facility.category}
                        {facility.city ? ` · ${facility.city}` : ""}
                      </p>
                    </div>
                    <span className={cn("text-xs shrink-0 mt-0.5", STATUS_COLORS[facility.relationshipStatus] ?? "text-muted-foreground")}>
                      {facility.relationshipStatus?.replace(/_/g, " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
