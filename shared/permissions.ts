// Central role / permission model — imported by both client and server (@shared/permissions).
//
// Roles:
//   super_admin     — everything, and can assign roles
//   bdr_manager     — sees ALL BD/FR data, cannot assign roles
//   fr_manager      — sees ALL BD/FR data, cannot assign roles
//   bdr_agent       — BDR tools, scoped to their OWN data only
//   fr_agent        — FR tools, scoped to their OWN data only
//   intake_manager  — the Intake (AI Case Desk) side ONLY, sees all intake data + intake settings
//   intake_agent    — the Intake side ONLY, works the shared lead queue
//   admin/user      — legacy values (admin → treated as super_admin; user → treated as bdr_agent)
//
// HARD WALL: intake roles never see BD/FR data (facilities, partner calls,
// expenses, reports) and BD/FR roles never see intake data (potential-client
// case facts are sensitive). Only the super admin crosses the wall.

export type Role =
  | "super_admin" | "bdr_manager" | "fr_manager" | "bdr_agent" | "fr_agent"
  | "intake_manager" | "intake_agent"
  | "admin" | "user";

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  bdr_manager: "BDR Manager",
  fr_manager: "FR Manager",
  bdr_agent: "BDR Agent",
  fr_agent: "FR Agent",
  intake_manager: "Intake Manager",
  intake_agent: "Intake Specialist",
  admin: "Admin (legacy)",
  user: "Unassigned",
};

// Roles offered in the assignment picker.
export const ASSIGNABLE_ROLES = ["super_admin", "bdr_manager", "fr_manager", "bdr_agent", "fr_agent", "intake_manager", "intake_agent"] as const;

export function normalizeRole(role?: string | null): Role {
  if (role === "admin") return "super_admin";   // legacy admin == super admin
  if (!role || role === "user") return "bdr_agent"; // legacy default
  return role as Role;
}

export const isSuperAdmin = (r?: string | null) => normalizeRole(r) === "super_admin";

export const isManager = (r?: string | null) => {
  const n = normalizeRole(r);
  return n === "super_admin" || n === "bdr_manager" || n === "fr_manager";
};

/** Managers + super admin see all data; agents are scoped to their own. */
export const seesAllData = (r?: string | null) => isManager(r);

export const isAgent = (r?: string | null) => {
  const n = normalizeRole(r);
  return n === "bdr_agent" || n === "fr_agent";
};

/** Can use the BDR side of the app (lead scraper, facilities, BDR tools). */
export const canSeeBDR = (r?: string | null) => isManager(r) || normalizeRole(r) === "bdr_agent";

/** Can use the FR side of the app (field visits, FR expenses/errands). */
export const canSeeFR = (r?: string | null) => isManager(r) || normalizeRole(r) === "fr_agent";

/** Management dashboards, team page, cross-agent reports. */
export const canManage = (r?: string | null) => isManager(r);

/** Only the super admin can change other people's roles. */
export const canAssignRoles = (r?: string | null) => isSuperAdmin(r);

// ─── Intake (AI Case Desk) ────────────────────────────────────────────────────

/** An intake-side role (NOT the super admin — used to hide the BD/FR app from them). */
export const isIntakeOnly = (r?: string | null) => {
  const n = normalizeRole(r);
  return n === "intake_manager" || n === "intake_agent";
};

/** Can open the Intake side: the intake team + the super admin. */
export const canSeeIntake = (r?: string | null) => isIntakeOnly(r) || isSuperAdmin(r);

/** Intake settings (Filevine webhook), lead deletion, assignment. */
export const canManageIntake = (r?: string | null) =>
  normalizeRole(r) === "intake_manager" || isSuperAdmin(r);
