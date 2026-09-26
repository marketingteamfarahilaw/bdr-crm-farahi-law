/**
 * The referring partner as Lead Docket's intake wrote it, reduced to a key — so
 * every lead that says the same thing gets the same answer. The Lead Docket
 * mirror stores it on each lead (facility_leads.partnerKey); the Data Check page
 * groups by it, and a partner someone picks for one lead is remembered for the
 * key (partner_aliases) and applied to every lead with it, past and future.
 *
 * Only this file computes it: the mirror, and the one-off that filled it in,
 * import it, and the app reads the stored value — a second copy of rules like
 * these drifted once and caused a real bug.
 */
import { TEAM } from "./leaddocket-rules.mjs";

/** Letters and digits only, lower-cased; "&" and "and" dropped ("B&B Auto" = "B and B Auto"). */
export const nk = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/\band\b/g, " ").replace(/[^a-z0-9]/g, "");

// Intake often puts the rep first: "Field Representative Genysys Sanchez / Reginos
// Auto Body". The rep is not the partner — that text once matched Sanchez Auto
// Body — so the parts naming a team member or a role are dropped before matching.
// So are former clients and employees who referred someone: they are people,
// not partners ("Former Client Ignacio Hernandez", "Employee Referral Diana Lopez").
const ROLE_WORDS = /\b(field rep(resentative)?|bdr|intake|(former|existing|current|past|previous) client|employee referral)\b/i;
const teamKeys = TEAM.map(([full]) => nk(full));

/** The part of intake's text that can name a partner ("" when it only names people). */
export const partnerPart = (referrer) => String(referrer ?? "").split("/")
  .filter((part) => !ROLE_WORDS.test(part) && !teamKeys.some((t) => nk(part).includes(t)))
  .join(" / ").trim();

/** The key for a lead's referral text: "" when nothing in it can name a partner. */
export const partnerKey = (referrer) => nk(partnerPart(referrer)).slice(0, 255);
