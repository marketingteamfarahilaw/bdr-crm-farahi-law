// The current BD/FR team — imported by both client and server (@shared/team).
//
// Reports use this to separate today's team from former representatives:
// a former rep's past sign-ups stay in historical reporting, but they shouldn't
// crowd the current team's leaderboard. Who is CREDITED with a lead is decided
// separately, by the Lead Docket rules (scripts/migration/leaddocket-rules.mjs),
// which also recognise former reps.
//
// Update this when someone joins or leaves the team.

export const CURRENT_TEAM: Record<"BDR" | "FR", readonly string[]> = {
  BDR: ["Ally Maceda", "Grace Lanayon", "Miguel Flores", "Queenie Miranda"],
  FR: ["Zulema Salas", "Lupe Campos", "Jezel Mercado", "Genysys Sanchez"],
};

const CURRENT = new Set(
  [...CURRENT_TEAM.BDR, ...CURRENT_TEAM.FR].map((n) => n.toLowerCase()),
);

/** True for a member of today's BD/FR team (case-insensitive, full name). */
export const isCurrentRep = (name?: string | null) =>
  CURRENT.has(String(name ?? "").trim().toLowerCase());
