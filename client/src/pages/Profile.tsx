import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/_core/hooks/useAuth";
import { fileToResizedDataUrl } from "@/lib/image";
import { UserRound, Upload, Trash2, Loader2, Save } from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  // undefined = unchanged, null = remove, string = new photo (data URL)
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);

  const current = photo !== undefined ? photo : ((user as any)?.photoUrl ?? null);
  const dirty = photo !== undefined;
  const initials = (user?.name?.trim()?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  const save = trpc.auth.updatePhoto.useMutation({
    onSuccess: () => {
      toast.success("Profile photo updated");
      utils.auth.me.invalidate();
      setPhoto(undefined);
    },
    onError: (e) => toast.error(e.message || "Could not save photo"),
  });

  const pick = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Image is too large (max 8 MB)."); return; }
    try {
      const url = await fileToResizedDataUrl(file);
      setPhoto(url);
    } catch (e: any) {
      toast.error(e?.message || "Could not process that image.");
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0">
          <UserRound className="w-[18px] h-[18px] text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          My Profile
        </h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-5">
          <Avatar className="h-24 w-24 border ring-1 ring-border shrink-0">
            {current && <AvatarImage src={current} className="object-cover" />}
            <AvatarFallback className="text-2xl font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-foreground truncate">{user?.name || "—"}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email || ""}</p>
            {user?.role && (
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">{String(user.role).replace(/_/g, " ")}</p>
            )}
            <div className="flex gap-2 mt-3">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }}
              />
              <Button size="sm" className="gap-1.5" onClick={() => inputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" /> Upload photo
              </Button>
              {current && (
                <Button size="sm" variant="outline" className="gap-1.5 border-border" onClick={() => setPhoto(null)}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </Button>
              )}
            </div>
          </div>
        </div>

        {dirty && (
          <div className="flex items-center gap-3 mt-5 pt-5 border-t border-border">
            <Button className="gap-2" disabled={save.isPending} onClick={() => save.mutate({ photoUrl: photo ?? null })}>
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save photo
            </Button>
            <Button variant="ghost" onClick={() => setPhoto(undefined)}>Cancel</Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Your photo shows on your avatar in the sidebar. PNG or JPG, auto-resized to 256px.
      </p>
    </div>
  );
}
