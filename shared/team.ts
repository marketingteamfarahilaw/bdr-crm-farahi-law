// The current BD/FR team — imported by both client and server (@shared/team).
//
// Reports use this to separate today's team from former representatives:
// a former rep's past sign-ups stay in historical reporting, but they shouldn't
// crowd the current team's leaderboard. Who is CREDITED with a lead is decided
// separately, by the Lead Docket rules (scripts/migration/leaddocket-rules.mjs),
// which also recognise former reps.
//
// "Intake" is Malvin Rosales, the Intake Department Manager: not BD/FR, but the
// leads he brings in are credited to him and counted, under their own role.
//
// Update this when someone joins or leaves the team.

export type TeamRole = "BDR" | "FR" | "Intake";

export const CURRENT_TEAM: Record<TeamRole, readonly string[]> = {
  BDR: ["Ally Maceda", "Grace Lanayon", "Miguel Flores", "Queenie Miranda"],
  FR: ["Zulema Salas", "Lupe Campos", "Jezel Mercado", "Genysys Sanchez"],
  Intake: ["Malvin Rosales"],
};

const CURRENT = new Set(
  [...CURRENT_TEAM.BDR, ...CURRENT_TEAM.FR, ...CURRENT_TEAM.Intake].map((n) => n.toLowerCase()),
);

/** True for a member of today's team (case-insensitive, full name). */
export const isCurrentRep = (name?: string | null) =>
  CURRENT.has(String(name ?? "").trim().toLowerCase());
