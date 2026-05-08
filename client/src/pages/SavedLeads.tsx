import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { toast } from "sonner";
import {
  Bookmark,
  Trash2,
  Phone,
  Globe,
  MapPin,
  Star,
  Download,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { getCategoryLabel } from "@/types/lead";
import type { ScoreBreakdown } from "@/types/lead";
import { LeadDetailSheet } from "@/components/LeadDetailSheet";
import type { Lead } from "@/types/lead";

export default function SavedLeadsPage() {
  const utils = trpc.useUtils();
  const { data: savedLeads, isLoading } = trpc.savedLeads.list.useQuery();

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const unsaveMutation = trpc.savedLeads.unsave.useMutation({
    onSuccess: () => {
      toast.success("Lead removed.");
      utils.savedLeads.list.invalidate();
    },
    onError: () => toast.error("Failed to remove lead."),
  });

  const handleExportCSV = () => {
    if (!savedLeads?.length) return;
    const headers = ["Name", "Category", "Address", "Phone", "Website", "Rating", "Reviews", "Score", "Tier", "Notes"];
    const rows = savedLeads.map((l) => [
      `"${l.name.replace(/"/g, '""')}"`,
      getCategoryLabel(l.category ?? ""),
      `"${(l.address ?? "").replace(/"/g, '""')}"`,
      l.phone ?? "",
      l.website ?? "",
      l.rating ?? "",
      l.reviewCount ?? "",
      l.qualificationScore ?? "",
      l.scoreTier ?? "",
      `"${(l.annotation ?? "").replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farahi-saved-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported!");
  };

  const openDetail = (sl: typeof savedLeads extends (infer T)[] | undefined ? T : never) => {
    if (!sl) return;
    const lead: Lead = {
      placeId: sl.placeId,
      name: sl.name,
      address: sl.address ?? "",
      phone: sl.phone ?? null,
      website: sl.website ?? null,
      email: sl.email ?? null,
      rating: sl.rating ?? null,
      reviewCount: sl.reviewCount ?? null,
      latitude: sl.latitude ?? null,
      longitude: sl.longitude ?? null,
      distanceMiles: null,
      category: sl.category ?? "",
      source: "google",
      types: [],
      businessStatus: null,
      photoReference: null,
      qualificationScore: sl.qualificationScore ?? 0,
      scoreTier: (sl.scoreTier as "hot" | "warm" | "cold") ?? "cold",
      scoreBreakdown: (sl.scoreBreakdown as ScoreBreakdown) ?? {
        ratingScore: 0, reviewScore: 0, proximityScore: 0, categoryScore: 0,
        total: sl.qualificationScore ?? 0, tier: (sl.scoreTier as "hot" | "warm" | "cold") ?? "cold",
      },
    };
    setSelectedLead(lead);
    setDetailOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark size={18} className="text-primary" />
          <h1 className="text-lg font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Saved Leads
          </h1>
          {savedLeads && (
            <Badge variant="secondary" className="text-xs">
              {savedLeads.length}
            </Badge>
          )}
        </div>
        {savedLeads && savedLeads.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            className="gap-1.5 border-border text-foreground text-xs"
          >
            <Download size={12} />
            Export CSV
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && (!savedLeads || savedLeads.length === 0) && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-sm">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Bookmark size={28} className="text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No Saved Leads Yet</h3>
              <p className="text-sm text-muted-foreground">
                Run a search and bookmark leads to build your prospecting list.
              </p>
            </div>
          </div>
        )}

        {savedLeads && savedLeads.length > 0 && (
          <div className="space-y-3">
            {savedLeads.map((lead) => (
              <div
                key={lead.id}
                className="bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors cursor-pointer group"
                onClick={() => openDetail(lead)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{lead.name}</span>
                      {lead.scoreTier && lead.qualificationScore != null && (
                        <ScoreBadge score={lead.qualificationScore} tier={lead.scoreTier as "hot" | "warm" | "cold"} size="sm" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {getCategoryLabel(lead.category ?? "")}
                      </Badge>
                    </div>

                    <div className="mt-2 space-y-1">
                      {lead.address && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin size={10} className="shrink-0" />
                          <span className="truncate">{lead.address}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone size={10} />
                            <span>{lead.phone}</span>
                          </div>
                        )}
                        {lead.rating != null && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star size={10} className="text-primary fill-primary" />
                            <span>{lead.rating.toFixed(1)}</span>
                            {lead.reviewCount != null && <span>({lead.reviewCount.toLocaleString()})</span>}
                          </div>
                        )}
                        {lead.website && (
                          <div className="flex items-center gap-1 text-xs text-primary">
                            <Globe size={10} />
                            <span className="truncate max-w-[120px]">
                              {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {lead.annotation && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground bg-background rounded px-2.5 py-1.5">
                        <MessageSquare size={10} className="shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{lead.annotation}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        unsaveMutation.mutate({ placeId: lead.placeId });
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                    <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <LeadDetailSheet
        lead={selectedLead}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
