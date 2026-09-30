/// <reference types="@types/google.maps" />
/**
 * FR Field Time's "Today" section (server/timeero.ts getFieldToday): who is
 * clocked in right now and where each Field Rep clocked in / out today, next to
 * today's shifts. The pins are the points Timeero recorded at clock-in and
 * clock-out — not live GPS — and the page says so. Refreshes every minute.
 * Reuses MapView (the same Maps loader and proxy as the Facilities map).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Building2, Loader2, MapPin, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MapView } from "@/components/Map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const REFRESH_MS = 60_000;
const OPEN_COLOR = "#16a34a";   // clocked in: filled and pulsing
const CLOSED_COLOR = "#9ca3af"; // clocked out: grey

const hm = (sec: number) => `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
// Timeero writes the rep's wall-clock time with no zone; read it as written.
const clock = (t: string | null) => (t ? new Date(t.slice(0, 19)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");
const short = (a: string | null) => (a ? a.replace(/, United States of America$/, "").replace(/, CA \d{5}$/, "") : null);
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

type Near = { id: number; name: string; meters: number } | null;

/** "At <partner>" inside the report's ~150 m, "<m> from <partner>" up to 1 km, else the address. */
function placeText(partner: Near, address: string | null, nearMeters: number) {
  if (partner && partner.meters <= nearMeters) return `at ${partner.name}`;
  const addr = short(address);
  if (partner) return `${addr ? `${addr} · ` : ""}${partner.meters} m from ${partner.name}`;
  return addr ?? "no address recorded";
}

function pinElement(label: string, open: boolean): HTMLElement {
  const color = open ? OPEN_COLOR : CLOSED_COLOR;
  const wrap = document.createElement("div");
  wrap.className = "relative flex items-center justify-center cursor-pointer";
  wrap.style.width = "34px";
  wrap.style.height = "34px";
  if (open) {
    const ring = document.createElement("span");
    ring.className = "absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping";
    ring.style.background = color;
    wrap.appendChild(ring);
  }
  const dot = document.createElement("span");
  dot.className = "relative inline-flex items-center justify-center rounded-full text-[11px] font-bold text-white";
  dot.style.cssText = `width:30px;height:30px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);`;
  dot.textContent = label;
  wrap.appendChild(dot);
  return wrap;
}

/** Built with textContent: names and addresses come from Timeero, never as HTML. */
function popupElement(lines: Array<[string, string, boolean?]>): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = "font-family:Inter,system-ui,sans-serif;color:#111827;min-width:200px;max-width:260px;font-size:12px;line-height:1.4;";
  for (const [text, style, bold] of lines) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = style + (bold ? "font-weight:600;" : "");
    box.appendChild(el);
  }
  return box;
}

export default function FieldTodayMap() {
  const { data, isLoading, isFetching, isError } = trpc.teamReports.fieldToday.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: (p) => p,
  });
  // Ticks "hours so far" between refreshes without another request.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), REFRESH_MS); return () => clearInterval(id); }, []);
  useEffect(() => { if (data) setNow(Date.now()); }, [data]);

  const nearMeters = data?.nearMeters ?? 150;
  const shifts = useMemo(() => data?.shifts ?? [], [data]);
  const secondsAt = (s: (typeof shifts)[number], t: number) =>
    s.open && s.clockInAt ? Math.max(0, Math.round((t - new Date(s.clockInAt).getTime()) / 1000)) : s.seconds;

  // One pin per rep: where they clocked in if still clocked in, otherwise where
  // their latest shift clocked out (or in, when no clock-out point was sent).
  const pins = useMemo(() => {
    const byRep = new Map<string, (typeof shifts)[number]>();
    for (const s of shifts) {
      const cur = byRep.get(s.rep);
      if (!cur || (s.open && !cur.open) || (s.open === cur.open && s.clockIn > cur.clockIn)) byRep.set(s.rep, s);
    }
    return Array.from(byRep.values()).flatMap((s) => {
      const at = s.open ? s.inPoint : s.outPoint ?? s.inPoint;
      return at ? [{ shift: s, at, fromOut: !s.open && !!s.outPoint }] : [];
    });
  }, [shifts]);

  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const fittedRef = useRef("");

  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    // A refresh redraws every pin; a popup left open would float unanchored.
    infoRef.current?.close();
    markersRef.current.forEach((m) => { m.map = null; });
    markersRef.current = [];
    const bounds = new window.google.maps.LatLngBounds();
    for (const p of pins) {
      const s = p.shift;
      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map, position: p.at, title: `${s.rep} — ${s.open ? "clocked in" : "clocked out"}`, content: pinElement(initials(s.rep), s.open),
        zIndex: s.open ? 2 : 1,
      });
      marker.addListener("click", () => {
        infoRef.current?.close();
        const lines: Array<[string, string, boolean?]> = [
          [s.rep, "font-size:13px;", true],
          [s.open ? "Still clocked in" : `Clocked out ${clock(s.clockOut)}`, `color:${s.open ? OPEN_COLOR : "#6b7280"};margin-bottom:4px;`, true],
          [`Clocked in ${clock(s.clockIn)}${s.day !== data?.today ? " (yesterday)" : ""}`, ""],
          [placeText(s.inPartner, s.inAddress, nearMeters), "color:#4b5563;margin-bottom:4px;"],
        ];
        if (!s.open) lines.push([`Clocked out ${placeText(s.outPartner, s.outAddress, nearMeters)}`, "color:#4b5563;margin-bottom:4px;"]);
        lines.push([`${s.open ? "Hours so far" : "Hours worked"}: ${hm(secondsAt(s, Date.now()))}`, "", true]);
        lines.push([p.fromOut ? "Pin: where they clocked out, not live GPS" : "Pin: where they clocked in, not live GPS", "color:#9ca3af;font-size:11px;margin-top:4px;"]);
        const iw = new window.google.maps.InfoWindow({ content: popupElement(lines), ariaLabel: s.rep });
        iw.open({ map, anchor: marker });
        infoRef.current = iw;
      });
      markersRef.current.push(marker);
      bounds.extend(p.at);
    }
    // Re-fit only when the set of pins changes, so a refresh doesn't undo the
    // manager's zoom every minute.
    const key = pins.map((p) => `${p.shift.id}:${p.at.lat},${p.at.lng}`).sort().join("|");
    if (key && key !== fittedRef.current) {
      fittedRef.current = key;
      if (pins.length === 1) { map.setCenter(pins[0].at); map.setZoom(13); }
      else map.fitBounds(bounds, 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, nearMeters, data?.today]);

  useEffect(() => { draw(); }, [draw]);
  const onReady = useCallback((map: google.maps.Map) => { mapRef.current = map; draw(); }, [draw]);

  const clockedIn = shifts.filter((s) => s.open);
  const reps = new Set(shifts.map((s) => s.rep)).size;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Radio className="w-4 h-4" /> Today
          <span className="text-xs font-normal text-muted-foreground">
            · {clockedIn.length} clocked in now · {shifts.length} shift{shifts.length === 1 ? "" : "s"} by {reps} rep{reps === 1 ? "" : "s"} · updates every minute
          </span>
          {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Pins show where each rep clocked in (still clocked in) or clocked out, as Timeero recorded it — not live GPS.</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3">
          <div className="relative">
            <MapView className="h-[280px] rounded-lg" initialCenter={{ lat: 34.0522, lng: -118.2437 }} initialZoom={9} onMapReady={onReady} />
            <div className="absolute bottom-2 left-2 z-10 flex gap-3 rounded-md bg-background/90 border border-border px-2 py-1 text-[11px] text-foreground">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: OPEN_COLOR }} /> Clocked in</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: CLOSED_COLOR }} /> Clocked out</span>
            </div>
            {!isLoading && !pins.length && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 text-sm text-muted-foreground pointer-events-none">
                {isError ? "Couldn't load today's shifts." : shifts.length ? "Today's shifts have no clock-in location." : "No one has clocked in today."}
              </div>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {!shifts.length ? (
              <p className="p-3 text-sm text-muted-foreground">{isLoading ? "Loading…" : "No shifts yet today."}</p>
            ) : shifts.map((s) => (
              <div key={s.id} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground inline-flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${s.open ? "animate-pulse" : ""}`} style={{ background: s.open ? OPEN_COLOR : CLOSED_COLOR }} />
                    {s.rep}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {clock(s.clockIn)} – {s.open ? <span className="font-medium text-emerald-600 dark:text-emerald-400">still in</span> : clock(s.clockOut)} · <span className="font-semibold text-foreground">{hm(secondsAt(s, now))}</span>
                  </span>
                </div>
                <div className="mt-0.5 text-muted-foreground truncate" title={s.inAddress ?? undefined}>
                  {s.inPartner && s.inPartner.meters <= nearMeters ? (
                    <Link href={`/crm/facilities/${s.inPartner.id}`} className="inline-flex items-center gap-1 text-foreground hover:text-primary"><Building2 className="w-3 h-3 shrink-0" />{s.inPartner.name}</Link>
                  ) : (
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{placeText(s.inPartner, s.inAddress, nearMeters)}</span>
                  )}
                  {s.day !== data?.today && <span className="ml-1 text-amber-600 dark:text-amber-400">· clocked in yesterday</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
