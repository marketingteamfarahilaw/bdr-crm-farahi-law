/**
 * Data Check — the BD/FR team's Lead Docket leads that need a person's answer
 * before the reports can be trusted (Youssef, 2026-09-25: "make the data 100%").
 *
 *   · Partner not found — intake wrote a referring partner the CRM couldn't
 *     match ("Valentz Auto Body Shop", "Boris"). Grouped by the words, since one
 *     answer covers every lead that says the same (server/partnerLinks.ts).
 *   · Nothing written   — no referring partner at all. Business-card leads
 *     ("Jezel Mercado BC - Sacramento") need none, and neither do leads referred
 *     by a person ("Former Client …"), so those count as fine.
 *   · Possible duplicates — the same client name twice within 60 days.
 *   · Test leads        — case type "TEST - Case".
 *
 * A lead is clean when none of these apply; each rep's score is their share of
 * clean leads. Same leads as the Sign-ups Report: by its date (the sign-up date
 * for signed leads), without the non-reporting reps.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { dataCheckDismissals, facilities, facilityLeads, leadIntake, partnerAliases } from "../drizzle/schema";
import { isNonReportingRep } from "@shared/permissions";
import { isCurrentRep, repNameKey } from "@shared/team";
import { createFacility } from "./crmDb";
import { forgetPartner, rememberPartner } from "./partnerLinks";

const DAY = 86_400_000;
const DUP_DAYS = 60;

export type CheckLead = {
  id: number;            // lead_intake.id — what the Link button sends
  ld: string;            // Lead Docket lead id, for "Open in Lead Docket"
  name: string;
  rep: string;
  role: string;
  date: string | null;
  outcome: string;
  signed: boolean;
  text: string | null;   // the referral words as intake wrote them
  partnerId: number | null;
  partner: string | null;
};

type Who = { rep: string | null; manager: boolean };

const SIGNED = new Set(["signed", "signed referred out", "referral accepted"]);
const isSigned = (o: unknown) => SIGNED.has(String(o ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim());
// "Jezel Mercado BC - Sacramento": the rep's own business card, not a partner.
const isBusinessCard = (s: string | null) => /\bBC\b/.test(String(s ?? ""));
const isTest = (caseType: string | null) => /^test\b/i.test(String(caseType ?? "").trim());
// Intake's ways of leaving the referral blank (as partner-key.mjs reads them).
const BLANK = /^(n\/?a|none|no|unknown|nothing|x|-+|\?+)$/i;
// Placeholder names say nothing about who the client is.
const PLACEHOLDER = /^(unknown|test|n ?a|none|no name|john doe|jane doe|ld|lead)$/;
const nameKey = (s: string) => {
  const k = String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return k.length >= 5 && !PLACEHOLDER.test(k) ? k : "";
};
const phoneKey = (s: string | null) => {
  const d = String(s ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 && !/^(\d)\1+$/.test(d) ? d : "";
};
/** Two leads, in either order: what "not a duplicate" is stored against. */
const pairKey = (a: string, b: string) => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * The name Lead Docket credits this user under, if any ("Miguel Flores"): their
 * full name as written there, else a first name that is exactly one rep's.
 */
export async function repNameFor(names: (string | null | undefined)[]): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const members = (await db.selectDistinct({ member: leadIntake.member }).from(leadIntake).where(eq(leadIntake.externalSource, "leaddocket")))
    .map((r) => r.member).filter((m): m is string => !!m);
  const given = names.map((n) => String(n ?? "").trim()).filter(Boolean);
  for (const n of given) {
    const hit = members.find((m) => repNameKey(m) === repNameKey(n));
    if (hit) return hit;
  }
  // Exactly the same first name only: a prefix would make "Angel" Angelica.
  const firstOf = (s: string) => s.toLowerCase().split(/\s+/)[0];
  for (const n of given) {
    const hits = members.filter((m) => firstOf(m) === firstOf(n));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

type Row = {
  id: number; ld: string; name: string; rep: string; role: string; date: Date | null; outcome: string;
  text: string | null; source: string | null; caseType: string | null; phone: string | null;
  placed: boolean; partnerId: number | null; partner: string | null; byHand: string | null; key: string | null;
};

/** Every BD/FR lead from Lead Docket — a few thousand rows; duplicates need them all. */
async function teamLeads(): Promise<Row[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: leadIntake.id, ld: leadIntake.externalId, name: leadIntake.leadName, rep: leadIntake.member, role: leadIntake.role,
    date: leadIntake.leadDate, outcome: leadIntake.outcome, text: leadIntake.facility, source: leadIntake.marketingSource,
    caseType: leadIntake.classification, phone: leadIntake.phone,
    placedId: facilityLeads.id, partnerId: facilityLeads.facilityId, partner: facilities.name, byHand: facilityLeads.facilityLinkedBy,
    key: facilityLeads.partnerKey,
  })
    .from(leadIntake)
    // The mirror places each lead in facility_leads right after the sync; one it
    // hasn't placed yet is "waiting", and can't be linked until it is.
    .leftJoin(facilityLeads, and(eq(facilityLeads.externalSource, "leaddocket"), eq(facilityLeads.externalId, leadIntake.externalId)))
    .leftJoin(facilities, eq(facilities.id, facilityLeads.facilityId))
    .where(eq(leadIntake.externalSource, "leaddocket"));
  return rows
    .filter((r) => r.rep && !isNonReportingRep(r.rep))
    .map(({ placedId, ...r }) => ({
      ...r, placed: placedId != null, ld: String(r.ld), name: r.name || "(no name)", rep: r.rep!, role: r.role ?? "", outcome: r.outcome ?? "",
    }));
}

const brief = (r: Row): CheckLead => ({
  id: r.id, ld: r.ld, name: r.name, rep: r.rep, role: r.role, date: r.date ? r.date.toISOString() : null,
  outcome: r.outcome, signed: isSigned(r.outcome), text: r.text?.trim() || null, partnerId: r.partnerId, partner: r.partner,
});

export async function getDataCheck(range: { from: Date; to: Date }, opts: { rep?: string | null; team?: "all" | "current" }) {
  const db = await getDb();
  if (!db) return null;
  const all = await teamLeads();
  const inScope = (r: Row) => (!opts.rep || r.rep === opts.rep) && (opts.team !== "current" || isCurrentRep(r.rep));
  const inRange = (r: Row) => !!r.date && r.date >= range.from && r.date <= range.to;
  const leads = all.filter((r) => inRange(r) && inScope(r));

  const aliases = await db.select({
    key: partnerAliases.aliasKey, text: partnerAliases.text, partnerId: partnerAliases.facilityId, partner: facilities.name,
    by: partnerAliases.createdBy, at: partnerAliases.updatedAt,
  }).from(partnerAliases).leftJoin(facilities, eq(facilities.id, partnerAliases.facilityId)).orderBy(desc(partnerAliases.updatedAt));
  // An answer naming a partner since deleted answers nothing: the mirror drops it too.
  const answered = new Map(aliases.filter((a) => a.partnerId == null || a.partner != null).map((a) => [a.key, a]));
  const dismissed = new Set((await db.select({ k: dataCheckDismissals.itemKey }).from(dataCheckDismissals)
    .where(eq(dataCheckDismissals.kind, "duplicate"))).map((d) => d.k));

  // ── duplicates: the same client name within 60 days, among all the team's
  // leads — so a group is the same whichever period is on screen. By name only:
  // a shared phone alone is usually a family (passengers of one accident are
  // separate clients on one number); the phone just confirms it. A pair someone
  // marked "not a duplicate" no longer joins a group.
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const paired = new Set<string>();
  const samePhone = new Set<string>();
  const buckets = new Map<string, Row[]>();
  for (const r of all) { const k = nameKey(r.name); if (k && r.date) buckets.set(k, [...(buckets.get(k) ?? []), r]); }
  for (const list of Array.from(buckets.values())) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date!.getTime() - b.date!.getTime());
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      if (b.date!.getTime() - a.date!.getTime() > DUP_DAYS * DAY || dismissed.has(pairKey(a.ld, b.ld))) continue;
      paired.add(a.ld); paired.add(b.ld);
      const ra = find(a.ld), rb = find(b.ld);
      if (ra !== rb) parent.set(ra, rb);
      if (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone)) { samePhone.add(a.ld); samePhone.add(b.ld); }
    }
  }
  const groups = new Map<string, Row[]>();
  for (const r of all) if (paired.has(r.ld)) {
    const root = find(r.ld);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const duplicates = Array.from(groups.values())
    .filter((g) => g.length > 1 && g.some((r) => inRange(r) && inScope(r)))
    .map((g) => {
      const rows = g.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
      return {
        key: rows.map((r) => r.ld).join(","),
        why: rows.some((r) => samePhone.has(r.ld)) ? "Same name and phone" : "Same name",
        leads: rows.map(brief),
      };
    })
    .sort((a, b) => (b.leads.at(-1)?.date ?? "").localeCompare(a.leads.at(-1)?.date ?? ""));
  const inDuplicate = new Set(duplicates.flatMap((d) => d.leads.map((l) => l.ld)));

  // ── each lead's standing
  type Standing = "linked" | "none" | "card" | "person" | "unmatched" | "nothing" | "waiting";
  const standing = (r: Row): Standing => {
    if (!r.placed) return "waiting";                               // the mirror hasn't placed it yet
    if (r.partnerId != null && r.partner != null) return "linked";
    if (r.byHand && r.partnerId == null) return "none";            // "not from a partner", for this lead
    if (r.key) {
      const a = answered.get(r.key);
      if (a) return a.partnerId == null ? "none" : "linked";       // answered: applied now, at worst at the next sync
      return "unmatched";
    }
    const t = r.text?.trim() ?? "";
    if (!t || BLANK.test(t)) return isBusinessCard(r.source) ? "card" : "nothing";
    return isBusinessCard(r.source) || isBusinessCard(t) ? "card" : "person";   // only people: "Former Client …", the rep
  };
  const problemsOf = (r: Row) => {
    const s = standing(r);
    return (s === "unmatched" || s === "nothing" ? 1 : 0) + (inDuplicate.has(r.ld) ? 1 : 0) + (isTest(r.caseType) ? 1 : 0);
  };

  const reps = new Map<string, { name: string; role: string; current: boolean; leads: number; linked: number; fix: number; clean: number }>();
  const totals = { leads: 0, linked: 0, fix: 0, clean: 0, none: 0, card: 0, person: 0, waiting: 0 };
  for (const r of leads) {
    const s = standing(r);
    const bad = problemsOf(r) > 0;
    const rep = reps.get(r.rep) ?? { name: r.rep, role: r.role, current: isCurrentRep(r.rep), leads: 0, linked: 0, fix: 0, clean: 0 };
    rep.leads++; totals.leads++;
    if (s === "linked") { rep.linked++; totals.linked++; }
    if (s === "none" || s === "card" || s === "person" || s === "waiting") totals[s]++;
    if (bad) { rep.fix++; totals.fix++; } else { rep.clean++; totals.clean++; }
    reps.set(r.rep, rep);
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 100);

  // ── partner not found, by the words
  const unmatchedGroups = new Map<string, Row[]>();
  for (const r of leads) if (standing(r) === "unmatched") unmatchedGroups.set(r.key!, [...(unmatchedGroups.get(r.key!) ?? []), r]);
  const commonText = (rows: Row[]) => {
    const n = new Map<string, number>();
    for (const r of rows) { const t = r.text?.trim(); if (t) n.set(t, (n.get(t) ?? 0) + 1); }
    return Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  const unmatched = Array.from(unmatchedGroups.entries())
    .map(([key, rows]) => ({
      key,
      text: commonText(rows),
      reps: Array.from(new Set(rows.map((r) => r.rep))),
      signed: rows.filter((r) => isSigned(r.outcome)).length,
      latest: rows.reduce((m, r) => (r.date && (!m || r.date > m) ? r.date : m), null as Date | null)?.toISOString() ?? null,
      leads: rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).map(brief),
    }))
    .sort((a, b) => b.leads.length - a.leads.length || (b.latest ?? "").localeCompare(a.latest ?? ""));

  const byDateDesc = (a: Row, b: Row) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  return {
    totals: { ...totals, cleanPct: pct(totals.clean, totals.leads) },
    reps: Array.from(reps.values())
      .map((r) => ({ ...r, cleanPct: pct(r.clean, r.leads) }))
      .sort((a, b) => a.cleanPct - b.cleanPct || b.fix - a.fix || a.name.localeCompare(b.name)),
    unmatched,
    nothing: leads.filter((r) => standing(r) === "nothing").sort(byDateDesc).map(brief),
    duplicates,
    tests: leads.filter((r) => isTest(r.caseType)).sort(byDateDesc).map(brief),
    remembered: aliases.slice(0, 100).map((a) => ({
      key: a.key, text: a.text, partnerId: a.partnerId, partner: a.partner, by: a.by, at: a.at ? a.at.toISOString() : null,
    })),
    // For the rep picker: everyone with leads in the period, whichever rep is picked.
    repOptions: Array.from(new Set(all.filter((r) => inRange(r) && (opts.team !== "current" || isCurrentRep(r.rep))).map((r) => r.rep))).sort(),
  };
}

// ── answers ─────────────────────────────────────────────────────────────────

/** The words behind a key as intake most often wrote them, and the reps whose leads say them. */
async function wordsFor(key: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  const rows = await db.select({ text: leadIntake.facility, rep: leadIntake.member })
    .from(facilityLeads)
    .innerJoin(leadIntake, and(eq(leadIntake.externalSource, "leaddocket"), eq(leadIntake.externalId, facilityLeads.externalId)))
    .where(and(eq(facilityLeads.externalSource, "leaddocket"), eq(facilityLeads.partnerKey, key)));
  if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "No lead says that any more — refresh the page." });
  const n = new Map<string, number>();
  for (const r of rows) { const t = String(r.text ?? "").trim(); if (t) n.set(t, (n.get(t) ?? 0) + 1); }
  const [alias] = await db.select({ facilityId: partnerAliases.facilityId, partner: facilities.name })
    .from(partnerAliases).leftJoin(facilities, eq(facilities.id, partnerAliases.facilityId))
    .where(eq(partnerAliases.aliasKey, key)).limit(1);
  return {
    text: Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? key,
    reps: new Set(rows.map((r) => String(r.rep ?? ""))),
    // An answer already given, unless it named a partner since deleted.
    answered: !!alias && (alias.facilityId == null || alias.partner != null),
  };
}

/**
 * A rep may answer for words their own leads say, if nobody has yet; a manager
 * for any words, and may change an answer.
 */
async function mayAnswer(key: string, who: Who) {
  const words = await wordsFor(key);
  if (!who.manager && !(who.rep && words.reps.has(who.rep))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager or the rep whose leads say this can answer for it." });
  }
  if (!who.manager && words.answered) {
    throw new TRPCError({ code: "FORBIDDEN", message: "These words already have an answer — ask a manager to change it." });
  }
  return words;
}

/** These words are this partner (or none): every lead saying them follows, now and later. */
export async function answerWords(key: string, facilityId: number | null, by: string, who: Who) {
  const { text } = await mayAnswer(key, who);
  const leads = await rememberPartner(key, text, facilityId, by);
  return { text, leads };
}

/** A partner the CRM didn't have yet, added from the words, and the words linked to it. */
export async function addPartnerForWords(
  key: string,
  partner: { name: string; category: string; city?: string | null },
  by: { id: number; name: string },
  who: Who,
) {
  const { text } = await mayAnswer(key, who);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  const name = partner.name.trim();
  const [twin] = await db.select({ id: facilities.id }).from(facilities).where(sql`LOWER(TRIM(${facilities.name})) = ${name.toLowerCase()}`).limit(1);
  if (twin) throw new TRPCError({ code: "CONFLICT", message: `${name} is already a partner — pick it from the list instead.` });
  const result = await createFacility({
    name,
    category: partner.category,
    city: partner.city?.trim() || null,
    relationshipStatus: "warm_lead",
    assignedRepId: by.id,
    assignedRepName: who.rep ?? by.name,
    notes: `Added from the Data Check page for leads Lead Docket lists as “${text}”.`,
  });
  const facilityId = Number((result as { insertId?: number }).insertId);
  if (!facilityId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The partner was added but couldn't be linked — link it from the list." });
  const leads = await rememberPartner(key, text, facilityId, by.name);
  return { facilityId, text, leads };
}

export async function forgetWords(key: string) {
  await forgetPartner(key);
}

/**
 * "These leads are not the same client". Stored per pair, so it holds in every
 * period's view; a new lead for the same name forms a new pair and shows again.
 * A manager may clear any group; a rep only one made of their own leads.
 */
export async function dismissDuplicate(lds: string[], by: string, who: Who) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  const ids = Array.from(new Set(lds.map(String)));
  const rows = await db.select({ ld: leadIntake.externalId, rep: leadIntake.member }).from(leadIntake)
    .where(and(eq(leadIntake.externalSource, "leaddocket"), inArray(leadIntake.externalId, ids)));
  if (rows.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Some of these leads are gone — refresh the page." });
  if (!who.manager && !rows.every((r) => who.rep && r.rep === who.rep)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager can clear a group with another rep's leads." });
  }
  const pairs: { kind: string; itemKey: string; createdBy: string }[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    pairs.push({ kind: "duplicate", itemKey: pairKey(ids[i], ids[j]), createdBy: by.slice(0, 255) });
  }
  if (pairs.length) await db.insert(dataCheckDismissals).values(pairs).onDuplicateKeyUpdate({ set: { createdBy: by.slice(0, 255) } });
}

/** The lead's rep, so a rep can only answer for their own leads. */
export async function repOfLead(leadId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [r] = await db.select({ rep: leadIntake.member }).from(leadIntake).where(eq(leadIntake.id, leadId)).limit(1);
  return r?.rep ?? null;
}
