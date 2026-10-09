/**
 * Case value from Filevine, for the leads Lead Docket has none for (Youssef,
 * 2026-10-09: "case value — take it from Filevine"). In September 92% of
 * leads had no Case Value in Lead Docket; every signed case's Filevine intake
 * form has an "Initial Case Value" (Low / Medium / High / Rank X) and a tier.
 *
 * Filevine and Lead Docket share no id, so a case is matched to its lead by
 * the client's phone: Filevine's client contact numbers against the last ten
 * digits Lead Docket stores (leaddocket_leads.phoneKey). Where one phone fits
 * several leads, the one signed (or created) closest to the case's creation —
 * within 45 days — wins; a lead already matched to another case is left alone.
 *
 * The value goes in leaddocket_leads.caseValueFv, never in caseValue: Lead
 * Docket stays the source of truth, and the reports use Filevine's value only
 * where Lead Docket's is blank, marked as Filevine's. Read-only against
 * Filevine; nothing here writes to it. Every case checked is remembered in
 * filevine_case_values, so a run reads only new cases and ones whose form was
 * still blank.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { filevineReader } from "./filevine";
import { ensureDigitalColumns, normalizeCaseValue } from "../scripts/migration/leaddocket-digital.mjs";

const DAY = 86_400_000;
/** How far apart a case's creation and its lead's sign-up may be to count as the same client. */
export const MATCH_WINDOW_DAYS = 45;
/** Cases first read on the very first run: this year's. */
export const FIRST_SINCE = "2026-01-01";

/** "High", "High Value", "rank x" → the report's picks; anything else as written. */
export function fvCaseValue(v: unknown): string | null {
  const text = String(v ?? "").replace(/\s+/g, " ").trim().replace(/\s*value$/i, "");
  return text ? (normalizeCaseValue(text) as string | null) : null;
}

/** The last ten digits of a phone number, as Lead Docket's phoneKey keeps them. */
export function phoneKeyOf(n: unknown): string | null {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export type Candidate = { leadId: number; signedUpDate: Date | string | null; createdDate: Date | string | null; taken: boolean };

/** The lead this Filevine case belongs to, among the leads sharing its client's phone; null when none fits. */
export function pickLead(caseCreated: Date | string, candidates: Candidate[]): number | null {
  const at = new Date(caseCreated).getTime();
  let best: { id: number; gap: number } | null = null;
  for (const c of candidates) {
    if (c.taken) continue;
    const when = c.signedUpDate ?? c.createdDate;
    if (!when) continue;
    const gap = Math.abs(new Date(when).getTime() - at) / DAY;
    // A signed lead beats an unsigned one at the same distance: Filevine cases are sign-ups.
    const score = gap - (c.signedUpDate ? 0.5 : 0);
    if (gap <= MATCH_WINDOW_DAYS && (!best || score < best.gap)) best = { id: c.leadId, gap: score };
  }
  return best?.id ?? null;
}

type Page<T> = { items?: T[]; hasMore?: boolean };
type FvProject = { projectId?: { native?: number }; clientId?: { native?: number }; createdDate?: string };

export async function syncFilevineCaseValues(opts: { since?: string } = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const run = async (q: ReturnType<typeof sql>) => {
    const r: any = await db.execute(q);
    return (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as any[];
  };
  await ensureDigitalColumns(async (q: string) => run(sql.raw(q)));
  await run(sql`CREATE TABLE IF NOT EXISTS filevine_case_values (
    projectId BIGINT NOT NULL PRIMARY KEY,
    leadId BIGINT NULL,
    caseValue VARCHAR(40) NULL,
    tier VARCHAR(60) NULL,
    fvCreated DATETIME NULL,
    note VARCHAR(60) NULL,
    checkedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  const get = await filevineReader();
  const pace = () => new Promise((s) => setTimeout(s, 250));   // ~4 reads a second, well under Filevine's limits

  // Cases already settled: matched with a value, or checked and found to have no phone match.
  const done = new Set((await run(sql`SELECT projectId FROM filevine_case_values WHERE caseValue IS NOT NULL OR note = 'no lead with this phone'`))
    .map((r) => String(r.projectId)));
  // Which case each lead is already matched to: a lead belongs to one case, but a case re-read keeps its own.
  const takenBy = new Map((await run(sql`SELECT leadId, projectId FROM filevine_case_values WHERE leadId IS NOT NULL`))
    .map((r) => [String(r.leadId), String(r.projectId)]));

  const since = opts.since ?? FIRST_SINCE;
  let offset = 0, listed = 0, read = 0, matched = 0, valued = 0, noForm = 0, noMatch = 0;
  for (;;) {
    const { data } = await get<Page<FvProject>>(`/Projects?createdSince=${encodeURIComponent(since)}&limit=500&offset=${offset}&requestedFields=projectId,clientId,createdDate`);
    const items = data?.items ?? [];
    listed += items.length;
    for (const p of items) {
      const projectId = p.projectId?.native, clientId = p.clientId?.native, created = p.createdDate;
      if (!projectId || !created || done.has(String(projectId))) continue;
      read++;
      await pace();
      const form = await get<{ initialCaseValue?: unknown; anticipatedTier?: unknown }>(`/Projects/${projectId}/Forms/intake?requestedFields=initialCaseValue,anticipatedTier`);
      const value = fvCaseValue(form.data?.initialCaseValue);
      const tier = String(form.data?.anticipatedTier ?? "").trim().slice(0, 60) || null;
      if (!form.data) { noForm++; }

      let leadId: number | null = null;
      if (clientId) {
        await pace();
        const phones = await get<Page<{ rawNumber?: string; number?: string }>>(`/Contacts/${clientId}/phones?requestedFields=rawNumber,number`);
        const keys = Array.from(new Set((phones.data?.items ?? []).map((x) => phoneKeyOf(x.rawNumber ?? x.number)).filter((k): k is string => !!k)));
        if (keys.length) {
          const rows = await run(sql`SELECT leadId, signedUpDate, createdDate FROM leaddocket_leads WHERE phoneKey IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
          leadId = pickLead(created, rows.map((r) => ({ leadId: Number(r.leadId), signedUpDate: r.signedUpDate, createdDate: r.createdDate, taken: (takenBy.get(String(r.leadId)) ?? String(projectId)) !== String(projectId) })));
        }
      }
      const note = !form.data ? "no intake form" : !leadId ? "no lead with this phone" : !value ? "form has no case value yet" : null;
      if (leadId) { matched++; takenBy.set(String(leadId), String(projectId)); } else noMatch++;
      await run(sql`INSERT INTO filevine_case_values (projectId, leadId, caseValue, tier, fvCreated, note)
        VALUES (${projectId}, ${leadId}, ${value}, ${tier}, ${new Date(created)}, ${note})
        ON DUPLICATE KEY UPDATE leadId = VALUES(leadId), caseValue = VALUES(caseValue), tier = VALUES(tier), note = VALUES(note)`);
      if (leadId && value) {
        valued++;
        await run(sql`UPDATE leaddocket_leads SET caseValueFv = ${value}, fvProjectId = ${projectId} WHERE leadId = ${leadId}`);
      }
    }
    if (!data?.hasMore || !items.length) break;
    offset += items.length;
  }
  return { since, listed, read, matched, valued, noForm, noMatch };
}
