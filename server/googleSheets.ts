/**
 * Read the team's Google Sheets directly, so nobody has to download and upload
 * workbooks by hand.
 *
 * Google will export a whole spreadsheet as .xlsx over plain HTTP when the file
 * is link-readable, which means the existing Excel importers work unchanged —
 * the only difference is where the bytes come from. A sheet that still requires
 * a login returns HTML instead of a spreadsheet; that is reported as a clear
 * "not shared" error rather than being parsed as a corrupt file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The workbooks the CRM reads. Ids come from the sheet URL. */
export const SHEETS = {
  centralized: {
    id: process.env.GSHEET_CENTRALIZED_ID || "1duZo7gJ-eW0ZB08-VxYH_Z-0MiRYRBRnXKeoQvoylNw",
    label: "Centralized BDR/FR Reports",
  },
  intake: {
    id: process.env.GSHEET_INTAKE_ID || "1_PLPrmmOv0KIyuqd_e2AaDKpLWYFvq4byj4DFdAB49k",
    label: "FLF Sign-up / Intake sheet",
  },
} as const;

export type SheetKey = keyof typeof SHEETS;

const exportUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;

/**
 * Download a workbook to a temp file and return its path. The caller deletes it.
 * Throws with a readable message when the sheet is not shared.
 */
export async function downloadWorkbook(key: SheetKey): Promise<{ file: string; bytes: number }> {
  const sheet = SHEETS[key];
  const res = await fetch(exportUrl(sheet.id), { redirect: "follow" });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `"${sheet.label}" is not shared for reading. In Google Sheets: Share → General access → ` +
      `"Anyone with the link" → Viewer. (id ${sheet.id})`
    );
  }
  if (!res.ok) throw new Error(`"${sheet.label}" download failed — HTTP ${res.status}`);

  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    throw new Error(`"${sheet.label}" returned a sign-in page, so it is not link-readable yet.`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`"${sheet.label}" download looks empty (${buf.length} bytes).`);

  const file = path.join(os.tmpdir(), `gsheet-${key}-${Date.now()}.xlsx`);
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

/** Whether each configured sheet is currently readable — used by the settings page. */
export async function checkSheets(): Promise<{ key: SheetKey; label: string; ok: boolean; detail: string }[]> {
  const out: { key: SheetKey; label: string; ok: boolean; detail: string }[] = [];
  for (const key of Object.keys(SHEETS) as SheetKey[]) {
    try {
      const res = await fetch(exportUrl(SHEETS[key].id), { method: "HEAD", redirect: "follow" });
      const ok = res.ok && !(res.headers.get("content-type") ?? "").includes("text/html");
      out.push({ key, label: SHEETS[key].label, ok, detail: ok ? "readable" : `HTTP ${res.status} — not shared for reading` });
    } catch (e: any) {
      out.push({ key, label: SHEETS[key].label, ok: false, detail: e?.message ?? "unreachable" });
    }
  }
  return out;
}
