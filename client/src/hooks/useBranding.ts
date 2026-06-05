import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";

export const DEFAULT_LOGO = "/farahi-logo-darkmode.jpg";

/**
 * Returns the theme-appropriate brand logo URL — an uploaded logo (data URL)
 * from Settings if present, otherwise the bundled default. Falls back across
 * themes so a single uploaded logo still shows in both modes.
 */
export function useBrandLogo(): string {
  const { theme } = useTheme();
  const { data } = trpc.settings.getBranding.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const preferred = theme === "dark" ? data?.logoDark : data?.logoLight;
  return preferred || data?.logoDark || data?.logoLight || DEFAULT_LOGO;
}
