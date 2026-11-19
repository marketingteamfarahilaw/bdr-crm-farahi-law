/**
 * The Audit tab's "Only on the sheet" names, explained: for each client the
 * team's sheet lists as signed but this period's GBP/SEO sign-ups don't, find
 * them among every lead the CRM holds from Lead Docket and say why they aren't
 * on the list — not in Lead Docket at all (not entered, or not synced yet),
 * credited to a rep or a non-digital source, not signed, or outside the period.
 * Each is something to fix in Lead Docket or on the sheet.
 *
 * Also returns the Lead Docket sync's state, so the tab can say when it is
 * comparing against a stale copy. Read only.
 */
import { or, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { leaddocketLeads } from "../drizzle/schema";
import { nameKey, sameName } from "@shared/digitalSheet";
import { TZ, clean } from "./marketing/common";
import { classify } from "./digitalMarketing";
import { getStatus } from "./dataSync";

const L = leaddocketLeads;

export type FoundLead = {
  leadId: number; clientName: string | null; leadDate: Date | string | null;
  outcome: string | null; status: string | null; subStatus: string | null; caseType: string | null;
  marketingSource: string | null; teamRole: string | null; teamRep: string | null;
};

export type Explained = {
  name: string;
  found: { leadId: number; name: string; date: string | null; outcome: string | null } | null;
  reason: string;
  /** Who fixes it: Lead Docket, the sheet, or nobody (it should already match). */
  fix: "leaddocket" | "sheet" | "check";
};

const day = (d: Date | string | null) => (d ? formatInTimeZone(new Date(d), TZ, "yyyy-MM-dd") : null);

/**
 * Why one of the CRM's leads isn't among this period's GBP/SEO sign-ups, in
 * the order the report itself filters: BD/FR first (never digital), then the
 * Marketing Source, Ads (the sheet has no Ads row), signed, then the date.
 */
export function whyNotListed(l: FoundLead, range: { fromDay: string; toDay: string }): Pick<Explained, "reason" | "fix"> {
  if (l.teamRole === "BDR" || l.teamRole === "FR") {
    return { reason: `Credited to ${l.teamRole} ${clean(l.teamRep) || "rep"} in Lead Docket, so it counts as a BD/FR lead, not digital`, fix: "leaddocket" };
  }
  const c = classify({ ...l, leadDate: l.leadDate ?? new Date(0) });
  if (!c) return { reason: `Marketing Source in Lead Docket is "${clean(l.marketingSource) || "blank"}", which isn't a GBP or SEO source`, fix: "leaddocket" };
  if (c.group === "Ads") return { reason: `Counted under Ads (${c.label}); the sheet has no Ads row`, fix: "check" };
  if (!c.signed) return { reason: `Not signed in Lead Docket: ${[clean(l.outcome), clean(l.status)].filter(Boolean).join(" · ") || "no outcome"}`, fix: "leaddocket" };
  const d = day(l.leadDate);
  if (!d) return { reason: "Has no lead date in Lead Docket, so no period counts it", fix: "leaddocket" };
  if (d < range.fromDay || d > range.toDay) return { reason: `Lead date in Lead Docket is ${d}, outside this period`, fix: "check" };
  return { reason: `In Lead Docket as ${c.label}, spelled "${clean(l.clientName)}" — the names didn't match`, fix: "sheet" };
}

/** Of several leads for one name, the one that explains it best: in the period and signed first, then the newest. */
function best(cands: FoundLead[], range: { fromDay: string; toDay: string }) {
  const score = (l: FoundLead) => {
    const d = day(l.leadDate) ?? "";
    const c = classify({ ...l, leadDate: l.leadDate ?? new Date(0) });
    return (d >= range.fromDay && d <= range.toDay ? 2 : 0) + (c?.signed ? 1 : 0);
  };
  return [...cands].sort((a, b) => score(b) - score(a) || String(day(b.leadDate)).localeCompare(String(day(a.leadDate))))[0];
}

export function explainNames(names: string[], leads: FoundLead[], range: { fromDay: string; toDay: string }): Explained[] {
  const keyed = leads.map((l) => ({ l, k: nameKey(clean(l.clientName)) }));
  return names.map((name) => {
    const k = nameKey(name);
    const cands = keyed.filter((x) => x.k && sameName(k, x.k)).map((x) => x.l);
    if (!cands.length) {
      return {
        name, found: null, fix: "leaddocket" as const,
        reason: "No lead by this name in the CRM's copy of Lead Docket: not entered in Lead Docket yet, entered under another name, or not synced",
      };
    }
    const l = best(cands, range);
    return {
      name,
      found: { leadId: l.leadId, name: clean(l.clientName), date: day(l.leadDate), outcome: clean(l.outcome) || null },
      ...whyNotListed(l, range),
    };
  });
}

/** The longest word of a name key, which narrows the read to a few rows per name. */
const probe = (name: string) => nameKey(name).split(" ").filter((w) => w.length >= 3).sort((a, b) => b.length - a.length)[0];

export async function explainSheetNames(names: string[], range: { fromDay: string; toDay: string }) {
  const sync = await getStatus("leaddocket");
  const out = {
    sync: { lastSuccessAt: sync.lastSuccessAt, state: sync.state, summary: sync.summary },
    names: [] as Explained[],
  };
  if (!names.length) return out;
  const words = Array.from(new Set(names.map(probe).filter(Boolean)));
  const db = await getDb();
  if (!db) return out;
  const leads = words.length
    ? await db.select({
        leadId: L.leadId, clientName: L.clientName, leadDate: L.leadDate,
        outcome: L.outcome, status: L.status, subStatus: L.subStatus, caseType: L.caseType,
        marketingSource: L.marketingSource, teamRole: L.teamRole, teamRep: L.teamRep,
      }).from(L).where(or(...words.map((w) => sql`LOWER(${L.clientName}) LIKE ${`%${w}%`}`))).limit(5000)
    : [];
  out.names = explainNames(names, leads, range);
  return out;
}
