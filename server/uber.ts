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

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE = process.env.UBER_API_BASE || "https://api.uber.com";

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

async function matchFacilityByAddress(address: string, city: string): Promise<{ id: number; name: string } | null> {
  const db = await getDb();
  if (!db || !address) return null;
  const num = (address.match(/\d+/) || [])[0];
  const cityL = (city || "").toLowerCase().trim();
  const head = address.toLowerCase().slice(0, 14);
  const rows = await db.select({ id: facilities.id, name: facilities.name, address: facilities.address, city: facilities.city }).from(facilities);
  for (const f of rows) {
    if (!f.address) continue;
    const fnum = (String(f.address).match(/\d+/) || [])[0];
    const sameCity = !!cityL && !!f.city && String(f.city).toLowerCase().trim() === cityL;
    const sameNum = !!num && num === fnum;
    if (sameNum && (sameCity || String(f.address).toLowerCase().includes(head))) return { id: f.id, name: f.name };
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
