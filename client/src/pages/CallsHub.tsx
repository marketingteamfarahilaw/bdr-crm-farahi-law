/**
 * Call Analytics and Call Logs on one page, as tabs (the team's Sept 30 2026
 * list: "merge with Call Logs to combine all features and analytics in one
 * place"). Each keeps its own address so links and bookmarks still work.
 */
import { useLocation } from "wouter";
import { PageTabs } from "@/components/PageTabs";
import CallAnalytics from "./CallAnalytics";
import CallLogs from "./CallLogs";

export default function CallsHub() {
  const [location, navigate] = useLocation();
  const tab = location.startsWith("/call-logs") ? "logs" : "analytics";
  return (
    <div className="relative">
      <PageTabs
        tabs={[["analytics", "Analytics"], ["logs", "Call Logs"]] as const}
        active={tab}
        onChange={(k) => navigate(k === "logs" ? "/call-logs" : "/call-analytics")}
      />
      {tab === "logs" ? <CallLogs /> : <CallAnalytics />}
    </div>
  );
}
