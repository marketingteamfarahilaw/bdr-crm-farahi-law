/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { loadMapScript } from "@/components/Map";

/**
 * Address field with Google Places autocomplete. The agent types an address and
 * picks from live suggestions. Uses the Places AutocompleteService (data API) +
 * a themed dropdown rendered inline (so it works inside modals/dialogs).
 * Degrades to a plain text input if the Places API isn't available.
 */
export function AddressAutocompleteInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [preds, setPreds] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const svcRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMapScript().then((r) => {
      if (cancelled || !r.ok) return;
      if (window.google?.maps?.places?.AutocompleteService) {
        svcRef.current = new window.google.maps.places.AutocompleteService();
      }
    });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fetchPreds = (input: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!svcRef.current || input.trim().length < 3) {
      setPreds([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      svcRef.current!.getPlacePredictions(
        { input, types: ["geocode"], componentRestrictions: { country: "us" } },
        (res, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && res && res.length) {
            setPreds(res);
            setOpen(true);
          } else {
            setPreds([]);
            setOpen(false);
          }
        },
      );
    }, 300);
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); fetchPreds(e.target.value); }}
        onFocus={() => { if (preds.length) setOpen(true); }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && preds.length > 0 && (
        <div className="absolute z-[70] mt-1 w-full rounded-lg border border-border bg-popover text-popover-foreground shadow-lg max-h-56 overflow-y-auto">
          {preds.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(p.description); setPreds([]); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <span className="leading-snug">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
