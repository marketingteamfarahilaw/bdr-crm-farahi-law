import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge, ScoreBreakdownCard } from "./ScoreBadge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Phone,
  Globe,
  MapPin,
  Star,
  MessageSquare,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Navigation,
  Tag,
} from "lucide-react";
import type { Lead } from "@/types/lead";
import { getCategoryLabel } from "@/types/lead";

interface LeadDetailSheetProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
}

export function LeadDetailSheet({ lead, open, onClose }: LeadDetailSheetProps) {
  const [annotation, setAnnotation] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  const utils = trpc.useUtils();

  const { data: savedStatus } = trpc.savedLeads.isSaved.useQuery(
    { placeId: lead?.placeId ?? "" },
    { enabled: !!lead?.placeId }
  );

  const saveMutation = trpc.savedLeads.save.useMutation({
    onSuccess: (data) => {
      if (data.alreadyExisted) {
        toast.info("Lead already in your saved list.");
      } else {
        toast.success("Lead saved successfully!");
        setIsSaved(true);
      }
      utils.savedLeads.list.invalidate();
      utils.savedLeads.isSaved.invalidate({ placeId: lead?.placeId });
    },
    onError: () => toast.error("Failed to save lead."),
  });

  const unsaveMutation = trpc.savedLeads.unsave.useMutation({
    onSuccess: () => {
      toast.success("Lead removed from saved list.");
      setIsSaved(false);
      utils.savedLeads.list.invalidate();
      utils.savedLeads.isSaved.invalidate({ placeId: lead?.placeId });
    },
    onError: () => toast.error("Failed to remove lead."),
  });

  const annotateMutation = trpc.savedLeads.annotate.useMutation({
    onSuccess: () => {
      toast.success("Note saved.");
      utils.savedLeads.list.invalidate();
    },
    onError: () => toast.error("Failed to save note."),
  });

  if (!lead) return null;

  const currentlySaved = savedStatus?.saved || isSaved;

  const handleSave = () => {
    if (currentlySaved) {
      unsaveMutation.mutate({ placeId: lead.placeId });
    } else {
      saveMutation.mutate({
        placeId: lead.placeId,
        source: "google",
        name: lead.name,
        address: lead.address,
        phone: lead.phone,
        website: lead.website,
        email: lead.email,
        category: lead.category,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        latitude: lead.latitude,
        longitude: lead.longitude,
        qualificationScore: lead.qualificationScore,
        scoreTier: lead.scoreTier,
        scoreBreakdown: lead.scoreBreakdown,
        annotation: annotation || undefined,
      });
    }
  };

  const handleAnnotate = () => {
    if (!annotation.trim()) return;
    annotateMutation.mutate({ placeId: lead.placeId, annotation });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-card border-border overflow-y-auto"
      >
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-semibold text-foreground leading-tight">
                {lead.name}
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {getCategoryLabel(lead.category)}
              </p>
            </div>
            <ScoreBadge score={lead.qualificationScore} tier={lead.scoreTier} size="md" />
          </div>
        </SheetHeader>

        <div className="py-5 space-y-6">
          {/* Contact Info */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact Information
            </h3>
            <div className="space-y-2">
              {lead.address && (
                <div className="flex items-start gap-2.5 text-sm">
                  <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground">{lead.address}</span>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Phone size={14} className="text-primary shrink-0" />
                  <a
                    href={`tel:${lead.phone}`}
                    className="text-primary hover:underline"
                  >
                    {lead.phone}
                  </a>
                </div>
              )}
              {lead.website && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Globe size={14} className="text-primary shrink-0" />
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 truncate"
                  >
                    <span className="truncate">{lead.website.replace(/^https?:\/\//, "")}</span>
                    <ExternalLink size={10} className="shrink-0" />
                  </a>
                </div>
              )}
              {lead.distanceMiles != null && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Navigation size={14} className="text-primary shrink-0" />
                  <span className="text-foreground">
                    {lead.distanceMiles.toFixed(1)} miles from search location
                  </span>
                </div>
              )}
              {lead.address && (
                <div className="flex items-center gap-2.5 text-sm">
                  <MapPin size={14} className="text-primary shrink-0" />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.name + ' ' + lead.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    View on Google Maps
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Ratings */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ratings & Reviews
            </h3>
            <div className="flex items-center gap-4">
              {lead.rating != null && (
                <div className="flex items-center gap-1.5">
                  <Star size={14} className="text-primary fill-primary" />
                  <span className="text-sm font-semibold text-foreground">{lead.rating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">/ 5.0</span>
                </div>
              )}
              {lead.reviewCount != null && (
                <div className="flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-muted-foreground" />
                  <span className="text-sm text-foreground">{lead.reviewCount.toLocaleString()} reviews</span>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tags & Source
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-xs gap-1">
                <Tag size={10} />
                {getCategoryLabel(lead.category)}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Google Maps
              </Badge>
              {lead.businessStatus && lead.businessStatus !== "OPERATIONAL" && (
                <Badge variant="destructive" className="text-xs">
                  {lead.businessStatus.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
          </div>

          {/* Score Breakdown */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Qualification Score Breakdown
            </h3>
            <div className="bg-background rounded-lg p-4 border border-border">
              <ScoreBreakdownCard breakdown={lead.scoreBreakdown} />
            </div>
          </div>

          {/* Annotation */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Team Notes
            </h3>
            <Textarea
              placeholder="Add notes about this lead..."
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              className="bg-background border-border text-foreground placeholder:text-muted-foreground resize-none"
              rows={3}
            />
            {annotation.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAnnotate}
                disabled={annotateMutation.isPending}
                className="w-full"
              >
                Save Note
              </Button>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              className="flex-1 gap-2"
              variant={currentlySaved ? "outline" : "default"}
              onClick={handleSave}
              disabled={saveMutation.isPending || unsaveMutation.isPending}
            >
              {currentlySaved ? (
                <>
                  <BookmarkCheck size={15} />
                  Saved
                </>
              ) : (
                <>
                  <Bookmark size={15} />
                  Save Lead
                </>
              )}
            </Button>
            {lead.website && (
              <Button
                variant="outline"
                size="icon"
                asChild
              >
                <a href={lead.website} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} />
                </a>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
