import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, Phone, MapPin, User, Plus, Search, ChevronRight,
  Star, AlertTriangle, Clock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

export default function Facilities() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: facilities, isLoading } = trpc.crm.facilities.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
  });

  return (
    <div className="p-6 space-y-6">
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
        <Button
          onClick={() => navigate("/crm/facilities/new")}
          className="gap-2"
          style={{ background: "var(--gold)", color: "#0a0f1e" }}
        >
          <Plus className="w-4 h-4" />
          Add Facility
        </Button>
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

      {/* Facilities Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : facilities?.length === 0 ? (
        <div className="text-center py-20">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <p className="text-muted-foreground text-lg">No facilities found</p>
          <p className="text-muted-foreground text-sm mt-1">Add your first facility partner to get started</p>
          <Button
            className="mt-4 gap-2"
            onClick={() => navigate("/crm/facilities/new")}
            style={{ background: "var(--gold)", color: "#0a0f1e" }}
          >
            <Plus className="w-4 h-4" /> Add Facility
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {facilities?.map((facility) => {
            const status = STATUS_LABELS[facility.relationshipStatus] ?? STATUS_LABELS.warm_lead;
            const lastContactDate = facility.lastContact?.contactDate
              ? new Date(facility.lastContact.contactDate)
              : null;
            return (
              <Card
                key={facility.id}
                className="bg-card border-border hover:border-[var(--gold)]/40 transition-all cursor-pointer group"
                onClick={() => navigate(`/crm/facilities/${facility.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {facility.managementFlag === 1 && (
                          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        )}
                        <h3 className="font-semibold text-foreground truncate group-hover:text-[var(--gold)] transition-colors">
                          {facility.name}
                        </h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[facility.category] ?? facility.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <Badge className={`text-xs border ${status.color} flex-shrink-0`}>
                        {status.label}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-[var(--gold)] transition-colors" />
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {facility.city && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{facility.city}</span>
                      </div>
                    )}
                    {facility.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span>{facility.phone}</span>
                      </div>
                    )}
                    {facility.contactName && (
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{facility.contactName}{facility.contactTitle ? ` · ${facility.contactTitle}` : ""}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Star className="w-3 h-3" />
                        <span className="font-medium text-foreground">{facility.totalLeadsSent ?? 0}</span> leads
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {lastContactDate
                        ? formatDistanceToNow(lastContactDate, { addSuffix: true })
                        : "Never contacted"}
                    </div>
                  </div>

                  {facility.assignedRepName && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Rep: <span className="text-foreground">{facility.assignedRepName}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
