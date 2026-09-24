/**
 * The rules that decide which Lead Docket leads are the BD/FR team's, and how
 * they are recorded. Shared by the sync and by the verifier, so the two can
 * never disagree — an earlier second copy of these rules drifted and caused a
 * real bug.
 */

// ── the team ────────────────────────────────────────────────────────────────
// Role is how the person is credited when the source carries no prefix.
// Current BDR: Ally, Grace, Miguel, Queenie. Current FR: Zulema, Lupe, Jezel,
// Genysys. Malvin Rosales is intake, but the leads he brings in count, as
// "Intake". The rest are former team members, kept so their past sign-ups stay
// in historical reporting.
export const TEAM = [
  ["Queenie Miranda", "BDR"],
  ["Ally Maceda", "BDR"],
  ["Miguel Flores", "BDR"],
  ["Grace Lanayon", "BDR"],
  ["John Bautista", "BDR"],
  ["Angelica Tobias", "BDR"],
  ["Jaque Solayao", "BDR"],
  ["Malvin Rosales", "Intake"],   // intake staff who also brings in leads — credited, under his own role
  ["Zulema Salas", "FR"],
  ["Lupe Campos", "FR"],
  ["Jezel Mercado", "FR"],
  ["Genysys Sanchez", "FR"],
];
const BY_FIRST = new Map(TEAM.map(([full, role]) => [full.split(" ")[0].toLowerCase(), { full, role }]));

/** Some fields come back as objects ({Id, Name, …}) rather than strings. */
export const str = (v) => {
  if (v == null) return "";
  if (typeof v === "object") return String(v.Name ?? v.Value ?? v.Title ?? "");
  return String(v);
};

const tidy = (s) => String(s).replace(/\s*[-–—].*$/, "").replace(/\s+/g, " ").trim();

/**
 * The roster spelling of a representative written in a spreadsheet: "Grace" →
 * "Grace Lanayon", "Jezel Mercadoo" → "Jezel Mercado". Reports group by name,
 * so a first name in one table and the full name in another split one person
 * in two. Stricter than canonical(): the first name must match exactly (no
 * "Angel" → Angelica), and a surname, if given, must start like the roster's.
 * Anything else — former reps, other staff — is returned as written.
 */
export function fullName(name) {
  const raw = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return raw;
  const [first, ...rest] = raw.toLowerCase().split(" ");
  const hit = BY_FIRST.get(first);
  if (!hit) return raw;
  const surname = hit.full.split(" ").slice(1).join(" ").toLowerCase();
  if (!rest.length || rest.join(" ").slice(0, 4) === surname.slice(0, 4)) return hit.full;
  return raw;
}

/** Map a bare or shortened first name onto the roster spelling ("Quee" → Queenie Miranda). */
export function canonical(name) {
  const first = String(name).trim().split(/\s+/)[0].toLowerCase();
  if (!first) return null;
  for (const [key, hit] of BY_FIRST) if (key.startsWith(first) || first.startsWith(key)) return hit;
  return null;
}

/**
 * The representative a lead is credited to, or null when it is not the team's.
 *
 *   "BDR Miguel Flores"                → BDR, Miguel Flores
 *   "Field Representative Lupe Campos" → FR,  Lupe Campos
 *   "Jezel Mercado BC - Sacramento"    → FR,  Jezel Mercado   (business card)
 *   "Malvin Rosales"                   → Intake, Malvin Rosales  (bare name)
 *
 * Marketing, intake, website and employee-referral sources name nobody on the
 * roster and return null.
 */
export function creditedRep(marketingSource) {
  const s = String(marketingSource ?? "").trim();
  if (!s) return null;

  // An explicit prefix wins, so someone tagged "BDR <name>" keeps that role.
  const bdr = s.match(/^BDR\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (bdr) { const hit = canonical(tidy(bdr[1])); return { role: "BDR", member: hit ? hit.full : tidy(bdr[1]) }; }

  const fr = s.match(/^(?:Field\s+Representative|FR)\s+(.+?)(?:\s+BC\b.*)?$/i);
  if (fr) { const hit = canonical(tidy(fr[1])); return { role: "FR", member: hit ? hit.full : tidy(fr[1]) }; }

  // Otherwise credit whoever on the roster is named anywhere in the source.
  for (const [full, role] of TEAM) {
    const pattern = new RegExp("\\b" + full.replace(/\s+/g, "\\s+") + "\\b", "i");
    if (pattern.test(s)) return { role, member: full };
  }
  return null;
}

/**
 * A sign-up is an event, not a current state. A client signed in February whose
 * case later moves to Closed or Lost was still a February sign-up — reading the
 * CURRENT status instead made past months' sign-ups shrink as cases closed. So
 * a lead with a SignedUpDate counts as signed whatever happened afterwards; the
 * current status is recorded separately so nothing is hidden.
 */
export const outcomeFor = (status, signedUpDate) => {
  const t = String(status ?? "").toLowerCase();
  // "Referred" means referred out to another firm. Only a lead signed first (it
  // has a sign-up date) is a sign-up — the team's scorecard counts the rest as
  // "Referred Out", and so do we. Counting them all added ~100 sign-ups.
  if (t === "referred") return signedUpDate ? "Signed Referred Out" : "Referred Out";
  if (signedUpDate || t.includes("signed up")) return "Signed";
  return String(status ?? "");
};
