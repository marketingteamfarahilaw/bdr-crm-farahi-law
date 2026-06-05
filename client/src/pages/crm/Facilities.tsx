import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
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
  AlertTriangle, Clock, ChevronUp, ChevronDown, Upload, List, Map,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { BulkImportDialog } from "./BulkImportDialog";
import FacilitiesMap from "@/components/FacilitiesMap";

import { STATUS_LABELS } from "@/lib/crmMeta";

const CATEGORY_LABELS: Record<string, string> = {
  body_shop: "Body Shop",
  chiropractor: "Chiropractor",
  physical_therapist: "Physical Therapist",
  medical_clinic: "Medical Clinic",
  orthopedic_doctor: "Orthopedic Doctor",
  imaging_center: "Imaging Center",
  other: "Other",
};

type SortKey = "name" | "category" | "relationshipStatus" | "assignedRepName" | "lastContact" | "totalLeadsSent";
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRep, setBulkRep] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const bulkUpdate = trpc.crm.facilities.bulkUpdate.useMutation({
    onSuccess: (r) => {
      toast.success(`Updated ${r.updated} facilit${r.updated === 1 ? "y" : "ies"}`);
      setSelected(new Set()); setBulkRep(""); setBulkStatus("");
      utils.crm.facilities.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleSelect = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const applyBulk = () => {
    if (selected.size === 0 || (!bulkRep && !bulkStatus)) return;
    bulkUpdate.mutate({
      ids: Array.from(selected),
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

  const sorted = [...(facilities ?? [])].sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    if (sortKey === "name") { av = a.name ?? ""; bv = b.name ?? ""; }
    else if (sortKey === "category") { av = CATEGORY_LABELS[a.category] ?? ""; bv = CATEGORY_LABELS[b.category] ?? ""; }
    else if (sortKey === "relationshipStatus") { av = a.partnerStatus ?? ""; bv = b.partnerStatus ?? ""; }
    else if (sortKey === "assignedRepName") { av = a.assignedRepName ?? ""; bv = b.assignedRepName ?? ""; }
    else if (sortKey === "totalLeadsSent") { av = a.totalLeadsSent ?? 0; bv = b.totalLeadsSent ?? 0; }
    else if (sortKey === "lastContact") {
      av = a.lastContact?.contactDate ? new Date(a.lastContact.contactDate).getTime() : 0;
      bv = b.lastContact?.contactDate ? new Date(b.lastContact.contactDate).getTime() : 0;
    }
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
              <Map className="w-3.5 h-3.5" />
              Map
            </button>
          </div>

          <Button
            variant="outline"
            onClick={() => setShowBulkImport(true)}
            className="gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </Button>
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
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
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
              <Table>
                <TableHeader>
                  <TableRow className="bg-card hover:bg-card border-border">
                    <TableHead className="w-10">
                      <input type="checkbox" className="accent-[var(--gold)] cursor-pointer"
                        checked={sorted.length > 0 && sorted.every((f) => selected.has(f.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(sorted.map((f) => f.id)) : new Set())} />
                    </TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("name")}
                    >
                      Facility <SortIcon col="name" />
                    </TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("category")}
                    >
                      Category <SortIcon col="category" />
                    </TableHead>
                    <TableHead className="text-muted-foreground text-xs">Contact</TableHead>
                    <TableHead className="text-muted-foreground text-xs">Location</TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("relationshipStatus")}
                    >
                      Status <SortIcon col="relationshipStatus" />
                    </TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("assignedRepName")}
                    >
                      BD Rep <SortIcon col="assignedRepName" />
                    </TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground text-right"
                      onClick={() => handleSort("totalLeadsSent")}
                    >
                      Leads <SortIcon col="totalLeadsSent" />
                    </TableHead>
                    <TableHead
                      className="text-muted-foreground text-xs cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort("lastContact")}
                    >
                      Last Contact <SortIcon col="lastContact" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((facility) => {
                    const status = STATUS_LABELS[facility.partnerStatus] ?? STATUS_LABELS.prospect;
                    const lastContactDate = facility.lastContact?.contactDate
                      ? new Date(facility.lastContact.contactDate)
                      : null;
                    return (
                      <TableRow
                        key={facility.id}
                        className="border-border hover:bg-card/60 cursor-pointer transition-colors"
                        onClick={() => navigate(`/crm/facilities/${facility.id}`)}
                      >
                        <TableCell className="py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="accent-[var(--gold)] cursor-pointer"
                            checked={selected.has(facility.id)} onChange={() => toggleSelect(facility.id)} />
                        </TableCell>
                        <TableCell className="py-1.5">
                          <div className="flex items-center gap-2">
                            {facility.managementFlag === 1 && (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-foreground text-sm">{facility.name}</span>
                          </div>
                          {facility.phone && (
                            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                              <Phone className="w-3 h-3" />
                              <span>{facility.phone}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {CATEGORY_LABELS[facility.category] ?? facility.category}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {facility.contactName ? (
                            <div className="flex items-center gap-1">
                              <User className="w-3 h-3 flex-shrink-0" />
                              <span>{facility.contactName}</span>
                            </div>
                          ) : (
                            <span className="opacity-40">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {facility.city ? (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              <span>{facility.city}</span>
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
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {facility.assignedRepName ?? <span className="opacity-40">—</span>}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-right font-medium text-foreground">
                          {facility.totalLeadsSent ?? 0}
                        </TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                          {lastContactDate ? (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 flex-shrink-0" />
                              <span>{formatDistanceToNow(lastContactDate, { addSuffix: true })}</span>
                            </div>
                          ) : (
                            <span className="opacity-40">Never</span>
                          )}
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
    </div>
  );
}
