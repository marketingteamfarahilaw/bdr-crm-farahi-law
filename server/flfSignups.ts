/**
 * The FLF Sign Up History sheet copied into flf_signups, each row linked to its
 * Lead Docket lead (shared/flfSignups.ts matchSignups), so the Marketing Report
 * can count and date sign-ups from the sheet intake keeps.
 *
 * Runs inside the "Digital marketing sheet" job (marketingSheetSync.ts), every
 * 30 minutes: the current and previous month, since past rows get corrected,
 * and every month tab once a day. A month is replaced whole on each read, so a
 * row deleted or moved in the sheet goes from here too.
 *
 * Phone numbers are kept as Lead Docket keys them (last ten digits) for the
 * match; emails only as a hash. Nothing else in the sheet is written back.
 */
import { createHash } from "node:crypto";
import xlsx from "xlsx";
import { formatInTimeZone } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db";
import { downloadWorkbook } from "./googleSheets";
import { countMonthOf, matchSignups, monthOfTab, nameKeyOf, parseFlfTab, type FlfSignup, type MatchLead } from "@shared/flfSignups";
import type { Cell } from "@shared/digitalSheet";

const TZ = "America/Los_Angeles";
const STATUS_KEY = "flf_signups_status";
/** Every month tab is re-read once this long after the last full read. */
const FULL_EVERY_MS = 20 * 60 * 60 * 1000;

export type FlfSyncStatus = {
  lastSuccessAt: string | null; lastFullAt: string | null;
  months: number; rows: number; matched: number; error: string | null; errorAt: string | null;
};

export async function getFlfSyncStatus(): Promise<FlfSyncStatus> {
  const empty: FlfSyncStatus = { lastSuccessAt: null, lastFullAt: null, months: 0, rows: 0, matched: 0, error: null, errorAt: null };
  try { return { ...empty, ...JSON.parse((await getSetting(STATUS_KEY)) ?? "{}") }; } catch { return empty; }
}
const saveStatus = async (patch: Partial<FlfSyncStatus>) =>
  setSetting(STATUS_KEY, JSON.stringify({ ...(await getFlfSyncStatus()), ...patch }));

// ── the table, created on first use (this deploy has no migration step) ─────

let ready: Promise<void> | null = null;
export function ensureFlfTable() {
  ready ??= (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`CREATE TABLE IF NOT EXISTS flf_signups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tabMonth CHAR(7) NOT NULL,
      rowNo INT NOT NULL,
      countMonth CHAR(7) NOT NULL,
      signDay CHAR(10) NULL,
      source VARCHAR(120) NULL,
      leadSource VARCHAR(255) NULL,
      intaker VARCHAR(120) NULL,
      signedUpBy VARCHAR(120) NULL,
      referralStatus VARCHAR(255) NULL,
      outcome VARCHAR(60) NULL,
      kind VARCHAR(10) NOT NULL,
      caseValue VARCHAR(60) NULL,
      caseRank VARCHAR(60) NULL,
      clientName VARCHAR(255) NOT NULL,
      caseType VARCHAR(120) NULL,
      caseNumber VARCHAR(60) NULL,
      phoneKey VARCHAR(10) NULL,
      emailHash CHAR(64) NULL,
      leadId BIGINT NULL,
      matchedBy VARCHAR(12) NULL,
      syncedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY flf_tab_row (tabMonth, rowNo),
      KEY flf_count_month (countMonth),
      KEY flf_lead (leadId)
    )`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ── matching ─────────────────────────────────────────────────────────────────

/** The Lead Docket leads any of these sign-ups could be: same phone, or same name. */
export async function candidateLeads(signups: FlfSignup[]): Promise<MatchLead[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const phones = Array.from(new Set(signups.map((s) => s.phoneKey).filter((p): p is string => !!p)));
  const names = Array.from(new Set(signups.map((s) => nameKeyOf(s.clientName)).filter(Boolean)));
  const out = new Map<number, MatchLead>();
  const read = async (where: ReturnType<typeof sql>) => {
    const [rows] = (await db.execute(sql`SELECT leadId, clientName, phoneKey, COALESCE(signedUpDate, leadDate) AS day
      FROM leaddocket_leads WHERE ${where}`)) as unknown as [{ leadId: number; clientName: string | null; phoneKey: string | null; day: Date | string | null }[]];
    for (const r of rows) {
      const day = r.day ? formatInTimeZone(new Date(r.day), TZ, "yyyy-MM-dd") : null;
      out.set(Number(r.leadId), { leadId: Number(r.leadId), clientName: r.clientName, phoneKey: r.phoneKey, day });
    }
  };
  for (let i = 0; i < phones.length; i += 500) {
    await read(sql`phoneKey IN (${sql.join(phones.slice(i, i + 500).map((p) => sql`${p}`), sql`, `)})`);
  }
  // Names Lead Docket spells the same way, give or take case and spaces; the
  // matcher still requires a sign-up date within 7 days for these.
  for (let i = 0; i < names.length; i += 500) {
    await read(sql`LOWER(TRIM(clientName)) IN (${sql.join(names.slice(i, i + 500).map((n) => sql`${n}`), sql`, `)})`);
  }
  return Array.from(out.values());
}

// ── the sync ─────────────────────────────────────────────────────────────────

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s) || null;

/**
 * Read the History sheet's month tabs into flf_signups. Every tab when `all` or
 * a day has passed since the last full read; otherwise the current and
 * previous month. Returns a one-line summary; throws when the sheet can't be read.
 */
export async function syncFlfSignups(opts: { all?: boolean } = {}): Promise<string> {
  const now = new Date();
  const thisMonth = formatInTimeZone(now, TZ, "yyyy-MM");
  const [y, m] = thisMonth.split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const status = await getFlfSyncStatus();
  const full = !!opts.all || !status.lastFullAt || now.getTime() - new Date(status.lastFullAt).getTime() > FULL_EVERY_MS;

  try {
    await ensureFlfTable();
    const { file } = await downloadWorkbook("history");
    let signups: FlfSignup[] = [];
    let months: string[] = [];
    const skipped: string[] = [];
    try {
      const tabs = xlsx.readFile(file, { bookSheets: true }).SheetNames;
      // One tab per month; should a month have two, the first is read and the other named in the summary.
      const byMonth = new Map<string, string>();
      for (const t of tabs) {
        const mo = monthOfTab(t);
        if (!mo) continue;
        if (byMonth.has(mo)) skipped.push(t); else byMonth.set(mo, t);
      }
      const wanted = Array.from(byMonth.entries()).filter(([mo]) => full || mo === thisMonth || mo === lastMonth);
      if (!wanted.length) throw new Error(`no "<Month> <Year>" tab${full ? "" : ` for ${thisMonth} or ${lastMonth}`} (tabs: ${tabs.slice(0, 8).join(", ")}…)`);
      const wb = xlsx.readFile(file, { sheets: wanted.map(([, t]) => t) });
      for (const [mo, t] of wanted) {
        const rows = xlsx.utils.sheet_to_json<Cell[]>(wb.Sheets[t], { header: 1, raw: true, defval: null, blankrows: true });
        const parsed = parseFlfTab(rows, mo);
        if (!parsed) { skipped.push(`${t} (no Client's Name header)`); continue; }
        signups = signups.concat(parsed);
        months.push(mo);
      }
      months = months.sort();
      if (!months.length) throw new Error(`no month tab could be read (${skipped.slice(0, 5).join(", ")})`);
    } finally {
      const fs = await import("node:fs");
      fs.rm(file, { force: true }, () => {});
    }

    const matches = matchSignups(signups, await candidateLeads(signups));
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const hash = (e: string | null) => (e ? createHash("sha256").update(e).digest("hex") : null);
    await db.transaction(async (tx) => {
      if (full) {
        // Every month tab was read: a month no longer in the sheet goes too.
        await tx.execute(sql`DELETE FROM flf_signups WHERE tabMonth NOT IN (${sql.join(months.map((mo) => sql`${mo}`), sql`, `)})`);
      }
      await tx.execute(sql`DELETE FROM flf_signups WHERE tabMonth IN (${sql.join(months.map((mo) => sql`${mo}`), sql`, `)})`);
      for (let i = 0; i < signups.length; i += 500) {
        const values = signups.slice(i, i + 500).map((s, j) => {
          const hit = matches[i + j];
          return sql`(${s.tabMonth}, ${s.rowNo}, ${countMonthOf(s)}, ${s.signDay}, ${cut(s.source, 120)}, ${cut(s.leadSource, 255)},
            ${cut(s.intaker, 120)}, ${cut(s.signedUpBy, 120)}, ${cut(s.referralStatus, 255)}, ${cut(s.outcome, 60)}, ${s.kind},
            ${cut(s.value, 60)}, ${cut(s.rank, 60)}, ${cut(s.clientName, 255)}, ${cut(s.caseType, 120)}, ${cut(s.caseNumber, 60)},
            ${s.phoneKey}, ${hash(s.emailKey)}, ${hit?.leadId ?? null}, ${hit?.by ?? null})`;
        });
        await tx.execute(sql`INSERT INTO flf_signups (tabMonth, rowNo, countMonth, signDay, source, leadSource, intaker, signedUpBy,
          referralStatus, outcome, kind, caseValue, caseRank, clientName, caseType, caseNumber, phoneKey, emailHash, leadId, matchedBy)
          VALUES ${sql.join(values, sql`, `)}`);
      }
    });

    const matched = matches.filter(Boolean).length;
    const at = now.toISOString();
    await saveStatus({ lastSuccessAt: at, ...(full ? { lastFullAt: at } : {}), months: months.length, rows: signups.length, matched, error: null, errorAt: null });
    return `FLF Sign Up History: ${full ? "every month" : `${lastMonth} and ${thisMonth}`} — ${signups.length} sign-ups in ${months.length} month tab(s), `
      + `${matched} linked to Lead Docket.${skipped.length ? ` Skipped: ${skipped.slice(0, 5).join(", ")}.` : ""}`;
  } catch (e: any) {
    await saveStatus({ error: e?.message ?? String(e), errorAt: now.toISOString() }).catch(() => {});
    throw e;
  }
}
