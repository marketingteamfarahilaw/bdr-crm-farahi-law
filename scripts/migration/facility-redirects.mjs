/**
 * Where a merged or deleted facility's name and phone numbers point now
 * (facility_redirects, written by server/facilityMerge.ts): at the facility kept
 * in a merge, or at nothing (null) after a delete.
 *
 * The Google Sheets sync matches workbook rows to facilities by name and phone.
 * Without this, a merged-away duplicate or a deleted facility no longer matches
 * anything, so the sync re-creates it and hangs its history back on it. Each
 * script keeps its own lookups first — a live facility always wins — and asks
 * here only when those find nothing: a number means "that facility", null means
 * "it was deleted: no facility", undefined means "never heard of it".
 */
export async function loadRedirects(c) {
  try {
    const [rows] = await c.query("SELECT kind, value, facilityId FROM facility_redirects ORDER BY id DESC");
    return rows;
  } catch {
    return [];   // table not created yet: nothing merged or deleted from the app
  }
}

/** A lookup keyed the way the calling script keys names and phones. The newest redirect wins. */
export function redirectLookup(rows, { nameKey, phoneKey }) {
  const byName = new Map(), byPhone = new Map();
  for (const r of rows) {
    const map = r.kind === "name" ? byName : r.kind === "phone" ? byPhone : null;
    const k = map && (r.kind === "name" ? nameKey(r.value) : phoneKey(r.value));
    if (k && !map.has(k)) map.set(k, r.facilityId ?? null);
  }
  return (name, phone) => {
    const p = phone ? phoneKey(phone) : "";
    if (p && byPhone.has(p)) return byPhone.get(p);
    const n = name ? nameKey(name) : "";
    if (n && byName.has(n)) return byName.get(n);
    return undefined;
  };
}
