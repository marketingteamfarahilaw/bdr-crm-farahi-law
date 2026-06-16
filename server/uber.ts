/**
 * Uber for Business — Receipt API integration.
 * Pulls completed Uber Eats order receipts into the CRM as FR expenses, matched
 * to the facility by delivery address. Webhook-driven (see _core/uberWebhook).
 *
 * Required env:
 *   UBER_CLIENT_ID, UBER_CLIENT_SECRET  — your Uber for Business app credentials
 *   UBER_ORG_ID                          — organization UUID
 *   UBER_SIGNING_KEY                     — webhook signing key (falls back to client secret)
 *   UBER_API_BASE                        — optional, default https://api.uber.com
 *                                          (use https://sandbox-api.uber.com for testing)
 */
import axios from "axios";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { facilities, frExpenses, uberReceipts } from "../drizzle/schema";

const API_BASE = process.env.UBER_API_BASE || "https://api.uber.com";
// Sandbox apps must mint tokens at sandbox-login.uber.com; prod uses auth.uber.com.
const AUTH_URL =
  process.env.UBER_AUTH_URL ||
  (API_BASE.includes("sandbox") ? "https://sandbox-login.uber.com/oauth/v2/token" : "https://auth.uber.com/oauth/v2/token");

export function uberConfigured(): boolean {
  return !!(process.env.UBER_CLIENT_ID && process.env.UBER_CLIENT_SECRET && process.env.UBER_ORG_ID);
}

let tokenCache = { token: "", exp: 0 };
export async function getUberToken(): Promise<string> {
  if (tokenCache.token && tokenCache.exp - Date.now() > 60_000) return tokenCache.token;
  const resp = await axios.post(
    AUTH_URL,
    new URLSearchParams({
      client_id: process.env.UBER_CLIENT_ID || "",
      client_secret: process.env.UBER_CLIENT_SECRET || "",
      grant_type: "client_credentials",
      scope: "business.receipts",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  tokenCache = { token: resp.data.access_token, exp: Date.now() + (resp.data.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

// Verify the X-Uber-Signature header: HMAC-SHA256(rawBody, signingKey).
export function verifyUberSignature(rawBody: Buffer | string, signature?: string): boolean {
  const key = process.env.UBER_SIGNING_KEY || process.env.UBER_CLIENT_SECRET || "";
  if (!key || !signature) return false;
  const digest = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function fetchOrderReceipt(orderId: string): Promise<any> {
  const token = await getUberToken();
  const resp = await axios.get(`${API_BASE}/v1/business/orders/${orderId}/receipt`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-uber-organizationuuid": process.env.UBER_ORG_ID || "",
      "Accept-Language": "en_US",
    },
  });
  return resp.data;
}

const money = (v: any): number => (typeof v?.value === "number" ? v.value / 100000 : 0);

// Street-name tokens we ignore when comparing (suffixes/directionals/units).
const STREET_STOP = new Set(["st", "street", "ave", "avenue", "blvd", "boulevard", "rd", "road", "dr", "drive", "ln", "lane", "way", "ct", "court", "pl", "place", "hwy", "highway", "pkwy", "parkway", "ste", "suite", "unit", "apt", "fl", "floor", "n", "s", "e", "w", "north", "south", "east", "west", "the"]);
const streetNum = (a: unknown): string => (String(a ?? "").match(/\d+/) || [])[0] || "";
const streetTokens = (a: unknown): string[] => String(a ?? "").toLowerCase().split(/[,#]/)[0].replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && w.length > 1 && !/^\d+$/.test(w) && !STREET_STOP.has(w));
type LatLng = { lat: number; lng: number };
const haversine = (a: LatLng, b: LatLng): number => { const R = 6371000, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=us&key=${key}`);
    const j = await r.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

/**
 * Match an Uber delivery address to a partner facility, accurately:
 *  1) Text: same street number AND a shared street-name token (city confirms
 *     but isn't required — handles missing/garbled city).
 *  2) Geocode fallback: geocode the delivery address and pick the nearest
 *     facility within 200m (facilities are geocoded with lat/long).
 */
export async function matchFacilityByAddress(address: string, city: string): Promise<{ id: number; name: string } | null> {
  const db = await getDb();
  if (!db || !address) return null;
  const rows = await db.select({ id: facilities.id, name: facilities.name, address: facilities.address, city: facilities.city, latitude: facilities.latitude, longitude: facilities.longitude }).from(facilities);

  // 1) Text match — street number + street-name token overlap.
  const num = streetNum(address);
  const toks = new Set(streetTokens(address));
  const cityL = (city || "").toLowerCase().trim();
  let textHit: { id: number; name: string } | null = null;
  for (const f of rows) {
    if (!f.address || !num || streetNum(f.address) !== num) continue;
    const ftoks = streetTokens(f.address);
    const shares = ftoks.some((t) => toks.has(t));
    if (!shares) continue;
    const sameCity = !!cityL && !!f.city && String(f.city).toLowerCase().trim() === cityL;
    if (sameCity) return { id: f.id, name: f.name }; // strongest: number + street + city
    if (!textHit) textHit = { id: f.id, name: f.name };
  }
  if (textHit) return textHit;

  // 2) Geocode fallback — nearest facility within 200m of the delivery point.
  const pt = await geocode([address, city].filter(Boolean).join(", "));
  if (pt) {
    let best: { id: number; name: string } | null = null, bestD = 200;
    for (const f of rows) {
      if (!f.latitude || !f.longitude) continue;
      const dmeters = haversine(pt, { lat: Number(f.latitude), lng: Number(f.longitude) });
      if (dmeters < bestD) { bestD = dmeters; best = { id: f.id, name: f.name }; }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Fetch + import one order receipt. Dedupes by orderId. Creates an FR expense
 * for COMPLETED orders, matched to a facility by delivery address.
 */
export async function importOrderReceipt(orderId: string): Promise<{ created: boolean; reason?: string; expenseId?: number; facilityName?: string | null; amount?: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existing = await db.select({ id: uberReceipts.id, expenseId: uberReceipts.expenseId }).from(uberReceipts).where(eq(uberReceipts.orderId, orderId)).limit(1);
  if (existing.length) return { created: false, reason: "already imported", expenseId: existing[0].expenseId ?? undefined };

  const r = await fetchOrderReceipt(orderId);
  const status = r?.status ?? "UNKNOWN";
  const requester = (r?.entities ?? []).find((e: any) => e?.entity_type === "USER")?.user;
  const requesterName = requester ? `${requester.first_name ?? ""} ${requester.last_name ?? ""}`.trim() : null;
  const store = r?.eats_detail?.stores?.[0]?.name ?? null;
  const loc = r?.eats_detail?.delivery_location ?? {};
  const amount = money(r?.payment_detail?.order_amount);
  const currency = r?.payment_detail?.order_amount?.currency_code ?? "USD";
  const orderDate = r?.order_request_time?.timestamp_utc ? new Date(r.order_request_time.timestamp_utc) : new Date();
  const items = (r?.eats_detail?.cart_items ?? []).map((i: any) => `${i.quantity ?? 1}x ${i.name}`).join(", ");

  let expenseId: number | null = null;
  const facility = await matchFacilityByAddress(loc.address ?? "", loc.city ?? "");

  // Only create an expense for completed orders.
  if (status === "COMPLETED" && amount > 0) {
    const res: any = await db.insert(frExpenses).values({
      expenseDate: orderDate,
      agentName: requesterName || requester?.email || "Uber Eats",
      agentEmail: requester?.email ?? null,
      facilityId: facility?.id ?? null,
      facilityName: facility?.name ?? null,
      store: "Uber Eats",
      reason: store ? `Partner meal — ${store}` : "Partner meal (Uber Eats)",
      amount: amount.toFixed(2),
      cardType: "Company",
      notes: [loc.address, items].filter(Boolean).join(" · ").slice(0, 4000) || null,
    });
    expenseId = res?.[0]?.insertId ?? res?.insertId ?? null;
  }

  await db.insert(uberReceipts).values({
    orderId,
    status,
    amount: amount ? amount.toFixed(2) : null,
    currency,
    orderDate,
    requesterName,
    requesterEmail: requester?.email ?? null,
    storeName: store,
    deliveryAddress: [loc.address, loc.city, loc.state].filter(Boolean).join(", ") || null,
    facilityId: facility?.id ?? null,
    facilityName: facility?.name ?? null,
    expenseId,
    expenseTable: expenseId ? "fr_expenses" : null,
    raw: r,
  });

  return { created: !!expenseId, reason: expenseId ? undefined : `status=${status}`, expenseId: expenseId ?? undefined, facilityName: facility?.name ?? null, amount };
}
