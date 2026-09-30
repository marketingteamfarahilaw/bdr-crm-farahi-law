/**
 * What the Digital Marketing Report needs from Lead Docket beyond the Marketing
 * Report's fields, and where the app keeps it on leaddocket_leads:
 *
 *   caseValue       Lead Docket's "Case Value" (Low / Medium / High / Rank X /
 *                   Rank U), which the digital team reports sign-ups by
 *   incidentDate    the accident's Pacific day, and
 *   relatedLeadIds  the leads intake linked to it (driver, passengers…) — the
 *                   same two fields lead_intake keeps for the BD/FR team, so the
 *                   report's "Sign-up Unique Count" can reuse accidentKeys()
 *
 * Shared by sync-leaddocket.mjs (which writes them) and the server (which reads
 * them), so the column definitions can't drift apart — as leaddocket-liability.mjs.
 */

// ASSUMPTION: Youssef confirmed Case Value is a Lead Docket field (2026-09-30),
// but nothing in this repo shows its exact label or where the lead-detail JSON
// (/api/Leads/{id}) puts it. So, as for the liability status, the whole lead is
// searched for a label that, reduced to lower-case letters, is "casevalue" —
// or failing that contains it ("Case Value Category", "Estimated Case Value") —
// whether it is a custom field object ({ Name, Value }) or a plain property
// (CaseValue: "High"). Check the stored column after the first sync.

const letters = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const TARGET = "casevalue";

/** How well a label names the field: 2 exact, 1 contains it, 0 no. */
function rank(label) {
  const l = letters(label);
  if (l === TARGET) return 2;
  return l.includes(TARGET) ? 1 : 0;
}

const LABEL_KEYS = ["Name", "FieldName", "Label", "DisplayName", "Title", "CustomFieldName", "Caption", "Key"];
const VALUE_KEYS = ["Value", "DisplayValue", "ValueText", "TextValue", "FieldValue", "SelectedValue", "Answer", "Text", "Values"];

/** A field value as text: lists joined, option objects by their name. */
function asText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object") return asText(v.Name ?? v.Value ?? v.DisplayValue ?? v.Text ?? v.Title ?? "");
  if (typeof v === "boolean") return "";
  return String(v).replace(/\s+/g, " ").trim();
}

/** The report's five picks, whatever case or spacing Lead Docket writes them in ("rank-x", "MEDIUM"). */
const PICKS = new Map([["low", "Low"], ["medium", "Medium"], ["high", "High"], ["rankx", "Rank X"], ["ranku", "Rank U"]]);

/** One of Low / Medium / High / Rank X / Rank U, else the value as written (40 characters at most); null when blank. */
export function normalizeCaseValue(v) {
  const text = asText(v);
  if (!text) return null;
  return PICKS.get(letters(text)) ?? text.slice(0, 40);
}

/**
 * The lead's Case Value, or null when Lead Docket has none. `lead` is the
 * detail record (the Data of /api/Leads/{id}).
 */
export function caseValueFrom(lead) {
  let best = null;   // { rank, value }
  const offer = (r, v) => {
    const value = normalizeCaseValue(v);
    if (r > 0 && value && (!best || r > best.rank)) best = { rank: r, value };
  };
  const seen = new Set();
  const walk = (o, depth) => {
    if (o == null || typeof o !== "object" || depth > 8 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    // A field object: { Name: "Case Value", Value: "High" } (or the label one level down).
    const labelKey = LABEL_KEYS.find((k) => typeof o[k] === "string" && o[k].trim());
    const label = labelKey ? o[labelKey] : (o.Field ?? o.CustomField)?.Name;
    if (typeof label === "string" && label) {
      const valueKey = VALUE_KEYS.find((k) => k in o && k !== labelKey);
      if (valueKey) offer(rank(label), o[valueKey]);
    }
    // A plain property: { CaseValue: "High" }
    for (const [k, v] of Object.entries(o)) {
      if (v == null || typeof v !== "object") offer(rank(k), v);
      else walk(v, depth + 1);
    }
  };
  walk(lead, 0);
  return best ? best.value : null;
}

/**
 * Columns added to leaddocket_leads at runtime: deploys run no migrations, so
 * whichever of the sync or the server gets there first adds them.
 */
export const DIGITAL_COLUMNS = [
  ["caseValue", "VARCHAR(40) NULL"],
  ["incidentDate", "VARCHAR(10) NULL"],
  ["relatedLeadIds", "VARCHAR(500) NULL"],
];

/**
 * Add the columns if they are missing. `query(sql)` runs one statement and
 * returns its rows. Safe to run from two processes at once: a "duplicate"
 * error from the loser means the other already added it.
 */
export async function ensureDigitalColumns(query) {
  const dup = (e) => /duplicate/i.test(String(e?.message ?? e)) || e?.errno === 1060;
  const cols = await query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaddocket_leads'",
  );
  const have = new Set(cols.map((r) => String(r.name ?? r.COLUMN_NAME)));
  for (const [name, type] of DIGITAL_COLUMNS) {
    if (have.has(name)) continue;
    try { await query(`ALTER TABLE leaddocket_leads ADD COLUMN \`${name}\` ${type}`); } catch (e) { if (!dup(e)) throw e; }
  }
}
