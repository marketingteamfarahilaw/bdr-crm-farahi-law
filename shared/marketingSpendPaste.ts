/**
 * Reads spend pasted from a spreadsheet: one "name, amount" per line.
 *
 * Excel and Google Sheets copy a two-column range as tab-separated lines, and
 * budget notes are usually "Name, $4,500". The name runs up to the first tab,
 * comma or semicolon after which the rest of the line is only an amount, so a
 * name with a comma in it ("Smith, Jones & Co, 1,200") stays whole. It lives in
 * shared so the spend editor's preview is exactly what vitest checks.
 *
 * A line with no separator before its amount ("Google Ads $2,500") would
 * otherwise split at the amount's own thousands comma and save $500 under
 * "Google Ads $2". A comma right after a digit and right before a 3-digit group
 * can't be told apart from a thousands comma, so that line is listed as
 * unreadable instead; a tab, "; ", or ", " after the name reads it.
 */

export type SpendPaste = {
  rows: { line: number; source: string; amount: number }[];
  bad: { line: number; text: string }[];   // lines that aren't "name <tab/comma/semicolon> amount"
};

const LINE = /^(.*?)([\t,;])(\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*)$/;
// What follows a thousands comma: 3-digit groups, maybe cents, nothing else.
const THOUSANDS_TAIL = /^\d{3}(?:,\d{3})*(?:\.\d{1,2})?\s*$/;

// The limits setSpendMany accepts. A line past them is a mis-paste (a date, a
// phone number), so it is listed as unreadable rather than failing the save.
const MAX_NAME = 255;
const MAX_AMOUNT = 10_000_000;

export function parseSpendPaste(text: string): SpendPaste {
  const out: SpendPaste = { rows: [], bad: [] };
  String(text ?? "").split(/\r\n|\r|\n/).forEach((raw, n) => {
    if (!raw.trim()) return;
    const line = n + 1;
    const found = LINE.exec(raw);
    const m = found && !(found[2] === "," && /\d$/.test(found[1]) && THOUSANDS_TAIL.test(found[3])) ? found : null;
    // A quoted CSV cell keeps its quotes when copied; the name is what's inside.
    const source = m ? m[1].replace(/\s+/g, " ").trim().replace(/^"(.*)"$/, "$1").trim() : "";
    const digits = m ? m[4].replace(/,/g, "") : "";
    const amount = Number(digits);
    if (!source || source.length > MAX_NAME || !/\d/.test(digits) || !Number.isFinite(amount) || amount > MAX_AMOUNT) {
      out.bad.push({ line, text: raw.trim() });
      return;
    }
    out.rows.push({ line, source, amount: Math.round(amount * 100) / 100 });
  });
  return out;
}
