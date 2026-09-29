/**
 * The Lead Scraper under one menu item (Sept 2026: "Lead search … Saved leads
 * … Saved searches … under one folder"): the Partner Map, Lead Search, Saved
 * Leads and Saved Searches as tabs of one page. Each keeps its own address, so
 * old links, bookmarks and a refresh land on the right tab.
 */
import { useLocation } from "wouter";
import { PageTabs } from "@/components/PageTabs";
import CaliforniaMap from "./CaliforniaMap";
import Search from "./Search";
import SavedLeads from "./SavedLeads";
import SavedSearches from "./SavedSearches";

const TABS = [
  ["/map", "Partner Map"],
  ["/search", "Lead Search"],
  ["/saved-leads", "Saved Leads"],
  ["/saved-searches", "Saved Searches"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function LeadMapHub() {
  const [location, navigate] = useLocation();
  const tab: Tab = TABS.find(([path]) => location === path || location.startsWith(`${path}/`))?.[0] ?? "/map";
  return (
    <div className="flex flex-col h-full min-h-0">
      <PageTabs tabs={TABS} active={tab} onChange={(k) => navigate(k)} />
      <div className="flex-1 min-h-0">
        {tab === "/map" ? <CaliforniaMap /> : tab === "/search" ? <Search /> : tab === "/saved-leads" ? <SavedLeads /> : <SavedSearches />}
      </div>
    </div>
  );
}
