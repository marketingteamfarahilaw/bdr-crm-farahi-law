/**
 * Partner Referrals Report — referrals sent to partners and received from them
 * over a date range, by partner, by representative and one by one. Replaces the
 * old Referral Reports page, which summed every row ever logged with no dates
 * and grouped partners by free-typed name.
 *
 * Counts come from facility_leads, the same rows the Command Center, facility
 * profiles and Representative Performance read, so a partner's numbers agree
 * everywhere:
 *   · sent      — direction sent_to_facility: referrals that actually went out
 *                 (the Partner Referral Tracker's outbound rows are mirrored in
 *                 with externalSource "outbound", externalId = their id) plus
 *                 leads logged on a facility profile.
 *   · received  — direction received_from_facility WITH a partner attached. A
 *                 Lead Docket lead whose referrer matched no partner still
 *                 counts for its rep elsewhere, but isn't a partner referral.
 * Outbound referrals that haven't gone out yet (Pending Review, Issue …) aren't
 * in facility_leads; they're read from outbound_referrals for the pipeline and
 * status breakdown the old page showed.
 */
import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { facilities, facilityLeads, inboundLeads, outboundReferrals } from "../drizzle/schema";
import { CURRENT_TEAM } from "@shared/team";
import { isNonReportingRep } from "@shared/permissions";

const LA = "America/Los_Angeles";
// The statuses import-bdr-from-excel.mjs mirrors into facility_leads as "sent".
const WENT_OUT = new Set(["Referral Sent", "Facility Confirmed", "Client Scheduled", "Client Attended", "Completed"]);
const ATTENDED = new Set(["Client Attended", "Completed"]);
const NEEDS_ATTENTION = new Set(["Pending Review", "Issue / Needs Follow-Up"]);

const first = (s?: string | null) => String(s ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
const TEAM_BY_FIRST = new Map([...CURRENT_TEAM.BDR, ...CURRENT_TEAM.FR, ...CURRENT_TEAM.Intake].map((n) => [first(n), n] as const));
/** One name per person: "LUPE", "Lupe" and "Lupe Campos" are the same rep. */
const repLabel = (raw?: string | null) => {
  const t = String(raw ?? "").trim();
  if (!t) return "Unassigned";
  return TEAM_BY_FIRST.get(first(t)) ?? t;
};

export type PartnerReferralRow = {
  id: number;
  date: string;               // Pacific day, YYYY-MM-DD
  direction: "sent" | "received";
  facilityId: number | null;
  partner: string;
  owner: string | null;
  rep: string;
  client: string | null;
  status: string;             // outbound status, or the lead's outcome
  signed: boolean;
};

export async function getPartnerReferralsReport(range: { from: Date; to: Date }, repNames?: string[] | null) {
  const empty = {
    summary: { sent: 0, received: 0, signed: 0, signRate: null as number | null, partners: 0, attended: 0, pipeline: 0, needsAttention: 0 },
    byPartner: [] as Array<{ facilityId: number | null; partner: string; owner: string | null; category: string | null; sent: number; received: number; signed: number; last: string }>,
    byRep: [] as Array<{ rep: string; sent: number; received: number; signed: number; partners: number }>,
    statuses: [] as Array<{ status: string; count: number }>,
    attention: [] as Array<{ id: number; date: string; client: string; partner: string | null; rep: string; status: string }>,
    rows: [] as PartnerReferralRow[],
  };
  const db = await getDb();
  if (!db) return empty;

  // Agents see only their own rows (matched by full or first name, as the
  // check-in matrix does); managers pass null and see everyone's.
  const wanted = repNames?.map((n) => n.trim().toLowerCase()).filter(Boolean) ?? null;
  const mine = (rep?: string | null) => !wanted || wanted.some((w) => String(rep ?? "").trim().toLowerCase() === w || first(rep) === first(w));
  const dayOf = (d: Date | string | null) => (d ? formatInTimeZone(new Date(d), LA, "yyyy-MM-dd") : "");

  const leads = await db.select({
    id: facilityLeads.id, facilityId: facilityLeads.facilityId, direction: facilityLeads.direction, leadDate: facilityLeads.leadDate,
    outcome: facilityLeads.outcome, signedCase: facilityLeads.signedCase, repName: facilityLeads.repName, contactPerson: facilityLeads.contactPerson,
    externalId: facilityLeads.externalId, externalSource: facilityLeads.externalSource,
    facilityName: facilities.name, owner: facilities.assignedRepName, category: facilities.category,
  }).from(facilityLeads).leftJoin(facilities, eq(facilityLeads.facilityId, facilities.id))
    .where(and(
      gte(facilityLeads.leadDate, range.from), lte(facilityLeads.leadDate, range.to),
      or(eq(facilityLeads.direction, "sent_to_facility"), isNotNull(facilityLeads.facilityId)),
    ));

  // The mirrored rows carry only an id; the tracker rows hold the client and status.
  const outIds = leads.filter((l) => l.externalSource === "outbound" && l.externalId).map((l) => Number(l.externalId)).filter(Number.isFinite);
  const ldIds = leads.filter((l) => l.externalSource === "leaddocket" && l.externalId).map((l) => String(l.externalId));
  const outById = new Map<number, { clientName: string; status: string; recommendedFacility: string | null }>();
  for (let i = 0; i < outIds.length; i += 500) {
    for (const o of await db.select({ id: outboundReferrals.id, clientName: outboundReferrals.clientName, status: outboundReferrals.status, recommendedFacility: outboundReferrals.recommendedFacility })
      .from(outboundReferrals).where(inArray(outboundReferrals.id, outIds.slice(i, i + 500)))) outById.set(o.id, o);
  }
  const inByExt = new Map<string, string>();
  for (let i = 0; i < ldIds.length; i += 500) {
    for (const l of await db.select({ externalId: inboundLeads.externalId, leadName: inboundLeads.leadName })
      .from(inboundLeads).where(and(eq(inboundLeads.externalSource, "leaddocket"), inArray(inboundLeads.externalId, ldIds.slice(i, i + 500))))) {
      if (l.externalId) inByExt.set(l.externalId, l.leadName);
    }
  }

  const rows: PartnerReferralRow[] = [];
  for (const l of leads) {
    if (!mine(l.repName) || isNonReportingRep(l.repName)) continue;
    const sent = l.direction === "sent_to_facility";
    const out = l.externalSource === "outbound" ? outById.get(Number(l.externalId)) : undefined;
    rows.push({
      id: l.id,
      date: dayOf(l.leadDate),
      direction: sent ? "sent" : "received",
      facilityId: l.facilityId,
      partner: l.facilityName ?? out?.recommendedFacility ?? "(partner not linked)",
      owner: l.owner ?? null,
      rep: repLabel(l.repName),
      client: out?.clientName ?? (l.externalId && l.externalSource === "leaddocket" ? inByExt.get(l.externalId) : undefined) ?? l.contactPerson ?? null,
      status: sent ? out?.status ?? "Referral Sent" : l.signedCase === 1 ? "signed" : l.outcome,
      signed: !sent && l.signedCase === 1,
    });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.partner.localeCompare(b.partner));

  // By partner — keyed by facility; an unlinked outbound referral groups under its typed name.
  const cat = new Map(leads.map((l) => [l.facilityId, l.category ?? null] as const));
  const partners = new Map<string, (typeof empty.byPartner)[number]>();
  for (const r of rows) {
    const key = r.facilityId != null ? `f:${r.facilityId}` : `n:${r.partner.toLowerCase()}`;
    const p = partners.get(key) ?? { facilityId: r.facilityId, partner: r.partner, owner: r.owner, category: cat.get(r.facilityId) ?? null, sent: 0, received: 0, signed: 0, last: "" };
    if (r.direction === "sent") p.sent++; else p.received++;
    if (r.signed) p.signed++;
    if (r.date > p.last) p.last = r.date;
    partners.set(key, p);
  }
  const byPartner = Array.from(partners.values()).sort((a, b) => b.received + b.sent - (a.received + a.sent) || b.signed - a.signed);

  const reps = new Map<string, { rep: string; sent: number; received: number; signed: number; ids: Set<string> }>();
  for (const r of rows) {
    const a = reps.get(r.rep) ?? { rep: r.rep, sent: 0, received: 0, signed: 0, ids: new Set<string>() };
    if (r.direction === "sent") a.sent++; else a.received++;
    if (r.signed) a.signed++;
    a.ids.add(r.facilityId != null ? String(r.facilityId) : r.partner.toLowerCase());
    reps.set(r.rep, a);
  }
  const byRep = Array.from(reps.values()).map(({ ids, ...a }) => ({ ...a, partners: ids.size }))
    .sort((a, b) => b.sent + b.received - (a.sent + a.received));

  // Every tracker referral dated in the range, whatever its status — the
  // pipeline that facility_leads doesn't hold. Dated by when it was sent, or
  // logged when it hasn't been sent yet.
  const outs = (await db.select({
    id: outboundReferrals.id, clientName: outboundReferrals.clientName, status: outboundReferrals.status,
    recommendedFacility: outboundReferrals.recommendedFacility, assignedAgent: outboundReferrals.assignedAgent,
    referralSentDate: outboundReferrals.referralSentDate, createdAt: outboundReferrals.createdAt,
  }).from(outboundReferrals)).filter((o) => {
    const when = o.referralSentDate ?? o.createdAt;
    return when && when >= range.from && when <= range.to && mine(o.assignedAgent) && !isNonReportingRep(o.assignedAgent);
  });
  const statusCount = new Map<string, number>();
  for (const o of outs) statusCount.set(o.status, (statusCount.get(o.status) ?? 0) + 1);
  const attention = outs.filter((o) => NEEDS_ATTENTION.has(o.status))
    .map((o) => ({ id: o.id, date: dayOf(o.referralSentDate ?? o.createdAt), client: o.clientName, partner: o.recommendedFacility, rep: repLabel(o.assignedAgent), status: o.status }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const sent = rows.filter((r) => r.direction === "sent").length;
  const received = rows.length - sent;
  const signed = rows.filter((r) => r.signed).length;
  return {
    summary: {
      sent, received, signed,
      signRate: received ? Math.round((signed / received) * 100) : null,
      partners: byPartner.length,
      attended: outs.filter((o) => ATTENDED.has(o.status)).length,
      pipeline: outs.filter((o) => !WENT_OUT.has(o.status) && o.status !== "Not Referred").length,
      needsAttention: attention.length,
    },
    byPartner,
    byRep,
    statuses: Array.from(statusCount.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    attention,
    rows,
  };
}
