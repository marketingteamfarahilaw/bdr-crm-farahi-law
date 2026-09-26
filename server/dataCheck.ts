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
import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
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

const SIGNED = new Set(["signed", "signed referred out", "referral accepted"]);
const isSigned = (o: unknown) => SIGNED.has(String(o ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim());
// "Jezel Mercado BC - Sacramento": the rep's own business card, not a partner.
const isBusinessCard = (source: string | null) => /\bBC\b/.test(String(source ?? ""));
const isTest = (caseType: string | null) => /^test\b/i.test(String(caseType ?? "").trim());
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
const groupKey = (ids: string[]) => {
  const k = [...ids].sort().join(",");
  return k.length <= 255 ? k : createHash("sha1").update(k).digest("hex");
};

/**
 * The name Lead Docket credits this user under, if any ("Miguel Flores"): their
 * full name as written there, else a first name that fits exactly one rep —
 * users.agentName holds short forms ("Gracel", "Queenie").
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
  for (const n of given) {
    const first = n.toLowerCase().split(/\s+/)[0];
    if (first.length < 3) continue;
    const hits = members.filter((m) => { const f = m.toLowerCase().split(/\s+/)[0]; return f.startsWith(first) || first.startsWith(f); });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

type Row = {
  id: number; ld: string; name: string; rep: string; role: string; date: Date | null; outcome: string;
  text: string | null; source: string | null; caseType: string | null; phone: string | null;
  partnerId: number | null; partner: string | null; byHand: string | null; key: string | null;
};

async function teamLeads(from: Date, to: Date): Promise<Row[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: leadIntake.id, ld: leadIntake.externalId, name: leadIntake.leadName, rep: leadIntake.member, role: leadIntake.role,
    date: leadIntake.leadDate, outcome: leadIntake.outcome, text: leadIntake.facility, source: leadIntake.marketingSource,
    caseType: leadIntake.classification, phone: leadIntake.phone,
    partnerId: facilityLeads.facilityId, partner: facilities.name, byHand: facilityLeads.facilityLinkedBy, key: facilityLeads.partnerKey,
  })
    .from(leadIntake)
    // Only leads the mirror has placed: the Link button needs their facility_leads row.
    .innerJoin(facilityLeads, and(eq(facilityLeads.externalSource, "leaddocket"), eq(facilityLeads.externalId, leadIntake.externalId)))
    .leftJoin(facilities, eq(facilities.id, facilityLeads.facilityId))
    .where(and(eq(leadIntake.externalSource, "leaddocket"), gte(leadIntake.leadDate, from), lte(leadIntake.leadDate, to)));
  return rows
    .filter((r) => r.rep && !isNonReportingRep(r.rep))
    .map((r) => ({ ...r, ld: String(r.ld), name: r.name || "(no name)", rep: r.rep!, role: r.role ?? "", outcome: r.outcome ?? "" }));
}

const brief = (r: Row): CheckLead => ({
  id: r.id, ld: r.ld, name: r.name, rep: r.rep, role: r.role, date: r.date ? r.date.toISOString() : null,
  outcome: r.outcome, signed: isSigned(r.outcome), text: r.text?.trim() || null, partnerId: r.partnerId, partner: r.partner,
});

export async function getDataCheck(range: { from: Date; to: Date }, opts: { rep?: string | null; team?: "all" | "current" }) {
  const db = await getDb();
  if (!db) return null;
  // Wide enough to see a duplicate that sits just outside the period.
  const wide = await teamLeads(new Date(range.from.getTime() - DUP_DAYS * DAY), new Date(range.to.getTime() + DUP_DAYS * DAY));
  const inScope = (r: Row) => (!opts.rep || r.rep === opts.rep) && (opts.team !== "current" || isCurrentRep(r.rep));
  const inRange = (r: Row) => !!r.date && r.date >= range.from && r.date <= range.to;
  const leads = wide.filter((r) => inRange(r) && inScope(r));

  const aliases = await db.select({
    key: partnerAliases.aliasKey, text: partnerAliases.text, partnerId: partnerAliases.facilityId, partner: facilities.name,
    by: partnerAliases.createdBy, at: partnerAliases.updatedAt,
  }).from(partnerAliases).leftJoin(facilities, eq(facilities.id, partnerAliases.facilityId)).orderBy(desc(partnerAliases.updatedAt));
  const answered = new Map(aliases.map((a) => [a.key, a]));
  const dismissed = new Set((await db.select({ k: dataCheckDismissals.itemKey }).from(dataCheckDismissals)
    .where(eq(dataCheckDismissals.kind, "duplicate"))).map((d) => d.k));

  // ── duplicates: same client name or phone within 60 days, among the team's leads
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const paired = new Set<string>();
  const union = (a: string, b: string) => {
    paired.add(a); paired.add(b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  // By name only: a shared phone alone is usually a family — passengers of one
  // accident are separate clients on one number. The phone just confirms it.
  const samePhone = new Set<string>();
  const buckets = new Map<string, Row[]>();
  for (const r of wide) { const k = nameKey(r.name); if (k && r.date) buckets.set(k, [...(buckets.get(k) ?? []), r]); }
  for (const list of Array.from(buckets.values())) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date!.getTime() - b.date!.getTime());
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      if (b.date!.getTime() - a.date!.getTime() > DUP_DAYS * DAY) continue;
      union(a.ld, b.ld);
      if (phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone)) { samePhone.add(a.ld); samePhone.add(b.ld); }
    }
  }
  const groups = new Map<string, Row[]>();
  for (const r of wide) if (paired.has(r.ld)) {
    const root = find(r.ld);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const duplicates = Array.from(groups.values())
    .filter((g) => g.length > 1 && g.some((r) => inRange(r) && inScope(r)))
    .map((g) => ({ key: groupKey(g.map((r) => r.ld)), rows: g }))
    .filter((g) => !dismissed.has(g.key))
    .map((g) => ({
      key: g.key,
      why: g.rows.some((r) => samePhone.has(r.ld)) ? "Same name and phone" : "Same name",
      leads: g.rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)).map(brief),
    }))
    .sort((a, b) => (b.leads.at(-1)?.date ?? "").localeCompare(a.leads.at(-1)?.date ?? ""));
  const inDuplicate = new Set(duplicates.flatMap((d) => d.leads.map((l) => l.ld)));

  // ── each lead's standing
  type Standing = "linked" | "none" | "card" | "person" | "unmatched" | "nothing" | "waiting";
  const standing = (r: Row): Standing => {
    if (r.partnerId) return "linked";
    if (r.byHand) return "none";                                   // "not from a partner", for this lead
    if (r.key == null) return "waiting";                           // the mirror hasn't placed it yet
    if (r.key) {
      const a = answered.get(r.key);
      if (a && a.partnerId == null) return "none";                 // those words name no partner
      return a ? "linked" : "unmatched";                           // answered: applied at the next sync at worst
    }
    if (r.text?.trim()) return "person";                           // only people: "Former Client …", the rep
    return isBusinessCard(r.source) ? "card" : "nothing";
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
    repOptions: Array.from(new Set(wide.filter((r) => inRange(r) && (opts.team !== "current" || isCurrentRep(r.rep))).map((r) => r.rep))).sort(),
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
  return {
    text: Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? key,
    reps: new Set(rows.map((r) => String(r.rep ?? ""))),
  };
}

/** A rep may answer for words their own leads say; managers for any. */
async function mayAnswer(key: string, who: { rep: string | null; manager: boolean }) {
  const words = await wordsFor(key);
  if (!who.manager && !(who.rep && words.reps.has(who.rep))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager or the rep whose leads say this can answer for it." });
  }
  return words;
}

/** These words are this partner (or none): every lead saying them follows, now and later. */
export async function answerWords(key: string, facilityId: number | null, by: string, who: { rep: string | null; manager: boolean }) {
  const { text } = await mayAnswer(key, who);
  const leads = await rememberPartner(key, text, facilityId, by);
  return { text, leads };
}

/** A partner the CRM didn't have yet, added from the words, and the words linked to it. */
export async function addPartnerForWords(
  key: string,
  partner: { name: string; category: string; city?: string | null },
  by: { id: number; name: string },
  who: { rep: string | null; manager: boolean },
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

/** "These leads are not the same client" — the group stays hidden until another lead joins it. */
export async function dismissDuplicate(key: string, by: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  await db.insert(dataCheckDismissals).values({ kind: "duplicate", itemKey: key.slice(0, 255), createdBy: by.slice(0, 255) })
    .onDuplicateKeyUpdate({ set: { createdBy: by.slice(0, 255) } });
}

/** The lead's rep, so a rep can only answer for their own leads. */
export async function repOfLead(leadId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [r] = await db.select({ rep: leadIntake.member }).from(leadIntake).where(eq(leadIntake.id, leadId)).limit(1);
  return r?.rep ?? null;
}
