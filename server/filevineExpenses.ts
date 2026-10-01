/**
 * FR expenses as Filevine has them, side by side with the Centralized sheet
 * (Youssef, 2026-10-01: "pull the FR expenses to the CRM but compare with what
 * we have already in Google Sheet").
 *
 * Filevine keeps one "<rep> Expenses" project per Field Rep. Its rows live in
 * their own table, filevine_expenses: fr_expenses is the sheet's, and the
 * 8-hourly sheets sync clears and reloads it, so anything put there would
 * vanish. Nothing here changes an expense total; the comparison only says
 * what one side has and the other doesn't.
 *
 * The rows arrive as an upload (the CRM's own Filevine API login is still
 * waiting on a working client secret); each upload replaces the rows of the
 * projects it carries, so a fresh export is always the whole picture.
 */
import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { frExpenses } from "../drizzle/schema";
import { whoIs } from "./adminOverview";

const TZ = "America/Los_Angeles";

export type FvExpenseInput = {
  itemId: string;
  projectId: number;
  rep: string;
  day: string | null;      // Date incurred, yyyy-MM-dd as Filevine wrote it
  entered: string | null;  // when it was logged, yyyy-MM-dd
  type: string | null;
  store: string | null;
  amount: number;
  payment: string | null;
  requestedBy: string | null;
  enteredBy: string | null;
};

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`CREATE TABLE IF NOT EXISTS filevine_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      itemId VARCHAR(64) NOT NULL,
      projectId INT NOT NULL,
      rep VARCHAR(120) NOT NULL,
      day VARCHAR(10) NULL,
      entered VARCHAR(10) NULL,
      type VARCHAR(255) NULL,
      store VARCHAR(255) NULL,
      amount DECIMAL(10,2) NOT NULL,
      payment VARCHAR(60) NULL,
      requestedBy VARCHAR(120) NULL,
      enteredBy VARCHAR(120) NULL,
      importedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY filevine_expenses_item (itemId)
    )`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Replace the rows of every project in the upload with the upload. */
export async function importFilevineExpenses(rows: FvExpenseInput[]) {
  await ensureTable();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const clean = rows.filter((r) => r.itemId && Number.isFinite(r.amount) && r.rep);
  const projects = Array.from(new Set(clean.map((r) => r.projectId)));
  if (projects.length) await db.execute(sql`DELETE FROM filevine_expenses WHERE projectId IN (${sql.join(projects.map((p) => sql`${p}`), sql`, `)})`);
  for (const r of clean) {
    await db.execute(sql`INSERT INTO filevine_expenses (itemId, projectId, rep, day, entered, type, store, amount, payment, requestedBy, enteredBy)
      VALUES (${r.itemId}, ${r.projectId}, ${r.rep}, ${r.day && DAY.test(r.day) ? r.day : null}, ${r.entered && DAY.test(r.entered) ? r.entered : null},
        ${r.type}, ${r.store}, ${Math.round(r.amount * 100) / 100}, ${r.payment}, ${r.requestedBy}, ${r.enteredBy})
      ON DUPLICATE KEY UPDATE projectId = VALUES(projectId), rep = VALUES(rep), day = VALUES(day), entered = VALUES(entered), type = VALUES(type),
        store = VALUES(store), amount = VALUES(amount), payment = VALUES(payment), requestedBy = VALUES(requestedBy), enteredBy = VALUES(enteredBy), importedAt = CURRENT_TIMESTAMP`);
  }
  return { imported: clean.length, skipped: rows.length - clean.length, projects: projects.length };
}

// ── matching (pure, tested) ──

export type SheetSide = { id: number; rep: string; day: string | null; amount: number; store: string | null; facility: string | null; reason: string | null; card: string | null };
export type FvSide = { id: string; rep: string; day: string | null; amount: number; store: string | null; type: string | null; payment: string | null; entered?: string | null };
export type Pair = { fv: FvSide; sheet: SheetSide; daysApart: number };

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

/**
 * One Filevine row to at most one sheet row: same rep, same amount to the
 * cent, dates within 3 days (the nearest wins); then a looser pass up to 14
 * days, reported as "date differs". Undated rows match only on that second pass.
 */
export function matchExpenses(fv: FvSide[], sheet: SheetSide[]) {
  const used = new Set<number>();
  const matched: Pair[] = [];
  const loose: Pair[] = [];
  const left: FvSide[] = [];
  const cents = (n: number) => Math.round(n * 100);
  const pass = (rows: FvSide[], maxDays: number, into: Pair[]) => {
    const rest: FvSide[] = [];
    for (const f of rows) {
      let best: SheetSide | null = null, bestGap = Infinity;
      for (const s of sheet) {
        if (used.has(s.id) || s.rep !== f.rep || cents(s.amount) !== cents(f.amount)) continue;
        const gap = f.day && s.day ? Math.abs(dayNum(f.day) - dayNum(s.day)) : maxDays === 14 ? 14 : Infinity;
        if (gap <= maxDays && gap < bestGap) { best = s; bestGap = gap; }
      }
      if (best) { used.add(best.id); into.push({ fv: f, sheet: best, daysApart: bestGap }); } else rest.push(f);
    }
    return rest;
  };
  left.push(...pass(pass(fv, 3, matched), 14, loose));
  return { matched, loose, onlyFilevine: left, onlySheet: sheet.filter((s) => !used.has(s.id)) };
}

// ── the view ──

export async function getFilevineComparison(range: { from?: string; to?: string }) {
  await ensureTable();
  const db = await getDb();
  if (!db) return null;
  const [fvRaw, sheetRaw] = await Promise.all([
    db.execute(sql`SELECT itemId, projectId, rep, day, entered, type, store, amount, payment, importedAt FROM filevine_expenses`),
    db.select().from(frExpenses),
  ]);
  const fvAll = ((fvRaw as any)[0] ?? fvRaw) as any[];
  const inRange = (d: string | null) => !!d && (!range.from || d >= range.from) && (!range.to || d <= range.to);

  const fv: FvSide[] = fvAll.map((r): FvSide => ({
    id: String(r.itemId), rep: whoIs(r.rep)?.name ?? String(r.rep), day: (r.day as string | null) ?? null,
    amount: Number.parseFloat(String(r.amount)) || 0, store: r.store ?? null, type: r.type ?? null, payment: r.payment ?? null,
    entered: (r.entered as string | null) ?? null,
  })).filter((r) => inRange(r.day ?? r.entered ?? null));
  const fvReps = new Set(fv.map((r) => r.rep));
  // Only the reps Filevine has a project for: the sheet's other FR rows have nothing to compare with.
  const sheet: SheetSide[] = (sheetRaw as any[]).map((e) => ({
    id: e.id as number, rep: whoIs(e.agentName)?.name ?? String(e.agentName ?? ""),
    day: e.expenseDate ? formatInTimeZone(new Date(e.expenseDate), TZ, "yyyy-MM-dd") : null,
    amount: Number.parseFloat(String(e.amount ?? 0)) || 0, store: e.store ?? null, facility: e.facilityName ?? null,
    reason: e.reason ?? null, card: e.cardType ?? null,
  })).filter((s) => inRange(s.day) && fvReps.has(s.rep));

  const m = matchExpenses(fv, sheet);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const reps = Array.from(fvReps).sort().map((rep) => {
    const sum = (xs: { amount: number }[]) => r2(xs.reduce((a, x) => a + x.amount, 0));
    const f = fv.filter((x) => x.rep === rep), s = sheet.filter((x) => x.rep === rep);
    return {
      rep,
      filevine: { count: f.length, total: sum(f) },
      sheet: { count: s.length, total: sum(s) },
      matched: m.matched.filter((p) => p.fv.rep === rep).length + m.loose.filter((p) => p.fv.rep === rep).length,
      onlyFilevine: { count: m.onlyFilevine.filter((x) => x.rep === rep).length, total: sum(m.onlyFilevine.filter((x) => x.rep === rep)) },
      onlySheet: { count: m.onlySheet.filter((x) => x.rep === rep).length, total: sum(m.onlySheet.filter((x) => x.rep === rep)) },
    };
  });
  const byDay = <T extends { day: string | null }>(xs: T[]) => xs.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
  const importedAt = fvAll.reduce<string | null>((a, r) => { const t = r.importedAt ? new Date(r.importedAt).toISOString() : null; return t && (!a || t > a) ? t : a; }, null);
  return {
    importedAt,
    filevineRows: fvAll.length,
    reps,
    looseMatches: m.loose.map((p) => ({ ...p, fv: { ...p.fv, amount: r2(p.fv.amount) } })),
    onlyFilevine: byDay(m.onlyFilevine),
    onlySheet: byDay(m.onlySheet),
  };
}
