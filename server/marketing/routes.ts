/**
 * How leads reached us: Lead Docket's Contact Source folded into a handful of
 * routes — the door the lead came through, as against Marketing Source, which
 * says who gets the credit. The doors convert very differently (website chat
 * and the answering service sign a fraction of what Google search does), which
 * is what decides whether a door is worth paying for.
 *
 * Pure: it works from derive()'s leads, so every lead is in exactly one route
 * and the routes add back to the scorecard's totals.
 */
import { NOT_VIABLE, clean, keyOf, pct, type Lead } from "./common";
import { reasonOf } from "./reasons";

/** Tested against clean(contactSource) in order; the first match wins. */
export const ROUTE_RULES: [RegExp, string][] = [
  [/^walker/i, "Walker call line"],
  [/after\s?hours/i, "After-hours answering service"],
  [/web chat|^intaker\b/i, "Website chat (Intaker)"],
  [/web form|jotform/i, "Website form"],
  [/^web search$/i, "Google search"],
  [/google my business|^gmb\b/i, "Google Business Profile"],
  [/local services/i, "Google Local Services Ads"],
  [/facebook|\bfb\b|instagram|social media|youtube|tiktok/i, "Social media"],
  [/yelp|avvo/i, "Directories (Yelp, Avvo)"],
  [/website|\.com\b/i, "Firm and partner websites"],
  [/walk[\s-]?in/i, "Walk-in"],
  [/phone call/i, "Phone call"],
  [/existing client/i, "Existing client"],
  [/flf employee|^(bdr|field representative)\b|^justin farahi$/i, "Staff and team referral"],
  [/referral|attorney/i, "Attorney referral"],
  [/collision|auto body|body & paint|towing|insurance|urgent care|chiropractic|orthopedic|\bmri\b|m\.d\./i, "Partner business"],
  [/television|radio|billboard/i, "TV, radio, outdoor"],
];

export const NOT_RECORDED = "Not recorded";
export const OTHER_ROUTE = "Other";

// Lead Docket has a few hundred distinct Contact Source spellings and the
// dashboard classifies up to ~45k leads a request, so each spelling is matched
// against the rules once. Capped so a flood of junk values can't grow it forever.
const routeCache = new Map<string, string>();
const ROUTE_CACHE_MAX = 5000;

export function routeOf(contactSource: string | null): string {
  const raw = contactSource ?? "";
  const hit = routeCache.get(raw);
  if (hit !== undefined) return hit;
  const v = clean(raw);
  let route = OTHER_ROUTE;
  // Intake picks "Unknown" when the caller can't say — no better than leaving it blank.
  if (!v || keyOf(v) === "unknown") route = NOT_RECORDED;
  else for (const [re, name] of ROUTE_RULES) if (re.test(v)) { route = name; break; }
  if (routeCache.size < ROUTE_CACHE_MAX) routeCache.set(raw, route);
  return route;
}

/**
 * The drill value for a lead's Contact Source: the raw value, so the server's
 * IN (...) matches it exactly, with '' standing for NULL or empty.
 */
const memberOf = (contactSource: string | null) => contactSource ?? "";

export type Routes = {
  rows: { name: string; members: string[]; leads: number; signed: number; conversion: number; notViable: number; lostThem: number }[];
  otherMembers: { value: string; leads: number }[];
  sameAsSource: number;   // % of leads whose contactSource equals marketingSource; about 70% today
};

export function contactRoutes(leads: Lead[]): Routes {
  type Acc = { name: string; members: Map<string, number>; leads: number; signed: number; notViable: number; lostThem: number };
  const routes = new Map<string, Acc>();
  // Other's values, merged by spelling, so the ones that need a rule stand out.
  const other = new Map<string, { value: string; leads: number }>();
  let same = 0;

  for (const l of leads) {
    const name = routeOf(l.contactSource);
    const r = routes.get(name) ?? { name, members: new Map<string, number>(), leads: 0, signed: 0, notViable: 0, lostThem: 0 };
    const member = memberOf(l.contactSource);
    r.members.set(member, (r.members.get(member) ?? 0) + 1);
    r.leads++;
    if (l.signed) r.signed++;
    const reason = reasonOf(l.bucket, l.status, l.subStatus);
    if (NOT_VIABLE.has(reason)) r.notViable++;
    else if (reason === "lostThem") r.lostThem++;
    routes.set(name, r);

    const contact = clean(l.contactSource);
    if (name === OTHER_ROUTE) {
      const k = keyOf(contact);
      const o = other.get(k) ?? { value: contact, leads: 0 };
      o.leads++;
      other.set(k, o);
    }
    // Walker's own lines carry the contract as both, which is why most leads match.
    if (contact && keyOf(contact) === keyOf(clean(l.marketingSource))) same++;
  }

  const rows = Array.from(routes.values())
    .map((r) => ({
      name: r.name,
      members: Array.from(r.members.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m),
      leads: r.leads,
      signed: r.signed,
      conversion: pct(r.signed, r.leads),
      notViable: r.notViable,
      lostThem: r.lostThem,
    }))
    .sort((a, b) => b.leads - a.leads || b.signed - a.signed || a.name.localeCompare(b.name));

  return {
    rows,
    otherMembers: Array.from(other.values()).sort((a, b) => b.leads - a.leads || a.value.localeCompare(b.value)),
    sameAsSource: pct(same, leads.length),
  };
}

/**
 * The routes are a lens on the same leads as the scorecard, so they must add
 * back to its totals, and each Contact Source value must drill into exactly the
 * route it's counted in. Returns the problems; empty when it all reconciles.
 */
export function checkRoutes(r: Routes, totals: { leads: number; signed: number }): string[] {
  const problems: string[] = [];
  const sum = (k: "leads" | "signed") => r.rows.reduce((a, row) => a + row[k], 0);
  if (sum("leads") !== totals.leads) problems.push(`routes: leads add to ${sum("leads")}, scorecard has ${totals.leads}`);
  if (sum("signed") !== totals.signed) problems.push(`routes: signed add to ${sum("signed")}, scorecard has ${totals.signed}`);

  const names = new Set<string>();
  const owner = new Map<string, string>();
  for (const row of r.rows) {
    if (names.has(row.name)) problems.push(`routes: ${row.name} appears twice`);
    names.add(row.name);
    if (row.leads <= 0) problems.push(`routes: ${row.name} has no leads`);
    if (row.signed > row.leads) problems.push(`routes: ${row.name} signed ${row.signed} of ${row.leads}`);
    if (row.signed + row.notViable + row.lostThem > row.leads) problems.push(`routes: ${row.name} signed + not viable + lost add to more than its ${row.leads} leads`);
    if (row.conversion !== pct(row.signed, row.leads)) problems.push(`routes: ${row.name} conversion ${row.conversion}% ≠ ${pct(row.signed, row.leads)}%`);
    if (!row.members.length) problems.push(`routes: ${row.name} has no members to drill into`);
    for (const m of row.members) {
      const prev = owner.get(m);
      if (prev !== undefined) problems.push(`routes: "${m}" is in both ${prev} and ${row.name}`);
      owner.set(m, row.name);
      const back = routeOf(m || null);
      if (back !== row.name) problems.push(`routes: "${m}" is listed under ${row.name} but routes to ${back}`);
    }
  }

  const otherLeads = r.rows.find((row) => row.name === OTHER_ROUTE)?.leads ?? 0;
  const otherListed = r.otherMembers.reduce((a, o) => a + o.leads, 0);
  if (otherListed !== otherLeads) problems.push(`routes: Other's values add to ${otherListed}, its row has ${otherLeads}`);
  if (!(r.sameAsSource >= 0 && r.sameAsSource <= 100)) problems.push(`routes: sameAsSource is ${r.sameAsSource}%`);
  return problems;
}
