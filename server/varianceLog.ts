/**
 * The Data audit tab's running variance log. Each time the team's sheet is
 * compared with Lead Docket, every difference found is saved with the date.
 * Across a month's comparisons, a difference still found in the latest one is
 * open; one found earlier but not in the latest is fixed, as of the first
 * comparison it was missing from. That is the record the team needs to decide
 * when the sheet can be retired.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export const VARIANCE_KINDS = ["total", "unbucketed", "status", "onlySheet", "onlyCrm", "source", "sync"] as const;
export type VarianceKind = (typeof VARIANCE_KINDS)[number];
export type VarianceItem = { kind: VarianceKind; itemKey: string; name: string; detail: string };
export type Upload = { id: number; month: string; fromDay: string; toDay: string; file: string; tab: string; uploadedBy: string | null; uploadedAt: string; count: number };

let ready: Promise<void> | null = null;
function ensureTables() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`CREATE TABLE IF NOT EXISTS audit_uploads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      month CHAR(7) NOT NULL,
      fromDay VARCHAR(10) NOT NULL,
      toDay VARCHAR(10) NOT NULL,
      file VARCHAR(255) NOT NULL,
      tab VARCHAR(60) NOT NULL,
      uploadedBy VARCHAR(120) NULL,
      uploadedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY audit_uploads_month (month)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS audit_variances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uploadId INT NOT NULL,
      kind VARCHAR(20) NOT NULL,
      itemKey VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      detail VARCHAR(1000) NOT NULL,
      KEY audit_variances_upload (uploadId)
    )`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export type LoggedVariance = VarianceItem & {
  status: "open" | "fixed";
  firstSeen: string;      // uploadedAt of the first comparison that found it
  lastSeen: string;       // ... and of the last
  fixedAt: string | null; // the first comparison after lastSeen, when fixed
  times: number;          // how many comparisons found it
};

/**
 * Open or fixed, from a month's comparisons in upload order. Pure, so it is
 * tested without a database. The detail shown is the latest one found.
 */
export function varianceStatus(uploads: Pick<Upload, "id" | "uploadedAt">[], items: (VarianceItem & { uploadId: number })[]): LoggedVariance[] {
  const order = [...uploads].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id - b.id);
  const pos = new Map(order.map((u, i) => [u.id, i]));
  const latest = order.length - 1;
  const by = new Map<string, { item: VarianceItem; first: number; last: number; times: number }>();
  for (const it of items) {
    const i = pos.get(it.uploadId);
    if (i == null) continue;
    const k = `${it.kind}|${it.itemKey}`;
    const e = by.get(k);
    if (!e) { by.set(k, { item: it, first: i, last: i, times: 1 }); continue; }
    e.times++;
    if (i < e.first) e.first = i;
    if (i >= e.last) { e.last = i; e.item = it; }
  }
  return Array.from(by.values()).map(({ item, first, last, times }) => ({
    kind: item.kind, itemKey: item.itemKey, name: item.name, detail: item.detail,
    status: last === latest ? "open" as const : "fixed" as const,
    firstSeen: order[first].uploadedAt, lastSeen: order[last].uploadedAt,
    fixedAt: last === latest ? null : order[last + 1].uploadedAt,
    times,
  })).sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1)
    || VARIANCE_KINDS.indexOf(a.kind) - VARIANCE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}

export async function saveComparison(u: { fromDay: string; toDay: string; file: string; tab: string; by: string | null }, items: VarianceItem[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureTables();
  const [res] = (await db.execute(sql`INSERT INTO audit_uploads (month, fromDay, toDay, file, tab, uploadedBy)
    VALUES (${u.toDay.slice(0, 7)}, ${u.fromDay}, ${u.toDay}, ${u.file.slice(0, 255)}, ${u.tab.slice(0, 60)}, ${u.by})`)) as any;
  const uploadId = Number(res.insertId);
  // One insert per 100 rows: a comparison has tens of differences, not thousands.
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    await db.execute(sql`INSERT INTO audit_variances (uploadId, kind, itemKey, name, detail) VALUES ${sql.join(
      chunk.map((it) => sql`(${uploadId}, ${it.kind}, ${it.itemKey.slice(0, 255)}, ${it.name.slice(0, 255)}, ${it.detail.slice(0, 1000)})`), sql`, `)}`);
  }
  return { uploadId };
}

/** A month's comparisons, newest first, and every difference with its status. */
export async function readLog(month: string) {
  const db = await getDb();
  if (!db) return { uploads: [] as Upload[], variances: [] as LoggedVariance[] };
  await ensureTables();
  const [ups] = (await db.execute(sql`SELECT u.id, u.month, u.fromDay, u.toDay, u.file, u.tab, u.uploadedBy, u.uploadedAt,
      (SELECT COUNT(*) FROM audit_variances v WHERE v.uploadId = u.id) AS n
    FROM audit_uploads u WHERE u.month = ${month} ORDER BY u.uploadedAt DESC, u.id DESC`)) as any;
  const uploads: Upload[] = (ups ?? []).map((r: any) => ({
    id: Number(r.id), month: r.month, fromDay: r.fromDay, toDay: r.toDay, file: r.file, tab: r.tab,
    uploadedBy: r.uploadedBy, uploadedAt: new Date(r.uploadedAt).toISOString(), count: Number(r.n) || 0,
  }));
  if (!uploads.length) return { uploads, variances: [] };
  const [its] = (await db.execute(sql`SELECT uploadId, kind, itemKey, name, detail FROM audit_variances
    WHERE uploadId IN (${sql.join(uploads.map((u) => sql`${u.id}`), sql`, `)})`)) as any;
  const items = (its ?? []).map((r: any) => ({ uploadId: Number(r.uploadId), kind: r.kind, itemKey: r.itemKey, name: r.name, detail: r.detail }));
  return { uploads, variances: varianceStatus(uploads, items) };
}
