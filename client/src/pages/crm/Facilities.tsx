import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { canManage } from "@shared/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Phone, MapPin, User, Plus, Search,
  AlertTriangle, Clock, ChevronUp, ChevronDown, Upload, List,
  Receipt, ListChecks, ArrowRight, Merge, Trash2, Map as MapIcon,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/datetime";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { BulkImportDialog } from "./BulkImportDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import FacilitiesMap from "@/components/FacilitiesMap";
import { DeleteFacilitiesDialog, MergeFacilitiesDialog } from "./FacilityMergeDelete";

import { STATUS_LABELS } from "@/lib/crmMeta";
import { RepFace } from "@/components/RepFace";
import { CURRENT_TEAM } from "@shared/team";

// Who is responsible for a partner, and on which team: facilities store the
// name as the rep wrote it ("Lupe" or "Lupe Campos"), so match on first name.
const firstName = (s?: string | null) => String(s ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
const TEAM_OF = new Map<string, { full: string; role: "BDR" | "FR" }>([
  ...CURRENT_TEAM.BDR.map((n) => [firstName(n), { full: n, role: "BDR" as const }] as const),
  ...CURRENT_TEAM.FR.map((n) => [firstName(n), { full: n, role: "FR" as const }] as const),
]);

// A partner's BDR and FR. assignedRepName holds whoever owns it — usually the
// BDR, but some are owned by an FR, and then that FR is the FR Rep unless
// frRepName names another. A name not on today's team (a former rep) stays in
// the BDR column, where it has always been, so it isn't silently hidden.
function repsOf(f: { assignedRepName?: string | null; frRepName?: string | null }) {
  const owner = f.assignedRepName?.trim() ? TEAM_OF.get(firstName(f.assignedRepName)) : undefined;
  const ownerIsFr = owner?.role === "FR";
  const bdr = f.assignedRepName?.trim() && !ownerIsFr ? (owner?.full ?? f.assignedRepName.trim()) : null;
  const frStored = f.frRepName?.trim() ? (TEAM_OF.get(firstName(f.frRepName))?.full ?? f.frRepName.trim()) : null;
  const fr = frStored ?? (ownerIsFr ? owner!.full : null);
  return { bdr, fr };
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function RepCell({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground opacity-40">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 h-5 rounded-full overflow-hidden bg-secondary flex items-center justify-center text-[9px] font-semibold text-foreground shrink-0 [&_img]:w-full [&_img]:h-full [&_img]:object-cover">
        <RepFace name={name} fallback={initials(name)} />
      </span>
      <span className="font-medium text-foreground block max-w-[120px] truncate" title={name}>{name}</span>
    </div>
  );
}

// Green within a week, amber within two, red after that or never.
function DaysAgoCell({ date }: { date: Date | string | null | undefined }) {
  const d = date ? new Date(date) : null;
  if (!d || isNaN(d.getTime())) {
    return <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /><span className="opacity-60">Never</span></div>;
  }
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const dot = days <= 7 ? "bg-emerald-500" : days <= 14 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5" title={d.toLocaleDateString()}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} title={`${days} days ago`} />
      <span>{formatDistanceToNow(d, { addSuffix: true })}</span>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  body_shop: "Body Shop",
  chiropractor: "Chiropractor",
  physical_therapist: "Physical Therapist",
  medical_clinic: "Medical Clinic",
  orthopedic_doctor: "Orthopedic Doctor",
  imaging_center: "Imaging Center",
  other: "Other",
};

type SortKey = "name" | "category" | "relationshipStatus" | "bdrRep" | "frRep" | "lastCall" | "lastVisit" | "totalLeadsSent";
type SortDir = "asc" | "desc";
type ViewMode = "list" | "map";

export default function Facilities() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const { data: facilities, isLoading } = trpc.crm.facilities.list.useQuery({
    search: search || undefined,
    partnerStatus: statusFilter !== "all" ? statusFilter : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });

  // For map view, fetch all facilities with coordinates (no filter)
  const { data: mapFacilities, isLoading: mapLoading } = trpc.crm.map.allFacilities.useQuery(
    undefined,
    { enabled: viewMode === "map" }
  );

  const utils = trpc.useUtils();
  const { user } = useAuth();
  const manager = canManage(user?.role);
  // Ticked facilities by id, with their row: a search or filter change doesn't lose them.
  const [selected, setSelected] = useState<Map<number, any>>(new Map());
  // Merging two, or deleting some, of the ticked facilities (managers only).
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const picked = Array.from(selected.values());
  const afterMergeOrDelete = () => {
    setMerging(false); setDeleting(false); setSelected(new Map());
    utils.crm.facilities.list.invalidate();
    utils.crm.map.allFacilities.invalidate();
  };
  const [bulkRep, setBulkRep] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const bulkUpdate = trpc.crm.facilities.bulkUpdate.useMutation({
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} facilit${r.updated === 1 ? "y" : "ies"}`);
      setSelected(new Map()); setBulkRep(""); setBulkStatus("");
      utils.crm.facilities.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleSelect = (f: any) => setSelected((s) => { const n = new Map(s); n.has(f.id) ? n.delete(f.id) : n.set(f.id, f); return n; });
  const applyBulk = () => {
    if (selected.size === 0 || (!bulkRep && !bulkStatus)) return;
    bulkUpdate.mutate({
      ids: Array.from(selected.keys()),
      ...(bulkStatus ? { partnerStatus: bulkStatus as any } : {}),
      ...(bulkRep ? { assignedRepName: bulkRep } : {}),
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);
  const sorted = [...(facilities ?? [])].sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    if (sortKey === "name") { av = a.name ?? ""; bv = b.name ?? ""; }
    else if (sortKey === "category") { av = CATEGORY_LABELS[a.category] ?? ""; bv = CATEGORY_LABELS[b.category] ?? ""; }
    else if (sortKey === "relationshipStatus") { av = a.partnerStatus ?? ""; bv = b.partnerStatus ?? ""; }
    else if (sortKey === "bdrRep" || sortKey === "frRep") {
      const k = sortKey === "bdrRep" ? "bdr" : "fr";
      av = repsOf(a)[k] ?? ""; bv = repsOf(b)[k] ?? "";
      // Unassigned rows go last either way: sorting by rep is for finding a rep's partners.
      if (!av !== !bv) return av ? -1 : 1;
    }
    else if (sortKey === "totalLeadsSent") { av = a.totalLeadsSent ?? 0; bv = b.totalLeadsSent ?? 0; }
    else if (sortKey === "lastCall") { av = time(a.lastCallDate); bv = time(b.lastCallDate); }
    else if (sortKey === "lastVisit") { av = time(a.lastVisitDate); bv = time(b.lastVisitDate); }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortDir === "asc" ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />
    ) : (
      <ChevronDown size={12} className="inline ml-1 opacity-30" />
    );

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Facility Partners
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {facilities?.length ?? 0} facilities in your network
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-[var(--gold)] text-[var(--gold-foreground)]"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                viewMode === "map"
                  ? "bg-[var(--gold)] text-[var(--gold-foreground)]"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Map
            </button>
          </div>

          {/* Territories lives here now, not in the left menu (Sept 2026). */}
          {manager && (
            <Button variant="outline" onClick={() => navigate("/territories")} className="gap-2 border-border text-muted-foreground hover:text-foreground">
              <MapIcon className="w-4 h-4" />
              Territories
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowBulkImport(true)}
            className="gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </Button>
          <LogFrVisitGlobal facilities={facilities ?? []} />
          <Button
            onClick={() => navigate("/crm/facilities/new")}
            className="gap-2"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
          >
            <Plus className="w-4 h-4" />
            Add Facility
          </Button>
        </div>
      </div>

      {/* Filters — shown in both views */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search facilities, contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions bar */}
      {viewMode === "list" && selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-[170px] h-8 bg-card border-border text-xs"><SelectValue placeholder="Set status…" /></SelectTrigger>
            <SelectContent>{Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={bulkRep} onValueChange={setBulkRep}>
            <SelectTrigger className="w-[160px] h-8 bg-card border-border text-xs"><SelectValue placeholder="Reassign rep…" /></SelectTrigger>
            <SelectContent>{Array.from(new Set((facilities ?? []).map((f) => f.assignedRepName).filter(Boolean))).sort().map((r) => <SelectItem key={r as string} value={r as string}>{r as string}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={applyBulk} disabled={bulkUpdate.isPending || (!bulkRep && !bulkStatus)} style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}>
            {bulkUpdate.isPending ? "Applying…" : "Apply"}
          </Button>
          {manager && (
            <>
              <span className="h-5 w-px bg-border" aria-hidden />
              <Button size="sm" variant="outline" className="gap-1.5 border-border" disabled={selected.size !== 2} title={selected.size === 2 ? "Merge these two facilities" : "Tick exactly two facilities to merge them"} onClick={() => picked.length === 2 && setMerging(true)}>
                <Merge className="w-3.5 h-3.5" /> Merge
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 border-border text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => setDeleting(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>Clear</Button>
        </div>
      )}

      {/* ── MAP VIEW ─────────────────────────────────────────────────────────── */}
      {viewMode === "map" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {mapLoading ? (
            <div className="h-[600px] flex items-center justify-center bg-card">
              <div className="text-center">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2 animate-pulse" />
                <p className="text-sm text-muted-foreground">Loading map...</p>
              </div>
            </div>
          ) : (
            <FacilitiesMap
              facilities={mapFacilities ?? []}
              onFacilityClick={(id) => navigate(`/crm/facilities/${id}`)}
              className="h-[600px]"
            />
          )}
        </div>
      )}

      {/* ── LIST VIEW ────────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-20">
              <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
              <p className="text-muted-foreground text-lg">No facilities found</p>
              <p className="text-muted-foreground text-sm mt-1">Add your first facility partner or bulk import from a CSV</p>
              <div className="flex items-center gap-3 justify-center mt-4">
                <Button
                  variant="outline"
                  className="gap-2 border-border"
                  onClick={() => setShowBulkImport(true)}
                >
                  <Upload className="w-4 h-4" /> Bulk Import
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => navigate("/crm/facilities/new")}
                  style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
                >
                  <Plus className="w-4 h-4" /> Add Facility
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              {/* Each column as wide as its content (w-px on the headers), so the
                  spare width sits after Last Visit instead of between columns. */}
              <Table className="[&_td]:whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-card hover:bg-card border-border">
                    <TableHead className="w-10">
                      <input type="checkbox" className="accent-[var(--gold)] cursor-pointer"
                        checked={sorted.length > 0 && sorted.every((f) => selected.has(f.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Map(sorted.map((f) => [f.id, f] as [number, any])) : new Map())} />
                    </TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("name")}
                    >
                      Facility <SortIcon col="name" />
                    </TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("bdrRep")}
                    >
                      BDR Rep <SortIcon col="bdrRep" />
                    </TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("frRep")}
                    >
                      FR Rep <SortIcon col="frRep" />
                    </TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("category")}
                    >
                      Category <SortIcon col="category" />
                    </TableHead>
                    <TableHead className="w-px whitespace-nowrap pr-2 text-muted-foreground text-xs">Contact</TableHead>
                    <TableHead className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs">Location</TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("relationshipStatus")}
                    >
                      Status <SortIcon col="relationshipStatus" />
                    </TableHead>
                    <TableHead className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs text-right" title="Referrals sent to / received from this partner">Sent / Recv</TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("lastCall")}
                      title="Most recent logged call"
                    >
                      Last Call <SortIcon col="lastCall" />
                    </TableHead>
                    <TableHead
                      className="w-px whitespace-nowrap pr-5 text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("lastVisit")}
                      title="Most recent in-person visit (field visits and visit logs)"
                    >
                      Last Visit <SortIcon col="lastVisit" />
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((facility) => {
                    const status = STATUS_LABELS[facility.partnerStatus] ?? STATUS_LABELS.prospect;
                    const reps = repsOf(facility);
                    return (
                      <TableRow
                        key={facility.id}
                        className="border-border hover:bg-card/60 cursor-pointer transition-colors"
                        onClick={() => navigate(`/crm/facilities/${facility.id}`)}
                      >
                        <TableCell className="py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="accent-[var(--gold)] cursor-pointer"
                            checked={selected.has(facility.id)} onChange={() => toggleSelect(facility)} />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex items-center gap-2">
                            {facility.managementFlag === 1 && (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-foreground text-sm block max-w-[240px] truncate" title={facility.name}>{facility.name}</span>
                          </div>
                          {facility.phone && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                              <Phone className="w-3 h-3" />
                              <span>{facility.phone}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs"><RepCell name={reps.bdr} /></TableCell>
                        <TableCell className="py-1.5 text-xs"><RepCell name={reps.fr} /></TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {CATEGORY_LABELS[facility.category] ?? facility.category}
                        </TableCell>
                        <TableCell className="py-1.5 pr-2 text-xs text-muted-foreground">
                          {facility.contactName ? (
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3 flex-shrink-0" />
                              <span className="block max-w-[96px] truncate" title={facility.contactName}>{facility.contactName}</span>
                            </div>
                          ) : (
                            <span className="opacity-40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {facility.city ? (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              <span className="whitespace-nowrap">{facility.city}</span>
                            </div>
                          ) : (
                            <span className="opacity-40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Badge className={`text-xs border ${status.color}`}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-right">
                          <span className="font-medium text-foreground">{(facility as any).referralsSent ?? 0}</span>
                          <span className="text-muted-foreground"> / {(facility as any).referralsReceived ?? 0}</span>
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground"><DaysAgoCell date={facility.lastCallDate} /></TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground"><DaysAgoCell date={facility.lastVisitDate} /></TableCell>
                        <TableCell className="py-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            {facility.phone && <ClickToCallButton phoneNumber={facility.phone} facilityId={facility.id} />}
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Tasks" onClick={() => navigate(`/crm/facilities/${facility.id}?tab=tasks`)}><ListChecks className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Expenses" onClick={() => navigate(`/crm/facilities/${facility.id}?tab=expenses`)}><Receipt className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Open profile" onClick={() => navigate(`/crm/facilities/${facility.id}`)}><ArrowRight className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <BulkImportDialog open={showBulkImport} onClose={() => setShowBulkImport(false)} />
      <MergeFacilitiesDialog pair={merging && picked.length === 2 ? [picked[0], picked[1]] : null} onClose={() => setMerging(false)} onDone={afterMergeOrDelete} />
      <DeleteFacilitiesDialog list={deleting && picked.length ? picked : null} onClose={() => setDeleting(false)} onDone={afterMergeOrDelete} />
    </div>
  );
}

// ── Rupert's FR VISIT form: global "Log FR Visit" with facility picker ─────────
// Choose BDR/FR facility → pick the facility (search) → type auto-fills →
// date + FR who visited. Saves a visit-type contact log credited to the FR, so
// it feeds the Check-In Report's FR section and the Daily Log.
const FR_VISITORS = ["Lupe", "Jezel", "Zulema", "Marisol"];
function LogFrVisitGlobal({ facilities }: { facilities: any[] }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("all");         // bdr | fr | all
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<any | null>(null);
  const [frName, setFrName] = useState(FR_VISITORS[0]);
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const createLog = trpc.crm.contactLogs.create.useMutation({
    onSuccess: () => {
      toast.success("FR visit logged — it will show in the Check-In Report");
      utils.crm.facilities.list.invalidate();
      setOpen(false); setPicked(null); setQ(""); setNotes("");
    },
    onError: (e) => toast.error(e.message),
  });
  const visitor = frName === "__other__" ? custom.trim() : frName;
  const pool = facilities.filter((f) => kind === "all" || (f as any).managedBy === kind);
  const results = q.length >= 2 ? pool.filter((f) => f.name?.toLowerCase().includes(q.toLowerCase())).slice(0, 10) : [];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-border">
          <MapPin className="w-4 h-4" /> Log FR Visit
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader><DialogTitle>Log FR Visit</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Facility type</label>
            <Select value={kind} onValueChange={(v) => { setKind(v); setPicked(null); }}>
              <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All facilities</SelectItem>
                <SelectItem value="bdr">BDR facility</SelectItem>
                <SelectItem value="fr">FR facility</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name of facility</label>
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{picked.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Type: {CATEGORY_LABELS[picked.category] ?? picked.category}{picked.city ? ` · ${picked.city}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>change</Button>
              </div>
            ) : (
              <>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search facility…" className="bg-background border-border" />
                {results.length > 0 && (
                  <div className="mt-1 border border-border rounded-lg max-h-44 overflow-y-auto">
                    {results.map((f) => (
                      <button key={f.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setPicked(f)}>
                        {f.name} <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[f.category] ?? f.category}{f.city ? ` · ${f.city}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Who visited (FR)</label>
              <Select value={frName} onValueChange={setFrName}>
                <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FR_VISITORS.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  <SelectItem value="__other__">Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Date of visit</label>
              <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="bg-background border-border" />
            </div>
          </div>
          {frName === "__other__" && (
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Who visited?" className="bg-background border-border" />
          )}
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened at the visit? (optional)" className="bg-background border-border" />
          <Button
            className="w-full"
            style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
            disabled={createLog.isPending || !picked || !visitor}
            onClick={() => createLog.mutate({
              facilityId: picked.id,
              contactType: "visit",
              contactDate: new Date(`${date}T12:00:00`).toISOString(),
              summary: notes || `FR visit by ${visitor}`,
              repName: visitor,
            })}
          >
            {createLog.isPending ? "Saving…" : "Log Visit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
