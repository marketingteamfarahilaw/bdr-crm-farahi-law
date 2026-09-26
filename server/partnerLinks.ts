/**
 * A Lead Docket lead's referring partner, changed from the app — the Sign-ups
 * Report's Link button and the Data Check page. It is written everywhere a
 * partner's leads are read, as scripts/migration/mirror-leads-to-facilities.mjs
 * does on each sync: facility_leads (facility profile, Command Center, the
 * reports), the partners' stored totals, and inbound_leads (Partner Referral
 * Tracker).
 *
 * Two kinds of answer:
 *   · for one lead (facilityLinkedBy set) — the mirror never changes it again;
 *   · for some referral words (partner_aliases, by facility_leads.partnerKey) —
 *     every lead saying the same thing follows it, past and future: the mirror
 *     applies it before guessing from the text.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { facilities, facilityLeads, inboundLeads, leadIntake, partnerAliases } from "../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// As isSigned in signupsReport.ts (not imported: that file imports this one).
const SIGNED = new Set(["signed", "signed referred out", "referral accepted"]);
const signedOutcome = (o: unknown) => SIGNED.has(String(o ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim());

const CHUNK = 500;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

async function dbOrThrow(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  return db;
}

/** Recompute these partners' stored totals from facility_leads, as the mirror does. */
async function refreshTotals(db: Db, ids: number[]) {
  for (const id of Array.from(new Set(ids))) {
    await db.execute(sql`UPDATE facilities f SET
      f.totalLeadsReceived = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND direction = 'received_from_facility'),
      f.totalLeadsSent = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND direction = 'sent_to_facility')
                       + (SELECT COALESCE(SUM(count), 0) FROM facility_leads_sent WHERE facilityId = ${id}),
      f.totalSignedCases = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND signedCase = 1),
      f.lastSignedCaseDate = (SELECT MAX(COALESCE(signedDate, leadDate)) FROM facility_leads WHERE facilityId = ${id} AND signedCase = 1)
      WHERE f.id = ${id}`);
  }
}

/**
 * Point these Lead Docket leads (by Lead Docket id) at a partner, or at none.
 * byHand: a decision for these very leads, which the mirror keeps. Otherwise
 * they follow a remembered answer for their words, and stay free to follow a
 * later one. Returns how many leads were set.
 */
export async function setLeadsPartner(externalIds: string[], facilityId: number | null, opts: { by: string; byHand: boolean }): Promise<number> {
  const ids = Array.from(new Set(externalIds.filter(Boolean)));
  if (!ids.length) return 0;
  const db = await dbOrThrow();
  let partner: { id: number; name: string } | undefined;
  if (facilityId != null) {
    [partner] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
    if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "That partner no longer exists." });
  }

  const touched: number[] = facilityId != null ? [facilityId] : [];
  let set = 0;
  for (const part of chunks(ids)) {
    const rows = await db.select({ id: facilityLeads.id, facilityId: facilityLeads.facilityId })
      .from(facilityLeads)
      .where(and(eq(facilityLeads.externalSource, "leaddocket"), inArray(facilityLeads.externalId, part)));
    if (!rows.length) continue;
    touched.push(...rows.map((r) => r.facilityId).filter((x): x is number => x != null));
    await db.update(facilityLeads)
      .set(opts.byHand
        ? { facilityId, facilityLinkedBy: opts.by.slice(0, 255), facilityLinkedAt: new Date() }
        : { facilityId })
      .where(inArray(facilityLeads.id, rows.map((r) => r.id)));
    set += rows.length;

    // The Partner Referral Tracker lists partner-referred leads only.
    const inboundOf = and(eq(inboundLeads.externalSource, "leaddocket"), inArray(inboundLeads.externalId, part));
    if (!partner) {
      await db.delete(inboundLeads).where(inboundOf);
      continue;
    }
    const leads = await db.select().from(leadIntake)
      .where(and(eq(leadIntake.externalSource, "leaddocket"), inArray(leadIntake.externalId, part)));
    const have = new Map((await db.select({ id: inboundLeads.id, externalId: inboundLeads.externalId }).from(inboundLeads).where(inboundOf))
      .map((r) => [String(r.externalId), r.id]));
    for (const lead of leads) {
      const externalId = String(lead.externalId);
      const signed = signedOutcome(lead.outcome);
      const when = lead.leadDate ?? new Date();
      const owned = {
        leadName: (lead.leadName || "(no name)").slice(0, 255),
        dateReceived: when,
        referringFacility: partner.name.slice(0, 255),
        facilityContact: String(lead.facility ?? "").slice(0, 255) || null,
        assignedAgent: String(lead.member ?? "").slice(0, 100) || null,
        caseType: String(lead.classification ?? "").trim().slice(0, 100) || null,
        signed,
        signedDate: signed ? when : null,
        notSignedReason: !signed && /^(lost|rejected)/i.test(String(lead.outcome ?? "")) ? String(lead.outcome) : null,
      };
      const id = have.get(externalId);
      if (id) await db.update(inboundLeads).set(owned).where(eq(inboundLeads.id, id));
      else await db.insert(inboundLeads).values({
        ...owned,
        notes: `Lead Docket #${externalId} · linked by ${opts.by}`,
        countsTowardPartnerActivity: true,
        externalId,
        externalSource: "leaddocket",
        createdAt: when,
      });
    }
  }
  await refreshTotals(db, touched);
  return set;
}

/**
 * Remember a partner (or none) for some referral words and apply it to every
 * lead saying them — except leads someone decided one by one. Returns how many
 * leads now follow it.
 */
export async function rememberPartner(key: string, text: string, facilityId: number | null, by: string): Promise<number> {
  if (!key) throw new TRPCError({ code: "BAD_REQUEST", message: "Those words name no partner to remember." });
  const db = await dbOrThrow();
  // Before saving: an answer naming a partner that's gone would unlink every lead saying the words.
  if (facilityId != null) {
    const [partner] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
    if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "That partner no longer exists." });
  }
  const row = { text: text.slice(0, 500), facilityId, createdBy: by.slice(0, 255) };
  await db.insert(partnerAliases).values({ aliasKey: key, ...row }).onDuplicateKeyUpdate({ set: row });
  const leads = await db.select({ externalId: facilityLeads.externalId }).from(facilityLeads)
    .where(and(eq(facilityLeads.externalSource, "leaddocket"), eq(facilityLeads.partnerKey, key), isNull(facilityLeads.facilityLinkedBy)));
  return setLeadsPartner(leads.map((l) => String(l.externalId)), facilityId, { by, byHand: false });
}

/**
 * Forget the answer for some words. Their leads keep today's partner until the
 * next Lead Docket sync, which matches them from the text again.
 */
export async function forgetPartner(key: string): Promise<void> {
  const db = await dbOrThrow();
  await db.delete(partnerAliases).where(eq(partnerAliases.aliasKey, key));
}
