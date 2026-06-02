import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Search, SlidersHorizontal } from "lucide-react";

export interface BdrFilterValues {
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
  month?: string;
  year?: string;
  status?: string;
  search?: string;
}

interface BdrFilterBarProps {
  filters: BdrFilterValues;
  onChange: (filters: BdrFilterValues) => void;
  /** Which filter fields to show */
  show?: {
    agent?: boolean;
    dateRange?: boolean;
    month?: boolean;
    year?: boolean;
    status?: boolean;
    search?: boolean;
  };
  /** Options for the status dropdown */
  statusOptions?: string[];
  /** Whether to show the agent dropdown (admin only) */
  showAgentFilter?: boolean;
}

const AGENTS = ["Gracel", "Queenie", "Ally", "Miguel", "Rupert"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = ["2024", "2025", "2026"];

export function BdrFilterBar({
  filters,
  onChange,
  show = {},
  statusOptions = [],
  showAgentFilter = true,
}: BdrFilterBarProps) {
  const {
    agent: showAgent = true,
    dateRange = true,
    month: showMonth = false,
    year: showYear = true,
    status: showStatus = false,
    search: showSearch = true,
  } = show;

  const set = (key: keyof BdrFilterValues, value: string | undefined) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const clearAll = () => onChange({});

  return (
    <div className="bg-muted/30 border rounded-lg p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Filters</span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearAll}
          >
            <X className="h-3 w-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        {/* Search */}
        {showSearch && (
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, facility..."
                value={filters.search ?? ""}
                onChange={(e) => set("search", e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>
        )}

        {/* Agent filter — admin only */}
        {showAgent && showAgentFilter && (
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Agent</Label>
            <Select
              value={filters.agent ?? "all"}
              onValueChange={(v) => set("agent", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {AGENTS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Date From */}
        {dateRange && (
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground mb-1 block">From date</Label>
            <Input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => set("dateFrom", e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        )}

        {/* Date To */}
        {dateRange && (
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground mb-1 block">To date</Label>
            <Input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => set("dateTo", e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        )}

        {/* Month */}
        {showMonth && (
          <div className="min-w-[140px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Month</Label>
            <Select
              value={filters.month ?? "all"}
              onValueChange={(v) => set("month", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {MONTHS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Year */}
        {showYear && (
          <div className="min-w-[110px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Year</Label>
            <Select
              value={filters.year ?? "all"}
              onValueChange={(v) => set("year", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Status */}
        {showStatus && statusOptions.length > 0 && (
          <div className="min-w-[160px]">
            <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) => set("status", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Object.entries(filters).map(([key, val]) =>
            val ? (
              <span
                key={key}
                className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full"
              >
                <span className="capitalize">{key}:</span>
                <span className="font-medium">{val}</span>
                <button
                  onClick={() => set(key as keyof BdrFilterValues, undefined)}
                  className="ml-0.5 hover:text-primary/70"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
