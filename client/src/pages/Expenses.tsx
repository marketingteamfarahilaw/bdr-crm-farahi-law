/**
 * Unified Expenses — one page, two ledgers (Field Rep + BDR) behind a tab toggle.
 * Replaces the separate FR/BDR expense nav entries; both old routes still work.
 * Renders the existing page components so their CRUD + CSV export are unchanged.
 */
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { normalizeRole } from "@shared/permissions";
import FrExpenses from "./FrExpenses";
import BdrExpenses from "./BdrExpenses";

export default function Expenses() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const isFR = role === "fr_agent" || role === "fr_manager";
  const [tab, setTab] = useState<"fr" | "bdr">(isFR ? "fr" : "bdr");

  return (
    <div className="relative">
      <div className="sticky top-0 z-20 flex justify-center px-6 py-2.5 bg-background/85 backdrop-blur border-b border-border">
        <div className="inline-flex rounded-lg border border-border bg-card p-1 text-sm">
          {([["fr", "Field Rep Expenses"], ["bdr", "BDR Expenses"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded-md font-medium transition-colors ${
                tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "fr" ? <FrExpenses /> : <BdrExpenses />}
    </div>
  );
}
