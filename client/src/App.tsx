import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import SearchPage from "./pages/Search";
import SavedLeadsPage from "./pages/SavedLeads";
import SavedSearchesPage from "./pages/SavedSearches";
import FacilitiesPage from "./pages/crm/Facilities";
import FacilityProfilePage from "./pages/crm/FacilityProfile";
import FacilityFormPage from "./pages/crm/FacilityForm";
import ManagementDashboardPage from "./pages/crm/ManagementDashboard";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        {/* Lead Scraper */}
        <Route path="/" component={SearchPage} />
        <Route path="/saved-leads" component={SavedLeadsPage} />
        <Route path="/saved-searches" component={SavedSearchesPage} />

        {/* Facility Partner CRM */}
        <Route path="/crm/facilities" component={FacilitiesPage} />
        <Route path="/crm/facilities/new" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id/edit" component={FacilityFormPage} />
        <Route path="/crm/facilities/:id" component={FacilityProfilePage} />
        <Route path="/crm/dashboard" component={ManagementDashboardPage} />

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
