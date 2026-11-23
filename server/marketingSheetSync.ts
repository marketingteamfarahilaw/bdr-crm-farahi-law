/**
 * The "Digital marketing sheet" job: the FLF Sign Up History sheet copied into
 * flf_signups (flfSignups.ts), which the Marketing Report counts sign-ups from
 * and the Data audit reconciles with Lead Docket (flfAudit.ts).
 *
 * It used to compare this month's digital sign-ups on the FLF sign-up sheet
 * with Lead Docket and log the differences; the Data audit's three lists,
 * covering every channel and any month, replaced that (Nov 23, 2026).
 */
import { syncFlfSignups } from "./flfSignups";

export async function runMarketingSheetSync(): Promise<{ ok: boolean; summary: string }> {
  try { return { ok: true, summary: await syncFlfSignups() }; }
  catch (e: any) { return { ok: false, summary: `FLF Sign Up History not read: ${e?.message ?? e}` }; }
}
