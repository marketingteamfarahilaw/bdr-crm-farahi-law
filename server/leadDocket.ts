/**
 * Lead Docket → CRM sync, restricted to the BD/FR team's own leads.
 *
 * The firm's Lead Docket holds every lead the firm takes (7k+ signed up alone);
 * only a fifth of them are ours. A lead is credited to a representative in its
 * MarketingSource field, written in a handful of shapes:
 *
 *   "BDR Miguel Flores"                 → BDR, Miguel Flores
 *   "Field Representative Lupe Campos"  → FR,  Lupe Campos
 *   "Jezel Mercado BC - Sacramento"     → FR,  Jezel Mercado   (business card)
 *
 * Everything else — Walker Advertising, GMB listings, Intaker, the website,
 * employee referrals — belongs to marketing or intake and is skipped, so the
 * team's reports only ever count work the team actually did.
 *
 * The API offers no server-side filtering (every documented filter parameter is
 * ignored and returns the full set), so the list endpoint is paged for ids and
 * each lead is read once for its MarketingSource. The list carries
 * LastUpdateDate, so after the first run only changed leads are re-read.
 */
import { getDb } from "./db";
import { leadIntake } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const BASE = process.env.LEADDOCKET_BASE_URL || "https://farahi.leaddocket.com";
const KEY = process.env.LEADDOCKET_API_KEY || "";

export const leadDocketConfigured = () => Boolean(KEY);

type LeadListRow = { Id: number; StatusName?: string; CreatedDate?: string; LastUpdateDate?: string };

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { api_key: KEY } });
  if (!res.ok) throw new Error(`Lead Docket ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Statuses worth syncing: a BD/FR lead counts whether or not it signed up. */
export async function getStatuses(): Promise<{ id: number; name: string; isClient: boolean }[]> {
  const raw = await api<any[]>("/api/Statuses");
  return raw.map((x) => ({ id: x.Data.Id, name: x.Data.StatusName, isClient: !!x.Data.IsCurrentClient }));
}

/** Every lead id in a status, following pagination. */
export async function listLeads(statusId: number): Promise<LeadListRow[]> {
  const out: LeadListRow[] = [];
  let page = 1, pages = 1;
  do {
    const r = await api<{ Page: number; TotalPages: number; Records: LeadListRow[] }>(
      `/api/Leads?Status=${statusId}&Page=${page}`
    );
    pages = r.TotalPages ?? 1;
    out.push(...(r.Records ?? []));
    page++;
  } while (page <= pages);
  return out;
}

/**
 * Read the representative out of a MarketingSource string.
 * Returns null when the lead belongs to marketing, intake or a referral —
 * i.e. when it is not the BD/FR team's work.
 */
export function creditedRep(marketingSource?: string | null): { role: "BDR" | "FR"; member: string } | null {
  const s = String(marketingSource ?? "").trim();
  if (!s) return null;

  const bdr = s.match(/^BDR\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (bdr) return { role: "BDR", member: tidy(bdr[1]) };

  const fr = s.match(/^(?:Field\s+Representative|FR)\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (fr) return { role: "FR", member: tidy(fr[1]) };

  // "Jezel Mercado BC - Sacramento" — a rep's business card, the rep named first.
  const bc = s.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z']+)+)\s+BC\b/);
  if (bc) return { role: "FR", member: tidy(bc[1]) };

  return null;
}
const tidy = (s: string) => s.replace(/\s*[-–—].*$/, "").replace(/\s+/g, " ").trim();

/** Lead Docket status → the outcome wording the sign-ups report counts as signed. */
function outcomeFor(statusName?: string | null): string {
  const s = String(statusName ?? "").toLowerCase();
  if (s.includes("signed up")) return "Signed";
  if (s === "referred") return "Signed Referred Out";
  return statusName ?? "";
}

export type SyncResult = { scanned: number; ours: number; inserted: number; updated: number; skipped: number };

/**
 * Pull BD/FR leads into lead_intake.
 * `since` limits detail reads to leads changed after that time (incremental run).
 */
export async function syncLeadDocket(opts: { since?: Date; statusIds?: number[]; onProgress?: (done: number, total: number) => void } = {}): Promise<SyncResult> {
  if (!KEY) throw new Error("LEADDOCKET_API_KEY is not set");
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const statuses = await getStatuses();
  const wanted = opts.statusIds?.length ? statuses.filter((s) => opts.statusIds!.includes(s.id)) : statuses;

  const rows: LeadListRow[] = [];
  for (const st of wanted) rows.push(...(await listLeads(st.id)).map((r) => ({ ...r, StatusName: st.name })));

  const fresh = opts.since
    ? rows.filter((r) => new Date(r.LastUpdateDate ?? r.CreatedDate ?? 0) > opts.since!)
    : rows;

  const result: SyncResult = { scanned: fresh.length, ours: 0, inserted: 0, updated: 0, skipped: 0 };

  // Read details in small batches — the API is not rate-limit documented, so stay gentle.
  const BATCH = 8;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const details = await Promise.all(
      fresh.slice(i, i + BATCH).map((r) => api<any>(`/api/Leads/${r.Id}`).catch(() => null))
    );
    for (const raw of details) {
      const d = raw?.Data ?? raw;
      if (!d) { result.skipped++; continue; }
      const rep = creditedRep(d.MarketingSource);
      if (!rep) { result.skipped++; continue; }
      result.ours++;

      const contact = d.Contact ?? {};
      const when = d.SignedUpDate ?? d.CreatedDate ?? null;
      const row = {
        leadDate: when ? new Date(when) : null,
        role: rep.role,
        member: rep.member,
        leadName: [contact.FirstName, contact.LastName].filter(Boolean).join(" ").trim() || `Lead ${d.Id}`,
        lastName: contact.LastName ?? null,
        phone: contact.MobilePhone ?? contact.PhoneNumber ?? null,
        email: contact.Email ?? null,
        outcome: outcomeFor(d.Status ?? d.StatusName),
        classification: d.PracticeArea ?? d.CaseType ?? null,
        sud: d.SignedUpDate ? String(d.SignedUpDate).slice(0, 10) : null,
        disposition: d.SubStatus ?? null,
        facility: d.ReferredByName ?? null,
        clientLocation: d.Office ?? null,
        externalId: String(d.Id),
        externalSource: "leaddocket",
        marketingSource: d.MarketingSource ?? null,
      };

      const existing = await db.select({ id: leadIntake.id }).from(leadIntake).where(eq(leadIntake.externalId, String(d.Id))).limit(1);
      if (existing.length) {
        await db.update(leadIntake).set(row).where(eq(leadIntake.id, existing[0].id));
        result.updated++;
      } else {
        await db.insert(leadIntake).values(row as any);
        result.inserted++;
      }
    }
    opts.onProgress?.(Math.min(i + BATCH, fresh.length), fresh.length);
    await new Promise((r) => setTimeout(r, 150));
  }
  return result;
}
