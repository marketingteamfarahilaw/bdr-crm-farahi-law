import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import Login from "@/pages/Login";
import { Search, Bookmark, History, LogOut, PanelLeft, Scale, Building2, LayoutDashboard, Phone, BarChart3, Map, Users, UserRound, Link2, Activity, MapPin, Receipt, CreditCard, Gift, ClipboardList, Network, ArrowLeftRight, FileBarChart2, PieChart, Plus, Shield, Workflow, Sun, Moon, UtensilsCrossed, Settings, Sparkles, Inbox, PhoneCall, ScanSearch, Bot, Navigation, Handshake, Target, CalendarClock, GraduationCap, Trophy, CalendarDays } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { CommandPalette } from "./CommandPalette";
import { QuickAdd } from "./QuickAdd";
import { NotificationBell } from "./NotificationBell";
import { useBrand } from "@/hooks/useBranding";
import { useTheme } from "@/contexts/ThemeContext";
import { canSeeBDR, canSeeFR, canManage, canAssignRoles, canSeeIntake, isIntakeOnly } from "@shared/permissions";

type NavLevel = "all" | "bdr" | "fr" | "manage" | "super" | "intake";

const NAV_SECTIONS: { title: string; items: { icon: any; label: string; path: string; level: NavLevel }[] }[] = [
  // Intake — a separate world. Intake roles see ONLY this section (plus their
  // profile); BD/FR roles never see it. The super admin sees both sides.
  { title: "Intake — AI Case Desk", items: [
    { icon: Sparkles, label: "Intake Desk", path: "/intake", level: "intake" },
    { icon: Inbox, label: "Lead Queue", path: "/intake/leads", level: "intake" },
    { icon: ScanSearch, label: "Auditor", path: "/intake/auditor", level: "intake" },
    { icon: Bot, label: "Agents", path: "/intake/agents", level: "super" }, // TEST PHASE — super admin only until approved for the team
    { icon: PhoneCall, label: "Calls & Transcripts", path: "/intake/calls", level: "intake" },
    { icon: Settings, label: "Settings & RingCentral", path: "/intake/settings", level: "intake" },
  ] },
  { title: "Lead Scraper", items: [
    { icon: Map, label: "CA Lead Map", path: "/map", level: "bdr" },
    { icon: Search, label: "Lead Search", path: "/search", level: "bdr" },
    { icon: Bookmark, label: "Saved Leads", path: "/saved-leads", level: "bdr" },
    { icon: History, label: "Saved Searches", path: "/saved-searches", level: "bdr" },
  ] },
  { title: "Facility Partner CRM", items: [
    { icon: Workflow, label: "Pipeline", path: "/crm/pipeline", level: "all" },
    { icon: Building2, label: "Facilities", path: "/crm/facilities", level: "bdr" },
    { icon: Phone, label: "RingCentral", path: "/crm/ringcentral", level: "bdr" },
    { icon: UtensilsCrossed, label: "Uber Eats", path: "/crm/uber-eats", level: "all" },
    { icon: BarChart3, label: "BDR Reports", path: "/crm/reports", level: "manage" },
  ] },
  { title: "FR/BDR Partnership", items: [
    { icon: PhoneCall, label: "BDR Desk", path: "/partnership/bdr-desk", level: "bdr" },
    { icon: Network, label: "Coordinated Loop", path: "/partnership/loop", level: "all" },
    { icon: Target, label: "Shared Quota", path: "/partnership/quota", level: "all" },
    { icon: CalendarClock, label: "Visits & Briefings", path: "/partnership/visits", level: "all" },
    { icon: Handshake, label: "Team Pods", path: "/partnership/pods", level: "manage" },
    { icon: GraduationCap, label: "QA Coach", path: "/partnership/qa", level: "manage" },
    { icon: Trophy, label: "Leadership", path: "/partnership/leadership", level: "manage" },
  ] },
  { title: "Agent Tools", items: [
    { icon: CalendarDays, label: "Daily Activity Log", path: "/daily-log", level: "all" },
    { icon: BarChart3, label: "Reports", path: "/reports", level: "all" },
    { icon: FileBarChart2, label: "Team Reports", path: "/team-reports", level: "manage" },
    { icon: Phone, label: "Call Analytics", path: "/call-analytics", level: "all" },
    { icon: ClipboardList, label: "Call Logs", path: "/call-logs", level: "all" },
    { icon: Sparkles, label: "Agent Performance", path: "/agent-performance", level: "all" },
    { icon: PieChart, label: "Admin Overview", path: "/bdr/admin", level: "manage" },
    { icon: MapPin, label: "Field Visits", path: "/bdr/field-visits", level: "fr" },
    { icon: Navigation, label: "Field Mode (Mobile)", path: "/field", level: "fr" },
    { icon: Receipt, label: "Expenses", path: "/bdr/expenses", level: "all" },
    { icon: Gift, label: "Referral Rewards", path: "/bdr/referral-rewards", level: "bdr" },
    { icon: ClipboardList, label: "FR Errands", path: "/bdr/fr-errands", level: "fr" },
    { icon: Network, label: "Referral-Friendly List", path: "/bdr/referral-tracker", level: "bdr" },
  ] },
  { title: "Partner Referrals", items: [
    { icon: ArrowLeftRight, label: "Partner Referrals", path: "/referral/tracker", level: "manage" },
    { icon: FileBarChart2, label: "Referral Reports", path: "/referral/reports", level: "manage" },
  ] },
  { title: "Team & Integrations", items: [
    { icon: Shield, label: "Team & Roles", path: "/team", level: "manage" },
    { icon: Users, label: "Agent Zones", path: "/agents", level: "manage" },
    { icon: UserRound, label: "PI Clients", path: "/pi-clients", level: "manage" },
    { icon: Link2, label: "Filevine", path: "/filevine", level: "manage" },
    { icon: Settings, label: "Settings", path: "/settings", level: "manage" },
  ] },
];

const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items);

function canShow(level: NavLevel, role?: string | null) {
  switch (level) {
    case "all": return !isIntakeOnly(role); // BD/FR shared tools — hidden from the intake team
    case "bdr": return canSeeBDR(role) && !isIntakeOnly(role);
    case "fr": return canSeeFR(role) && !isIntakeOnly(role);
    case "manage": return canManage(role);
    case "super": return canAssignRoles(role);
    case "intake": return canSeeIntake(role);
    default: return false;
  }
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  // Defensive fallback — normally the AuthGate in App.tsx renders Login before
  // DashboardLayout ever mounts unauthenticated.
  if (!user) {
    return <Login />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { logo, slogan } = useBrand();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const allMenuItems = ALL_NAV;
  const activeMenuItem = allMenuItems.find(item => item.path === location || (item.path !== "/" && location.startsWith(item.path)));
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  // The intake team gets a clean, intake-only shell: no facility search
  // palette, no facility quick-add, no BD notification feed.
  const intakeOnly = isIntakeOnly(user?.role);

  return (
    <>
      {!intakeOnly && <CommandPalette />}
      {!intakeOnly && <QuickAdd />}
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-auto py-3 justify-center">
            <div className="flex items-start gap-2.5 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex flex-col min-w-0">
                  <img src={logo} alt="Farahi Law Firm" className="h-14 w-auto max-w-[190px] object-contain" />
                  <span className="text-sm font-semibold text-muted-foreground mt-1.5 leading-snug">{slogan}</span>
                </div>
              ) : (
                <img src={logo} alt="Farahi Law Firm" className="h-9 w-9 object-contain" />
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-y-auto">
            {/* Quick search + quick add */}
            {!isCollapsed && !intakeOnly && (
              <div className="px-3 pt-3 space-y-2">
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
                  className="w-full flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  <Search className="h-4 w-4" />
                  <span>Search…</span>
                  <kbd className="ml-auto text-[10px] font-mono bg-background/60 border border-border rounded px-1.5 py-0.5">⌘K</kbd>
                </button>
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent("open-quick-add"))}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: "var(--gold)", color: "var(--gold-foreground)" }}
                >
                  <Plus className="h-4 w-4" />
                  <span>Quick Add</span>
                </button>
              </div>
            )}
            {/* Command Center */}
            <div className="px-3 pt-3 pb-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location === "/"}
                    onClick={() => setLocation("/")}
                    tooltip={intakeOnly ? "Intake Desk" : "Command Center"}
                    className="h-10 transition-all font-medium"
                  >
                    <LayoutDashboard className={`h-4 w-4 ${location === "/" ? "text-primary" : ""}`} />
                    <span>{intakeOnly ? "Intake Desk" : "Command Center"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>

            {NAV_SECTIONS.map((section) => {
              const items = section.items.filter((it) => canShow(it.level, user?.role));
              if (items.length === 0) return null;
              return (
                <div key={section.title}>
                  <div className="mx-3 my-1 border-t border-border/40" />
                  <div className="px-3 pt-1 pb-3">
                    {!isCollapsed && (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1 mb-1">{section.title}</p>
                    )}
                    <SidebarMenu>
                      {items.map((item) => {
                        const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              isActive={isActive}
                              onClick={() => setLocation(item.path)}
                              tooltip={item.label}
                              className="h-9 transition-all font-normal"
                            >
                              <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                              <span>{item.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </div>
                </div>
              );
            })}
          </SidebarContent>

          <SidebarFooter className="p-3">
            {!intakeOnly && <NotificationBell />}
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className="flex items-center gap-3 rounded-lg px-2 py-2 mb-1 w-full text-left text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
                <span className="group-data-[collapsible=icon]:hidden">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    {(user as any)?.photoUrl && <AvatarImage src={(user as any).photoUrl} className="object-cover" />}
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer">
                  <UserRound className="mr-2 h-4 w-4" />
                  <span>My Profile</span>
                </DropdownMenuItem>
                {toggleTheme && (
                  <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">
                    {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                    <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 overflow-hidden" style={{ height: 'calc(100vh - 0px)' }}>{children}</main>
      </SidebarInset>
    </>
  );
}
