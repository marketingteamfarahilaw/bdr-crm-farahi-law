/**
 * Logos for the top referring partners, so the reports and the presentation
 * show a company's mark instead of its initials.
 *
 * Most partners came from the team's sheets with no website, so each of the
 * top 50 (by signed cases, then leads) is looked up once on Google Places by
 * name and city. Google's answer is only trusted when its name shares a real
 * word with ours — the wrong company's logo on a CEO slide is worse than
 * initials. The logo is the website's own icon: its apple-touch-icon or
 * largest declared icon, else Google's favicon service. Found or not, the
 * result is saved (facility_logos); a partner with no logo is tried again a
 * month later. Runs from the data sync's schedule (production only), about 50
 * Places lookups the first time and only newcomers to the top 50 after that.
 */
import { desc, inArray, isNotNull } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db";
import { facilities, facilityLogos } from "../drizzle/schema";

const TOP = 50;
const RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNCED_KEY = "facility_logos_synced_at";
const MAX_BYTES = 400_000;
const UA = "Mozilla/5.0 (compatible; FarahiLawCRM/1.0; +https://bdcrm.farahilaw.com)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (s: string) => new Set(String(s).toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !GENERIC.has(w)));
// Trade words say nothing about which company it is.
const GENERIC = new Set(["auto", "body", "shop", "collision", "center", "centre", "repair", "towing", "medical",
  "health", "clinic", "care", "insurance", "services", "service", "group", "chiropractic", "chiro", "wellness",
  "agency", "paint", "glass", "motors", "automotive", "recovery", "transport", "garage", "spine", "injury"]);

/** Google's listing is the same company when the names share a distinctive word (or are the same). */
function sameCompany(ours: string, theirs: string): boolean {
  const a = words(ours), b = words(theirs);
  if (!a.size) return String(ours).toLowerCase().replace(/[^a-z0-9]/g, "") === String(theirs).toLowerCase().replace(/[^a-z0-9]/g, "");
  return Array.from(a).some((w) => b.has(w));
}

async function findOnGoogle(name: string, city: string | null, key: string) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri",
    },
    body: JSON.stringify({ textQuery: [name, city, "CA"].filter(Boolean).join(", "), maxResultCount: 3 }),
  });
  if (!r.ok) throw new Error(`Places search: HTTP ${r.status}`);
  const j = await r.json() as { places?: { id: string; displayName?: { text?: string }; websiteUri?: string }[] };
  return (j.places ?? []).find((p) => sameCompany(name, p.displayName?.text ?? "")) ?? null;
}

async function fetchWithTimeout(url: string, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": UA } });
  } finally {
    clearTimeout(t);
  }
}

/**
 * The website's own icons, best first (apple-touch-icon, then the largest
 * declared icon); whether the site answered at all; and whether it's a Wix site,
 * whose icon, unless the owner set one, is Wix's.
 */
async function readSite(site: string): Promise<{ icons: string[]; answered: boolean; wix: boolean }> {
  try {
    const r = await fetchWithTimeout(site);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return { icons: [], answered: true, wix: false };
    const html = (await r.text()).slice(0, 1_500_000);
    const wix = /content=["']Wix\.com|static\.parastorage\.com/i.test(html);
    const base = r.url || site;
    const found: { href: string; score: number }[] = [];
    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = /\brel=["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
      const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
      if (!href || !rel.includes("icon")) continue;
      const size = Number(/\bsizes=["']?(\d+)x\d+/i.exec(tag)?.[1] ?? 0);
      const score = rel.includes("apple-touch-icon") ? 1000 + size : size || 16;
      // Only real addresses: bot-check pages declare a placeholder "data:;" icon.
      try { const u = new URL(href, base); if (/^https?:$/.test(u.protocol)) found.push({ href: u.toString(), score }); } catch { /* bad href */ }
    }
    return { icons: found.sort((a, b) => b.score - a.score).map((f) => f.href), answered: true, wix };
  } catch {
    // No answer (dead domain, timeout): Google's cached icon for it may be a
    // parked page's or a site builder's, not theirs.
    return { icons: [], answered: false, wix: false };
  }
}

/** The image as 32x32 grey pixels on white, or null for a format sharp can't read (.ico). */
async function thumb(buf: Buffer): Promise<number[] | null> {
  try {
    const { default: sharp } = await import("sharp");
    const { data } = await sharp(buf).flatten({ background: "#ffffff" })
      .resize(32, 32, { fit: "contain", background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    return Array.from(data);
  } catch {
    return null;
  }
}

/** A solid block or white-on-transparent mark: nothing would show in the white circle. */
async function looksBlank(buf: Buffer): Promise<boolean> {
  const px = await thumb(buf);
  if (!px) return false;   // judged by size alone, as before
  const mean = px.reduce((a, v) => a + v, 0) / px.length;
  const spread = Math.sqrt(px.reduce((a, v) => a + (v - mean) ** 2, 0) / px.length);
  const ink = px.filter((v) => v < 200).length / px.length;
  return ink < 0.02 || spread < 8;
}

async function asDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!type.startsWith("image/") || type.includes("svg")) return null;   // SVG can carry script; raster only
    const buf = Buffer.from(await r.arrayBuffer());
    // Google's "no icon" globe and 16px favicons are a few hundred bytes: initials read better.
    if (buf.length < 900 || buf.length > MAX_BYTES || await looksBlank(buf)) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Sites whose icon is the host's, not the company's: a partner whose only web
 * page is on Facebook or Wix would otherwise show Facebook's or Wix's logo.
 */
const NOT_THEIR_OWN = /(^|\.)(facebook|instagram|yelp|carwise|linktr|twitter|x|tiktok|youtube|google|wixsite|weebly|godaddysites|business|square)\.(com|ee|site|net|org)$|(^|\.)sites\.google\.com$/i;
/** Where Wix serves its own default icon from. */
const BUILDER_ICON = /(^|\.)(parastorage|wix)\.com$/i;

async function logoFor(website: string): Promise<{ image: string; source: string } | null> {
  if (NOT_THEIR_OWN.test(new URL(website).hostname)) return null;
  const origin = new URL(website).origin;
  const site = await readSite(website);
  if (!site.answered) return null;
  const candidates = site.icons.filter((u) => !BUILDER_ICON.test(new URL(u).hostname));
  // The guessed locations would give a Wix site's default icon back.
  if (!site.wix) candidates.push(`${origin}/apple-touch-icon.png`);
  // Google's favicon service only for a site that declares no icon: where the
  // declared ones were unusable it answers with the platform's (WordPress's, Wix's).
  if (!site.wix && !site.icons.length) {
    candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(website).hostname)}&sz=128`);
  }
  for (const url of Array.from(new Set(candidates))) {
    const image = await asDataUrl(url);
    if (image) return { image, source: url };
  }
  return null;
}

let running = false;

/** Find logos for the top partners that don't have a recent answer yet. */
export async function syncFacilityLogos(): Promise<{ looked: number; found: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (running || !key) return null;
  running = true;
  try {
    const db = await getDb();
    if (!db) return null;
    const top = await db.select({ id: facilities.id, name: facilities.name, city: facilities.city, website: facilities.website })
      .from(facilities).orderBy(desc(facilities.totalSignedCases), desc(facilities.totalLeadsReceived)).limit(TOP);
    const have = await db.select().from(facilityLogos).where(inArray(facilityLogos.facilityId, top.map((f) => f.id)));
    const known = new Map(have.map((h) => [h.facilityId, h]));
    let looked = 0, found = 0;
    for (const f of top) {
      const h = known.get(f.id);
      if (h && (h.image || Date.now() - new Date(h.checkedAt).getTime() < RETRY_MS)) continue;
      looked++;
      let website = (f.website ?? "").trim() || null, placeId: string | null = null;
      try {
        if (!website) {
          const place = await findOnGoogle(f.name, f.city, key);
          website = place?.websiteUri ?? null;
          placeId = place?.id ?? null;
          await sleep(300);
        }
        if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
        const logo = website ? await logoFor(website) : null;
        if (logo) found++;
        const row = { website, placeId, image: logo?.image ?? null, source: logo?.source ?? null };
        await db.insert(facilityLogos).values({ facilityId: f.id, ...row }).onDuplicateKeyUpdate({ set: row });
      } catch (e) {
        console.warn(`[facilityLogos] ${f.name}:`, e instanceof Error ? e.message : e);
      }
    }
    await setSetting(SYNCED_KEY, new Date().toISOString());
    cache = null;
    console.log(`[facilityLogos] looked up ${looked}, found ${found}`);
    return { looked, found };
  } finally {
    running = false;
  }
}

/** Daily, from the data sync's schedule. Never throws. */
export async function syncFacilityLogosIfDue(): Promise<void> {
  try {
    const last = await getSetting(SYNCED_KEY);
    if (last && Date.now() - new Date(last).getTime() < DAY_MS) return;
    await syncFacilityLogos();
  } catch (e) {
    console.warn("[facilityLogos] sync failed:", e instanceof Error ? e.message : e);
  }
}

let cache: { at: number; map: Record<number, string> } | null = null;

/** Every saved logo by facility id, for the page. Cached for ten minutes. */
export async function getFacilityLogos(): Promise<Record<number, string>> {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.map;
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select({ id: facilityLogos.facilityId, image: facilityLogos.image }).from(facilityLogos).where(isNotNull(facilityLogos.image));
  const map: Record<number, string> = Object.fromEntries(rows.map((r) => [r.id, r.image!]));
  cache = { at: Date.now(), map };
  return map;
}
