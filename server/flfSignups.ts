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
import {
  DEFAULT_SOURCE_MAP, LD_SOURCE, channelForSheetSource, countMonthOf, utcDate, matchSignups, monthOfTab, nameKeyOf, parseFlfTab, placeSignup,
  type FlfSignup, type LinkedLead, type MatchLead, type SourceMapEntry,
} from "@shared/flfSignups";
import { TEAM_CHANNEL as TEAM_ROW, channelOfSource } from "@shared/marketing";
import type { Cell } from "@shared/digitalSheet";

const TZ = "America/Los_Angeles";
const STATUS_KEY = "flf_signups_status";
const MAP_KEY = "flf_source_map";
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
      reportSource VARCHAR(255) NULL,
      reportTeamRole VARCHAR(20) NULL,
      reportTeamRep VARCHAR(120) NULL,
      UNIQUE KEY flf_tab_row (tabMonth, rowNo),
      KEY flf_count_month (countMonth),
      KEY flf_lead (leadId)
    )`);
    // Added after the table first shipped (Nov 23, 2026): where the Marketing Report counts each sign-up.
    const [cols] = (await db.execute(sql`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flf_signups'`)) as unknown as [{ c: string }[]];
    const have = new Set(cols.map((r) => r.c));
    if (!have.has("reportSource")) await db.execute(sql`ALTER TABLE flf_signups ADD COLUMN reportSource VARCHAR(255) NULL`);
    if (!have.has("reportTeamRole")) await db.execute(sql`ALTER TABLE flf_signups ADD COLUMN reportTeamRole VARCHAR(20) NULL`);
    if (!have.has("reportTeamRep")) await db.execute(sql`ALTER TABLE flf_signups ADD COLUMN reportTeamRep VARCHAR(120) NULL`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ── the column-A mapping ────────────────────────────────────────────────────

/** The lines saved in Settings: one per column-A value someone mapped by hand. */
async function savedLines(): Promise<SourceMapEntry[]> {
  try {
    const saved = JSON.parse((await getSetting(MAP_KEY)) ?? "null");
    if (Array.isArray(saved)) return saved.filter((e) => e && typeof e.sheet === "string" && typeof e.channel === "string");
  } catch { /* none saved */ }
  return [];
}

/**
 * The mapping in use: Settings' lines first, then the defaults. Saved lines
 * are exact values, and an exact line wins over a prefix, so a saved line
 * always overrides the default for that value.
 */
export async function getSourceMap(): Promise<SourceMapEntry[]> {
  return [...(await savedLines()), ...DEFAULT_SOURCE_MAP];
}

/**
 * Settings' view of the mapping: every column-A value on the sheet, how many
 * sign-ups have it and when it was last used, and the channel it counts under
 * — by a saved line, a default line, or (with neither) its own name.
 */
export async function getSourceMapView() {
  await ensureFlfTable();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const saved = await savedLines();
  const map = [...saved, ...DEFAULT_SOURCE_MAP];
  const [values] = (await db.execute(sql`SELECT TRIM(COALESCE(source, '')) AS sheet, COUNT(*) AS n, MAX(countMonth) AS last
    FROM flf_signups GROUP BY TRIM(COALESCE(source, '')) ORDER BY last DESC, n DESC`)) as unknown as [{ sheet: string; n: number; last: string }[]];
  // The report's channels in use, to pick from: those Lead Docket's sources of the last year group into.
  const [ld] = (await db.execute(sql`SELECT marketingSource AS s, COUNT(*) AS n FROM leaddocket_leads
    WHERE leadDate >= ${new Date(Date.now() - 365 * 86_400_000)} AND marketingSource IS NOT NULL AND TRIM(marketingSource) <> ''
      AND (teamRole IS NULL OR teamRole NOT IN ('BDR', 'FR'))
    GROUP BY marketingSource`)) as unknown as [{ s: string; n: number }[]];
  const channels = new Map<string, number>();
  for (const r of ld) { const c = channelOfSource(r.s.trim()); channels.set(c, (channels.get(c) ?? 0) + Number(r.n)); }
  const savedKeys = new Set(saved.map((e) => e.sheet.toLowerCase().replace(/\s+/g, " ").trim()));
  return {
    rows: values.map((v) => {
      const channel = channelForSheetSource(v.sheet, map);
      const isSaved = savedKeys.has(v.sheet.toLowerCase().replace(/\s+/g, " ").trim());
      return {
        sheet: v.sheet, signups: Number(v.n), lastMonth: v.last,
        channel: channel ?? (v.sheet ? channelOfSource(v.sheet) : null),
        how: isSaved ? "saved" as const : channel ? "default" as const : "ownName" as const,
      };
    }),
    saved,
    defaults: DEFAULT_SOURCE_MAP,
    channels: [TEAM_ROW, LD_SOURCE, ...Array.from(channels.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => c !== TEAM_ROW)].slice(0, 150),
  };
}

/** Save Settings' lines (one per column-A value; an empty channel removes it) and place every sign-up again. */
export async function saveSourceMap(lines: SourceMapEntry[]): Promise<{ lines: number; replaced: number }> {
  const seen = new Set<string>();
  const clean = lines
    .map((e) => ({ sheet: e.sheet.replace(/\s+/g, " ").trim(), channel: e.channel.replace(/\s+/g, " ").trim() }))
    .filter((e) => e.sheet && e.channel && !e.sheet.endsWith("*"))
    .filter((e) => { const k = e.sheet.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  await setSetting(MAP_KEY, clean.length ? JSON.stringify(clean) : null);
  return { lines: clean.length, replaced: await remapFlfSignups(false) };
}

// ── matching ─────────────────────────────────────────────────────────────────

export type CandidateLead = MatchLead & NonNullable<LinkedLead>;

/** The Lead Docket leads any of these sign-ups could be: same phone, or same name. */
export async function candidateLeads(signups: FlfSignup[]): Promise<CandidateLead[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const phones = Array.from(new Set(signups.map((s) => s.phoneKey).filter((p): p is string => !!p)));
  const names = Array.from(new Set(signups.map((s) => nameKeyOf(s.clientName)).filter(Boolean)));
  const emails = Array.from(new Set(signups.map((s) => s.emailKey).filter((e): e is string => !!e)));
  // The Lead Docket sync adds emailHash when it next runs; until then there's nothing to match by email.
  const [ecol] = (await db.execute(sql`SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaddocket_leads' AND COLUMN_NAME = 'emailHash'`)) as unknown as [{ n: number }[]];
  const hasEmail = Number(ecol[0]?.n) > 0;
  const out = new Map<number, CandidateLead>();
  type Row = { leadId: number; clientName: string | null; phoneKey: string | null; emailHash: string | null; day: Date | string | null; marketingSource: string | null; teamRole: string | null; teamRep: string | null };
  const read = async (where: ReturnType<typeof sql>) => {
    const [rows] = (await db.execute(sql`SELECT leadId, clientName, phoneKey, ${hasEmail ? sql`emailHash` : sql`NULL AS emailHash`}, COALESCE(signedUpDate, leadDate) AS day, marketingSource, teamRole, teamRep
      FROM leaddocket_leads WHERE ${where}`)) as unknown as [Row[]];
    for (const r of rows) {
      const t = utcDate(r.day);
      const day = t ? formatInTimeZone(t, TZ, "yyyy-MM-dd") : null;
      out.set(Number(r.leadId), { leadId: Number(r.leadId), clientName: r.clientName, phoneKey: r.phoneKey, emailKey: r.emailHash, day, marketingSource: r.marketingSource, teamRole: r.teamRole, teamRep: r.teamRep });
    }
  };
  for (let i = 0; i < phones.length; i += 500) {
    await read(sql`phoneKey IN (${sql.join(phones.slice(i, i + 500).map((p) => sql`${p}`), sql`, `)})`);
  }
  if (hasEmail) {
    for (let i = 0; i < emails.length; i += 500) {
      await read(sql`emailHash IN (${sql.join(emails.slice(i, i + 500).map((e) => sql`${e}`), sql`, `)})`);
    }
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

    // Emails are compared as hashes on both sides; the address is never stored.
    const hash = (e: string | null) => (e ? createHash("sha256").update(e).digest("hex") : null);
    signups = signups.map((s) => ({ ...s, emailKey: hash(s.emailKey) }));
    const candidates = await candidateLeads(signups);
    const matches = matchSignups(signups, candidates);
    const byId = new Map(candidates.map((l) => [l.leadId, l]));
    const map = await getSourceMap();
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.transaction(async (tx) => {
      if (full) {
        // Every month tab was read: a month no longer in the sheet goes too.
        await tx.execute(sql`DELETE FROM flf_signups WHERE tabMonth NOT IN (${sql.join(months.map((mo) => sql`${mo}`), sql`, `)})`);
      }
      await tx.execute(sql`DELETE FROM flf_signups WHERE tabMonth IN (${sql.join(months.map((mo) => sql`${mo}`), sql`, `)})`);
      for (let i = 0; i < signups.length; i += 500) {
        const values = signups.slice(i, i + 500).map((s, j) => {
          const hit = matches[i + j];
          const at = placeSignup(s, hit ? byId.get(hit.leadId) ?? null : null, map, channelOfSource);
          return sql`(${s.tabMonth}, ${s.rowNo}, ${countMonthOf(s)}, ${s.signDay}, ${cut(s.source, 120)}, ${cut(s.leadSource, 255)},
            ${cut(s.intaker, 120)}, ${cut(s.signedUpBy, 120)}, ${cut(s.referralStatus, 255)}, ${cut(s.outcome, 60)}, ${s.kind},
            ${cut(s.value, 60)}, ${cut(s.rank, 60)}, ${cut(s.clientName, 255)}, ${cut(s.caseType, 120)}, ${cut(s.caseNumber, 60)},
            ${s.phoneKey}, ${s.emailKey}, ${hit?.leadId ?? null}, ${hit?.by ?? null},
            ${cut(at.marketingSource ?? "", 255)}, ${at.teamRole}, ${cut(at.teamRep ?? "", 120)})`;
        });
        await tx.execute(sql`INSERT INTO flf_signups (tabMonth, rowNo, countMonth, signDay, source, leadSource, intaker, signedUpBy,
          referralStatus, outcome, kind, caseValue, caseRank, clientName, caseType, caseNumber, phoneKey, emailHash, leadId, matchedBy,
          reportSource, reportTeamRole, reportTeamRep)
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

// ── placing rows again ───────────────────────────────────────────────────────

/**
 * Work out again where each sign-up counts — after the mapping changes, or
 * for rows written without a placement (by the sync before placements
 * existed). `onlyMissing` touches just those. Returns how many rows changed.
 */
export async function remapFlfSignups(onlyMissing = false): Promise<number> {
  await ensureFlfTable();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [rows] = (await db.execute(sql`SELECT f.id, f.source, f.leadSource, f.signedUpBy, f.reportSource, f.reportTeamRole, f.reportTeamRep,
      l.marketingSource, l.teamRole, l.teamRep, f.leadId
    FROM flf_signups f LEFT JOIN leaddocket_leads l ON l.leadId = f.leadId
    ${onlyMissing ? sql`WHERE f.reportSource IS NULL AND f.reportTeamRole IS NULL` : sql``}`)) as unknown as [{
      id: number; source: string | null; leadSource: string | null; signedUpBy: string | null;
      reportSource: string | null; reportTeamRole: string | null; reportTeamRep: string | null;
      marketingSource: string | null; teamRole: string | null; teamRep: string | null; leadId: number | null;
    }[]];
  const map = await getSourceMap();
  const changed: { id: number; src: string | null; role: string | null; rep: string | null }[] = [];
  for (const r of rows) {
    const lead = r.leadId != null ? { marketingSource: r.marketingSource, teamRole: r.teamRole, teamRep: r.teamRep } : null;
    const at = placeSignup({ source: r.source ?? "", leadSource: r.leadSource ?? "", signedUpBy: r.signedUpBy ?? "" }, lead, map, channelOfSource);
    const src = at.marketingSource ? cut(at.marketingSource, 255) : null, rep = at.teamRep ? cut(at.teamRep, 120) : null;
    if (src !== r.reportSource || at.teamRole !== r.reportTeamRole || rep !== r.reportTeamRep) changed.push({ id: Number(r.id), src, role: at.teamRole, rep });
  }
  for (let i = 0; i < changed.length; i += 500) {
    const b = changed.slice(i, i + 500);
    const ids = sql.join(b.map((c) => sql`${c.id}`), sql`, `);
    const caseOf = (pick: (c: (typeof b)[number]) => string | null) => sql`CASE id ${sql.join(b.map((c) => sql`WHEN ${c.id} THEN ${pick(c)}`), sql` `)} END`;
    await db.execute(sql`UPDATE flf_signups SET reportSource = ${caseOf((c) => c.src)}, reportTeamRole = ${caseOf((c) => c.role)},
      reportTeamRep = ${caseOf((c) => c.rep)} WHERE id IN (${ids})`);
  }
  return changed.length;
}
