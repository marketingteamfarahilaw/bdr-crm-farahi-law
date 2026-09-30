/**
 * The activity side of a representative's profile page (Youssef, 2026-09-28:
 * "when we click on a representative it shows all the details … and
 * performance of the representative in a premium profile page"): calls,
 * recaps, visits, errands, expenses and partners for the dates picked. Their
 * sign-ups and trends come from the Sign-ups Report's own functions, filtered
 * to them, so the two pages always agree.
 */
import { inArray } from "drizzle-orm";
import { getDb } from "./db";
import { agentZones, facilities } from "../drizzle/schema";
import { getAgentPerformanceData, getAgentReport, generateAgentPerformanceReview, type AgentPerformanceReview } from "./reports";
import { CURRENT_TEAM, isCurrentRep, type TeamRole } from "@shared/team";
import { partnerType } from "./signupsReport";

/** The spellings a rep's name takes across the CRM's tables: "Lupe Campos", "Lupe". */
export const nameVariants = (member: string) => Array.from(new Set([member.trim(), member.trim().split(/\s+/)[0]].filter(Boolean)));

export async function getRepActivity(member: string, range: { from: Date; to: Date }) {
  const names = nameVariants(member);
  const [perf, report, db] = await Promise.all([
    getAgentPerformanceData({ names, ...range }),
    getAgentReport({ names, ...range }),
    getDb(),
  ]);
  let profile: { title: string | null; phone: string | null; email: string | null; cities: string[]; active: boolean } | null = null;
  let assigned: { id: number; name: string; type: string; city: string | null; status: string | null; lastContact: Date | null }[] = [];
  if (db) {
    const [z] = await db.select().from(agentZones).where(inArray(agentZones.agentName, [...names, member])).limit(1);
    if (z) profile = { title: z.title, phone: z.phone, email: z.email, cities: Array.isArray(z.cities) ? (z.cities as string[]) : [], active: !!z.active };
    const rows = await db
      .select({
        id: facilities.id, name: facilities.name, category: facilities.category, city: facilities.city,
        status: facilities.relationshipStatus, lastContact: facilities.lastContactDate,
      })
      .from(facilities)
      .where(inArray(facilities.assignedRepName, names));
    assigned = rows
      .map(({ category, ...f }) => ({ ...f, type: partnerType(category, f.name) }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }
  const role = (Object.keys(CURRENT_TEAM) as TeamRole[]).find((r) => CURRENT_TEAM[r].includes(member)) ?? null;
  const k = perf.kpis, r = report.kpis;
  return {
    member,
    role,
    current: isCurrentRep(member),
    profile,
    /** Partners in the CRM assigned to them today — the hero's chip opens the list. */
    partners: assigned.length,
    assignedPartners: assigned,
    calls: {
      total: k.calls, connected: k.connected, voicemail: k.voicemail, noAnswer: k.noAnswer,
      talkMinutes: Math.round(k.talkSec / 60), partnersContacted: k.facilities,
    },
    recaps: {
      count: k.recaps, sentiment: k.sentiment, interest: k.interest,
      latest: perf.recaps
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8)
        .map((x) => ({ date: x.date, facilityId: x.facilityId, facility: x.facility, summary: x.summary, sentiment: x.sentiment, interest: x.interest })),
    },
    field: { visits: r.visits, facilitiesVisited: r.facilitiesVisited, hours: Math.round(r.hours * 10) / 10, errands: r.errandsTotal, errandsCompleted: r.errandsCompleted },
    money: { expenses: Math.round(r.expenseTotal * 100) / 100, rewards: r.rewardsTotal, payouts: Math.round(r.payoutTotal * 100) / 100 },
    /** Calls, connected calls and recaps a day, for the activity strip. */
    days: perf.days,
  };
}

/**
 * The AI performance review (the Representative Performance page's) for this
 * rep and these dates, written from their call recaps. The profile opens it by
 * itself, so a review is kept for a few hours per rep and range rather than
 * paying for a new one on every visit; Regenerate asks for a fresh one.
 */
const REVIEW_MS = 6 * 3600_000;
const reviews = new Map<string, { at: number; review: AgentPerformanceReview }>();
export async function getRepReview(member: string, range: { from: Date; to: Date }, fresh = false) {
  const key = `${member}|${range.from.toISOString()}|${range.to.toISOString()}`;
  const hit = reviews.get(key);
  if (!fresh && hit && Date.now() - hit.at < REVIEW_MS) return { ...hit.review, generatedAt: new Date(hit.at).toISOString() };
  const review = await generateAgentPerformanceReview({ names: nameVariants(member), ...range, agentLabel: member });
  const at = Date.now();
  reviews.set(key, { at, review });
  if (reviews.size > 200) reviews.delete(reviews.keys().next().value!);
  return { ...review, generatedAt: new Date(at).toISOString() };
}
