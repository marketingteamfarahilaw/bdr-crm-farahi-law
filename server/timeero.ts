/**
 * Timeero (GPS time tracking the Field Reps use) → the CRM (Youssef,
 * 2026-09-30: "sync timeero with our crm for the FR team so we can have more
 * data").
 *
 * Two ways in, both through Timeero's Public API (Integrations → Public API):
 *  · Webhooks. Timeero posts {event, id, operation, last_updated_at} for users,
 *    groups, jobs, tasks, timesheets, schedules, clock-ins and clock-outs,
 *    signed with x-webhook-timestamp and x-webhook-signature (SHA-256 over the
 *    timestamp and the body, keyed by the secret entered in Timeero). The body
 *    carries only the id, so the record itself is then fetched from the API.
 *  · Import: pages through the API's lists, for history before the webhook.
 *
 * Records are kept as Timeero sends them (timeero_records, one row per kind and
 * id) until we've seen real ones and decide what the FR reports read from them.
 *
 * The API key and the webhook secret are stored encrypted in app_settings, the
 * way the Anthropic key is, and never sent back to a browser.
 */
import type { Express, Request, Response } from "express";
import axios, { type AxiosError } from "axios";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db";
import { decryptKey, encryptKey } from "./_core/claude";

const BASE = "https://api.timeero.app/api/public";
const KEY_SETTING = "timeero_api_key_enc";
const SECRET_SETTING = "timeero_webhook_secret_enc";
const AUTH_SETTING = "timeero_auth_style";
const STATS_SETTING = "timeero_webhook_stats";
export const TIMEERO_WEBHOOK_PATH = "/api/webhooks/timeero";

// Timeero's docs name the lists these; clock-in/out events are about timesheets.
const KINDS = ["users", "groups", "jobs", "tasks", "timesheets", "schedules"] as const;
const kindOf = (event: string) => {
  const e = event.toLowerCase().replace(/[^a-z]/g, "");
  if (e === "clockin" || e === "clockout") return "timesheets";
  return (KINDS as readonly string[]).includes(e) ? e : null;
};

// ── the table, created on first use (this deploy has no migration step) ─────

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`CREATE TABLE IF NOT EXISTS timeero_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(30) NOT NULL,
      externalId VARCHAR(64) NOT NULL,
      data LONGTEXT NULL,
      deleted TINYINT NOT NULL DEFAULT 0,
      sourceUpdatedAt TIMESTAMP NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY timeero_kind_id (kind, externalId)
    )`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function upsert(kind: string, externalId: string, data: unknown, opts: { deleted?: boolean; updatedAt?: Date | null } = {}) {
  await ensureTable();
  const db = await getDb();
  if (!db) return;
  const json = data === undefined ? null : JSON.stringify(data);
  const del = opts.deleted ? 1 : 0;
  await db.execute(sql`INSERT INTO timeero_records (kind, externalId, data, deleted, sourceUpdatedAt)
    VALUES (${kind}, ${externalId}, ${json}, ${del}, ${opts.updatedAt ?? null})
    ON DUPLICATE KEY UPDATE data = COALESCE(VALUES(data), data), deleted = VALUES(deleted), sourceUpdatedAt = VALUES(sourceUpdatedAt)`);
}

// ── keys ─────────────────────────────────────────────────────────────────────

async function readEnc(setting: string, env?: string) {
  const fromEnv = env ? process.env[env]?.trim() : "";
  if (fromEnv) return fromEnv;
  const stored = await getSetting(setting);
  return stored ? decryptKey(stored) : null;
}
const apiKey = () => readEnc(KEY_SETTING, "TIMEERO_API_KEY");
const webhookSecret = () => readEnc(SECRET_SETTING, "TIMEERO_WEBHOOK_SECRET");

// ── the API ──────────────────────────────────────────────────────────────────

// The docs we could read don't say how the key is sent, so the first call tries
// the usual ways and remembers the one Timeero accepts.
const AUTH_STYLES: Record<string, (k: string) => Record<string, string>> = {
  bearer: (k) => ({ Authorization: `Bearer ${k}` }),
  plain: (k) => ({ Authorization: k }),
  xapikey: (k) => ({ "x-api-key": k }),
};

async function apiGet(path: string, params?: Record<string, unknown>) {
  const key = await apiKey();
  if (!key) throw new Error("No Timeero API key is connected.");
  const known = await getSetting(AUTH_SETTING);
  const order = known && AUTH_STYLES[known] ? [known] : Object.keys(AUTH_STYLES);
  let last: unknown;
  for (const style of order) {
    try {
      const r = await axios.get(`${BASE}${path}`, { params, timeout: 30_000, headers: { Accept: "application/json", ...AUTH_STYLES[style](key) } });
      if (style !== known) await setSetting(AUTH_SETTING, style);
      return r.data;
    } catch (e) {
      last = e;
      const status = (e as AxiosError).response?.status;
      if (status !== 401 && status !== 403) throw e;   // only a refused key is worth another way of sending it
    }
  }
  throw last;
}

/** The records in a list answer, whichever envelope Timeero wraps them in. */
function itemsOf(body: any): any[] {
  if (Array.isArray(body)) return body;
  for (const c of [body?.data, body?.data?.data, body?.items, body?.results, body?.records]) if (Array.isArray(c)) return c;
  return [];
}
const idOf = (x: any) => String(x?.id ?? x?.uuid ?? x?._id ?? "");
const whenOf = (x: any) => {
  const v = x?.updated_at ?? x?.last_updated_at ?? x?.updatedAt;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};
const describe = (e: unknown) => {
  const r = (e as AxiosError).response;
  if (r?.status === 401 || r?.status === 403) return "Timeero didn't accept the API key. Generate a new one in Timeero → Integrations → Public API.";
  if (r) return `Timeero answered ${r.status}${typeof r.data === "object" ? `: ${JSON.stringify(r.data).slice(0, 200)}` : ""}`;
  return `Couldn't reach Timeero (${(e as Error)?.message ?? "no answer"}).`;
};

// ── webhook ──────────────────────────────────────────────────────────────────

/**
 * Timeero signs "SHA-256 of x-webhook-timestamp + the payload with the shared
 * secret". Its docs don't spell out hex or base64, or a separator, so each
 * reading is tried; all of them need the secret, which only Timeero and we hold.
 */
export function signatureMatches(secret: string, ts: string, raw: Buffer, sig: string) {
  const body = raw.toString("utf8");
  const candidates: string[] = [];
  for (const msg of [ts + body, `${ts}.${body}`]) {
    const h = createHmac("sha256", secret).update(msg);
    const d = h.digest();
    candidates.push(d.toString("hex"), d.toString("base64"));
  }
  const plain = createHash("sha256").update(ts + body + secret).digest();
  candidates.push(plain.toString("hex"), plain.toString("base64"));
  const got = sig.trim().replace(/^sha256=/i, "");
  return candidates.some((c) => c.length === got.length && timingSafeEqual(Buffer.from(c), Buffer.from(got)));
}

type Stats = { received: number; rejected: number; lastAt: string | null; lastEvent: string | null; lastError: string | null };
async function noteWebhook(patch: Partial<Stats> & { ok: boolean }) {
  const s: Stats = { received: 0, rejected: 0, lastAt: null, lastEvent: null, lastError: null, ...JSON.parse((await getSetting(STATS_SETTING)) || "{}") };
  if (patch.ok) s.received++; else s.rejected++;
  s.lastAt = new Date().toISOString();
  if (patch.lastEvent !== undefined) s.lastEvent = patch.lastEvent;
  s.lastError = patch.lastError ?? (patch.ok ? null : s.lastError);
  await setSetting(STATS_SETTING, JSON.stringify(s));
}

export function registerTimeeroWebhook(app: Express) {
  app.post(TIMEERO_WEBHOOK_PATH, async (req: Request, res: Response) => {
    const secret = await webhookSecret().catch(() => null);
    const raw: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const ts = String(req.header("x-webhook-timestamp") ?? "");
    const sig = String(req.header("x-webhook-signature") ?? "");
    if (!secret || !ts || !sig || !signatureMatches(secret, ts, raw, sig)) {
      await noteWebhook({ ok: false, lastError: !secret ? "No webhook secret saved in the CRM yet." : "A call arrived with a signature that didn't match the secret." }).catch(() => {});
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    res.status(200).json({ ok: true });   // answer first; Timeero doesn't wait on the fetch below

    // Timeero's docs show {event, id, operation, last_updated_at}; accept the
    // same fields wrapped in "data" or under their other usual names too.
    // What Timeero really sends (seen 2026-09-30):
    //   {"payload":{"event":"timesheets","data":{"id":19178817,"operation":"timesheets_updated","last_updated_at":false}}}
    const top = req.body ?? {};
    const env = top.payload && typeof top.payload === "object" ? top.payload : top;
    const inner = env.data && typeof env.data === "object" ? env.data : {};
    const b = { ...inner, ...env };
    const event = String(env.event ?? env.type ?? env.event_type ?? inner.event ?? "");
    const id = String(inner.id ?? env.id ?? env.data_id ?? "");
    const op = String(inner.operation ?? env.operation ?? env.action ?? "");
    const kind = kindOf(event);
    try {
      if (!kind || !id) {
        // Keep what came, so we can see it on the Settings card and teach the CRM to read it.
        const sample = JSON.stringify(top).slice(0, 500);
        await noteWebhook({ ok: true, lastEvent: event || "(no event name)", lastError: `Not recognised yet — Timeero sent: ${sample || "(empty body)"}` });
        return;
      }
      const at = whenOf(b);
      if (/deleted$/i.test(op)) await upsert(kind, id, undefined, { deleted: true, updatedAt: at });
      else {
        const full = await apiGet(`/${kind}/${encodeURIComponent(id)}`).catch(() => null);
        // Keep what the webhook said even when the fetch fails, so nothing is lost.
        await upsert(kind, id, full?.data && !Array.isArray(full.data) ? full.data : full ?? { webhook: b }, { updatedAt: at });
      }
      await noteWebhook({ ok: true, lastEvent: `${event} ${op}`.trim() });
    } catch (e) {
      console.warn("[timeero] webhook:", (e as Error)?.message ?? e);
      await noteWebhook({ ok: true, lastEvent: `${event} ${op}`.trim(), lastError: (e as Error)?.message ?? String(e) }).catch(() => {});
    }
  });
  console.log(`[timeero] webhook at ${TIMEERO_WEBHOOK_PATH}`);
}

// ── Settings: status, connect, test, import ──────────────────────────────────

export async function timeeroStatus() {
  const [key, secret] = await Promise.all([apiKey(), webhookSecret()]);
  const counts: Record<string, number> = {};
  try {
    await ensureTable();
    const db = await getDb();
    const [rows] = (await db!.execute(sql`SELECT kind, COUNT(*) AS n FROM timeero_records WHERE deleted = 0 GROUP BY kind`)) as any;
    for (const r of rows as any[]) counts[r.kind] = Number(r.n);
  } catch { /* shown as no records */ }
  return {
    connected: !!key,
    keyTail: key ? key.slice(-4) : null,
    fromServer: !!process.env.TIMEERO_API_KEY?.trim(),
    // The secret is ours to show: it has to be pasted into Timeero's webhook form.
    secret,
    webhookPath: TIMEERO_WEBHOOK_PATH,
    webhook: JSON.parse((await getSetting(STATS_SETTING)) || "null") as Stats | null,
    counts,
  };
}

export async function saveTimeeroKey(key: string | null): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  if (key == null) {
    await setSetting(KEY_SETTING, null);
    await setSetting(AUTH_SETTING, null);
    return { ok: true };
  }
  const k = key.trim();
  if (k.length < 20 || /\s/.test(k)) return { ok: false, error: "That doesn't look like a Timeero API key." };
  await setSetting(KEY_SETTING, encryptKey(k));
  await setSetting(AUTH_SETTING, null);
  // A secret for the webhook, made once, for pasting into Timeero.
  if (!(await webhookSecret())) await setSetting(SECRET_SETTING, encryptKey(randomBytes(24).toString("hex")));
  // Kept even when the test fails: the webhook doesn't need the test to pass, and the answer says why.
  const t = await testTimeero();
  return t.ok ? { ok: true } : { ok: true, warning: t.error };
}

export async function newTimeeroSecret() {
  await setSetting(SECRET_SETTING, encryptKey(randomBytes(24).toString("hex")));
  return { ok: true as const };
}

export async function testTimeero(): Promise<{ ok: true; users: number } | { ok: false; error: string }> {
  try {
    return { ok: true, users: itemsOf(await apiGet("/users", { page: 1 })).length };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

// Some lists (schedules) refuse to answer without a date range ("The date range
// field is required"), and the docs we can read don't give its format, so the
// import tries the usual ones and remembers the one Timeero accepts.
const RANGE_SETTING = "timeero_range_style";
const RANGE_STYLES: Record<string, (from: string, to: string) => Record<string, unknown>> = {
  dash: (f, t) => ({ date_range: `${f} - ${t}` }),
  comma: (f, t) => ({ date_range: `${f},${t}` }),
  array: (f, t) => ({ date_range: [f, t] }),
  startEnd: (f, t) => ({ start_date: f, end_date: t }),
  fromTo: (f, t) => ({ from: f, to: t }),
};
const needsRange = (e: unknown) => {
  const r = (e as AxiosError).response;
  return r?.status === 422 && /date.?range|start.?date|end.?date/i.test(JSON.stringify(r.data ?? ""));
};

async function rangedGet(kind: string, from: string, to: string, page: number) {
  const known = await getSetting(RANGE_SETTING);
  const order = known && RANGE_STYLES[known] ? [known, ...Object.keys(RANGE_STYLES).filter((k) => k !== known)] : Object.keys(RANGE_STYLES);
  let last: unknown;
  for (const style of order) {
    try {
      const body = await apiGet(`/${kind}`, { page, per_page: 100, ...RANGE_STYLES[style](from, to) });
      if (style !== known) await setSetting(RANGE_SETTING, style);
      return body;
    } catch (e) {
      last = e;
      const st = (e as AxiosError).response?.status;
      if (st !== 422 && st !== 400) throw e;
    }
  }
  throw last;
}

/** Month by month, newest first, for the last `months` months (Pacific calendar is close enough here). */
function monthRanges(months: number) {
  const out: [string, string][] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    out.push([first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)]);
  }
  return out;
}

const lastPage = (body: any, page: number, items: any[]) => {
  const last = body?.last_page ?? body?.meta?.last_page ?? body?.data?.last_page;
  if (!items.length || (last && page >= Number(last))) return true;
  const next = body?.next_page_url ?? body?.links?.next ?? body?.data?.next_page_url;
  return next === null || (next === undefined && items.length < 100);
};

/** History before the webhook: every page of each list, kept like webhook records. */
export async function importTimeero(): Promise<{ ok: true; imported: Record<string, number>; errors: string[] }> {
  const imported: Record<string, number> = {};
  const errors: string[] = [];
  const seen = new Set<string>();   // the plain and dated lists overlap: count each record once
  const keep = async (kind: string, items: any[]) => {
    for (const it of items) {
      const id = idOf(it);
      if (!id) continue;
      await upsert(kind, id, it, { updatedAt: whenOf(it) });
      if (!seen.has(`${kind}:${id}`)) { seen.add(`${kind}:${id}`); imported[kind]++; }
    }
  };
  for (const kind of KINDS) {
    imported[kind] = 0;
    try {
      let ranged = false;
      for (let page = 1; page <= 200; page++) {
        let body: any;
        try {
          body = await apiGet(`/${kind}`, { page, per_page: 100 });
        } catch (e) {
          if (page === 1 && needsRange(e)) { ranged = true; break; }
          throw e;
        }
        const items = itemsOf(body);
        await keep(kind, items);
        if (lastPage(body, page, items)) break;
      }
      // Dated lists: the last 12 months, a month at a time. Timesheets too, as
      // their plain list may only cover the current pay period.
      if (ranged || kind === "timesheets") {
        for (const [from, to] of monthRanges(12)) {
          for (let page = 1; page <= 200; page++) {
            let body: any;
            try {
              body = await rangedGet(kind, from, to, page);
            } catch (e) {
              if (!ranged) break;   // timesheets that take no range: the plain list above was all of it
              throw e;
            }
            const items = itemsOf(body);
            await keep(kind, items);
            if (lastPage(body, page, items)) break;
          }
        }
      }
    } catch (e) {
      const status = (e as AxiosError).response?.status;
      if (status !== 404) errors.push(`${kind}: ${describe(e)}`);   // a list Timeero doesn't offer is skipped quietly
    }
  }
  return { ok: true, imported, errors };
}

/**
 * For Settings: the fields of the newest record of a kind, so we can see what
 * Timeero actually sends before building reports on it. Long values are cut.
 */
export async function timeeroSample(kind: string) {
  await ensureTable();
  const db = await getDb();
  // Tasks and groups are few and name the categories reps clock into: show them all.
  const all = kind === "tasks" || kind === "groups";
  const [rows] = (await db!.execute(sql`SELECT data FROM timeero_records WHERE kind = ${kind} AND deleted = 0 AND data IS NOT NULL ORDER BY updatedAt DESC, id DESC LIMIT ${all ? 20 : 1}`)) as any;
  if (!(rows as any[]).length) return null;
  const raw = all ? `[${(rows as any[]).map((r) => r.data).join(",")}]` : (rows as any[])[0].data;
  const cut = (v: unknown, depth = 0): unknown => {
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
    if (Array.isArray(v)) return depth > 3 ? `[${v.length} items]` : v.slice(0, 3).map((x) => cut(x, depth + 1));
    if (v && typeof v === "object") return depth > 3 ? "{…}" : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x, depth + 1)]));
    return v;
  };
  return JSON.stringify(cut(JSON.parse(raw)), null, 2);
}

// ── FR field time (the report on top of the timesheets) ─────────────────────

const toSec = (d: unknown) => {
  const m = String(d ?? "").match(/^(\d+):(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};
const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const NEAR_KM = 0.15;   // a clock-in within ~150 m of a partner is at that partner

/**
 * Timesheets from Timeero for the dates picked (from/to are Pacific days,
 * "YYYY-MM-DD"). Timeero writes clock times as the rep's local wall clock
 * (clock_in_timezone, Los Angeles), so the day is the clock-in's own date.
 * Each clock-in and clock-out point is matched to the nearest CRM partner
 * within ~150 m.
 */
export async function getFieldTime(from: string, to: string, member?: string) {
  await ensureTable();
  const db = await getDb();
  if (!db) return { reps: [], rows: [] };
  const [rows] = (await db.execute(sql`SELECT data FROM timeero_records WHERE kind = 'timesheets' AND deleted = 0 AND data IS NOT NULL`)) as any;
  const [facs] = (await db.execute(sql`SELECT id, name, latitude, longitude FROM facilities WHERE latitude IS NOT NULL AND longitude IS NOT NULL`)) as any;
  const partners = (facs as any[]).map((f) => ({ id: Number(f.id), name: String(f.name), at: [Number(f.latitude), Number(f.longitude)] as [number, number] }));
  const nearest = (lat: unknown, lng: unknown) => {
    const p: [number, number] = [Number(lat), Number(lng)];
    if (!isFinite(p[0]) || !isFinite(p[1]) || (p[0] === 0 && p[1] === 0)) return null;
    let best: { id: number; name: string; km: number } | null = null;
    for (const f of partners) {
      const d = km(p, f.at);
      if (d <= NEAR_KM && (!best || d < best.km)) best = { id: f.id, name: f.name, km: d };
    }
    return best ? { id: best.id, name: best.name, meters: Math.round(best.km * 1000) } : null;
  };
  const want = member ? member.trim().toLowerCase().split(/\s+/)[0] : null;

  // Timeero jobs are partner locations (a name, GPS and a geofence radius).
  // Each is tied to the CRM partner at that spot, or else of that name.
  const normName = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map(partners.map((f) => [normName(f.name), f]));
  const [jobRows] = (await db.execute(sql`SELECT externalId, data FROM timeero_records WHERE kind = 'jobs' AND deleted = 0 AND data IS NOT NULL`)) as any;
  const jobPartner = new Map<string, { id: number; name: string } | null>();
  for (const j of jobRows as any[]) {
    let d: any;
    try { d = JSON.parse(j.data); } catch { continue; }
    const at: [number, number] = [Number(d.latitude), Number(d.longitude)];
    const radius = Math.max(NEAR_KM, Number(d.radius_meters ?? 0) / 1000);
    let best: { id: number; name: string; km: number } | null = null;
    if (isFinite(at[0]) && isFinite(at[1]) && (at[0] || at[1])) {
      for (const f of partners) {
        const dist = km(at, f.at);
        if (dist <= radius && (!best || dist < best.km)) best = { id: f.id, name: f.name, km: dist };
      }
    }
    const named = byName.get(normName(String(d.name ?? "")));
    jobPartner.set(String(d.id ?? j.externalId), best ? { id: best.id, name: best.name } : named ? { id: named.id, name: named.name } : null);
  }

  const list = [];
  for (const r of rows as any[]) {
    let t: any;
    try { t = JSON.parse(r.data); } catch { continue; }
    const inTime = String(t.clock_in_time ?? "");
    const day = inTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
    const name = [t.first_name, t.last_name].filter(Boolean).join(" ").trim() || `Timeero user ${t.user_id ?? "?"}`;
    if (want && name.toLowerCase().split(/\s+/)[0] !== want) continue;
    const worked = Math.max(0, toSec(t.duration) - Number(t.break_in_seconds ?? 0));
    list.push({
      id: String(t.id), rep: name, day,
      clockIn: inTime || null, clockOut: t.clock_out_time ? String(t.clock_out_time) : null,
      inAddress: t.clock_in_address ?? null, outAddress: t.clock_out_address ?? null,
      inPartner: nearest(t.clock_in_latitude, t.clock_in_longitude),
      outPartner: nearest(t.clock_out_latitude, t.clock_out_longitude),
      seconds: worked,
      miles: Math.round(Number(t.mileage ?? 0) * 10) / 10,
      job: t.job_name || null, jobPartner: t.job_id ? jobPartner.get(String(t.job_id)) ?? null : null,
      notes: t.notes ? String(t.notes) : null,
      approved: !!t.approved, flagged: !!t.flagged, open: !t.clock_out_time,
    });
  }
  list.sort((a, b) => (b.clockIn ?? "").localeCompare(a.clockIn ?? ""));

  const byRep = new Map<string, { rep: string; days: Set<string>; seconds: number; miles: number; shifts: number; atPartners: number; flagged: number }>();
  for (const r of list) {
    const k = r.rep;
    const s = byRep.get(k) ?? { rep: k, days: new Set(), seconds: 0, miles: 0, shifts: 0, atPartners: 0, flagged: 0 };
    s.days.add(r.day); s.seconds += r.seconds; s.miles += r.miles; s.shifts++;
    if (r.inPartner || r.outPartner || r.jobPartner || r.job) s.atPartners++;
    if (r.flagged) s.flagged++;
    byRep.set(k, s);
  }
  const reps = Array.from(byRep.values())
    .map((s) => ({ rep: s.rep, days: s.days.size, hours: Math.round((s.seconds / 3600) * 10) / 10, miles: Math.round(s.miles), shifts: s.shifts, atPartners: s.atPartners, flagged: s.flagged,
      avgHoursPerDay: s.days.size ? Math.round((s.seconds / 3600 / s.days.size) * 10) / 10 : 0 }))
    .sort((a, b) => b.hours - a.hours);
  return { reps, rows: list };
}
