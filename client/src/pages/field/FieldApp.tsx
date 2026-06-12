/**
 * FIELD MODE — the FR team's phone/tablet experience.
 * Full-screen, thumb-first: bottom tabs, tap-to-call, tap-to-navigate,
 * and 30-second logging of visits, leads, and expenses from the parking lot.
 * Installed via the existing PWA (Add to Home Screen) — no separate app store.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "@/lib/datetime";
import {
  MapPin, Phone, Navigation, Search, CheckCircle2, Plus, Minus,
  ClipboardCheck, UserPlus, Receipt, Building2, Loader2, LocateFixed, ArrowLeft, Scale,
} from "lucide-react";

const CASE_TYPES = ["Auto", "Motorcycle", "Bicycle", "Pedestrian", "Semi/Truck", "Slip and Fall", "Personal Injury", "Other"];
const VALUES = ["High", "Medium", "Low", "Rank X"];

const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const mapsUrl = (f: any) =>
  f.latitude && f.longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${f.latitude},${f.longitude}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([f.address, f.city].filter(Boolean).join(", ") || f.name)}`;

type Tab = "visit" | "facilities" | "lead" | "expense";

export default function FieldApp() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const agentName = (user as any)?.agentName ?? user?.name ?? "";
  const today = format(new Date(), "yyyy-MM-dd");

  const [tab, setTab] = useState<Tab>("visit");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Array<{ id: number; name: string }>>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  const { data: facilities, isLoading: facLoading } = trpc.crm.facilities.list.useQuery(undefined, { retry: false });
  const { data: todayVisits } = trpc.bdr.fieldVisits.list.useQuery({ dateFrom: today, dateTo: today });
  const { data: todayExpenses } = trpc.bdr.frExpenses.list.useQuery({ dateFrom: today, dateTo: today });

  const book = useMemo(() => {
    let list = (facilities ?? []) as any[];
    const s = search.trim().toLowerCase();
    if (s) list = list.filter((f) => `${f.name} ${f.city ?? ""} ${f.category ?? ""}`.toLowerCase().includes(s));
    if (pos) {
      list = [...list].sort((a, b) => {
        const da = a.latitude && a.longitude ? dist(pos, { lat: a.latitude, lng: a.longitude }) : 1e9;
        const db = b.latitude && b.longitude ? dist(pos, { lat: b.latitude, lng: b.longitude }) : 1e9;
        return da - db;
      });
    }
    return list.slice(0, 120);
  }, [facilities, search, pos]);

  const nearMe = () => {
    if (!navigator.geolocation) { toast.error("Location not available on this device."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); toast.success("Sorted by distance from you."); },
      () => toast.error("Could not get your location — check permissions."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const toggle = (f: any) => {
    setSelected((prev) => prev.some((x) => x.id === f.id)
      ? prev.filter((x) => x.id !== f.id)
      : [...prev, { id: f.id, name: f.name }]);
  };
  const isSel = (id: number) => selected.some((x) => x.id === id);

  // ── Visit logging ──
  const [hours, setHours] = useState("");
  const [visitNotes, setVisitNotes] = useState("");
  const createVisit = trpc.bdr.fieldVisits.create.useMutation({
    onSuccess: () => {
      toast.success(`Visit logged — ${selected.length} facilit${selected.length === 1 ? "y" : "ies"} ✓`);
      setSelected([]); setHours(""); setVisitNotes("");
      utils.bdr.fieldVisits.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Lead capture ──
  const [lFirst, setLFirst] = useState(""); const [lLast, setLLast] = useState("");
  const [lPhone, setLPhone] = useState(""); const [lFacility, setLFacility] = useState("");
  const [lType, setLType] = useState(""); const [lValue, setLValue] = useState("");
  const [lNotes, setLNotes] = useState("");
  const createLead = trpc.crm.leadIntake.create.useMutation({
    onSuccess: () => {
      toast.success("Lead captured ✓ — it's in the tracker");
      setLFirst(""); setLLast(""); setLPhone(""); setLType(""); setLValue(""); setLNotes("");
      utils.crm.leadIntake.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Expense ──
  const [eAmount, setEAmount] = useState(""); const [eStore, setEStore] = useState("");
  const [eReason, setEReason] = useState(""); const [eCard, setECard] = useState<"Company" | "Personal">("Company");
  const createExpense = trpc.bdr.frExpenses.create.useMutation({
    onSuccess: () => {
      toast.success("Expense logged ✓");
      setEAmount(""); setEStore(""); setEReason("");
      utils.bdr.frExpenses.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const FacilityCard = ({ f, compact = false }: { f: any; compact?: boolean }) => (
    <div className={`rounded-2xl border bg-card p-3.5 ${isSel(f.id) ? "border-primary ring-1 ring-primary/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <button className="text-left min-w-0 flex-1" onClick={() => toggle(f)}>
          <p className="text-[15px] font-semibold text-foreground leading-snug">{f.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {[f.category?.replace(/_/g, " "), f.city].filter(Boolean).join(" · ")}
            {pos && f.latitude && f.longitude ? ` · ${dist(pos, { lat: f.latitude, lng: f.longitude }).toFixed(1)} km` : ""}
          </p>
          {!compact && f.lastContactDate && (
            <p className="text-[11px] text-muted-foreground mt-0.5">Last contact {format(new Date(f.lastContactDate), "MMM d")}</p>
          )}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {f.phone && (
            <a href={`tel:${f.phone}`} className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center" aria-label="Call">
              <Phone className="w-4.5 h-4.5 w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />
            </a>
          )}
          <a href={mapsUrl(f)} target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/25 flex items-center justify-center" aria-label="Navigate">
            <Navigation className="w-[18px] h-[18px] text-sky-600 dark:text-sky-400" />
          </a>
          <button onClick={() => toggle(f)} aria-label="Select"
            className={`w-10 h-10 rounded-xl border flex items-center justify-center ${isSel(f.id) ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground"}`}>
            {isSel(f.id) ? <CheckCircle2 className="w-[18px] h-[18px]" /> : <Plus className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </div>
    </div>
  );

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "visit", label: "Visit", icon: ClipboardCheck },
    { id: "facilities", label: "Facilities", icon: Building2 },
    { id: "lead", label: "Lead", icon: UserPlus },
    { id: "expense", label: "Expense", icon: Receipt },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><Scale className="w-4 h-4 text-primary-foreground" /></div>
          <div>
            <p className="text-sm font-bold text-foreground leading-none">Field Mode</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{agentName} · {format(new Date(), "EEE, MMM d")}</p>
          </div>
        </div>
        <button onClick={() => navigate("/")} className="text-xs text-muted-foreground flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border">
          <ArrowLeft className="w-3.5 h-3.5" /> Full CRM
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 max-w-xl w-full mx-auto space-y-4">
        {tab === "visit" && (
          <>
            {/* selection summary */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground mb-1">Log today's visit</p>
              <p className="text-xs text-muted-foreground">Pick the facilities you visited (Facilities tab or below), set hours, save. {selected.length > 0 && <span className="text-primary font-semibold">{selected.length} selected</span>}</p>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {selected.map((s) => (
                    <button key={s.id} onClick={() => setSelected((p) => p.filter((x) => x.id !== s.id))}
                      className="text-[11px] font-medium rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1 inline-flex items-center gap-1">
                      {s.name} <Minus className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours (e.g. 6.5)" inputMode="decimal" className="bg-card border-border h-11 text-base" />
                <Button className="h-11 text-base gap-2" disabled={selected.length === 0 || createVisit.isPending}
                  onClick={() => createVisit.mutate({
                    visitDate: `${today}T12:00:00`,
                    agentName,
                    facilityCount: selected.length,
                    facilityNames: selected.map((s) => s.name).join(", "),
                    hoursWorked: hours || undefined,
                    notes: visitNotes || undefined,
                  })}>
                  {createVisit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save visit
                </Button>
              </div>
              <Textarea value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} placeholder="Notes (optional)…" rows={2} className="bg-card border-border mt-2.5 text-base" />
            </div>

            {/* quick facility picker */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find facility…" className="pl-9 bg-card border-border h-11 text-base" />
              </div>
              <Button variant="outline" className="h-11 gap-1.5 px-3" onClick={nearMe}><LocateFixed className="w-4 h-4" /> Near me</Button>
            </div>
            {facLoading ? <Skeleton className="h-40 rounded-2xl" /> : (
              <div className="space-y-2">{book.slice(0, 25).map((f) => <FacilityCard key={f.id} f={f} compact />)}</div>
            )}

            {/* today already logged */}
            {(todayVisits ?? []).length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Logged today</p>
                {(todayVisits as any[]).map((v) => (
                  <p key={v.id} className="text-sm text-foreground py-1 border-b border-border/40 last:border-0">
                    <CheckCircle2 className="w-3.5 h-3.5 inline text-emerald-500 mr-1.5" />
                    {v.facilityCount} facilit{v.facilityCount === 1 ? "y" : "ies"}{v.hoursWorked ? ` · ${v.hoursWorked}h` : ""}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "facilities" && (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your facilities…" className="pl-9 bg-card border-border h-11 text-base" />
              </div>
              <Button variant="outline" className="h-11 gap-1.5 px-3" onClick={nearMe}><LocateFixed className="w-4 h-4" /> Near me</Button>
            </div>
            {facLoading ? <Skeleton className="h-60 rounded-2xl" /> : (
              <div className="space-y-2">
                {book.map((f) => <FacilityCard key={f.id} f={f} />)}
                {book.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No facilities found.</p>}
              </div>
            )}
          </>
        )}

        {tab === "lead" && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">Capture a lead on-site</p>
            <div className="grid grid-cols-2 gap-2.5">
              <Input value={lFirst} onChange={(e) => setLFirst(e.target.value)} placeholder="First name *" className="bg-card border-border h-11 text-base" />
              <Input value={lLast} onChange={(e) => setLLast(e.target.value)} placeholder="Last name" className="bg-card border-border h-11 text-base" />
            </div>
            <Input value={lPhone} onChange={(e) => setLPhone(e.target.value)} placeholder="Phone" inputMode="tel" className="bg-card border-border h-11 text-base" />
            <Select value={lFacility || (selected[0]?.name ?? "")} onValueChange={setLFacility}>
              <SelectTrigger className="bg-card border-border h-11 text-base"><SelectValue placeholder="Sourcing facility" /></SelectTrigger>
              <SelectContent>
                {(facilities ?? []).slice(0, 200).map((f: any) => <SelectItem key={f.id} value={f.name}>{f.name}</SelectItem>)}
                <SelectItem value="Independent">Independent (no facility)</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2.5">
              <Select value={lType} onValueChange={setLType}>
                <SelectTrigger className="bg-card border-border h-11 text-base"><SelectValue placeholder="Case type" /></SelectTrigger>
                <SelectContent>{CASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={lValue} onValueChange={setLValue}>
                <SelectTrigger className="bg-card border-border h-11 text-base"><SelectValue placeholder="Value" /></SelectTrigger>
                <SelectContent>{VALUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea value={lNotes} onChange={(e) => setLNotes(e.target.value)} placeholder="What happened? (notes)…" rows={3} className="bg-card border-border text-base" />
            <Button className="w-full h-12 text-base gap-2" disabled={!lFirst.trim() || createLead.isPending}
              onClick={() => createLead.mutate({
                leadName: lFirst.trim(),
                lastName: lLast.trim() || undefined,
                phone: lPhone.trim() || undefined,
                leadDate: new Date().toISOString(),
                role: "FR",
                member: agentName,
                value: lValue || undefined,
                outcome: "Open",
                classification: lType || undefined,
                facility: (lFacility || selected[0]?.name) || undefined,
                notes: lNotes.trim() || undefined,
              })}>
              {createLead.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserPlus className="w-5 h-5" />} Save lead
            </Button>
          </div>
        )}

        {tab === "expense" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Log an expense</p>
              <div className="grid grid-cols-2 gap-2.5">
                <Input value={eAmount} onChange={(e) => setEAmount(e.target.value)} placeholder="Amount $ *" inputMode="decimal" className="bg-card border-border h-11 text-base" />
                <Select value={eCard} onValueChange={(v) => setECard(v as any)}>
                  <SelectTrigger className="bg-card border-border h-11 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Company">Company card</SelectItem><SelectItem value="Personal">Personal card</SelectItem></SelectContent>
                </Select>
              </div>
              <Input value={eStore} onChange={(e) => setEStore(e.target.value)} placeholder="Store / vendor" className="bg-card border-border h-11 text-base" />
              <Input value={eReason} onChange={(e) => setEReason(e.target.value)} placeholder="Reason (lunch drop-off, gas…)" className="bg-card border-border h-11 text-base" />
              <Button className="w-full h-12 text-base gap-2" disabled={!eAmount.trim() || createExpense.isPending}
                onClick={() => createExpense.mutate({
                  expenseDate: `${today}T12:00:00`,
                  agentName,
                  amount: eAmount.trim(),
                  storeName: eStore.trim() || undefined,
                  facilityName: selected[0]?.name || undefined,
                  reason: eReason.trim() || undefined,
                  cardType: eCard,
                })}>
                {createExpense.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Receipt className="w-5 h-5" />} Save expense
              </Button>
            </div>
            {(todayExpenses ?? []).length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Today's expenses</p>
                {(todayExpenses as any[]).map((x) => (
                  <p key={x.id} className="text-sm text-foreground py-1 border-b border-border/40 last:border-0 flex justify-between">
                    <span>{x.storeName || x.reason || "Expense"}</span><span className="font-semibold">${x.amount}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}>
        <div className="max-w-xl mx-auto grid grid-cols-4">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex flex-col items-center gap-1 py-2.5 ${tab === t.id ? "text-primary" : "text-muted-foreground"}`}>
              <t.icon className="w-[22px] h-[22px]" />
              <span className="text-[11px] font-medium">{t.label}</span>
              {t.id === "visit" && selected.length > 0 && (
                <span className="absolute mt-0 ml-7 -translate-y-1 w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{selected.length}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
