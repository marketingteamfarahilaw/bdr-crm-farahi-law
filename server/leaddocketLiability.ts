/**
 * Lead Docket's "Status of Liability During Intake" for an Intake case, found
 * by the client's phone among the leads sync-leaddocket.mjs stored.
 *
 * An intake case fact: only intake procedures (canSeeIntake) may call this.
 */
import { desc, eq, sql } from "drizzle-orm";
import { leaddocketLeads } from "../drizzle/schema";
import { getDb } from "./db";
import { ensureLiabilityColumns, phoneKey } from "../scripts/migration/leaddocket-liability.mjs";

const rowsOf = (r: any) => (Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : []) as Record<string, unknown>[];

// The columns may not exist yet (deploys run no migrations, and the sync may
// not have run since this shipped), so the first read adds them.
let ready: Promise<void> | null = null;
function ensureColumns() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await ensureLiabilityColumns(async (q) => rowsOf(await db.execute(sql.raw(q))));
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export type LeadDocketLiability = { leadId: number; liabilityStatus: string | null };

/**
 * The newest Lead Docket lead with this phone, and its liability status (null
 * when intake left it blank). Null when no stored lead has the number.
 */
export async function leadDocketLiabilityForPhone(phone: string | null | undefined): Promise<LeadDocketLiability | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  try {
    await ensureColumns();
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ leadId: leaddocketLeads.leadId, liabilityStatus: leaddocketLeads.liabilityStatus })
      .from(leaddocketLeads)
      .where(eq(leaddocketLeads.phoneKey, key))
      .orderBy(desc(leaddocketLeads.leadDate), desc(leaddocketLeads.leadId))
      .limit(1);
    return row ?? null;
  } catch (e) {
    // A side detail: the case page must still open if this can't be read.
    console.warn("[leaddocketLiability] lookup failed:", e);
    return null;
  }
}
