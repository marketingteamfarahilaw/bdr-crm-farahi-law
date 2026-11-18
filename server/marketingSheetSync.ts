/**
 * The digital marketing team's daily sheet ("MTD Performance Summary", one tab
 * per day) read straight from Google Sheets on a schedule, and compared with
 * Lead Docket the way the Audit tab compares an uploaded copy. Each comparison
 * goes into the running variance log (varianceLog.ts), so the log keeps itself
 * current without anyone uploading the file.
 *
 * The tab compared is today's (Pacific), or the most recent day before it in
 * the last week when today's isn't there yet; the period is that day's month
 * to date, as the sheet is. A comparison is logged only when its differences
 * changed since the last one this sync logged — the log lists every saved
 * comparison, and one every few minutes would bury the uploads.
 *
 * Read only: nothing is written but the variance log and the sync's status.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import xlsx from "xlsx";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { parseSheet, sheetVariances, tabForDay, type Cell, type NameReason } from "@shared/digitalSheet";
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
    const picked = pickTab(tabs, today);
    if (!picked) {
      return { ok: false, summary: `No tab for ${today} or the ${LOOK_BACK_DAYS} days before it this month (looked for "${tabForDay(today)}" and earlier). The workbook's last tab is "${tabs[tabs.length - 1] ?? "none"}".` };
    }
    const wb = xlsx.readFile(file, { sheets: [picked.tab] });
    const rows = xlsx.utils.sheet_to_json<Cell[]>(wb.Sheets[picked.tab], { header: 1, raw: true, defval: null, blankrows: true });
    const sheet = parseSheet(rows);
    if (!sheet.found.team) {
      return { ok: false, summary: `Tab "${picked.tab}" has no GBP / SEO / TOTAL table the comparison recognises.` };
    }

    const fromDay = `${picked.day.slice(0, 8)}01`, toDay = picked.day;
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

    const fingerprint = createHash("sha1").update(JSON.stringify([picked.tab, fromDay, toDay, compared])).digest("hex");
    const what = `tab ${picked.tab} (${fromDay} to ${toDay}), ${(bytes / 1048576).toFixed(1)} MB`;
    if ((await getSetting(LAST_KEY)) === fingerprint) {
      return { ok: true, summary: `Compared ${what}: ${compared.length} difference(s), unchanged since the last logged comparison.` };
    }
    await saveComparison({ fromDay, toDay, file: `${SHEETS.marketing.label} (Google Sheets)`, tab: picked.tab, by: "Scheduled sync" }, items);
    await setSetting(LAST_KEY, fingerprint);
    return { ok: true, summary: `Compared ${what}: ${compared.length} difference(s), logged to the Audit tab's variance log.` };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}
