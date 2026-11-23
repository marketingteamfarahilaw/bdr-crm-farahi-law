/**
 * The Data audit's reconciliation of the FLF Sign Up History sheet with Lead
 * Docket, for one month and every channel (or the digital ones):
 *
 * - Missing in Lead Docket: sheet sign-ups linked to no lead. The report
 *   still counts them, under the sheet's channel.
 * - Missing from the FLF sheet: leads Lead Docket marks signed in the month
 *   that no sheet row is linked to. The report doesn't count them as sign-ups.
 * - Differs: linked sign-ups whose date or channel Lead Docket has otherwise,
 *   or that Lead Docket doesn't show as signed. The report goes by the sheet.
 *
 * It lists clients by name, as the report's drill-downs do; no intake case
 * facts (Lead Docket's sub-status) are read.
 */
import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { ensureFlfTable, getFlfSyncStatus } from "./flfSignups";
import { utcDate } from "@shared/flfSignups";
import { isSigned } from "./signupsReport";
import { TZ, isDigitalSource, monthBounds, rowNameOf, sourceOf } from "./marketing/common";

const dayOf = (d: Date | string | null) => { const t = utcDate(d); return t ? formatInTimeZone(t, TZ, "yyyy-MM-dd") : null; };
const channelOf = (marketingSource: string | null, teamRole: string | null) => rowNameOf(sourceOf({ marketingSource, teamRole }), "channel");
const kindLabel = (k: string) => (k === "referred" ? "Signed referred out" : "Signed in-house");

export type MissingInLd = { id: number; name: string; day: string | null; sheetSource: string; leadSource: string; channel: string; kind: string; caseType: string; signedUpBy: string };
export type MissingFromSheet = { leadId: number; name: string; day: string | null; channel: string; source: string; rep: string | null; outcome: string };
export type Differs = {
  id: number; leadId: number; name: string; matchedBy: string;
  sheetDay: string | null; ldDay: string | null; sheetChannel: string; ldChannel: string;
  ldStatus: string; dateDiffers: boolean; channelDiffers: boolean; notSignedInLd: boolean;
};

export async function getFlfReconciliation(input: { month: string; digital?: boolean }) {
  const db = await getDb();
  if (!db) return null;
  await ensureFlfTable();
  const { month, digital = false } = input;
  const { start, end } = monthBounds(month);
  const keep = (...sources: (string | null)[]) => !digital || sources.some((s) => !!s && isDigitalSource(s));

  type SheetRow = {
    id: number; clientName: string; signDay: string | null; source: string | null; leadSource: string | null; kind: string;
    caseType: string | null; signedUpBy: string | null; reportSource: string | null; reportTeamRole: string | null; leadId: number | null; matchedBy: string | null;
    ldSigned: Date | string | null; ldOutcome: string | null; ldStatus: string | null; ldSource: string | null; ldRole: string | null;
  };
  const [[sheet], [ldSigned]] = (await Promise.all([
    db.execute(sql`SELECT f.id, f.clientName, f.signDay, f.source, f.leadSource, f.kind, f.caseType, f.signedUpBy, f.reportSource, f.reportTeamRole,
        f.leadId, f.matchedBy, l.signedUpDate AS ldSigned, l.outcome AS ldOutcome, l.status AS ldStatus, l.marketingSource AS ldSource, l.teamRole AS ldRole
      FROM flf_signups f LEFT JOIN leaddocket_leads l ON l.leadId = f.leadId
      WHERE f.countMonth = ${month} ORDER BY f.signDay, f.tabMonth, f.rowNo`),
    // A signed lead's leadDate is its sign-up date (sync-leaddocket.mjs), so this is "signed in the month".
    db.execute(sql`SELECT ld.leadId, ld.clientName, ld.leadDate, ld.outcome, ld.marketingSource, ld.teamRole, ld.teamRep
      FROM leaddocket_leads ld
      WHERE ld.leadDate >= ${start} AND ld.leadDate < ${end}
        AND LOWER(TRIM(REPLACE(COALESCE(ld.outcome, ''), '_', ' '))) IN ('signed', 'signed referred out', 'referral accepted')
        AND NOT EXISTS (SELECT 1 FROM flf_signups fx WHERE fx.leadId = ld.leadId)
      ORDER BY ld.leadDate`),
  ])) as unknown as [[SheetRow[]], [{ leadId: number; clientName: string | null; leadDate: Date | string; outcome: string | null; marketingSource: string | null; teamRole: string | null; teamRep: string | null }[]]];

  const missingInLd: MissingInLd[] = [];
  const differs: Differs[] = [];
  let matched = 0, counted = 0;
  for (const r of sheet) {
    if (!keep(r.reportSource, r.leadSource, r.source, r.ldSource)) continue;
    counted++;
    const sheetChannel = channelOf(r.reportSource, r.reportTeamRole);
    if (r.leadId == null) {
      missingInLd.push({
        id: Number(r.id), name: r.clientName, day: r.signDay, sheetSource: r.source ?? "", leadSource: r.leadSource ?? "",
        channel: sheetChannel, kind: kindLabel(r.kind), caseType: r.caseType ?? "", signedUpBy: r.signedUpBy ?? "",
      });
      continue;
    }
    matched++;
    const notSignedInLd = !isSigned(r.ldOutcome);
    const ldDay = notSignedInLd ? null : dayOf(r.ldSigned);
    const ldChannel = channelOf(r.ldSource, r.ldRole);
    const dateDiffers = !notSignedInLd && !!ldDay && !!r.signDay && ldDay !== r.signDay;
    const channelDiffers = ldChannel !== sheetChannel;
    if (dateDiffers || channelDiffers || notSignedInLd) {
      differs.push({
        id: Number(r.id), leadId: Number(r.leadId), name: r.clientName, matchedBy: r.matchedBy ?? "",
        sheetDay: r.signDay, ldDay, sheetChannel, ldChannel, ldStatus: [r.ldOutcome, r.ldStatus].filter(Boolean).join(" · "),
        dateDiffers, channelDiffers, notSignedInLd,
      });
    }
  }

  const missingFromSheet: MissingFromSheet[] = ldSigned
    .filter((l) => keep(l.marketingSource))
    .map((l) => ({
      leadId: Number(l.leadId), name: l.clientName?.trim() || `Lead ${l.leadId}`, day: dayOf(l.leadDate),
      channel: channelOf(l.marketingSource, l.teamRole), source: l.marketingSource ?? "",
      rep: l.teamRole === "BDR" || l.teamRole === "FR" ? `${l.teamRole} ${l.teamRep ?? ""}`.trim() : null, outcome: l.outcome ?? "",
    }));

  const status = await getFlfSyncStatus();
  return {
    month, digital, syncedAt: status.lastSuccessAt, syncError: status.error,
    totals: { sheet: counted, matched, missingInLd: missingInLd.length, missingFromSheet: missingFromSheet.length, differs: differs.length },
    missingInLd, missingFromSheet, differs,
  };
}
