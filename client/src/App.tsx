import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect, useRef } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import SearchPage from "./pages/Search";
import CaliforniaMapPage from "./pages/CaliforniaMap";
import Dashboard from "./pages/Dashboard";
import SavedLeadsPage from "./pages/SavedLeads";
import SavedSearchesPage from "./pages/SavedSearches";
import FacilitiesPage from "./pages/crm/Facilities";
import PipelinePage from "./pages/crm/Pipeline";
import UberEatsPage from "./pages/crm/UberEats";
import FacilityProfilePage from "./pages/crm/FacilityProfile";
import FacilityFormPage from "./pages/crm/FacilityForm";
import ManagementDashboardPage from "./pages/crm/ManagementDashboard";
import TeamRolesPage from "./pages/crm/TeamRoles";
import RingCentralSettingsPage from "./pages/crm/RingCentralSettings";
import BdrReportsPage from "./pages/crm/BdrReports";
import AgentDashboardPage from "./pages/AgentDashboard";
import FieldVisitsPage from "./pages/FieldVisits";
import FrExpensesPage from "./pages/FrExpenses";
import BdrExpensesPage from "./pages/BdrExpenses";
import ExpensesPage from "./pages/Expenses";
import LeadCapturePage from "./pages/LeadCapture";
import ReferralRewardsPage from "./pages/ReferralRewards";
import FrErrandsPage from "./pages/FrErrands";
import ReferralTrackerPage from "./pages/ReferralTracker";
import PartnerReferralTrackerPage from "./pages/PartnerReferralTracker";
import ReferralReportsPage from "./pages/ReferralReports";
import BdrAdminDashboardPage from "./pages/BdrAdminDashboard";
import AgentsPage from "./pages/Agents";
import PiClientsPage from "./pages/PiClients";
import FilevineSettingsPage from "./pages/FilevineSettings";
import SettingsPage from "./pages/Settings";
import RingCentralCallback from "./pages/RingCentralCallback";
import { RingCentralProvider } from "./components/RingCentralWidget";
import type { CallEndData } from "./components/RingCentralWidget";
import { trpc } from "./lib/trpc";
import { toast } from "sonner";
import { useAuth } from "./_core/hooks/useAuth";
import Login from "./pages/Login";
import { Scale, Loader2 } from "lucide-react";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        {/* Home: Command Center dashboard */}
        <Route path="/" component={Dashboard} />
        <Route path="/map" component={CaliforniaMapPage} />

        {/* Lead Scraper */}
        <Route path="/search" component={SearchPage} />
        <Route path="/saved-leads" component={SavedLeadsPage} />
        <Route path="/saved-searches" component={SavedSearchesPage} />

        {/* Facility Partner CRM */}
        <Route path="/crm/pipeline" component={PipelinePage} />
        <Route path="/crm/facilities" component={FacilitiesPage} />
        <Route path="/crm/facilities/new" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id/edit" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id" component={FacilityProfilePage} />
        <Route path="/crm/dashboard" component={ManagementDashboardPage} />
        <Route path="/team" component={TeamRolesPage} />
        <Route path="/crm/ringcentral" component={RingCentralSettingsPage} />
        <Route path="/crm/uber-eats" component={UberEatsPage} />
        <Route path="/crm/leads" component={LeadCapturePage} />
        <Route path="/crm/reports" component={BdrReportsPage} />

        {/* BDR Reports */}
        <Route path="/bdr/admin" component={BdrAdminDashboardPage} />
        <Route path="/bdr/dashboard" component={AgentDashboardPage} />
        <Route path="/bdr/field-visits" component={FieldVisitsPage} />
        <Route path="/bdr/expenses" component={ExpensesPage} />
        <Route path="/bdr/fr-expenses" component={FrExpensesPage} />
        <Route path="/bdr/bdr-expenses" component={BdrExpensesPage} />
        <Route path="/bdr/referral-rewards" component={ReferralRewardsPage} />
        <Route path="/bdr/fr-errands" component={FrErrandsPage} />
        <Route path="/bdr/referral-tracker" component={ReferralTrackerPage} />

        {/* Partner Referral Workflow */}
        <Route path="/referral/tracker" component={PartnerReferralTrackerPage} />
        <Route path="/referral/reports" component={ReferralReportsPage} />

        {/* Agent Management */}
        <Route path="/agents" component={AgentsPage} />

        {/* PI Clients */}
        <Route path="/pi-clients" component={PiClientsPage} />

        {/* Filevine Integration */}
        <Route path="/filevine" component={FilevineSettingsPage} />

        {/* App settings / branding */}
        <Route path="/settings" component={SettingsPage} />

        <Route path="/ringcentral-callback" component={RingCentralCallback} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

/**
 * Once-per-session follow-up digest. On load, surfaces how many of the rep's
 * own tasks are due today / overdue and links straight to My Day — so cadence
 * pulls reps back instead of relying on them to go looking.
 */
function FollowUpDigest() {
  const [, navigate] = useLocation();
  const { data: myTasks } = trpc.crm.tasks.listMine.useQuery({ status: "open" });
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current || !myTasks) return;
    if (sessionStorage.getItem("followup-digest-shown")) { shownRef.current = true; return; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    let overdue = 0, dueToday = 0;
    for (const t of (myTasks as Array<{ dueDate?: string | Date | null; status?: string }>)) {
      if (!t.dueDate || t.status === "completed") continue;
      const d = new Date(t.dueDate);
      if (d < today) overdue++;
      else if (d < tomorrow) dueToday++;
    }
    const total = overdue + dueToday;
    if (total > 0) {
      toast(`${total} follow-up${total > 1 ? "s" : ""} need attention`, {
        description: `${dueToday} due today · ${overdue} overdue`,
        action: { label: "My Day", onClick: () => navigate("/") },
        duration: 9000,
      });
    }
    sessionStorage.setItem("followup-digest-shown", "1");
    shownRef.current = true;
  }, [myTasks, navigate]);

  return null;
}

function AppWithPhone() {
  const utils = trpc.useUtils();

  // Auto-log facility calls when a RingCentral call ends.
  // Uses logFacilityCall which: matches facility by phone → creates contact log → fetches RC recording → Whisper transcription → AI summary → saves to facility_updates.
  const logFacilityCall = trpc.crm.ringcentral.logFacilityCall.useMutation({
    onSuccess: (result) => {
      if (result.facilityId) {
        utils.crm.contactLogs.list.invalidate();
        utils.crm.facilities.get.invalidate();
        utils.crm.updates.list.invalidate();          // transcript + AI summary
        utils.crm.tasks.listByFacility.invalidate();  // auto-created follow-up tasks
        utils.crm.tasks.listMine.invalidate();
        utils.crm.tasks.listOverdue.invalidate();
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
        duration: 60000,
      });

      logFacilityCall.mutate(
        {
          phone: data.phoneNumber,
          facilityId: data.facilityId,
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
            if (result.facilityId) {
              if (result.hasTranscript && result.hasAiSummary) {
                const taskNote = result.followUpTasksCreated ? ` · ${result.followUpTasksCreated} task${result.followUpTasksCreated !== 1 ? "s" : ""} created` : "";
                const actionNote = result.actionItemsCount ? ` · ${result.actionItemsCount} action item${result.actionItemsCount !== 1 ? "s" : ""}` : "";
                toast.success(
                  `Call logged & analysed for ${result.facilityName}`,
                  {
                    description: `${dur} · transcript + AI summary${actionNote}${taskNote}`,
                    duration: 10000,
                  }
                );
              } else if (result.hasTranscript) {
                toast.success(
                  `Call logged & transcribed for ${result.facilityName}`,
                  {
                    description: `${dur} · ${data.direction ?? ""} · transcript saved`,
                    duration: 8000,
                  }
                );
              } else {
                toast.success(
                  `Call logged for ${result.facilityName}`,
                  {
                    description: `${dur} · ${data.direction ?? ""} · no recording available yet`,
                    duration: 6000,
                  }
                );
              }
            } else {
              toast.info(`Call ended — ${phone} · ${dur}`, {
                description: "No matching facility found. Open the facility profile to log manually.",
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
      <FollowUpDigest />
      <Router />
    </RingCentralProvider>
  );
}

/**
 * Auth gate. Shows the login screen when no session exists, so that NO protected
 * query (or the RingCentral widget) mounts until the user is authenticated.
 * This is what makes per-user password login secure — there is no path into the
 * app without a valid session.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="dashboard-mesh min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Scale className="w-6 h-6 text-primary" />
        </div>
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;

  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <AuthGate>
            <AppWithPhone />
          </AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
