/**
 * Reps' profile pictures, from RingCentral, so the reports and the sidebar show
 * faces instead of initials.
 *
 * RingCentral keeps a picture on each person's extension. The app has no
 * account-wide RingCentral connection — people connect their own (the call
 * sync works the same way) — so this borrows the first connected user's token
 * that still works, lists the company's extensions, and saves the 195×195
 * picture of everyone the CRM shows as a rep: the current team, every rep in
 * the Lead Docket data, and every CRM user. Refreshed once a day from the data
 * sync's schedule (production only); nobody waits on it.
 */
import { inArray, sql } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db";
import { leadIntake, repPhotos, users } from "../drizzle/schema";
import { listConnectedRcUsers } from "./crmDb";
import { getValidRCTokenForUser } from "./crmRouter";
import { CURRENT_TEAM, repNameKey } from "@shared/team";

const RC_BASE = "https://platform.ringcentral.com";
const SYNCED_KEY = "rep_photos_synced_at";
const EVERY_MS = 24 * 60 * 60 * 1000;
// Profile images are in RingCentral's "heavy" rate group; a pause between
// downloads keeps a dozen of them well inside it.
const GAP_MS = 7000;

const nameKey = repNameKey;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everyone the CRM shows as a rep, by name key. */
async function wantedNames(): Promise<Set<string>> {
  const db = await getDb();
  const out = new Set<string>(Object.values(CURRENT_TEAM).flat().map(nameKey));
  if (!db) return out;
  const [members, people] = await Promise.all([
    db.selectDistinct({ name: leadIntake.member }).from(leadIntake),
    db.select({ name: users.name }).from(users),
  ]);
  for (const r of [...members, ...people]) if (r.name) out.add(nameKey(r.name));
  out.delete("");
  return out;
}

/** A connected user's token that works now (getValidRCTokenForUser refreshes and saves it if needed). */
async function anyToken(): Promise<string | null> {
  for (const u of await listConnectedRcUsers()) {
    try {
      const t = await getValidRCTokenForUser(u.userId);
      if (t) return t;
    } catch { /* that user's connection is broken; try the next */ }
  }
  return null;
}

type Ext = { id: number | string; name?: string; contact?: { firstName?: string; lastName?: string }; profileImage?: { uri?: string } };

async function listExtensions(token: string): Promise<Ext[]> {
  const out: Ext[] = [];
  let url: string | null = `${RC_BASE}/restapi/v1.0/account/~/extension?type=User&perPage=1000`;
  for (let page = 0; url && page < 10; page++) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`RingCentral extension list: HTTP ${r.status}`);
    const j = await r.json() as { records?: Ext[]; navigation?: { nextPage?: { uri?: string } } };
    out.push(...(j.records ?? []));
    url = j.navigation?.nextPage?.uri ?? null;
  }
  return out;
}

async function download(token: string, uri: string): Promise<string | null> {
  const r = await fetch(`${uri.replace(/\/$/, "")}/195x195`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const type = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  if (!type.startsWith("image/")) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${type};base64,${buf.toString("base64")}`;
}

let running = false;

/** Fetch and save every rep's picture. Returns what happened, or null when it couldn't run. */
export async function syncRepPhotos(): Promise<{ saved: number; removed: number; withoutPicture: number } | null> {
  if (running) return null;
  running = true;
  try {
    const db = await getDb();
    if (!db) return null;
    const token = await anyToken();
    if (!token) { console.warn("[repPhotos] no connected RingCentral user with a working token"); return null; }
    const wanted = await wantedNames();
    const exts = (await listExtensions(token)).filter((e) =>
      wanted.has(nameKey(`${e.contact?.firstName ?? ""} ${e.contact?.lastName ?? ""}`)) || wanted.has(nameKey(e.name)));

    let saved = 0, withoutPicture = 0;
    const keep = new Set<string>();
    for (const e of exts) {
      const name = (e.name || `${e.contact?.firstName ?? ""} ${e.contact?.lastName ?? ""}`).replace(/\s+/g, " ").trim();
      const key = wanted.has(nameKey(name)) ? nameKey(name) : nameKey(`${e.contact?.firstName ?? ""} ${e.contact?.lastName ?? ""}`);
      if (!e.profileImage?.uri) { withoutPicture++; continue; }
      if (keep.has(key)) continue;   // two extensions, one person (e.g. a call-monitoring line): first wins
      const image = await download(token, e.profileImage.uri).catch(() => null);
      await sleep(GAP_MS);
      if (!image) continue;
      await db.insert(repPhotos).values({ nameKey: key, name, extensionId: String(e.id), image })
        .onDuplicateKeyUpdate({ set: { name, extensionId: String(e.id), image, updatedAt: sql`CURRENT_TIMESTAMP` } });
      keep.add(key);
      saved++;
    }
    // Someone who has since removed their picture goes back to initials.
    const stored = await db.select({ nameKey: repPhotos.nameKey }).from(repPhotos);
    const gone = stored.map((r) => r.nameKey).filter((k) => !keep.has(k));
    if (gone.length) await db.delete(repPhotos).where(inArray(repPhotos.nameKey, gone));
    await setSetting(SYNCED_KEY, new Date().toISOString());
    cache = null;
    console.log(`[repPhotos] saved ${saved}, removed ${gone.length}, ${withoutPicture} without a picture`);
    return { saved, removed: gone.length, withoutPicture };
  } finally {
    running = false;
  }
}

/** Run the daily refresh when it's due; the data sync's schedule calls this. Never throws. */
export async function syncRepPhotosIfDue(): Promise<void> {
  try {
    const last = await getSetting(SYNCED_KEY);
    if (last && Date.now() - new Date(last).getTime() < EVERY_MS) return;
    await syncRepPhotos();
  } catch (e) {
    console.warn("[repPhotos] sync failed:", e instanceof Error ? e.message : e);
  }
}

let cache: { at: number; map: Record<string, string> } | null = null;

/** Every saved picture by name key, for the page's avatars. Cached for ten minutes. */
export async function getRepPhotos(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.map;
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select({ nameKey: repPhotos.nameKey, image: repPhotos.image }).from(repPhotos);
  const map = Object.fromEntries(rows.map((r) => [r.nameKey, r.image]));
  cache = { at: Date.now(), map };
  return map;
}
