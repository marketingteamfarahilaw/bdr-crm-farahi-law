/**
 * The Digital Marketing Report's Audit tab, server side: where Lead Docket may
 * have credited a lead to the wrong Marketing Source, and which source names
 * need cleaning up (Youssef, 2026-09-30: "find all the gaps and check deeply
 * Lead Docket: any other digital marketing mis-registered").
 *
 * Nothing here changes a count. Lead Docket stays the source of truth; this is
 * a to-fix list for the team, and a lead corrected in Lead Docket moves on the
 * report after the next sync.
 *
 *  1. Possibly digital: a lead whose Marketing Source isn't digital (or is
 *     empty) while its other fields say it came in digitally — its Contact
 *     Source (grouped as the Marketing Report's "How leads reached us" panel
 *     does, routeOf), its campaign, or its UTM, referring URL or keywords.
 *  2. Possibly not digital: a digital Marketing Source whose Contact Source
 *     says the lead came another way (a Walker line, staff, an existing client…).
 *  3. Source-name hygiene, all time: names that look digital but match no
 *     digital row, near-duplicate spellings, and which names roll up into each
 *     GBP office, SEO brand and ad campaign.
 *
 * The rules are pure and tested (digitalAudit.test.ts); the loader only reads.
 */
import { and, desc, gte, lte, sql, type AnyColumn } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { getDb } from "./db";
import { leaddocketLeads } from "../drizzle/schema";
import { DIGITAL_GROUPS, NO_SOURCE, TEAM_CHANNEL, TOLL_FREE, channelOfSource, digitalGroupOf, isTollFreeLine, sourceCategoryOf, type DigitalGroup } from "@shared/marketing";
import { TZ, bdFrOnly, clean, notBdFr, sourceOf } from "./marketing/common";
import { routeOf } from "./marketing/routes";
import { isSigned } from "./signupsReport";

export type AuditLead = {
  leadId: number;
  leadDate: Date | string | null;
  clientName: string | null;
  outcome: string | null;
  marketingSource: string | null;
  teamRole: string | null;
  contactSource: string | null;
  campaign: string | null;
  utm: string | null;
  referringUrl: string | null;
  keywords: string | null;
};

export type Evidence = { group: DigitalGroup; evidence: string };

/** The firm's own sites, as they appear in a URL or UTM. */
const FIRM_SITE = /justinforjustice|justin-for-justice|kapwajustice|ayudacalifornia|braininjuryhelpcenter|laborlawadvocates|wom[ae]nsrights?group|motorcyclist|collisionrepair|farahilaw/;

/** The Contact Source routes that say the lead came in through one of the firm's digital doors. */
const DIGITAL_ROUTES: Record<string, DigitalGroup> = {
  "Google Business Profile": "GBP",
  "Google search": "SEO",
  "Website chat (Intaker)": "SEO",
  "Website form": "SEO",
  "Directories (Yelp, Avvo)": "SEO",
  "Google Local Services Ads": "Ads",
  "Social media": "Ads",
};

/**
 * What in a lead's other fields says it came in digitally, or null. The first
 * that speaks wins: Contact Source, then campaign, then the UTM, referring URL
 * and keywords. A Walker call line is never evidence — Walker runs its own ads,
 * so a lead through its line is Walker's however it found the number.
 */
export function evidenceOf(l: Pick<AuditLead, "contactSource" | "campaign" | "utm" | "referringUrl" | "keywords">): Evidence | null {
  const route = routeOf(l.contactSource);
  if (route === "Walker call line") return null;
  const contact = clean(l.contactSource).toLowerCase();
  if (DIGITAL_ROUTES[route]) return { group: DIGITAL_ROUTES[route], evidence: `Contact Source: ${route}` };
  // "Firm and partner websites" catches any .com, a partner's too: only the firm's own sites count.
  if (route === "Firm and partner websites" && (FIRM_SITE.test(contact.replace(/\s+/g, "")) || /\bwebsite\b/.test(contact))) {
    return { group: "SEO", evidence: "Contact Source: firm website" };
  }
  if (/\be-?mail/.test(contact)) return { group: "SEO", evidence: "Contact Source: email" };

  const campaign = clean(l.campaign).toLowerCase();
  if (campaign) {
    if (/gmb|google my business|business profile|\bgbp\b/.test(campaign)) return { group: "GBP", evidence: "Campaign: Google Business Profile" };
    if (/local services|\blsa\b/.test(campaign)) return { group: "Ads", evidence: "Campaign: Local Services Ads" };
    if (/ppc|google ads|adwords|\bsem\b|facebook|instagram|\bfb\b|tiktok/.test(campaign)) return { group: "Ads", evidence: "Campaign: paid ads" };
    if (/website|\bweb\b|\bseo\b|google|landing/.test(campaign) || FIRM_SITE.test(campaign.replace(/\s+/g, ""))) return { group: "SEO", evidence: "Campaign: website / search" };
  }

  const web = [l.utm, l.referringUrl, l.keywords].map((v) => clean(v).toLowerCase()).join(" ");
  if (web.trim()) {
    if (/utm_(source|medium|campaign)=(gmb|gbp|google_?business|googlemybusiness)|business\.google|maps\.google|google\.[a-z.]+\/maps/.test(web)) return { group: "GBP", evidence: "Link: Google Business Profile" };
    if (/gclid|gad_source|wbraid|gbraid|utm_medium=(cpc|ppc|paid)/.test(web)) return { group: "Ads", evidence: "Link: Google Ads click" };
    if (/fbclid|facebook|instagram|tiktok/.test(web)) return { group: "Ads", evidence: "Link: social media" };
    if (FIRM_SITE.test(web)) return { group: "SEO", evidence: "Link: firm website" };
    if (/google/.test(web)) return { group: "SEO", evidence: "Link: Google search" };
  }
  return null;
}

/** Contact Source routes that say a lead did not come in digitally. After-hours answering is how digital callers reach us at night too, so it is not one. */
const NOT_DIGITAL_ROUTES = new Set(["Walker call line", "Staff and team referral", "Existing client", "Attorney referral", "Partner business", "TV, radio, outdoor", "Walk-in"]);

/** For a lead credited to a digital source: the Contact Source route that says otherwise, or null. */
export function contraryOf(l: Pick<AuditLead, "contactSource">): string | null {
  const route = routeOf(l.contactSource);
  return NOT_DIGITAL_ROUTES.has(route) ? `Contact Source: ${route}` : null;
}

const LIST_CAP = 100;
type Listed = { id: number; name: string; date: string | null; outcome: string; signed: boolean; contactSource: string | null; campaign: string | null };
const listed = (l: AuditLead): Listed => ({
  id: l.leadId, name: clean(l.clientName) || `Lead ${l.leadId}`, date: l.leadDate ? new Date(l.leadDate).toISOString() : null,
  outcome: clean(l.outcome), signed: isSigned(l.outcome), contactSource: clean(l.contactSource) || null, campaign: clean(l.campaign) || null,
});

export type AuditGroup = { source: string; evidence: string; group: DigitalGroup | null; label: string | null; leads: number; signed: number; clients: Listed[] };

/** Parts 1 and 2 from the leads. BD/FR-credited leads are the team's, never checked here. */
export function misregistered(leads: AuditLead[]) {
  const into = new Map<string, AuditGroup>();
  const outOf = new Map<string, AuditGroup>();
  const shared = new Map<string, AuditGroup>();
  const bump = (m: Map<string, AuditGroup>, g: Omit<AuditGroup, "leads" | "signed" | "clients">, l: AuditLead) => {
    const k = g.source + "\u0001" + g.evidence;
    const e = m.get(k) ?? { ...g, leads: 0, signed: 0, clients: [] };
    e.leads++;
    if (isSigned(l.outcome)) e.signed++;
    if (e.clients.length < LIST_CAP) e.clients.push(listed(l));
    m.set(k, e);
  };
  for (const l of leads) {
    const source = sourceOf(l);
    if (source === TEAM_CHANNEL) continue;
    const g = digitalGroupOf(source);
    // The toll-free line is printed on the website and on merch, welcome kits,
    // the emailer and billboards: a lead on it can't be credited to one of them.
    const where = g?.label === TOLL_FREE ? "Marketing Source" : isTollFreeLine(l.contactSource) ? "Contact Source" : isTollFreeLine(l.campaign) ? "Campaign" : null;
    if (where) bump(shared, { source, evidence: `${where} names the 800-738-0000 toll-free line`, group: g?.group ?? null, label: g?.label ?? null }, l);
    if (!g) {
      const ev = evidenceOf(l);
      if (ev) bump(into, { source, evidence: ev.evidence, group: ev.group, label: null }, l);
    } else {
      const why = contraryOf(l);
      if (why) bump(outOf, { source, evidence: why, group: g.group, label: g.label }, l);
    }
  }
  const sort = (m: Map<string, AuditGroup>) => Array.from(m.values()).sort((a, b) => b.leads - a.leads || b.signed - a.signed || a.source.localeCompare(b.source));
  const possiblyDigital = sort(into);
  // What each group would gain if Lead Docket were corrected.
  const wouldAdd = DIGITAL_GROUPS.map((group) => {
    const of = possiblyDigital.filter((x) => x.group === group);
    return { group, leads: of.reduce((a, x) => a + x.leads, 0), signed: of.reduce((a, x) => a + x.signed, 0) };
  });
  return { possiblyDigital, possiblyNotDigital: sort(outOf), wouldAdd, tollFree: sort(shared) };
}

// ── BD/FR leads that carry a marketing campaign ──

export type TeamCampaign = {
  campaign: string;
  /** Where the campaign alone would file the lead if no rep were credited. */
  kind: "Toll-free line" | DigitalGroup | "Other";
  leads: number;
  signed: number;
  clients: (Listed & { rep: string; role: string })[];
};

/**
 * BD/FR-credited leads whose Lead Docket Campaign is filled in (Youssef,
 * 2026-10-01: "find all the leads and signups that have a marketing campaign
 * and are assigned to BDR and FR"). The rep keeps the credit — a rep's client
 * often calls the toll-free number they were handed, and the intake notes say
 * so — so this is a list to review, not a recount: a lead that really came in
 * on its own is moved by changing its Marketing Source in Lead Docket.
 */
export function teamCampaigns(leads: AuditLead[]): TeamCampaign[] {
  const by = new Map<string, TeamCampaign>();
  for (const l of leads) {
    const campaign = clean(l.campaign);
    if (!campaign) continue;
    const key = campaign.toLowerCase();
    const kind: TeamCampaign["kind"] = isTollFreeLine(campaign) ? "Toll-free line" : evidenceOf({ contactSource: null, campaign, utm: null, referringUrl: null, keywords: null })?.group ?? "Other";
    const e = by.get(key) ?? { campaign, kind, leads: 0, signed: 0, clients: [] };
    e.leads++;
    if (isSigned(l.outcome)) e.signed++;
    if (e.clients.length < LIST_CAP) e.clients.push({ ...listed(l), rep: clean(l.marketingSource) || "—", role: clean(l.teamRole) });
    by.set(key, e);
  }
  const marketing = (t: TeamCampaign) => (t.kind === "Other" ? 1 : 0);
  return Array.from(by.values()).sort((a, b) => marketing(a) - marketing(b) || b.leads - a.leads || a.campaign.localeCompare(b.campaign));
}

// ── part 3: source names ──

export type SourceName = { source: string; leads: number; first: string | null; last: string | null };

/** Words that suggest a digital channel, for a name no digital row claims. */
const DIGITAL_WORDS = /web|site\b|google|gmb|gbp|\bseo\b|\bads?\b|ppc|facebook|\bfb\b|insta|tiktok|yelp|avvo|e-?mail|\bchat\b|intaker|landing|\blsa\b|online/i;
// Letters and digits: "Contract 26" and "Contract 27" are two contracts, not one name spelled twice.
const lettersKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The all-time source-name picture: which names each digital row is made of,
 * names that look digital but aren't counted as such, and spellings that are
 * probably the same thing. Near duplicates are the same letters and digits
 * ignoring case, spaces and punctuation, one name inside another (both of 8 letters or
 * more, so "GMB" doesn't pair with every listing), or the same first 12
 * letters. Walker's numbered contracts are deliberate, so they never pair
 * except by identical letters.
 */
export function sourceHygiene(names: SourceName[]) {
  const real = names.filter((n) => n.source && n.source !== NO_SOURCE && n.source !== TEAM_CHANNEL);

  const rows = new Map<string, { group: DigitalGroup; label: string; names: SourceName[] }>();
  for (const n of real) {
    const g = digitalGroupOf(n.source);
    if (!g) continue;
    const k = g.group + "|" + g.label;
    const r = rows.get(k) ?? { group: g.group, label: g.label, names: [] };
    r.names.push(n);
    rows.set(k, r);
  }
  const perRow = Array.from(rows.values())
    .map((r) => ({ ...r, names: r.names.sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)), leads: r.names.reduce((a, n) => a + n.leads, 0) }))
    .sort((a, b) => DIGITAL_GROUPS.indexOf(a.group) - DIGITAL_GROUPS.indexOf(b.group) || b.leads - a.leads || a.label.localeCompare(b.label));

  const lookDigital = real.filter((n) => sourceCategoryOf(n.source).kind === "other" && DIGITAL_WORDS.test(n.source)).sort((a, b) => b.leads - a.leads);
  // Known and not digital, so not a gap: the firm's merch and print.
  const merch = real.filter((n) => sourceCategoryOf(n.source).kind === "merch").sort((a, b) => b.leads - a.leads);

  // Union-find over the names.
  const parent = real.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const keys = real.map((n) => lettersKey(n.source));
  const contract = real.map((n) => /\bcontract\b/i.test(n.source));
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = keys[i], b = keys[j];
      if (!a || !b) continue;
      const same = a === b;
      const loose = !contract[i] && !contract[j];
      const inside = loose && Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a));
      // "Justin For Justice Toll Free for Website" and "JustinforJustice Website": the same brand, named two ways.
      const stem = loose && a.slice(0, 12) === b.slice(0, 12) && a.length >= 12 && b.length >= 12;
      if (same || inside || stem) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, SourceName[]>();
  real.forEach((n, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), n]); });
  const duplicates = Array.from(clusters.values())
    .filter((c) => c.length > 1)
    .map((c) => {
      const sorted = c.sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
      const groups = new Set(sorted.map((n) => {
        const c = sourceCategoryOf(n.source);
        return c.kind === "digital" ? `${c.group}: ${c.label}` : c.kind === "merch" ? c.label : "not digital";
      }));
      return {
        names: sorted,
        exact: new Set(sorted.map((n) => lettersKey(n.source))).size === 1,
        // Spellings that land in different rows (or one digital, one not) make the report disagree with itself.
        rows: Array.from(groups),
        leads: sorted.reduce((a, n) => a + n.leads, 0),
      };
    })
    .sort((a, b) => b.rows.length - a.rows.length || b.leads - a.leads);

  return { perRow, lookDigital, merch, duplicates };
}

// ── reading ──

const L = leaddocketLeads;
const AUDIT_COLS = {
  leadId: L.leadId, leadDate: L.leadDate, clientName: L.clientName, outcome: L.outcome, marketingSource: L.marketingSource,
  teamRole: L.teamRole, contactSource: L.contactSource, campaign: L.campaign, utm: L.utm, referringUrl: L.referringUrl, keywords: L.keywords,
};
const day = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function getDigitalAudit(range: { from: Date; to: Date; fromDay: string; toDay: string }, scope: "period" | "12m" | "all") {
  const db = await getDb();
  if (!db) return null;
  // Last 12 months: the whole months up to the period's end, as the trend charts.
  const [y, m] = range.toDay.split("-").map(Number);
  const start12 = fromZonedTime(`${new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10)}T00:00:00`, TZ);
  const when = scope === "all" ? [] : [gte(L.leadDate, scope === "12m" ? start12 : range.from), lte(L.leadDate, range.to)];

  const [leads, team, names] = await Promise.all([
    db.select(AUDIT_COLS).from(L).where(and(notBdFr, ...when)),
    db.select(AUDIT_COLS).from(L).where(and(bdFrOnly, sql`TRIM(COALESCE(${L.campaign}, '')) <> ''`, ...when)).orderBy(desc(L.leadDate)),
    // Every name, all time: hygiene is about the names, whatever the period.
    db.select({
      source: sql<string>`TRIM(${L.marketingSource})`, leads: sql<number>`COUNT(*)`,
      first: sql<Date | null>`MIN(${L.leadDate})`, last: sql<Date | null>`MAX(${L.leadDate})`,
    }).from(L).where(notBdFr).groupBy(sql`TRIM(${L.marketingSource})`),
  ]);

  return {
    scope,
    checked: leads.length,
    ...misregistered(leads),
    teamCampaigns: teamCampaigns(team),
    hygiene: sourceHygiene(names.map((n) => ({ source: clean(n.source), leads: Number(n.leads) || 0, first: day(n.first), last: day(n.last) }))),
  };
}

// ── Lead Docket sources directory ──

/**
 * Every Marketing Source, Contact Source and Campaign Lead Docket has ever
 * used, with how many leads and sign-ups each carries and where the CRM files
 * it — the list the team shares as a PDF (Youssef, 2026-09-30: "all the
 * channels and sources in Lead Docket in a PDF to share with the team").
 * All leads, BD/FR included, so nothing in Lead Docket is missing from it.
 * Names and counts only: no client appears.
 */
export type DirectoryRow = { name: string; leads: number; signed: number; first: string | null; last: string | null; category: string; detail: string };

function classifyMarketing(name: string, bdFr: boolean): { category: string; detail: string } {
  if (!name) return { category: "No source", detail: NO_SOURCE };
  if (bdFr) return { category: "BD/FR team", detail: TEAM_CHANNEL };
  if (isTollFreeLine(name)) return { category: "Toll-free line", detail: TOLL_FREE };
  const c = sourceCategoryOf(name);
  if (c.kind === "digital") return { category: `Digital · ${c.group}`, detail: c.label };
  if (c.kind === "merch") return { category: "Merch & print", detail: c.label };
  return { category: "Other", detail: channelOfSource(name) };
}

export async function getSourceDirectory() {
  const db = await getDb();
  if (!db) return null;
  const field = (col: AnyColumn) =>
    db.select({
      name: sql<string>`TRIM(${col})`, outcome: L.outcome, bdFr: sql<number>`MAX(${L.teamRole} IN ('BDR', 'FR'))`,
      leads: sql<number>`COUNT(*)`, first: sql<Date | null>`MIN(${L.leadDate})`, last: sql<Date | null>`MAX(${L.leadDate})`,
    }).from(L).groupBy(sql`TRIM(${col})`, L.outcome);

  const [ms, cs, cp] = await Promise.all([field(L.marketingSource), field(L.contactSource), field(L.campaign)]);

  // Fold the outcome split back into one row per name, counting the signed ones.
  const fold = (rows: Awaited<ReturnType<typeof field>>, classify: (name: string, bdFr: boolean) => { category: string; detail: string }) => {
    const by = new Map<string, { name: string; leads: number; signed: number; first: number | null; last: number | null; bdFr: boolean }>();
    for (const r of rows) {
      const name = clean(r.name);
      const key = name.toLowerCase();
      const e = by.get(key) ?? { name, leads: 0, signed: 0, first: null, last: null, bdFr: false };
      const n = Number(r.leads) || 0;
      e.leads += n;
      if (isSigned(r.outcome)) e.signed += n;
      if (Number(r.bdFr)) e.bdFr = true;
      const f = r.first ? new Date(r.first).getTime() : null, l = r.last ? new Date(r.last).getTime() : null;
      if (f != null && (e.first == null || f < e.first)) e.first = f;
      if (l != null && (e.last == null || l > e.last)) e.last = l;
      by.set(key, e);
    }
    return Array.from(by.values())
      .map((e): DirectoryRow => ({
        name: e.name || NO_SOURCE, leads: e.leads, signed: e.signed,
        first: e.first == null ? null : new Date(e.first).toISOString(), last: e.last == null ? null : new Date(e.last).toISOString(),
        ...classify(e.name, e.bdFr),
      }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  };
  const plain = (name: string) => (name ? { category: isTollFreeLine(name) ? "Toll-free line" : "", detail: "" } : { category: "Not recorded", detail: "" });

  return {
    generated: new Date().toISOString(),
    marketing: fold(ms, classifyMarketing),
    contact: fold(cs, plain),
    campaign: fold(cp, plain),
  };
}
