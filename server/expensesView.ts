/**
 * Expenses (/bdr/expenses): the FR and BDR expense ledgers, read-only.
 *
 * The Centralized BDR/FR sheet is where expenses are entered (Youssef,
 * 2026-09-29: "Sheet only"). The 8-hourly sheets sync clears both tables and
 * reloads them from it, so the CRM only shows them — anything typed here would
 * vanish at the next sync, which is why the add/edit/delete forms are gone.
 *
 * Everything is worked out here rather than in the page so it is right once:
 * reps are matched to today's team (whoIs — "Quee" is Queenie), days and months
 * are Pacific, the BDR sheet's report month is shown as written or, when the
 * cell held a spreadsheet serial ("46174"), as the month it means.
 */
import { formatInTimeZone } from "date-fns-tz";
import { getDb, getSetting } from "./db";
import { bdrExpenses, frExpenses } from "../drizzle/schema";
import { whoIs } from "./adminOverview";
import { SHEETS } from "./googleSheets";

const TZ = "America/Los_Angeles";
export type Ledger = "fr" | "bdr";
export type ExpenseFilters = { from?: string; to?: string; rep?: string; card?: "Company" | "Personal"; search?: string };

/** "46174" (an Excel date serial) → "June 2026"; anything else as written. */
export function reportMonth(v?: string | null): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return t;
}

/** The rep a row belongs to: today's team by full name, anyone else as stored. */
function repOf(raw?: string | null) {
  const p = whoIs(raw);
  return p ? { rep: p.name, role: p.role, current: p.current } : { rep: "No rep named", role: "Unassigned" as const, current: false };
}

export async function getExpensesView(ledger: Ledger, f: ExpenseFilters, onlyRep: string | null) {
  const db = await getDb();
  if (!db) return null;
  const table = ledger === "fr" ? frExpenses : bdrExpenses;
  const raw = (await db.select().from(table)) as any[];
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");

  // Every row, normalised once.
  const all = raw.map((e) => {
    const day = e.expenseDate ? formatInTimeZone(new Date(e.expenseDate), TZ, "yyyy-MM-dd") : null;
    const amount = Number.parseFloat(String(e.amount ?? 0));
    return {
      id: e.id as number,
      day,
      ...repOf(e.agentName),
      facilityName: (e.facilityName as string | null) || null,
      facilityPhone: ledger === "bdr" ? ((e.facilityPhone as string | null) || null) : null,
      store: (e.store as string | null) || null,
      reason: (e.reason as string | null) || null,
      notes: (e.notes as string | null) || null,
      amount: Number.isFinite(amount) ? amount : 0,
      cardType: ledger === "fr" ? ((e.cardType as string | null) ?? "Company") : null,
      reportMonth: ledger === "bdr" ? reportMonth(e.month) : null,
    };
  });
  // A rep sees only their own rows; managers see everyone (as the old list did).
  const mine = onlyRep ? all.filter((r) => r.rep === (whoIs(onlyRep)?.name ?? onlyRep)) : all;

  // Who can be picked in the filter: today's team first, then anyone else with rows.
  const repCounts = new Map<string, { rep: string; role: string; current: boolean; count: number }>();
  for (const r of mine) {
    const c = repCounts.get(r.rep) ?? { rep: r.rep, role: r.role, current: r.current, count: 0 };
    c.count++; repCounts.set(r.rep, c);
  }
  const reps = Array.from(repCounts.values()).sort((a, b) => Number(b.current) - Number(a.current) || a.rep.localeCompare(b.rep));

  const q = (f.search ?? "").trim().toLowerCase();
  const rows = mine.filter((r) =>
    (!f.from || (r.day && r.day >= f.from)) &&
    (!f.to || (r.day && r.day <= f.to)) &&
    (!f.rep || r.rep === f.rep) &&
    (!f.card || r.cardType === f.card) &&
    (!q || [r.facilityName, r.store, r.reason, r.notes, r.rep].some((v) => v?.toLowerCase().includes(q))),
  ).sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || b.id - a.id);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const byRepMap = new Map<string, { rep: string; role: string; current: boolean; total: number; count: number }>();
  const byMonthMap = new Map<string, { month: string; total: number; count: number; company: number; personal: number }>();
  const byStoreMap = new Map<string, { store: string; total: number; count: number }>();
  const month = (m: string) => {
    if (!byMonthMap.has(m)) byMonthMap.set(m, { month: m, total: 0, count: 0, company: 0, personal: 0 });
    return byMonthMap.get(m)!;
  };
  for (const r of rows) {
    const br = byRepMap.get(r.rep) ?? { rep: r.rep, role: r.role, current: r.current, total: 0, count: 0 };
    br.total += r.amount; br.count++; byRepMap.set(r.rep, br);
    if (r.day) {
      const m = month(r.day.slice(0, 7));
      m.total += r.amount; m.count++;
      if (r.cardType === "Personal") m.personal += r.amount; else m.company += r.amount;
    }
    const s = (r.store ?? "").trim();
    if (s) {
      // "Uber Eats", "UberEats" and "uber eats" are one store.
      const k = s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const bs = byStoreMap.get(k) ?? { store: s, total: 0, count: 0 };
      bs.total += r.amount; bs.count++; byStoreMap.set(k, bs);
    }
  }
  // Every month between the first and last shown (quiet months read zero, not missing).
  const days = rows.map((r) => r.day).filter((d): d is string => !!d).sort();
  const span = [f.from ?? days[0], f.to ?? (days.length ? (days[days.length - 1] > today ? days[days.length - 1] : today) : undefined)];
  if (span[0] && span[1]) {
    const [y0, m0] = span[0].split("-").map(Number), [y1, m1] = span[1].split("-").map(Number);
    for (let i = y0 * 12 + m0 - 1; i <= y1 * 12 + m1 - 1 && i - (y0 * 12 + m0 - 1) < 240; i++)
      month(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  }

  const sheets = await getSetting("sync_status_sheets").catch(() => null);
  let syncedAt: string | null = null;
  try { syncedAt = sheets ? JSON.parse(sheets).lastSuccessAt ?? null : null; } catch { /* no status yet */ }
  const latest = mine.reduce<string | null>((m, r) => (r.day && r.day <= today && (!m || r.day > m) ? r.day : m), null);

  return {
    ledger,
    rows: rows.map((r) => ({ ...r, amount: round2(r.amount) })),
    reps,
    summary: {
      total: round2(total),
      count: rows.length,
      average: rows.length ? round2(total / rows.length) : 0,
      reps: byRepMap.size,
      personal: round2(rows.filter((r) => r.cardType === "Personal").reduce((s, r) => s + r.amount, 0)),
      zeroAmount: rows.filter((r) => r.amount === 0).length,
    },
    byRep: Array.from(byRepMap.values()).map((r) => ({ ...r, total: round2(r.total) })).sort((a, b) => b.total - a.total),
    byMonth: Array.from(byMonthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, total: round2(m.total), company: round2(m.company), personal: round2(m.personal) })),
    topStores: Array.from(byStoreMap.values()).sort((a, b) => b.total - a.total).slice(0, 8).map((s) => ({ ...s, total: round2(s.total) })),
    source: {
      syncedAt,
      latest,
      tab: ledger === "fr" ? "2.FR Expen" : "2.BDR Expen",
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEETS.centralized.id}/edit`,
    },
  };
}
