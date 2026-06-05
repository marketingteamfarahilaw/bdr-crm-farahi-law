import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";

export const DEFAULT_LOGO = "/farahi-logo-darkmode.jpg";
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
  });
  const preferred = theme === "dark" ? data?.logoDark : data?.logoLight;
  const logo = preferred || data?.logoDark || data?.logoLight || DEFAULT_LOGO;
  const slogan = (data?.slogan && data.slogan.trim()) || DEFAULT_SLOGAN;
  return { logo, slogan };
}
