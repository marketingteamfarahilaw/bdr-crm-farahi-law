/**
 * The FLF sign-up sheet for the Digital Marketing Report's "Sign-up sheet"
 * tab: its Current Month tab read live from Google Sheets (the same sheet the
 * marketing sync compares, googleSheets.ts → SHEETS.marketing). Kept in memory
 * for a few minutes so opening the tab doesn't download it every time; the
 * tab's Refresh button asks for a fresh copy.
 *
 * Nothing is stored. Intake case facts are dropped here for anyone without
 * marketingCaseFacts — the hard wall in CLAUDE.md — and phone and email are
 * never read from the sheet at all.
 */
import fs from "node:fs";
import xlsx from "xlsx";
import { SIGNUP_LOG_TAB, readSignupSheet, type Cell, type SignupSheetRow } from "@shared/digitalSheet";
import { downloadWorkbook, SHEETS } from "./googleSheets";

const FRESH_FOR_MS = 5 * 60 * 1000;
type Cached = { at: number; tab: string; rows: SignupSheetRow[] };
let cache: Cached | null = null;
let loading: Promise<Cached> | null = null;

async function load(): Promise<Cached> {
  const { file } = await downloadWorkbook("marketing");
  try {
    const tabs = xlsx.readFile(file, { bookSheets: true }).SheetNames;
    const tab = tabs.find((t) => t.trim().toLowerCase() === SIGNUP_LOG_TAB.toLowerCase()) ?? tabs[0];
    if (!tab) throw new Error(`"${SHEETS.marketing.label}" has no tabs.`);
    const rows = xlsx.utils.sheet_to_json<Cell[]>(xlsx.readFile(file, { sheets: [tab] }).Sheets[tab], { header: 1, raw: true, defval: null, blankrows: true });
    const signups = readSignupSheet(rows);
    if (!signups) throw new Error(`Tab "${tab}" of "${SHEETS.marketing.label}" has no Lead Outcome / Client's Name columns.`);
    return { at: Date.now(), tab, rows: signups };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

export async function getSignupSheet(opts: { fresh: boolean; caseFacts: boolean }) {
  if (opts.fresh || !cache || Date.now() - cache.at > FRESH_FOR_MS) {
    // One download at a time, however many people open the tab at once.
    loading ??= load().finally(() => { loading = null; });
    cache = await loading;
  }
  const c: Cached = cache;
  return {
    sheet: SHEETS.marketing.label,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEETS.marketing.id}/edit`,
    tab: c.tab,
    fetchedAt: new Date(c.at).toISOString(),
    caseFacts: opts.caseFacts,
    rows: opts.caseFacts ? c.rows : c.rows.map((r) => ({ ...r, facts: null })),
  };
}
