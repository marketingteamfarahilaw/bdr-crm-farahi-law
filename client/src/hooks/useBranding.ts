import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";

// Navy on transparent (Youssef, 2026-09-25): shown on a white badge so it reads
// in both themes. The mark alone is for the collapsed sidebar.
export const DEFAULT_LOGO = "/farahi-logo.png";
export const DEFAULT_MARK = "/farahi-mark.png";
export const DEFAULT_SLOGAN = "BD Partner CRM";

/**
 * Brand identity for the login screen + sidebar: the theme-appropriate uploaded
 * logo (data URL) and the editable slogan, both falling back to sensible
 * defaults. A single uploaded logo still shows in both themes.
 */
export function useBrand(): { logo: string; slogan: string } {
  const { theme } = useTheme();
  const { data } = trpc.settings.getBranding.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Outlast a deploy's restart rather than settling on the fallback after
    // the default three quick tries.
    retry: 8,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 15000),
  });
  const preferred = theme === "dark" ? data?.logoDark : data?.logoLight;
  const logo = preferred || data?.logoDark || data?.logoLight || DEFAULT_LOGO;
  const slogan = (data?.slogan && data.slogan.trim()) || DEFAULT_SLOGAN;
  return { logo, slogan };
}
