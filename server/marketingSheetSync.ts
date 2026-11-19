/**
 * The FLF sign-up sheet read straight from Google Sheets on a schedule, and
 * compared with Lead Docket the way the Audit tab compares an uploaded copy.
 * Each comparison goes into the running variance log (varianceLog.ts), so the
 * log keeps itself current without anyone uploading the file.
 *
 * The sheet logs every sign-up of the month on its "Current Month" tab; its
 * GBP ("GMB") and website sign-ups from the 1st to today (Pacific) are
 * compared (shared/digitalSheet.ts parseSignupLog). A workbook in the older
 * layout — one "MTD Performance Summary" tab per day — still works: today's
 * tab, or the latest day before it this month.
 *
 * A comparison is logged only when its differences changed since the last one
 * this sync logged — the log lists every saved comparison, and one every few
 * minutes would bury the uploads.
 *
 * Read only: nothing is written but the variance log and the sync's status.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import xlsx from "xlsx";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { SIGNUP_LOG_TAB, parseSheet, parseSignupLog, sheetVariances, tabForDay, type Cell, type NameReason, type ParsedSheet } from "@shared/digitalSheet";
import { downloadWorkbook, SHEETS } from "./googleSheets";
import { getDigitalMarketingReport, shiftDay } from "./digitalMarketing";
import { explainSheetNames } from "./sheetNames";
import { saveComparison } from "./varianceLog";
import { getSetting, setSetting } from "./db";
import { getStatus } from "./dataSync";

const TZ = "America/Los_Angeles";
/** How far back to look for a day's tab when today's isn't there yet (a weekend, a late update). */
const LOOK_BACK_DAYS = 7;
/** Older than this, the Lead Docket copy may be behind the sheet; logged as a "sync" difference, as the Audit tab does. */
const STALE_MS = 30 * 60 * 1000;
const LAST_KEY = "marketing_sheet_last_logged";

/** The newest day, today or up to a week back within this month, whose tab the workbook has. */
export function pickTab(tabs: string[], today: string): { day: string; tab: string } | null {
  const have = new Set(tabs.map((t) => t.trim()));
  for (let i = 0, day = today; i <= LOOK_BACK_DAYS; i++, day = shiftDay(today, -i)) {
    // The sheet is month to date: last month's final tab is a different period.
    if (day.slice(0, 7) !== today.slice(0, 7)) break;
    const tab = tabForDay(day);
    if (have.has(tab)) return { day, tab };
  }
  return null;
}

export async function runMarketingSheetSync(): Promise<{ ok: boolean; summary: string }> {
  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const { file, bytes } = await downloadWorkbook("marketing");
  try {
    const tabs = xlsx.readFile(file, { bookSheets: true }).SheetNames;
    const rowsOf = (tab: string) => xlsx.utils.sheet_to_json<Cell[]>(xlsx.readFile(file, { sheets: [tab] }).Sheets[tab], { header: 1, raw: true, defval: null, blankrows: true });
    let sheet: ParsedSheet, tab: string, fromDay: string, toDay: string;
    const logTab = tabs.find((t) => t.trim().toLowerCase() === SIGNUP_LOG_TAB.toLowerCase());
    if (logTab) {
      // The sign-up sheet: this month to today.
      fromDay = `${today.slice(0, 8)}01`; toDay = today; tab = logTab;
      const parsed = parseSignupLog(rowsOf(logTab), { fromDay, toDay });
      if (!parsed) return { ok: false, summary: `Tab "${logTab}" has no Lead Outcome / Client's Name columns the comparison recognises.` };
      sheet = parsed;
    } else {
      // The older layout: a tab per day.
      const picked = pickTab(tabs, today);
      if (!picked) {
        return { ok: false, summary: `No "${SIGNUP_LOG_TAB}" tab, and no day tab for ${today} or the ${LOOK_BACK_DAYS} days before it this month (looked for "${tabForDay(today)}" and earlier). The workbook's tabs: ${tabs.slice(-5).join(", ") || "none"}.` };
      }
      sheet = parseSheet(rowsOf(picked.tab));
      if (!sheet.found.team) return { ok: false, summary: `Tab "${picked.tab}" has no GBP / SEO / TOTAL table the comparison recognises.` };
      fromDay = `${picked.day.slice(0, 8)}01`; toDay = picked.day; tab = picked.tab;
    }

    const report = await getDigitalMarketingReport({
      from: fromZonedTime(`${fromDay}T00:00:00`, TZ), to: fromZonedTime(`${toDay}T23:59:59.999`, TZ), fromDay, toDay,
    }, today);
    if (!report) return { ok: false, summary: "The database is unavailable." };

    // Names only on the sheet, each with why it's missing — the same lookup the Audit tab makes.
    const onlySheetNames = sheetVariances(sheet, report).filter((v) => v.kind === "onlySheet").map((v) => v.name).slice(0, 200);
    const why = await explainSheetNames(onlySheetNames, { fromDay, toDay });
    const explained = new Map<string, NameReason>(why.names.map((n) => [n.name, n]));
    const ld = await getStatus("leaddocket");
    const syncedAt = ld.lastSuccessAt ? new Date(ld.lastSuccessAt).getTime() : 0;
    const stale = !syncedAt || Date.now() - syncedAt > STALE_MS || ld.state === "failed" || ld.state === "partial";
    // Staleness isn't part of what's compared, so it doesn't count as a change on its own.
    const items = sheetVariances(sheet, report, { explained, staleSync: stale ? { lastSuccessAt: ld.lastSuccessAt, state: ld.state } : null }).slice(0, 1000);
    const compared = items.filter((v) => v.kind !== "sync");

    const fingerprint = createHash("sha1").update(JSON.stringify([tab, fromDay, toDay, compared])).digest("hex");
    const what = `tab ${tab} (${fromDay} to ${toDay}), ${(bytes / 1048576).toFixed(1)} MB`;
    if ((await getSetting(LAST_KEY)) === fingerprint) {
      return { ok: true, summary: `Compared ${what}: ${compared.length} difference(s), unchanged since the last logged comparison.` };
    }
    await saveComparison({ fromDay, toDay, file: `${SHEETS.marketing.label} (Google Sheets)`, tab, by: "Scheduled sync" }, items);
    await setSetting(LAST_KEY, fingerprint);
    return { ok: true, summary: `Compared ${what}: ${compared.length} difference(s), logged to the Audit tab's variance log.` };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}
