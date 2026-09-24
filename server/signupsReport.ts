/**
 * Sign-ups dashboard — the executive view of lead_intake: how many sign-ups,
 * from which facility types, and from which territories.
 *
 * The wrinkle: lead_intake stores the source as FREE TEXT ("Leonard with
 * Randy's Towing", "Field Rep Jezel / Karina of All Foreign and Domestic Body
 * Shop"), with typeOfFacility and clientLocation never filled in. So facility
 * type and territory are DERIVED by matching that text back to the facilities
 * table in three passes — exact, containment, then distinctive-token overlap.
 *
 * Most Lead Docket team leads name no referring partner, so only about a third
 * match. The rest are reported as "N/A" rather than guessed at, and still count
 * for the representative; the response carries the match rate so the page can
 * say how much of the picture is partner-attributed.
 */
import { and, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import { leadIntake, facilities } from "../drizzle/schema";
import { isCurrentRep } from "@shared/team";

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
const isSigned = (o: unknown) => SIGNED.has(String(o ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim());

export type SignupsDashboard = Awaited<ReturnType<typeof getSignupsDashboard>>;

export type SignupsFilter = {
  /** Only BDR or only FR leads. */
  role?: "BDR" | "FR";
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
  const leads = all.filter((l) =>
    (!filter.role || l.role === filter.role) &&
    (filter.team !== "current" || isCurrentRep(l.member)));

  const facs = await db
    .select({ id: facilities.id, name: facilities.name, category: facilities.category, territory: facilities.territory })
    .from(facilities);
  const index = facs.map((f) => ({ ...f, n: norm(f.name), toks: new Set(tokens(f.name)) }));

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
  const roleStats: Record<string, { leads: number; signed: number }> = { BDR: { leads: 0, signed: 0 }, FR: { leads: 0, signed: 0 } };
  const partnerStats = new Map<number, { facilityId: number; name: string; territory: string | null; leads: number; signed: number }>();

  for (const l of leads) {
    const isS = isSigned(l.outcome);
    if (isS) signed++;
    if (l.member) memberCount.set(l.member, (memberCount.get(l.member) ?? 0) + 1);
    const month = l.leadDate ? new Date(l.leadDate).toISOString().slice(0, 7) : null;
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
    const hit = text ? matchFacility(text) : null;
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
  }

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
  const roles = (["BDR", "FR"] as const).map((role) => ({
    role, ...roleStats[role], conversion: conv(roleStats[role].signed, roleStats[role].leads),
    share: signed ? Math.round((roleStats[role].signed / signed) * 1000) / 10 : 0,
  }));
  const partners = Array.from(partnerStats.values())
    .map((p) => ({ ...p, conversion: conv(p.signed, p.leads) }))
    .sort((a, b) => b.signed - a.signed || b.leads - a.leads)
    .slice(0, 15);

  // Insights are computed from the numbers above, never hard-coded — the page
  // renders whatever the data actually says for the selected period.
  const insights: string[] = [];
  if (total) insights.push(`${signed} of ${total} leads signed — ${pct(signed)}% conversion.`);
  const topRep = reps[0];
  if (topRep && topRep.signed) insights.push(`${topRep.name} leads with ${topRep.signed} sign-ups from ${topRep.leads} leads (${topRep.conversion}%).`);
  const converter = reps.filter((r) => r.leads >= 10).sort((a, b) => b.conversion - a.conversion)[0];
  if (converter && converter.name !== topRep?.name) insights.push(`${converter.name} converts best: ${converter.conversion}% of leads signed.`);
  const fr = roles.find((r) => r.role === "FR"), bdr = roles.find((r) => r.role === "BDR");
  if (fr && bdr && signed) insights.push(`FR delivered ${fr.signed} sign-ups (${fr.share}%), BDR ${bdr.signed} (${bdr.share}%).`);
  if (months.length >= 2) {
    const [prev, last] = months.slice(-2);
    const now = new Date();
    if (last.month === now.toISOString().slice(0, 7)) {
      // A month still in progress would always look like a drop, so compare its pace instead.
      const day = now.getUTCDate();
      const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
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
    filter: { role: filter.role ?? null, team: filter.team ?? "all" },
    insights,
    recommendations,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
