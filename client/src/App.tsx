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
import { RingCentralProvider } from "./components/RingCentralWidget";
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

  // Auto-log PI client calls when a RingCentral call ends.
  // Uses transcribeAndLog which: fetches RC recording → Whisper transcription → saves to pi_client_call_logs.
  const transcribeAndLog = trpc.piClients.transcribeAndLog.useMutation({
    onSuccess: (result) => {
      if (result.success && result.piClientId) {
        utils.piClients.getCallLogs.invalidate();
        utils.piClients.list.invalidate();
      }
    },
  });

  const handleCallEnd = (data: CallEndData) => {
    const dur = data.durationStr ?? "0:00";
    const phone = data.phoneNumber ?? "unknown";

    if (data.phoneNumber) {
      // Show an immediate "processing" toast while transcription runs server-side
      const processingId = `rc-processing-${Date.now()}`;
      toast.loading("Processing call…", {
        id: processingId,
        description: `${phone} · ${dur} — fetching recording & transcribing`,
        duration: 30000,
      });

      transcribeAndLog.mutate(
        {
          phone: data.phoneNumber,
          callId: data.callId,
          direction: data.direction,
          result: data.result,
          duration: data.duration,
          durationStr: data.durationStr,
          startTime: data.startTime,
        },
        {
          onSuccess: (result) => {
            toast.dismiss(processingId);
            if (result.piClientId) {
              if (result.hasTranscript) {
                toast.success(
                  `Call logged & transcribed for ${result.clientName}`,
                  {
                    description: `${dur} · ${data.direction ?? ""} · transcript saved`,
                    duration: 8000,
                  }
                );
              } else {
                toast.success(
                  `Call logged for ${result.clientName}`,
                  {
                    description: `${dur} · ${data.direction ?? ""} · no recording available yet`,
                    duration: 6000,
                  }
                );
              }
            } else {
              toast.info(`Call ended — ${phone} · ${dur}`, {
                description: "No matching PI client found. Open a client profile to log manually.",
                duration: 8000,
              });
            }
          },
          onError: () => {
            toast.dismiss(processingId);
            toast.info(`Call ended — ${phone} · ${dur}`, {
              description: "Could not auto-log this call. Check RingCentral connection.",
              duration: 8000,
            });
          },
        }
      );
    } else {
      toast.info(`Call ended — ${phone} · ${dur}`, {
        description: "Open the facility profile to log this call or sync from RingCentral.",
        duration: 8000,
      });
    }

    // Invalidate CRM contact logs so any open facility profile refreshes
    utils.crm.contactLogs.list.invalidate();
    utils.crm.facilities.get.invalidate();
  };

  return (
    <RingCentralProvider onCallEnd={handleCallEnd}>
      <Router />
    </RingCentralProvider>
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
