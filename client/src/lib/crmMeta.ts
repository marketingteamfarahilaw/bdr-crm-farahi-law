/**
 * Single source of truth for partner/relationship status → badge label + color.
 * Previously duplicated (and divergent) across the facility-listing pages.
 * `color` is a Tailwind class string for badge styling. Covers both the
 * partnerStatus and relationshipStatus value sets.
 */
export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  // partnerStatus
  prospect:         { label: "Prospect",         color: "bg-sky-500/20 text-sky-400 border-sky-500/30" },
  active_partner:   { label: "Active Partner",   color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  priority_partner: { label: "Priority Partner", color: "bg-primary/15 text-primary border-primary/30" },
  needs_follow_up:  { label: "Needs Follow-Up",  color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  dormant:          { label: "Dormant",          color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  do_not_use:       { label: "Do Not Use",       color: "bg-red-900/30 text-red-300 border-red-900/50" },
  // relationshipStatus
  warm_lead:        { label: "Warm Lead",        color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  cold:             { label: "Cold",             color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  churned:          { label: "Churned",          color: "bg-red-500/20 text-red-400 border-red-500/30" },
  do_not_contact:   { label: "Do Not Contact",   color: "bg-red-900/30 text-red-300 border-red-900/50" },
  needs_agent:      { label: "Needs Agent",      color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

/** Safe lookup with a neutral fallback for unknown/empty statuses. */
export function statusMeta(status?: string | null): { label: string; color: string } {
  if (!status) return { label: "—", color: "bg-muted text-muted-foreground border-border" };
  return STATUS_LABELS[status] ?? { label: status.replace(/_/g, " "), color: "bg-muted text-muted-foreground border-border" };
}
