/**
 * Lead Docket's "Status of Liability During Intake" — a custom field intake
 * fills in on the lead's Incident Info section — and where the app keeps it.
 *
 * Shared by sync-leaddocket.mjs (which writes it) and the server (which reads
 * it for the Intake case page), so the column definitions can't drift apart.
 *
 * It is an intake case fact: only the Intake side (canSeeIntake) may read it.
 * It lives on leaddocket_leads, which the Marketing Report reads, but every
 * marketing query names its columns, so BD/FR never receive it.
 */

// ASSUMPTION: nothing in this repo shows how Lead Docket's lead-detail JSON
// (/api/Leads/{id}) lays out custom fields — no sample payload, fixture or doc.
// Lead Docket custom fields generally come back as objects carrying a label
// (Name / FieldName / Label / DisplayName…) and a value (Value / DisplayValue…),
// nested in a list or a section, and admins rename and re-space labels freely.
// So the whole lead is searched for a label that, reduced to lower-case letters,
// is "statusofliabilityduringintake"; failing that, the closest label that
// mentions liability (see RANK). A plain property named like the field
// (StatusOfLiabilityDuringIntake: "…") is accepted too. Confirm against a real
// lead: `node scripts/migration/sync-leaddocket.mjs --dry --limit 1` does not
// print it, so check the stored column after the first run.

const letters = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const TARGET = "statusofliabilityduringintake";
// Labels about coverage or a kind of case, not the intake's view of fault.
const NOT_IT = /insurance|carrier|polic|limit|coverage|product|premises|adjuster|claim/;

/** How well a label names the field: 3 exact, 2 liability + status/intake, 1 liability, 0 no. */
function rank(label) {
  const l = letters(label);
  if (!l.includes("liability")) return 0;
  if (l === TARGET) return 3;
  if (NOT_IT.test(l)) return 0;
  return /status|intake/.test(l) ? 2 : 1;
}

const LABEL_KEYS = ["Name", "FieldName", "Label", "DisplayName", "Title", "CustomFieldName", "Caption", "Key"];
const VALUE_KEYS = ["Value", "DisplayValue", "ValueText", "TextValue", "FieldValue", "SelectedValue", "Answer", "Text", "Values"];

/** A field value as text: lists joined, option objects by their name. */
function asText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (typeof v === "object") return asText(v.Name ?? v.Value ?? v.DisplayValue ?? v.Text ?? v.Title ?? "");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * The lead's "Status of Liability During Intake", or null when Lead Docket has
 * none. `lead` is the detail record (the Data of /api/Leads/{id}).
 */
export function liabilityStatusFrom(lead) {
  let best = null;   // { rank, value }
  const offer = (r, v) => {
    const value = asText(v);
    if (r > 0 && value && (!best || r > best.rank)) best = { rank: r, value };
  };
  const seen = new Set();
  const walk = (o, depth) => {
    if (o == null || typeof o !== "object" || depth > 8 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    // A field object: { Name: "Status of Liability During Intake", Value: "…" }
    // (or with the label one level down: { Field: { Name: "…" }, Value: "…" })
    const labelKey = LABEL_KEYS.find((k) => typeof o[k] === "string" && o[k].trim());
    const label = labelKey ? o[labelKey] : (o.Field ?? o.CustomField)?.Name;
    if (typeof label === "string" && label) {
      const valueKey = VALUE_KEYS.find((k) => k in o && k !== labelKey);
      if (valueKey) offer(rank(label), o[valueKey]);
    }
    // A plain property: { StatusOfLiabilityDuringIntake: "…" }
    for (const [k, v] of Object.entries(o)) {
      if (v == null || typeof v !== "object") offer(rank(k), v);
      else walk(v, depth + 1);
    }
  };
  walk(lead, 0);
  return best ? best.value.slice(0, 255) : null;
}

/** The last ten digits of a phone number — how the Intake side matches callers. */
export const phoneKey = (s) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * Columns added to leaddocket_leads at runtime: deploys run no migrations, so
 * whichever of the sync or the server gets there first adds them.
 */
export const LIABILITY_COLUMNS = [
  ["liabilityStatus", "VARCHAR(255) NULL"],
  ["phoneKey", "VARCHAR(10) NULL"],
];
export const PHONE_INDEX = ["leaddocket_leads_phoneKey", "phoneKey"];

/**
 * Add the columns (and the phone index) if they are missing. `query(sql)` runs
 * one statement and returns its rows (everything here is a constant, so no
 * parameters). Safe to run from two processes at once: a "duplicate" error
 * from the loser means the other already added it.
 */
export async function ensureLiabilityColumns(query) {
  const dup = (e) => /duplicate/i.test(String(e?.message ?? e)) || e?.errno === 1060 || e?.errno === 1061;
  const cols = await query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaddocket_leads'",
  );
  const have = new Set(cols.map((r) => String(r.name ?? r.COLUMN_NAME)));
  for (const [name, type] of LIABILITY_COLUMNS) {
    if (have.has(name)) continue;
    try { await query(`ALTER TABLE leaddocket_leads ADD COLUMN \`${name}\` ${type}`); } catch (e) { if (!dup(e)) throw e; }
  }
  const [indexName, column] = PHONE_INDEX;
  const idx = await query(
    `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaddocket_leads' AND INDEX_NAME = '${indexName}'`,
  );
  if (!idx.length) {
    try { await query(`CREATE INDEX \`${indexName}\` ON leaddocket_leads (\`${column}\`)`); } catch (e) { if (!dup(e)) throw e; }
  }
}
