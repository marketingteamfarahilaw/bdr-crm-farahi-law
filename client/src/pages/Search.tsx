import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { LeadDetailSheet } from "@/components/LeadDetailSheet";
import { toast } from "sonner";
import {
  Search,
  Download,
  Bookmark,
  Star,
  Phone,
  Globe,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Save,
} from "lucide-react";
import type { Lead, CategoryValue } from "@/types/lead";
import { CATEGORIES, getCategoryLabel } from "@/types/lead";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import type { PlaceResult } from "@/components/PlacesAutocomplete";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type SortKey = "name" | "qualificationScore" | "rating" | "reviewCount" | "distanceMiles";
type SortDir = "asc" | "desc";
type TierFilter = "all" | "hot" | "warm" | "cold";

export default function SearchPage() {
  const [category, setCategory] = useState<CategoryValue>(() => {
    try {
      const saved = sessionStorage.getItem("rerunSearch");
      if (saved) return (JSON.parse(saved) as { category: CategoryValue }).category;
    } catch {}
    return "body_shop";
  });
  const [location, setLocation] = useState(() => {
    try {
      const saved = sessionStorage.getItem("rerunSearch");
      if (saved) return (JSON.parse(saved) as { location: string }).location;
    } catch {}
    return "";
  });
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(() => {
    try {
      const saved = sessionStorage.getItem("rerunSearch");
      if (saved) {
        const parsed = JSON.parse(saved) as { lat?: number; lng?: number };
        if (parsed.lat && parsed.lng) return { lat: parsed.lat, lng: parsed.lng };
      }
    } catch {}
    return null;
  });
  const [radiusMiles, setRadiusMiles] = useState(() => {
    try {
      const saved = sessionStorage.getItem("rerunSearch");
      if (saved) return (JSON.parse(saved) as { radiusMiles: number }).radiusMiles ?? 10;
    } catch {}
    return 10;
  });
  const [maxResults, setMaxResults] = useState(20);
  const [enabled, setEnabled] = useState(false);
  const [searchKey, setSearchKey] = useState(0);

  const [sortKey, setSortKey] = useState<SortKey>("qualificationScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [nameFilter, setNameFilter] = useState("");

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");

  const utils = trpc.useUtils();

  const { data: leads, isFetching, error } = trpc.leads.search.useQuery(
    { category, location, lat: locationCoords?.lat, lng: locationCoords?.lng, radiusMiles, maxResults },
    {
      enabled: enabled && location.trim().length >= 2 && locationCoords != null,
      staleTime: 5 * 60 * 1000,
      retry: false,
    }
  );

  const saveSearchMutation = trpc.savedSearches.save.useMutation({
    onSuccess: () => {
      toast.success("Search saved!");
      setSaveSearchOpen(false);
      setSaveSearchName("");
      utils.savedSearches.list.invalidate();
    },
    onError: () => toast.error("Failed to save search."),
  });

  const saveLeadMutation = trpc.savedLeads.save.useMutation({
    onSuccess: (data) => {
      if (data.alreadyExisted) toast.info("Already saved.");
      else toast.success("Lead saved!");
      utils.savedLeads.list.invalidate();
    },
    onError: () => toast.error("Failed to save lead."),
  });

  const handleSearch = () => {
    if (!location.trim()) {
      toast.error("Please enter a city or zip code.");
      return;
    }
    if (!locationCoords) {
      toast.error("Please select a location from the dropdown suggestions.");
      return;
    }
    sessionStorage.removeItem("rerunSearch");
    setEnabled(true);
    setSearchKey((k) => k + 1);
    utils.leads.search.invalidate();
  };

  const handlePlaceSelect = (place: PlaceResult) => {
    setLocation(place.description);
    setLocationCoords({ lat: place.lat, lng: place.lng });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    let result = [...leads] as Lead[];
    if (tierFilter !== "all") result = result.filter((l) => l.scoreTier === tierFilter);
    if (nameFilter.trim()) {
      const q = nameFilter.toLowerCase();
      result = result.filter(
        (l) => l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return result;
  }, [leads, tierFilter, nameFilter, sortKey, sortDir]);

  const handleExportCSV = () => {
    if (!filteredLeads.length) return;
    const headers = ["Name", "Category", "Address", "Phone", "Website", "Rating", "Reviews", "Distance (mi)", "Score", "Tier"];
    const rows = filteredLeads.map((l) => [
      `"${l.name.replace(/"/g, '""')}"`,
      getCategoryLabel(l.category),
      `"${(l.address ?? "").replace(/"/g, '""')}"`,
      l.phone ?? "",
      l.website ?? "",
      l.rating ?? "",
      l.reviewCount ?? "",
      l.distanceMiles != null ? l.distanceMiles.toFixed(1) : "",
      l.qualificationScore,
      l.scoreTier,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farahi-leads-${category}-${location}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported!");
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortDir === "asc" ? <ChevronUp size={13} className="inline ml-1" /> : <ChevronDown size={13} className="inline ml-1" />
    ) : (
      <ChevronDown size={13} className="inline ml-1 opacity-30" />
    );

  return (
    <div className="flex flex-col h-full">
      {/* Search Panel */}
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          <Search size={18} className="text-primary" />
          <h1 className="text-lg font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Lead Prospecting
          </h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CategoryValue)}>
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value} className="text-foreground">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">City or Zip Code</Label>
            <PlacesAutocomplete
              value={location}
              onChange={(val) => {
                setLocation(val);
                // Clear coords if user manually edits the text
                setLocationCoords(null);
              }}
              onPlaceSelect={handlePlaceSelect}
              placeholder="e.g. Los Angeles, CA"
              className="bg-background border-border"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Radius (miles)</Label>
            <Select value={String(radiusMiles)} onValueChange={(v) => setRadiusMiles(Number(v))}>
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {[5, 10, 15, 25, 50].map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-foreground">
                    {r} miles
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Results</Label>
            <Select value={String(maxResults)} onValueChange={(v) => setMaxResults(Number(v))}>
              <SelectTrigger className="bg-background border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {[10, 20, 40, 60, 80, 100].map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-foreground">
                    {r} results
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleSearch}
            disabled={isFetching}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-semibold"
          >
            {isFetching ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <Search size={15} />
            )}
            {isFetching ? "Searching..." : "Search"}
          </Button>
        </div>
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Toolbar */}
        {leads && leads.length > 0 && (
          <div className="bg-card border-b border-border px-6 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <SlidersHorizontal size={14} className="text-muted-foreground shrink-0" />
              <Input
                placeholder="Filter by name or address..."
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                className="h-8 text-sm bg-background border-border text-foreground placeholder:text-muted-foreground max-w-xs"
              />
              <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
                <SelectTrigger className="h-8 text-sm bg-background border-border text-foreground w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="all" className="text-foreground">All Tiers</SelectItem>
                  <SelectItem value="hot" className="text-foreground">🔥 Hot</SelectItem>
                  <SelectItem value="warm" className="text-foreground">🌡 Warm</SelectItem>
                  <SelectItem value="cold" className="text-foreground">❄️ Cold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {filteredLeads.length} of {leads.length} leads
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSaveSearchOpen(true)}
                className="h-8 text-xs gap-1.5 border-border text-foreground"
              >
                <Save size={12} />
                Save Search
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportCSV}
                className="h-8 text-xs gap-1.5 border-border text-foreground"
              >
                <Download size={12} />
                Export CSV
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-destructive font-medium">Search failed</p>
                <p className="text-sm text-muted-foreground">{error.message}</p>
              </div>
            </div>
          )}

          {!enabled && !isFetching && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3 max-w-sm">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Search size={28} className="text-primary" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Start Prospecting</h3>
                <p className="text-sm text-muted-foreground">
                  Select a category, enter a location, and click Search to find qualified leads.
                </p>
              </div>
            </div>
          )}

          {enabled && !isFetching && leads?.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-foreground font-medium">No results found</p>
                <p className="text-sm text-muted-foreground">Try a different location or category.</p>
              </div>
            </div>
          )}

          {isFetching && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground">Fetching leads from Google Maps...</p>
              </div>
            </div>
          )}

          {!isFetching && filteredLeads.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead
                    className="text-muted-foreground text-xs cursor-pointer select-none"
                    onClick={() => handleSort("name")}
                  >
                    Business <SortIcon col="name" />
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs">Source</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Contact</TableHead>
                  <TableHead
                    className="text-muted-foreground text-xs cursor-pointer select-none"
                    onClick={() => handleSort("rating")}
                  >
                    Rating <SortIcon col="rating" />
                  </TableHead>
                  <TableHead
                    className="text-muted-foreground text-xs cursor-pointer select-none"
                    onClick={() => handleSort("distanceMiles")}
                  >
                    Distance <SortIcon col="distanceMiles" />
                  </TableHead>
                  <TableHead
                    className="text-muted-foreground text-xs cursor-pointer select-none"
                    onClick={() => handleSort("qualificationScore")}
                  >
                    Score <SortIcon col="qualificationScore" />
                  </TableHead>
                  <TableHead className="text-muted-foreground text-xs w-16">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => (
                  <TableRow
                    key={lead.placeId}
                    className="border-border cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => { setSelectedLead(lead); setDetailOpen(true); }}
                  >
                    <TableCell className="py-3">
                      <div className="font-medium text-sm text-foreground leading-tight">{lead.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">
                        {lead.address}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full px-2 py-0.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                        Google
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="space-y-0.5">
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone size={10} />
                            <span>{lead.phone}</span>
                          </div>
                        )}
                        {lead.website && (
                          <div className="flex items-center gap-1 text-xs text-primary">
                            <Globe size={10} />
                            <span className="truncate max-w-[140px]">
                              {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {lead.rating != null ? (
                        <div className="flex items-center gap-1">
                          <Star size={12} className="text-primary fill-primary" />
                          <span className="text-sm text-foreground font-medium">{lead.rating.toFixed(1)}</span>
                          {lead.reviewCount != null && (
                            <span className="text-xs text-muted-foreground">({lead.reviewCount.toLocaleString()})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {lead.distanceMiles != null ? (
                        <span className="text-sm text-foreground">{lead.distanceMiles.toFixed(1)} mi</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <ScoreBadge score={lead.qualificationScore} tier={lead.scoreTier} size="sm" />
                    </TableCell>
                    <TableCell className="py-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          saveLeadMutation.mutate({
                            placeId: lead.placeId,
                            source: "google",
                            name: lead.name,
                            address: lead.address,
                            phone: lead.phone,
                            website: lead.website,
                            email: null,
                            category: lead.category,
                            rating: lead.rating,
                            reviewCount: lead.reviewCount,
                            latitude: lead.latitude,
                            longitude: lead.longitude,
                            qualificationScore: lead.qualificationScore,
                            scoreTier: lead.scoreTier,
                            scoreBreakdown: lead.scoreBreakdown,
                          });
                        }}
                      >
                        <Bookmark size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Lead Detail Sheet */}
      <LeadDetailSheet
        lead={selectedLead}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

      {/* Save Search Dialog */}
      <Dialog open={saveSearchOpen} onOpenChange={setSaveSearchOpen}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">Save This Search</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Search Name</Label>
              <Input
                placeholder={`${getCategoryLabel(category)} in ${location || "..."}`}
                value={saveSearchName}
                onChange={(e) => setSaveSearchName(e.target.value)}
                className="bg-background border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Category: <span className="text-foreground">{getCategoryLabel(category)}</span></div>
              <div>Location: <span className="text-foreground">{location}</span></div>
              <div>Radius: <span className="text-foreground">{radiusMiles} miles</span></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveSearchOpen(false)} className="border-border text-foreground">
              Cancel
            </Button>
            <Button
              onClick={() => {
                saveSearchMutation.mutate({
                  name: saveSearchName || `${getCategoryLabel(category)} in ${location}`,
                  category,
                  location,
                  lat: locationCoords?.lat,
                  lng: locationCoords?.lng,
                  radiusMiles,
                });
              }}
              disabled={saveSearchMutation.isPending}
              className="bg-primary text-primary-foreground"
            >
              Save Search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
