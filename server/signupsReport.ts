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
 * About two thirds of rows match. Everything else is reported honestly as
 * "N/A" rather than guessed at, and the response carries the match rate so the
 * page can show how much of the picture is attributed.
 */
import { and, gte, lte } from "drizzle-orm";
import { getDb } from "./db";
import { leadIntake, facilities } from "../drizzle/schema";

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

export async function getSignupsDashboard(range?: { from?: Date; to?: Date }) {
  const db = await getDb();
  if (!db) return null;

  const conds = [] as any[];
  if (range?.from) conds.push(gte(leadIntake.leadDate, range.from));
  if (range?.to) conds.push(lte(leadIntake.leadDate, range.to));
  const leads = await db.select().from(leadIntake).where(conds.length ? and(...conds) : undefined);

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
    const contained = index
      .filter((f) => f.n && (ln.includes(f.n) || f.n.includes(ln)))
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

  for (const l of leads) {
    if (isSigned(l.outcome)) signed++;
    if (l.member) memberCount.set(l.member, (memberCount.get(l.member) ?? 0) + 1);
    if (l.leadDate) {
      const k = new Date(l.leadDate).toISOString().slice(0, 7);
      monthCount.set(k, (monthCount.get(k) ?? 0) + 1);
    }

    const text = String(l.facility ?? "").trim();
    if (text) withText++;
    const hit = text ? matchFacility(text) : null;
    if (hit) matched++;

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

  // Insights are computed from the numbers above, never hard-coded — the page
  // renders whatever the data actually says for the selected period.
  const insights: string[] = [];
  if (topTypes[0]) insights.push(`${topTypes[0].name} generated the highest volume of leads: ${topTypes[0].leads}.`);
  if (topTypes[1]) insights.push(`${topTypes[1].name} ranked second with ${topTypes[1].leads} leads.`);
  if (topTypes[2]) insights.push(`${topTypes[2].name} contributed ${topTypes[2].leads} leads.`);
  const naTerr = byTerritory.find((t) => t.name === "N/A");
  if (naTerr) insights.push(`${naTerr.leads} leads have no territory attributed and should be reviewed.`);
  if (topTerritories[0] && topTerritories[1]) {
    insights.push(`${topTerritories[0].name} and ${topTerritories[1].name} are the strongest territories.`);
  }
  if (total) insights.push(`${signed} of ${total} leads signed (${pct(signed)}%).`);

  const recommendations: string[] = [];
  if (topTypes[0] && topTypes[1]) recommendations.push(`Double down on ${topTypes[0].name} and ${topTypes[1].name} relationships.`);
  if (topTerritories[0] && topTerritories[1]) recommendations.push(`Expand outreach in ${topTerritories[0].name} and ${topTerritories[1].name}.`);
  if (naTerr) recommendations.push("Clean up missing territory attribution for better reporting.");

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
    insights,
    recommendations,
  };
}
