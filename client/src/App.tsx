import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import SearchPage from "./pages/Search";
import CaliforniaMapPage from "./pages/CaliforniaMap";
import SavedLeadsPage from "./pages/SavedLeads";
import SavedSearchesPage from "./pages/SavedSearches";
import FacilitiesPage from "./pages/crm/Facilities";
import FacilityProfilePage from "./pages/crm/FacilityProfile";
import FacilityFormPage from "./pages/crm/FacilityForm";
import ManagementDashboardPage from "./pages/crm/ManagementDashboard";
import RingCentralSettingsPage from "./pages/crm/RingCentralSettings";
import BdrReportsPage from "./pages/crm/BdrReports";
import AgentsPage from "./pages/Agents";
import PiClientsPage from "./pages/PiClients";
import FilevineSettingsPage from "./pages/FilevineSettings";
import RingCentralCallback from "./pages/RingCentralCallback";
import { RingCentralWidget } from "./components/RingCentralWidget";
import type { CallEndData } from "./components/RingCentralWidget";
import { trpc } from "./lib/trpc";
import { toast } from "sonner";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        {/* Home: California Map Dashboard */}
        <Route path="/" component={CaliforniaMapPage} />

        {/* Lead Scraper */}
        <Route path="/search" component={SearchPage} />
        <Route path="/saved-leads" component={SavedLeadsPage} />
        <Route path="/saved-searches" component={SavedSearchesPage} />

        {/* Facility Partner CRM */}
        <Route path="/crm/facilities" component={FacilitiesPage} />
        <Route path="/crm/facilities/new" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id/edit" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id" component={FacilityProfilePage} />
        <Route path="/crm/dashboard" component={ManagementDashboardPage} />
        <Route path="/crm/ringcentral" component={RingCentralSettingsPage} />
        <Route path="/crm/reports" component={BdrReportsPage} />

        {/* Agent Management */}
        <Route path="/agents" component={AgentsPage} />

        {/* PI Clients */}
        <Route path="/pi-clients" component={PiClientsPage} />

        {/* Filevine Integration */}
        <Route path="/filevine" component={FilevineSettingsPage} />

        <Route path="/ringcentral-callback" component={RingCentralCallback} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AppWithPhone() {
  const utils = trpc.useUtils();

  const handleCallEnd = (data: CallEndData) => {
    // Auto-create a contact log if we can identify a facility from the phone number
    // The log is created without a facilityId here — users can also manually log from the facility profile.
    // For now, show a toast so the agent knows the call ended.
    const dur = data.durationStr ?? "0:00";
    const phone = data.phoneNumber ?? "unknown";
    toast.info(
      `Call ended — ${phone} · ${dur}`,
      {
        description: "Open the facility profile to log this call or sync from RingCentral.",
        duration: 8000,
      }
    );
    // Invalidate contact logs globally so any open profile refreshes
    utils.crm.contactLogs.list.invalidate();
    utils.crm.facilities.get.invalidate();
  };

  return (
    <>
      <Router />
      <RingCentralWidget onCallEnd={handleCallEnd} />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AppWithPhone />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
