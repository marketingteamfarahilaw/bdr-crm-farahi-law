/**
 * Merge two facilities, or delete one, from the Facilities page (Youssef,
 * 2026-09-29: "under Facilities lets add an option to merge two facilities or
 * DELETE specific facilities"). Managers and super admins only.
 *
 * Merging moves everything that points at the duplicate onto the facility kept
 * — calls and visits, recaps, tasks, leads, referrals, expenses, rewards, the
 * PD tracker — fills the kept one's blank fields from it, and removes it. It
 * follows scripts/migration/merge-obvious-duplicates.mjs, which merged the
 * import's duplicates, and adds what that script didn't need to care about:
 * the recap queue, logos, field-visit lists, and the Lead Docket words that
 * named the duplicate, remembered for the kept partner so the next sync doesn't
 * unlink its leads.
 *
 * Deleting removes the facility with its own history (calls, recaps, tasks,
 * referrals); records elsewhere that named it (expenses, rewards, trackers,
 * Lead Docket leads) are kept and just no longer point at it.
 *
 * Both leave a forwarding address (facility_redirects), so the 8-hourly Google
 * Sheets sync doesn't re-create the facility from the workbook or hang its rows
 * on a new copy, and calls on its numbers still find the facility kept.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { refreshTotals } from "./partnerLinks";
import { partnerKey } from "../scripts/migration/partner-key.mjs";

/** Rows that belong to one facility, with facilityId NOT NULL. */
const OWNED = ["contact_logs", "facility_updates", "facility_tasks", "facility_referrals", "facility_leads_sent", "facility_gratitude", "call_recap_queue"] as const;
/** Rows elsewhere that point at a facility and also keep its name as text. */
const NAMED = ["fr_expenses", "bdr_expenses", "referral_rewards", "referral_tracker", "uber_receipts", "pod_appointments", "qa_reviews", "pd_referrals"] as const;

type Fac = Record<string, any> & { id: number; name: string };

const last10 = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
const later = (a: unknown, b: unknown) => (!a ? b ?? null : !b ? a : new Date(a as any) >= new Date(b as any) ? a : b);
const STATUS_RANK: Record<string, number> = { priority_partner: 5, active_partner: 4, needs_follow_up: 3, prospect: 2, dormant: 1, do_not_use: 0 };

/**
 * The kept facility's fields after taking in the duplicate: its own values win;
 * blanks are filled from the duplicate; phones are pooled (up to three, one per
 * number) so a call from either number still finds it; notes are kept together;
 * money and calls add up; dates take the later one.
 */
export function mergedFields(keep: Fac, drop: Fac) {
  const out: Record<string, any> = {};
  for (const col of ["address", "city", "zipCode", "serviceArea", "website", "contactName", "contactTitle", "contactPhone", "contactEmail",
    "preferredContactMethod", "assignedRepName", "assignedRepId", "placeId", "latitude", "longitude", "territory", "managedBy", "lastPartnerInFLF", "loopStage"])
    if (blank(keep[col]) && !blank(drop[col])) out[col] = drop[col];

  const phones: string[] = [];
  for (const p of [keep.phone, keep.phone2, keep.phone3, drop.phone, drop.phone2, drop.phone3])
    if (!blank(p) && !phones.some((q) => (last10(q) || q) === (last10(p) || p))) phones.push(String(p).trim());
  const [phone, phone2, phone3] = [phones[0] ?? null, phones[1] ?? null, phones[2] ?? null];
  if (phone !== (keep.phone ?? null)) out.phone = phone;
  if (phone2 !== (keep.phone2 ?? null)) out.phone2 = phone2;
  if (phone3 !== (keep.phone3 ?? null)) out.phone3 = phone3;

  const joinText = (a: unknown, b: unknown) =>
    blank(b) || String(a ?? "").includes(String(b).trim()) ? undefined : blank(a) ? String(b) : `${a}\n\n[From ${drop.name}] ${b}`;
  const notes = joinText(keep.notes, drop.notes);
  if (notes !== undefined) out.notes = notes;
  const mgmt = joinText(keep.managementNote, drop.managementNote);
  if (mgmt !== undefined) out.managementNote = mgmt;

  if ((STATUS_RANK[drop.partnerStatus] ?? 0) > (STATUS_RANK[keep.partnerStatus] ?? 0) && keep.partnerStatus !== "do_not_use") out.partnerStatus = drop.partnerStatus;
  for (const col of ["priorityPartner", "managementFlag", "visitRequested"]) if (Number(drop[col] ?? 0) > Number(keep[col] ?? 0)) out[col] = drop[col];
  for (const col of ["lastContactDate", "lastCheckInDate", "lastPackageDate"]) {
    const v = later(keep[col], drop[col]);
    if (v && v !== keep[col]) out[col] = v;
  }
  if (Number(drop.totalCalls ?? 0)) out.totalCalls = Number(keep.totalCalls ?? 0) + Number(drop.totalCalls ?? 0);
  if (Number(drop.moneyInvested ?? 0)) out.moneyInvested = (Number(keep.moneyInvested ?? 0) + Number(drop.moneyInvested ?? 0)).toFixed(2);
  return out;
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  return db;
}
const rowsOf = (r: any) => (Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : []) as any[];
const affected = (r: any) => Number((Array.isArray(r) ? r[0] : r)?.affectedRows ?? 0);

export type RecordCounts = {
  /** Deleted with the facility. */
  calls: number; recaps: number; tasks: number; referrals: number; gratitude: number;
  /** Kept when it's deleted (they just stop pointing at it). */
  leads: number; signed: number; other: number;
};

/** What hangs off each facility, shown before a merge or delete: one grouped count per table. */
export async function facilityRecordCounts(ids: number[]) {
  const db = await dbOrThrow();
  const list = Array.from(new Set(ids));
  const out: Record<number, RecordCounts> = {};
  for (const id of list) out[id] = { calls: 0, recaps: 0, tasks: 0, referrals: 0, gratitude: 0, leads: 0, signed: 0, other: 0 };
  if (!list.length) return out;
  const idList = sql.join(list.map((id) => sql`${id}`), sql`, `);
  const count = async (field: keyof RecordCounts, table: string, extra = sql``) => {
    const rows = rowsOf(await db.execute(sql`SELECT facilityId, COUNT(*) AS n FROM ${sql.raw(table)} WHERE facilityId IN (${idList}) ${extra} GROUP BY facilityId`));
    for (const r of rows) if (out[Number(r.facilityId)]) out[Number(r.facilityId)][field] += Number(r.n);
  };
  await count("calls", "contact_logs");
  await count("recaps", "facility_updates");
  await count("tasks", "facility_tasks");
  await count("referrals", "facility_referrals");
  await count("referrals", "facility_leads_sent");
  await count("gratitude", "facility_gratitude");
  await count("leads", "facility_leads");
  await count("signed", "facility_leads", sql`AND signedCase = 1`);
  for (const t of NAMED) await count("other", t);
  return out;
}

async function loadTwo(db: any, a: number, b: number) {
  const rows = rowsOf(await db.execute(sql`SELECT * FROM facilities WHERE id IN (${a}, ${b})`)) as Fac[];
  return [rows.find((f) => f.id === a), rows.find((f) => f.id === b)] as const;
}

/**
 * Leave a forwarding address for a facility that's going away: its name and
 * numbers now point at `to` (the facility kept), or at nothing after a delete.
 * The Google Sheets sync and call matching read these, so the facility isn't
 * re-created from the workbook, and calls on its numbers still land (see
 * scripts/migration/facility-redirects.mjs). Earlier redirects to it move along.
 */
async function forward(tx: any, from: Fac, to: number | null, reason: "merged" | "deleted", by: string) {
  await tx.execute(sql`UPDATE facility_redirects SET facilityId = ${to} WHERE facilityId = ${from.id}`);
  const values: [string, string][] = [["name", String(from.name ?? "").trim()]];
  for (const p of [from.phone, from.phone2, from.phone3, from.contactPhone]) if (last10(p)) values.push(["phone", last10(p)]);
  for (const [kind, value] of values)
    if (value) await tx.execute(sql`INSERT INTO facility_redirects (kind, value, facilityId, fromFacilityId, reason, createdBy)
      VALUES (${kind}, ${value.slice(0, 255)}, ${to}, ${from.id}, ${reason}, ${by.slice(0, 255)})`);
}

/** Merge `dropId` into `keepId`. Returns how many records moved. */
export async function mergeFacilities(keepId: number, dropId: number, by: string) {
  if (keepId === dropId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick two different facilities." });
  const db = await dbOrThrow();
  const [keep, drop] = await loadTwo(db, keepId, dropId);
  if (!keep || !drop) throw new TRPCError({ code: "NOT_FOUND", message: "One of those facilities no longer exists." });

  const moved = await db.transaction((tx: any) => applyMerge(tx, keep, drop, by));
  await refreshTotals(db as any, [keepId]);
  return { moved, keptId: keepId, keptName: keep.name, removedName: drop.name };
}

/** The merge itself, inside a transaction (its own, or a test's that rolls back). */
export async function applyMerge(tx: any, keep: Fac, drop: Fac, by: string) {
  const keepId = keep.id, dropId = drop.id;

  // The Lead Docket sync re-matches its leads from their words each time. The
  // words that matched the duplicate would match nothing once it's gone, so they
  // (and its name) are remembered for the kept partner. Read before the move, so
  // the kept partner's own guesses aren't frozen too.
  const words = rowsOf(await tx.execute(sql`SELECT DISTINCT partnerKey FROM facility_leads
    WHERE facilityId = ${dropId} AND externalSource = 'leaddocket' AND facilityLinkedBy IS NULL AND partnerKey IS NOT NULL AND partnerKey <> ''`))
    .map((r) => String(r.partnerKey));

  let moved = 0;
  for (const t of OWNED) moved += affected(await tx.execute(sql`UPDATE ${sql.raw(t)} SET facilityId = ${keepId} WHERE facilityId = ${dropId}`));
  for (const t of NAMED)
    moved += affected(await tx.execute(sql`UPDATE ${sql.raw(t)} SET facilityId = ${keepId}, facilityName = ${keep.name} WHERE facilityId = ${dropId}`));
  moved += affected(await tx.execute(sql`UPDATE facility_leads SET facilityId = ${keepId} WHERE facilityId = ${dropId}`));
  await tx.execute(sql`UPDATE partner_aliases SET facilityId = ${keepId} WHERE facilityId = ${dropId}`);
  const nameKey = partnerKey(drop.name);
  for (const key of Array.from(new Set([...words, ...(nameKey ? [nameKey] : [])])))
    await tx.execute(sql`INSERT IGNORE INTO partner_aliases (aliasKey, text, facilityId, createdBy)
      VALUES (${key}, ${`Merged from ${drop.name}`.slice(0, 500)}, ${keepId}, ${by.slice(0, 255)})`);

  // The logo: the kept one's own, else the duplicate's.
  const [hasLogo] = rowsOf(await tx.execute(sql`SELECT facilityId FROM facility_logos WHERE facilityId = ${keepId}`));
  if (hasLogo) await tx.execute(sql`DELETE FROM facility_logos WHERE facilityId = ${dropId}`);
  else await tx.execute(sql`UPDATE facility_logos SET facilityId = ${keepId} WHERE facilityId = ${dropId}`);

  // Field visits list the partners they covered as JSON: the duplicate becomes the
  // kept one, and if both were on one visit they count once. Entries without an id
  // (typed names) are left alone.
  const idOf = (x: any) => Number(x?.id ?? x?.facilityId);
  const visits = rowsOf(await tx.execute(sql`SELECT id, facilitiesVisited, facilityCount FROM field_visits`));
  for (const v of visits) {
    const list: any[] = typeof v.facilitiesVisited === "string" ? JSON.parse(v.facilitiesVisited) : v.facilitiesVisited ?? [];
    if (!Array.isArray(list) || !list.some((x) => idOf(x) === dropId)) continue;
    const renamed = list.map((x) => (idOf(x) === dropId ? { ...x, id: keepId, name: keep.name } : x));
    const next = renamed.filter((x, i) => idOf(x) !== keepId || renamed.findIndex((y) => idOf(y) === keepId) === i);
    const collapsed = renamed.length - next.length;
    await tx.execute(sql`UPDATE field_visits SET facilitiesVisited = ${JSON.stringify(next)},
      facilityCount = ${Math.max(next.length, Number(v.facilityCount ?? 0) - collapsed)} WHERE id = ${v.id}`);
  }

  const fields = mergedFields(keep, drop);
  const cols = Object.keys(fields);
  if (cols.length)
    await tx.execute(sql`UPDATE facilities SET ${sql.join(cols.map((c) => sql`${sql.raw("`" + c + "`")} = ${fields[c]}`), sql`, `)}, updatedAt = NOW() WHERE id = ${keepId}`);
  await forward(tx, drop, keepId, "merged", by);
  await tx.execute(sql`DELETE FROM facilities WHERE id = ${dropId}`);

  // Who merged what, on the kept partner's activity.
  await tx.execute(sql`INSERT INTO facility_updates (facilityId, updateDate, summary, updateType, repName)
    VALUES (${keepId}, NOW(), ${`Merged with "${drop.name}" (#${dropId}) by ${by}. Its calls, recaps, tasks, leads and notes are now here.`.slice(0, 2000)}, 'other', ${by.slice(0, 255)})`);
  return moved;
}

/** Delete a facility with its own history; other records keep their row but stop pointing at it. */
export async function deleteFacilityFully(id: number, by: string) {
  const db = await dbOrThrow();
  await db.transaction((tx: any) => applyDelete(tx, id, by));
}

export async function applyDelete(tx: any, id: number, by: string) {
  const [fac] = rowsOf(await tx.execute(sql`SELECT * FROM facilities WHERE id = ${id}`)) as Fac[];
  if (!fac) return;
  for (const t of OWNED) await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE facilityId = ${id}`);
  for (const t of NAMED) await tx.execute(sql`UPDATE ${sql.raw(t)} SET facilityId = NULL WHERE facilityId = ${id}`);
  // Lead Docket leads go back to being matched from their words at the next sync.
  await tx.execute(sql`UPDATE facility_leads SET facilityId = NULL, facilityLinkedBy = NULL, facilityLinkedAt = NULL WHERE facilityId = ${id}`);
  await tx.execute(sql`DELETE FROM partner_aliases WHERE facilityId = ${id}`);
  await tx.execute(sql`DELETE FROM facility_logos WHERE facilityId = ${id}`);
  // So the Google Sheets sync doesn't bring it back from the workbook.
  await forward(tx, fac, null, "deleted", by);
  await tx.execute(sql`DELETE FROM facilities WHERE id = ${id}`);
}
