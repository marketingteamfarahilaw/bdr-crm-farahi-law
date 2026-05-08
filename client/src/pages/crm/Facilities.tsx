import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Phone, MapPin, User, Plus, Search,
  AlertTriangle, Clock, ChevronUp, ChevronDown, Upload,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { BulkImportDialog } from "./BulkImportDialog";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active_partner: { label: "Active Partner", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  warm_lead: { label: "Warm Lead", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  cold: { label: "Cold", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  churned: { label: "Churned", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  do_not_contact: { label: "Do Not Contact", color: "bg-red-900/30 text-red-300 border-red-900/50" },
  needs_agent: { label: "Needs Agent", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

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

export default function Facilities() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showBulkImport, setShowBulkImport] = useState(false);

  const { data: facilities, isLoading } = trpc.crm.facilities.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });

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
    else if (sortKey === "relationshipStatus") { av = a.relationshipStatus ?? ""; bv = b.relationshipStatus ?? ""; }
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
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
          >
            <Plus className="w-4 h-4" />
            Add Facility
          </Button>
        </div>
      </div>

      {/* Filters */}
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

      {/* Table */}
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
              style={{ background: "var(--gold)", color: "#0a0f1e" }}
            >
              <Plus className="w-4 h-4" /> Add Facility
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-card hover:bg-card border-border">
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
                const status = STATUS_LABELS[facility.relationshipStatus] ?? STATUS_LABELS.warm_lead;
                const lastContactDate = facility.lastContact?.contactDate
                  ? new Date(facility.lastContact.contactDate)
                  : null;
                return (
                  <TableRow
                    key={facility.id}
                    className="border-border hover:bg-card/60 cursor-pointer transition-colors"
                    onClick={() => navigate(`/crm/facilities/${facility.id}`)}
                  >
                    <TableCell className="py-3">
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
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[facility.category] ?? facility.category}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {facility.contactName ? (
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 flex-shrink-0" />
                          <span>{facility.contactName}</span>
                        </div>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {facility.city ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span>{facility.city}</span>
                        </div>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge className={`text-xs border ${status.color}`}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {facility.assignedRepName ?? <span className="opacity-40">—</span>}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-right font-medium text-foreground">
                      {facility.totalLeadsSent ?? 0}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
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

      <BulkImportDialog open={showBulkImport} onClose={() => setShowBulkImport(false)} />
    </div>
  );
}
