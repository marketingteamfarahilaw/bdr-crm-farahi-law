import { Flame, Thermometer, Snowflake } from "lucide-react";
import type { ScoreBreakdown } from "@/types/lead";

interface ScoreBadgeProps {
  score: number;
  tier: "hot" | "warm" | "cold";
  size?: "sm" | "md" | "lg";
}

const TIER_CONFIG = {
  hot: {
    icon: Flame,
    label: "Hot",
    className: "tier-hot",
    barClass: "bg-gradient-to-r from-orange-600 to-red-500",
  },
  warm: {
    icon: Thermometer,
    label: "Warm",
    className: "tier-warm",
    barClass: "bg-gradient-to-r from-yellow-600 to-amber-400",
  },
  cold: {
    icon: Snowflake,
    label: "Cold",
    className: "tier-cold",
    barClass: "bg-gradient-to-r from-blue-700 to-blue-400",
  },
};

export function ScoreBadge({ score, tier, size = "md" }: ScoreBadgeProps) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5 gap-1",
    md: "text-sm px-2.5 py-1 gap-1.5",
    lg: "text-base px-3 py-1.5 gap-2",
  };

  const iconSizes = { sm: 10, md: 12, lg: 14 };

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${config.className} ${sizeClasses[size]}`}
    >
      <Icon size={iconSizes[size]} />
      <span>{score}</span>
      <span className="opacity-70">·</span>
      <span>{config.label}</span>
    </span>
  );
}

interface ScoreBreakdownCardProps {
  breakdown: ScoreBreakdown;
}

export function ScoreBreakdownCard({ breakdown }: ScoreBreakdownCardProps) {
  const components = [
    { label: "Rating", value: breakdown.ratingScore, max: 30, description: "Google rating (0–5 scale)" },
    { label: "Review Volume", value: breakdown.reviewScore, max: 30, description: "Number of reviews (cap: 500)" },
    { label: "Proximity", value: breakdown.proximityScore, max: 20, description: "Distance from searched location" },
    { label: "Category Relevance", value: breakdown.categoryScore, max: 20, description: "PI referral relevance weight" },
  ];

  const tier = breakdown.tier;
  const barColorClass =
    tier === "hot"
      ? "bg-gradient-to-r from-orange-600 to-red-500"
      : tier === "warm"
      ? "bg-gradient-to-r from-yellow-600 to-amber-400"
      : "bg-gradient-to-r from-blue-700 to-blue-400";

  return (
    <div className="space-y-3">
      {components.map((comp) => (
        <div key={comp.label}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="text-sm font-medium text-foreground">{comp.label}</span>
              <span className="text-xs text-muted-foreground ml-2">{comp.description}</span>
            </div>
            <span className="text-sm font-semibold text-foreground">
              {comp.value}
              <span className="text-muted-foreground font-normal">/{comp.max}</span>
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColorClass}`}
              style={{ width: `${(comp.value / comp.max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Total Score</span>
        <ScoreBadge score={breakdown.total} tier={breakdown.tier} size="md" />
      </div>
    </div>
  );
}
