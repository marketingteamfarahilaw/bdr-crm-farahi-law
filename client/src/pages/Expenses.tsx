/**
 * Unified Expenses — one page, two ledgers (Field Rep + BDR) behind a tab toggle,
 * plus Uber Eats, which imports partner meals as expenses (its own menu item
 * until Sept 2026; /crm/uber-eats opens that tab). Replaces the separate FR/BDR
 * expense nav entries; both old routes still work. Renders the existing page
 * components so their CRUD + CSV export are unchanged.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { normalizeRole } from "@shared/permissions";
import { PageTabs } from "@/components/PageTabs";
import FrExpenses from "./FrExpenses";
import BdrExpenses from "./BdrExpenses";
import UberEats from "./crm/UberEats";

const UBER_PATH = "/crm/uber-eats";

export default function Expenses() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const isFR = role === "fr_agent" || role === "fr_manager";
  const [location, navigate] = useLocation();
  const [ledger, setLedger] = useState<"fr" | "bdr">(isFR ? "fr" : "bdr");
  // Uber Eats has its own address, so a link or refresh lands on it.
  const tab = location.startsWith(UBER_PATH) ? "uber" : ledger;

  return (
    <div className="relative">
      <PageTabs
        tabs={[["fr", "Field Rep Expenses"], ["bdr", "BDR Expenses"], ["uber", "Uber Eats"]] as const}
        active={tab}
        onChange={(k) => {
          if (k === "uber") return navigate(UBER_PATH);
          setLedger(k);
          if (tab === "uber") navigate("/bdr/expenses");
        }}
      />
      {tab === "uber" ? <UberEats /> : tab === "fr" ? <FrExpenses /> : <BdrExpenses />}
    </div>
  );
}
