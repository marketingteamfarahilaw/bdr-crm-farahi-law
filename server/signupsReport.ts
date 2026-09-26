/**
 * Sign-ups dashboard — the executive view of lead_intake: how many sign-ups,
 * from which facility types, and from which territories.
 *
 * The wrinkle: lead_intake stores the source as FREE TEXT ("Leonard with
 * Randy's Towing", "Field Rep Jezel / Karina of All Foreign and Domestic Body
 * Shop"), with typeOfFacility and clientLocation never filled in. So facility
 * type and territory come from the referring partner: for Lead Docket leads, the
 * facility the Lead Docket mirror linked them to; for hand-entered leads, a
 * match of that text in three passes — exact, containment, then token overlap.
 *
 * Most Lead Docket team leads name no referring partner, so only about a third
 * match. The rest are reported as "N/A" rather than guessed at, and still count
 * for the representative; the response carries the match rate so the page can
 * say how much of the picture is partner-attributed.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { leadIntake, facilities, facilityLeads, inboundLeads } from "../drizzle/schema";
import { isCurrentRep, CURRENT_TEAM, MONTHLY_SIGNUP_TARGET, type TeamRole } from "@shared/team";
import { isNonReportingRep } from "@shared/permissions";
import { formatInTimeZone } from "date-fns-tz";

// Words that carry no identifying signal when matching a facility name.
const STOP = new Set([
  "the", "and", "of", "inc", "llc", "shop", "center", "centre", "co", "company",
  "with", "field", "rep", "dr", "auto", "body", "service", "services", "clinic",
]);
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: unknown) => norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));

/**
 * Report-facing facility types. The CRM's own categories don't separate towing,
 * insurance or marketing partners — they all land in "other" — but the business
 * reports on them separately, so the name is used to split that bucket out.
 */
const TYPE_LABEL: Record<string, string> = {
  body_shop: "Bodyshop",
  chiropractor: "Chiropractor",
  medical_clinic: "Medical",
  physical_therapist: "Physical Therapy",
  imaging_center: "Imaging",
  towing: "Towing",
  insurance: "Insurance",
  marketing: "Marketing",
  other: "Independent",
};

const byKeyword = (text: string): string | null => {
  const n = norm(text);
  if (/\btow(ing|s)?\b|\btow\b|wrecker/.test(n)) return "towing";
  if (/insurance|agency|farmers|allstate/.test(n)) return "insurance";
  if (/marketing|media|advertis/.test(n)) return "marketing";
  if (/chiropract|spine/.test(n)) return "chiropractor";
  if (/body|collision|paint|autobody|dent/.test(n)) return "body_shop";
  return null;
};

const SIGNED = new Set(["signed", "signed referred out", "referral accepted"]);
export const isSigned = (o: unknown) => SIGNED.has(String(o ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim());

/**
 * Which scorecard column a lead falls in, from its outcome (Lead Docket's status,
 * or "Signed"/"Signed Referred Out" once it has a sign-up date). As in the team's
 * sheet, Lost counts with Rejected; Lead Docket has no "not interested" status,
 * so that column stays 0 unless an outcome says so.
 */
export type ScoreBucket = "open" | "rejected" | "referredOut" | "notInterested" | "signedReferred" | "signedInHouse";
export const scorecardBucket = (outcome: unknown): ScoreBucket => {
  const o = String(outcome ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim();
  if (o === "signed referred out") return "signedReferred";
  if (o === "signed" || o === "referral accepted") return "signedInHouse";
  if (o === "referred out" || o === "referred") return "referredOut";
  if (o.startsWith("rejected") || o === "lost" || o === "closed") return "rejected";
  if (o.includes("not interested")) return "notInterested";
  return "open";
};

export type SignupsDashboard = Awaited<ReturnType<typeof getSignupsDashboard>>;

export type SignupsFilter = {
  /** Only BDR or only FR leads. */
  role?: TeamRole;
  /** "current" hides former representatives (see @shared/team). */
  team?: "current" | "all";
};

export async function getSignupsDashboard(range?: { from?: Date; to?: Date }, filter: SignupsFilter = {}) {
  const db = await getDb();
  if (!db) return null;

  const conds = [] as any[];
  if (range?.from) conds.push(gte(leadIntake.leadDate, range.from));
  if (range?.to) conds.push(lte(leadIntake.leadDate, range.to));
  const all = await db.select().from(leadIntake).where(conds.length ? and(...conds) : undefined);
  // People outside BD/FR (NON_REPORTING_REPS, e.g. Malvin Rosales of Intake) stay out of team reporting.
  const leads = all.filter((l) => !isNonReportingRep(l.member) &&
    (!filter.role || l.role === filter.role) &&
    (filter.team !== "current" || isCurrentRep(l.member)));

  const facs = await db
    .select({ id: facilities.id, name: facilities.name, category: facilities.category, territory: facilities.territory })
    .from(facilities);
  const index = facs.map((f) => ({ ...f, n: norm(f.name), toks: new Set(tokens(f.name)) }));
  const facById = new Map(index.map((f) => [f.id, f]));

  // A Lead Docket lead's referring partner is the one the Lead Docket mirror
  // linked it to (facility_leads.facilityId) — the same link the Command Center,
  // facility profiles and the Partner Referral Tracker read, so every page agrees
  // on who sent a lead. Only leads entered by hand fall back to text matching.
  const links = await db
    .select({ externalId: facilityLeads.externalId, facilityId: facilityLeads.facilityId, linkedBy: facilityLeads.facilityLinkedBy })
    .from(facilityLeads)
    .where(eq(facilityLeads.externalSource, "leaddocket"));
  const linkedTo = new Map(links.map((r) => [String(r.externalId), r.facilityId]));
  const linkedByHand = new Map(links.filter((r) => r.linkedBy).map((r) => [String(r.externalId), r.linkedBy!]));

  /** exact → containment → distinctive-token overlap. Null when nothing is confident. */
  const matchFacility = (text: string) => {
    const ln = norm(text);
    if (!ln) return null;
    const exact = index.find((f) => f.n === ln);
    if (exact) return exact;
    // Whole words only, and nothing shorter than 5 characters: plain substring
    // matching let a junk facility named "#REF!" ("ref") claim every lead
    // whose source text said "referral".
    const within = (hay: string, needle: string) => needle.length >= 5 && ` ${hay} `.includes(` ${needle} `);
    const contained = index
      .filter((f) => f.n && (within(ln, f.n) || within(f.n, ln)))
      .sort((a, b) => b.n.length - a.n.length)[0];
    if (contained) return contained;
    const lt = tokens(text);
    if (!lt.length) return null;
    let best: typeof index[number] | null = null;
    let bestScore = 0;
    for (const f of index) {
      let hits = 0;
      for (const t of lt) if (f.toks.has(t)) hits++;
      if (hits < 2) continue;
      const score = hits / Math.max(1, Math.min(lt.length, f.toks.size));
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore >= 0.6 ? best : null;
  };

  const typeCount = new Map<string, number>();
  const territoryCount = new Map<string, number>();
  const memberCount = new Map<string, number>();
  const monthCount = new Map<string, number>();
  let matched = 0, withText = 0, signed = 0;

  // Per-representative, per-month and per-partner tallies — the view the team
  // actually manages by: who signed what, when, and how well each rep converts.
  const repStats = new Map<string, { name: string; role: string; leads: number; signed: number }>();
  const monthStats = new Map<string, { leads: number; signed: number }>();
  const repMonth = new Map<string, Map<string, number>>();      // rep → month → signed
  const roleStats: Record<string, { leads: number; signed: number }> = { BDR: { leads: 0, signed: 0 }, FR: { leads: 0, signed: 0 }, Intake: { leads: 0, signed: 0 } };
  const partnerStats = new Map<number, { facilityId: number; name: string; territory: string | null; leads: number; signed: number }>();
  // Every lead by name with its case type (Lead Docket's classification — Auto,
  // Workers Comp…), for the report's lead list, plus the case-type mix. Case
  // types are grouped ignoring case and spacing, so "Workers Comp " and
  // "workers comp" are one type.
  const leadList: {
    id: number; name: string; caseType: string; member: string; role: string;
    date: string | null; outcome: string; signed: boolean; partner: string | null; partnerId: number | null;
    // Lead Docket's own "Marketing Source Details" text, shown when it names no
    // CRM partner, so the list never hides who intake wrote down.
    referredBy: string | null;
    linkable: boolean; linkedBy: string | null;
  }[] = [];
  const caseStats = new Map<string, { name: string; leads: number; signed: number }>();
  // The team's scorecard: each lead lands in exactly one column, so the columns
  // add up to Total Leads, as in their sheet (see scorecardBucket).
  type Score = Record<ScoreBucket, number> & { name: string; role: string; leads: number; partners: Set<number> };
  const scoreStats = new Map<string, Score>();

  for (const l of leads) {
    const isS = isSigned(l.outcome);
    if (isS) signed++;
    if (l.member) memberCount.set(l.member, (memberCount.get(l.member) ?? 0) + 1);
    // Pacific months, matching the Pacific-day ranges the report is filtered by.
    const month = l.leadDate ? formatInTimeZone(new Date(l.leadDate), "America/Los_Angeles", "yyyy-MM") : null;
    if (month) monthCount.set(month, (monthCount.get(month) ?? 0) + 1);

    if (l.member) {
      const r = repStats.get(l.member) ?? { name: l.member, role: l.role ?? "", leads: 0, signed: 0 };
      r.leads++; if (isS) r.signed++;
      repStats.set(l.member, r);
      if (month && isS) {
        const m = repMonth.get(l.member) ?? new Map<string, number>();
        m.set(month, (m.get(month) ?? 0) + 1);
        repMonth.set(l.member, m);
      }
    }
    if (month) {
      const m = monthStats.get(month) ?? { leads: 0, signed: 0 };
      m.leads++; if (isS) m.signed++;
      monthStats.set(month, m);
    }
    if (l.role && roleStats[l.role]) { roleStats[l.role].leads++; if (isS) roleStats[l.role].signed++; }

    const text = String(l.facility ?? "").trim();
    if (text) withText++;
    const hit = l.externalSource === "leaddocket"
      ? facById.get(linkedTo.get(String(l.externalId)) ?? -1) ?? null
      : text ? matchFacility(text) : null;
    if (hit) {
      matched++;
      const p = partnerStats.get(hit.id) ?? { facilityId: hit.id, name: hit.name, territory: hit.territory ?? null, leads: 0, signed: 0 };
      p.leads++; if (isS) p.signed++;
      partnerStats.set(hit.id, p);
    }

    // Type: the matched facility's category, but let an unmistakable keyword in
    // the source text split towing/insurance/marketing out of "other".
    const keyword = byKeyword(text);
    const type = hit
      ? (hit.category === "other" || !hit.category ? keyword ?? "other" : hit.category)
      : keyword ?? null;
    typeCount.set(type ? TYPE_LABEL[type] ?? "Independent" : "N/A", (typeCount.get(type ? TYPE_LABEL[type] ?? "Independent" : "N/A") ?? 0) + 1);

    const territory = hit?.territory?.trim() || "N/A";
    territoryCount.set(territory, (territoryCount.get(territory) ?? 0) + 1);

    const written = String(l.classification ?? "").replace(/\s+/g, " ").trim();
    const caseKey = written.toLowerCase() || "not recorded";
    const cs = caseStats.get(caseKey) ?? { name: written || "Not recorded", leads: 0, signed: 0 };
    cs.leads++; if (isS) cs.signed++;
    caseStats.set(caseKey, cs);
    leadList.push({
      id: l.id,
      name: l.leadName,
      caseType: cs.name,
      member: l.member ?? "",
      role: l.role ?? "",
      date: l.leadDate ? new Date(l.leadDate).toISOString() : null,
      outcome: l.outcome ?? "",
      signed: isS,
      partner: hit?.name ?? null,
      partnerId: hit?.id ?? null,
      referredBy: text || null,
      linkable: l.externalSource === "leaddocket" && linkedTo.has(String(l.externalId)),
      linkedBy: l.externalSource === "leaddocket" ? linkedByHand.get(String(l.externalId)) ?? null : null,
    });

    if (l.member) {
      const s = scoreStats.get(l.member) ?? {
        name: l.member, role: l.role ?? "", leads: 0, partners: new Set<number>(),
        open: 0, rejected: 0, referredOut: 0, notInterested: 0, signedReferred: 0, signedInHouse: 0,
      };
      s.leads++;
      s[scorecardBucket(l.outcome)]++;
      if (isS && hit) s.partners.add(hit.id);
      scoreStats.set(l.member, s);
    }
  }
  leadList.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const caseTypes = Array.from(caseStats.values())
    .map((c) => ({ ...c, conversion: c.leads ? Math.round((c.signed / c.leads) * 1000) / 10 : 0 }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  const rank = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([name, leads]) => ({ name, leads }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  const byType = rank(typeCount);
  const byTerritory = rank(territoryCount);
  const byMember = rank(memberCount);
  const byMonth = Array.from(monthCount.entries())
    .map(([month, leads]) => ({ month, leads }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const real = <T extends { name: string }>(list: T[]) => list.filter((x) => x.name !== "N/A");
  const topTypes = real(byType);
  const topTerritories = real(byTerritory);
  const total = leads.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  // ── representatives, months, partners ────────────────────────────────────────
  const conv = (s: number, n: number) => (n ? Math.round((s / n) * 1000) / 10 : 0);
  const reps = Array.from(repStats.values())
    .map((r) => ({ ...r, conversion: conv(r.signed, r.leads), current: isCurrentRep(r.name) }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads || a.name.localeCompare(b.name));
  const months = Array.from(monthStats.entries())
    .map(([month, v]) => ({ month, ...v, conversion: conv(v.signed, v.leads) }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const monthKeys = months.map((m) => m.month);
  const repMonths = {
    months: monthKeys,
    rows: reps.map((r) => {
      const m = repMonth.get(r.name) ?? new Map<string, number>();
      return { name: r.name, role: r.role, current: r.current, cells: monthKeys.map((k) => m.get(k) ?? 0), total: r.signed };
    }),
  };
  const roles = (["BDR", "FR", "Intake"] as const).map((role) => ({
    role, ...roleStats[role], conversion: conv(roleStats[role].signed, roleStats[role].leads),
    share: signed ? Math.round((roleStats[role].signed / signed) * 1000) / 10 : 0,
  }));
  const partners = Array.from(partnerStats.values())
    .map((p) => ({ ...p, conversion: conv(p.signed, p.leads) }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads)
    .slice(0, 15);

  // ── team scorecard (FRs, BDRs, Intake — as the team's sheet lays it out) ──
  // Targets are per rep per month, so a range covering two months doubles them.
  const monthsInRange = range?.from && range?.to
    ? new Set(Array.from({ length: Math.ceil((range.to.getTime() - range.from.getTime()) / 86400000) + 1 }, (_, i) =>
        formatInTimeZone(new Date(range.from!.getTime() + i * 86400000), "America/Los_Angeles", "yyyy-MM"))).size
    : Math.max(1, months.length);
  // A range that starts mid-month (Last week, custom dates) gets its share of the
  // monthly target — each day counts 1/(days in its month) — so a week is measured
  // against about a quarter of a month, not all of it (Youssef, 2026-09-25: the
  // team presents weekly). A range from the 1st keeps whole months, as the team's
  // sheet does for month-to-date.
  const days = range?.from && range?.to
    ? Array.from({ length: Math.round((range.to.getTime() - range.from.getTime()) / 86400000) + 1 }, (_, i) =>
        formatInTimeZone(new Date(range.from!.getTime() + i * 86400000), "America/Los_Angeles", "yyyy-MM-dd"))
        .filter((d) => d <= formatInTimeZone(range.to!, "America/Los_Angeles", "yyyy-MM-dd"))
    : [];
  const prorated = days.length > 0 && !days[0].endsWith("-01");
  const daysIn = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();
  const targetMonths = prorated ? days.reduce((a, d) => a + 1 / daysIn(d), 0) : monthsInRange;
  const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : null);
  const order = (role: TeamRole, name: string) => {
    const i = CURRENT_TEAM[role]?.indexOf(name) ?? -1;
    return i < 0 ? 100 : i;   // current team in the sheet's order, former reps after
  };
  const scorecard = {
    months: monthsInRange,
    // When the range starts mid-month: its days, and the share of a month's target they carry.
    prorated: prorated ? { days: days.length, share: Math.round(targetMonths * 1000) / 1000 } : null,
    groups: (["FR", "BDR", "Intake"] as const).map((role) => {
      const perRepTarget = MONTHLY_SIGNUP_TARGET[role];
      const rows = Array.from(scoreStats.values())
        .filter((s) => s.role === role)
        .sort((a, b) => order(role, a.name) - order(role, b.name) || a.name.localeCompare(b.name))
        .map((s) => {
          const signedN = s.signedReferred + s.signedInHouse;
          const target = perRepTarget ? Math.round(perRepTarget * targetMonths * 10) / 10 : null;
          return {
            name: s.name, current: isCurrentRep(s.name), leads: s.leads,
            open: s.open, rejected: s.rejected, referredOut: s.referredOut, notInterested: s.notInterested,
            signedReferred: s.signedReferred, unique: s.partners.size, signedInHouse: s.signedInHouse, signed: signedN,
            target, achieved: target ? pctOf(signedN, target) : null, conversion: pctOf(signedN, s.leads),
          };
        });
      const sum = (k: "leads" | "open" | "rejected" | "referredOut" | "notInterested" | "signedReferred" | "unique" | "signedInHouse" | "signed") =>
        rows.reduce((a, r) => a + r[k], 0);
      // Rounded: prorated targets are tenths, and a sum of tenths picks up float noise (14.100000000000001).
      const target = perRepTarget ? Math.round(rows.reduce((a, r) => a + (r.target ?? 0), 0) * 10) / 10 : null;
      const total = {
        leads: sum("leads"), open: sum("open"), rejected: sum("rejected"), referredOut: sum("referredOut"),
        notInterested: sum("notInterested"), signedReferred: sum("signedReferred"), unique: sum("unique"),
        signedInHouse: sum("signedInHouse"), signed: sum("signed"), target,
        achieved: target ? pctOf(sum("signed"), target) : null, conversion: pctOf(sum("signed"), sum("leads")),
      };
      return { role, rows, total };
    }).filter((g) => g.rows.length),
  };

  // Insights are computed from the numbers above, never hard-coded — the page
  // renders whatever the data actually says for the selected period.
  const insights: string[] = [];
  if (total) insights.push(`${signed} of ${total} leads signed — ${pct(signed)}% conversion.`);
  const topRep = reps[0];
  if (topRep && topRep.signed) insights.push(`${topRep.name} leads with ${topRep.signed} sign-ups from ${topRep.leads} leads (${topRep.conversion}%).`);
  const converter = reps.filter((r) => r.leads >= 10).sort((a, b) => b.conversion - a.conversion)[0];
  if (converter && converter.name !== topRep?.name) insights.push(`${converter.name} converts best: ${converter.conversion}% of leads signed.`);
  // Share of sign-ups by role — FR, BDR and, for leads Malvin brings in, Intake.
  const shares = roles.filter((r) => r.signed).sort((a, b) => b.signed - a.signed).map((r) => `${r.role} ${r.signed} (${r.share}%)`);
  if (shares.length > 1) insights.push(`Sign-ups by role: ${shares.join(", ")}.`);
  if (months.length >= 2) {
    const [prev, last] = months.slice(-2);
    const now = new Date();
    if (last.month === formatInTimeZone(now, "America/Los_Angeles", "yyyy-MM")) {
      // A month still in progress would always look like a drop, so compare its pace instead.
      const day = Number(formatInTimeZone(now, "America/Los_Angeles", "d"));
      const [yy, mm] = last.month.split("-").map(Number);
      const days = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const pace = Math.round((last.signed / day) * days);
      insights.push(`${monthName(last.month)} so far (${day} of ${days} days): ${last.signed} sign-ups — on pace for about ${pace}, against ${prev.signed} in ${monthName(prev.month)}.`);
    } else {
      const d = last.signed - prev.signed;
      insights.push(`${monthName(last.month)}: ${last.signed} sign-ups, ${d === 0 ? "level with" : d > 0 ? `${d} more than` : `${-d} fewer than`} ${monthName(prev.month)}.`);
    }
  }
  if (partners[0]) insights.push(`Top referring partner: ${partners[0].name} — ${partners[0].signed} sign-ups from ${partners[0].leads} leads.`);
  // Most leads name no referring partner in Lead Docket; that is normal, not a
  // data fault, so say so plainly rather than asking anyone to "review" it.
  if (total) insights.push(`${matched} of ${total} leads name a referring partner we can match; the rest are credited to the representative only.`);

  const recommendations: string[] = [];
  const quiet = reps.filter((r) => r.current && r.leads >= 5 && r.conversion < pct(signed) - 10);
  if (quiet.length) recommendations.push(`Review lead quality with ${quiet.map((r) => r.name).join(", ")} — conversion well below the team average.`);
  if (partners.length >= 2) recommendations.push(`Invest in the partners that sign: ${partners.slice(0, 3).map((p) => p.name).join(", ")}.`);
  if (topTypes[0] && topTypes[1]) recommendations.push(`Double down on ${topTypes[0].name} and ${topTypes[1].name} relationships.`);
  if (total && matched / total < 0.5) recommendations.push("Ask intake to record the referring partner in Lead Docket's \"Referred by\" field, so sign-ups can be credited to the partner that sent them.");

  const topTwoTerritoryLeads = (topTerritories[0]?.leads ?? 0) + (topTerritories[1]?.leads ?? 0);

  return {
    period: {
      from: range?.from ? range.from.toISOString().slice(0, 10) : null,
      to: range?.to ? range.to.toISOString().slice(0, 10) : null,
      firstLead: byMonth[0]?.month ?? null,
      lastLead: byMonth[byMonth.length - 1]?.month ?? null,
    },
    totals: {
      leads: total,
      signed,
      signedPct: pct(signed),
      attributed: matched,
      withFacilityText: withText,
      matchRate: withText ? Math.round((matched / withText) * 100) : 0,
    },
    headline: {
      bestType: topTypes[0] ?? null,
      secondType: topTypes[1] ?? null,
      bestTerritory: topTerritories[0] ?? null,
      secondTerritory: topTerritories[1] ?? null,
      bestTypeShare: topTypes[0] ? pct(topTypes[0].leads) : 0,
      topTwoTerritoryLeads,
    },
    byType,
    byTerritory,
    byMember,
    byMonth,
    reps,
    months,
    repMonths,
    roles,
    partners,
    caseTypes,
    scorecard,
    leadList,
    filter: { role: filter.role ?? null, team: filter.team ?? "all" },
    insights,
    recommendations,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** Every partner, for the "Link to a partner" picker. */
export async function getPartnerOptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: facilities.id, name: facilities.name, territory: facilities.territory })
    .from(facilities).orderBy(asc(facilities.name));
}

/**
 * Pick a Lead Docket lead's referring partner by hand, from the report's lead
 * lists. Intake writes partners the way people say them ("Luke with First
 * Health Medical"), so the mirror's text matching misses some and can get a few
 * wrong; the BDR who owns the relationship knows. The choice goes everywhere a
 * partner's leads are read — facility_leads (facility profile, Command Center,
 * this report), the facility's totals, and inbound_leads (Partner Referral
 * Tracker) — the same writes mirror-leads-to-facilities.mjs makes for an
 * automatic link. facilityLinkedBy tells that script to keep it from then on.
 * facilityId null records "no partner", which also sticks.
 */
export async function linkLeadToPartner(leadId: number, facilityId: number | null, by: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  const [lead] = await db.select().from(leadIntake).where(eq(leadIntake.id, leadId)).limit(1);
  if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
  if (lead.externalSource !== "leaddocket" || !lead.externalId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only Lead Docket leads can be linked to a partner here." });
  }
  const externalId = String(lead.externalId);
  const [row] = await db.select({ id: facilityLeads.id, facilityId: facilityLeads.facilityId })
    .from(facilityLeads)
    .where(and(eq(facilityLeads.externalSource, "leaddocket"), eq(facilityLeads.externalId, externalId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This lead only just arrived from Lead Docket — try again after the next sync." });
  }
  let partner: { id: number; name: string } | undefined;
  if (facilityId != null) {
    [partner] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, facilityId)).limit(1);
    if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "That partner no longer exists." });
  }

  await db.update(facilityLeads)
    .set({ facilityId, facilityLinkedBy: by.slice(0, 255), facilityLinkedAt: new Date() })
    .where(eq(facilityLeads.id, row.id));

  // Both the partner that lost the lead and the one that gained it.
  for (const id of Array.from(new Set([row.facilityId, facilityId].filter((x): x is number => x != null)))) {
    await db.execute(sql`UPDATE facilities f SET
      f.totalLeadsReceived = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND direction = 'received_from_facility'),
      f.totalLeadsSent = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND direction = 'sent_to_facility')
                       + (SELECT COALESCE(SUM(count), 0) FROM facility_leads_sent WHERE facilityId = ${id}),
      f.totalSignedCases = (SELECT COUNT(*) FROM facility_leads WHERE facilityId = ${id} AND signedCase = 1),
      f.lastSignedCaseDate = (SELECT MAX(COALESCE(signedDate, leadDate)) FROM facility_leads WHERE facilityId = ${id} AND signedCase = 1)
      WHERE f.id = ${id}`);
  }

  const inboundKey = and(eq(inboundLeads.externalSource, "leaddocket"), eq(inboundLeads.externalId, externalId));
  if (!partner) {
    await db.delete(inboundLeads).where(inboundKey);
    return { partner: null };
  }
  const signed = isSigned(lead.outcome);
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
  const [have] = await db.select({ id: inboundLeads.id }).from(inboundLeads).where(inboundKey).limit(1);
  if (have) {
    await db.update(inboundLeads).set(owned).where(eq(inboundLeads.id, have.id));
  } else {
    await db.insert(inboundLeads).values({
      ...owned,
      notes: `Lead Docket #${externalId} · linked by ${by}`,
      countsTowardPartnerActivity: true,
      externalId,
      externalSource: "leaddocket",
      createdAt: when,
    });
  }
  return { partner: partner.name };
}
