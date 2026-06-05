import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { History, Trash2, Play, MapPin, Tag, Ruler } from "lucide-react";
import { getCategoryLabel } from "@/types/lead";
import { useLocation } from "wouter";

export default function SavedSearchesPage() {
  const utils = trpc.useUtils();
  const { data: savedSearches, isLoading } = trpc.savedSearches.list.useQuery();
  const [, navigate] = useLocation();

  const deleteMutation = trpc.savedSearches.delete.useMutation({
    onSuccess: () => {
      toast.success("Search deleted.");
      utils.savedSearches.list.invalidate();
    },
    onError: () => toast.error("Failed to delete search."),
  });

  const handleRerun = (search: { category: string; location: string; radiusMiles: number; lat?: number | null; lng?: number | null }) => {
    // Navigate to search page with params in sessionStorage
    sessionStorage.setItem("rerunSearch", JSON.stringify({
      category: search.category,
      location: search.location,
      radiusMiles: search.radiusMiles,
      lat: search.lat ?? undefined,
      lng: search.lng ?? undefined,
    }));
    navigate("/search");
    toast.info("Search loaded — click Search to run it.");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-5 flex items-center gap-2">
        <History size={18} className="text-primary" />
        <h1 className="text-lg font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          Saved Searches
        </h1>
        {savedSearches && (
          <Badge variant="secondary" className="text-xs">
            {savedSearches.length}
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && (!savedSearches || savedSearches.length === 0) && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-sm">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <History size={28} className="text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">No Saved Searches</h3>
              <p className="text-sm text-muted-foreground">
                Run a search and save it to quickly re-run your prospecting queries.
              </p>
            </div>
          </div>
        )}

        {savedSearches && savedSearches.length > 0 && (
          <div className="space-y-3">
            {savedSearches.map((search) => (
              <div
                key={search.id}
                className="bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground">{search.name}</div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Tag size={10} className="text-primary" />
                        <span>{getCategoryLabel(search.category)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin size={10} className="text-primary" />
                        <span>{search.location}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Ruler size={10} className="text-primary" />
                        <span>{search.radiusMiles} mi radius</span>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Saved {new Date(search.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleRerun(search)}
                      className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8"
                    >
                      <Play size={11} />
                      Re-run
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteMutation.mutate({ id: search.id })}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
