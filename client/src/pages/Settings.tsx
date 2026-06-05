import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/_core/hooks/useAuth";
import { canManage } from "@shared/permissions";
import { Palette, Upload, Trash2, Save, Loader2, Image as ImageIcon, Moon, Sun, Lock } from "lucide-react";
import { DEFAULT_LOGO } from "@/hooks/useBranding";

const MAX_DIM = 256; // logos render <=112px; 256 keeps them crisp on retina while tiny in storage

/** Read an image file, downscale to MAX_DIM on the longest edge, return a PNG data URL. */
async function fileToResizedDataUrl(file: File): Promise<string> {
  const readDataUrl = (f: File) =>
    new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = () => rej(new Error("Could not read file"));
      fr.readAsDataURL(f);
    });
  const loadImg = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("That file isn't a valid image"));
      img.src = src;
    });
  const src = await readDataUrl(file);
  const img = await loadImg(src);
  let { width, height } = img;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function LogoField({
  title,
  subtitle,
  icon: Icon,
  swatch,
  value,
  disabled,
  onPick,
  onClear,
}: {
  title: string;
  subtitle: string;
  icon: any;
  swatch: string;
  value: string | null;
  disabled: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = value || DEFAULT_LOGO;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>

      {/* Preview on its intended background */}
      <div
        className="rounded-xl border border-border flex items-center justify-center h-32 mb-4"
        style={{ background: swatch }}
      >
        <img src={preview} alt={`${title} preview`} className="max-h-20 max-w-[70%] object-contain rounded-lg" />
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPick(file);
          }}
        />
        <Button size="sm" className="gap-1.5" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" /> Upload image
        </Button>
        {value && (
          <Button size="sm" variant="outline" className="gap-1.5 border-border" disabled={disabled} onClick={onClear}>
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">PNG with transparency works best. Auto-resized to 256px.</p>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isManager = canManage(user?.role);
  const utils = trpc.useUtils();
  const { data: branding } = trpc.settings.getBranding.useQuery();

  const [dark, setDark] = useState<string | null>(null);
  const [light, setLight] = useState<string | null>(null);
  const [slogan, setSlogan] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (branding) {
      setDark(branding.logoDark ?? null);
      setLight(branding.logoLight ?? null);
      setSlogan(branding.slogan ?? "");
    }
  }, [branding]);

  const save = trpc.settings.updateBranding.useMutation({
    onSuccess: () => {
      toast.success("Branding saved — refresh to see it everywhere.");
      utils.settings.getBranding.invalidate();
      setDirty(false);
    },
    onError: (e) => toast.error(e.message || "Could not save branding"),
  });

  const pick = (which: "dark" | "light") => async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Image is too large (max 8 MB before resize).");
      return;
    }
    try {
      const url = await fileToResizedDataUrl(file);
      which === "dark" ? setDark(url) : setLight(url);
      setDirty(true);
    } catch (err: any) {
      toast.error(err?.message || "Could not process that image.");
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shrink-0">
          <Palette className="w-[18px] h-[18px] text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          Settings
        </h1>
      </div>
      <p className="text-sm text-muted-foreground ml-12 mb-8">
        Brand your CRM. Upload a logo for dark and light mode — it appears on the sign-in screen and the sidebar.
      </p>

      {!isManager && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm mb-6">
          <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span className="text-muted-foreground">Branding is view-only for your role. Ask a manager to change the logos.</span>
        </div>
      )}

      {/* Slogan / tagline */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm mb-4">
        <label htmlFor="slogan" className="text-sm font-semibold text-foreground">Slogan / Tagline</label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Shown beside the logo on the sign-in screen and in the sidebar.</p>
        <Input
          id="slogan"
          value={slogan}
          disabled={!isManager}
          maxLength={200}
          onChange={(e) => { setSlogan(e.target.value); setDirty(true); }}
          placeholder="e.g. Business Development · Partner CRM"
          className="bg-card border-border max-w-lg"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LogoField
          title="Logo — Dark mode"
          subtitle="Shown on dark backgrounds"
          icon={Moon}
          swatch="linear-gradient(160deg, #0b1220, #0f1a30)"
          value={dark}
          disabled={!isManager || save.isPending}
          onPick={pick("dark")}
          onClear={() => { setDark(null); setDirty(true); }}
        />
        <LogoField
          title="Logo — Light mode"
          subtitle="Shown on light backgrounds"
          icon={Sun}
          swatch="linear-gradient(160deg, #ffffff, #f1f5f9)"
          value={light}
          disabled={!isManager || save.isPending}
          onPick={pick("light")}
          onClear={() => { setLight(null); setDirty(true); }}
        />
      </div>

      {isManager && (
        <div className="flex items-center gap-3 mt-6">
          <Button
            className="gap-2"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ logoDark: dark, logoLight: light, slogan })}
          >
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </Button>
          {dirty && <span className="text-xs text-muted-foreground flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
