// Guard: subStatus is an intake case fact. It is shown only because canSeeMarketing is Youssef-only; if MARKETING_VIEWERS ever includes a BD/FR person, also require canSeeIntake (CLAUDE.md: hard wall between BD/FR and Intake).
/**
 * Why leads didn't sign: every lead in exactly one reason family, from Lead
 * Docket's status and sub-status.
 *
 * The scorecard column decides first — signed, still open and referred out are
 * families of their own — so each family adds back to a scorecard column, and
 * only Rejected (which holds Lost and Closed too) and Not Interested are split
 * by what the sub-status says. That split is what tells a marketing problem (no
 * viable claim, not a case we take, past the deadline, junk) from an intake one
 * (chose another firm or went quiet).
 *
 * Pure: works from derive()'s rows, so no new query. REASON_LABEL lives in
 * @shared/marketing so the page uses the same labels; it is re-exported here.
 */
import {
  NOT_VIABLE, NOT_VIABLE_KEYS, NO_SOURCE, REASON_KEYS, REASON_LABEL, TEAM_CHANNEL, clean, keyOf, pct,
  type Counts, type Lead, type ReasonKey, type ScoreBucket,
} from "./common";

export { REASON_LABEL };

/** What a lead with an empty sub-status is listed under. */
export const NO_REASON = "No reason recorded";

/**
 * Tried in order against "sub-status status", first match wins. The order
 * matters: "City Claim - SOL Lapsed" is too late, not a city claim; "Currently
 * has an Atty but had a General Inquiry" went elsewhere, not a general inquiry;
 * and "Rejected - PD Leads Only" is no viable claim only when its sub-status
 * doesn't say the client went quiet first.
 */
export const REASON_RULES: [ReasonKey, RegExp][] = [
  ["junk", /spam|robo ?call|wrong (number|contact)|invalid|disconnected|duplicate|fraud|hung up|^test\b/i],
  ["tooLate", /\bsol\b/i],
  ["lostThem", /hired another|no longer interested|no response|lost contact|did not sign|no show|no answer|has an atty|cease and desist/i],
  ["noClaim", /at fault|no injur|gap in treatment|parked vehicle|no treatment|disputed liability|uninsured|no um\/?uim|no insurance|settled with|\bpd only|minimal pd|pd leads only|self negligence|no def to go after|no same day er|total loss|already resolved|financial reasons/i],
  ["wrongArea", /not a pi case|med mal|employment|criminal|civil law|family law|tenant|immigration|work comp|general inquiry|product liability|defamation|city claim|indian territory|outside of usa|no-fault|complex lead|premises liability/i],
];

// Lead Docket has ~150 (outcome, status, sub-status) combinations but the
// dashboard classifies up to ~45k rows per request, so the regexes run once per
// combination. The cap only guards against a runaway pick-list.
const memo = new Map<string, ReasonKey>();
const MEMO_CAP = 5000;

export function reasonOf(bucket: ScoreBucket, status: string | null, subStatus: string | null): ReasonKey {
  if (bucket === "signedInHouse" || bucket === "signedReferred") return "signed";
  if (bucket === "open") return "open";
  if (bucket === "referredOut") return "referred";
  if (bucket === "notInterested") return "lostThem";
  // \u0001 can't appear in either field, so two different pairs never share a key.
  const key = `${bucket}\u0001${status ?? ""}\u0001${subStatus ?? ""}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const text = `${clean(subStatus)} ${clean(status)}`.trim();
  let family: ReasonKey | null = null;
  for (const [k, re] of REASON_RULES) if (re.test(text)) { family = k; break; }
  // A Lost lead with no telling sub-status still chose not to go ahead with us.
  if (!family) family = keyOf(clean(status)) === "lost" ? "lostThem" : "other";
  if (memo.size >= MEMO_CAP) memo.clear();
  memo.set(key, family);
  return family;
}

export type WhyNotSigned = {
  families: { key: ReasonKey; label: string; leads: number; share: number }[];   // all 9 keys in REASON_KEYS order; sum of leads = totals.leads
  funnel: { leads: number; notViable: number; viable: number; signed: number; viableRate: number; winRate: number; costPerViable: number | null };
  rows: { name: string; members: string[]; leads: number; signed: number; by: Record<ReasonKey, number>; other?: true }[];
  top: { reason: string; family: ReasonKey; leads: number; topRow: string; topRowShare: number }[];
  members: Record<ReasonKey, { reason: string; leads: number }[]>;
  insights: string[];
};

/** What whyNotSigned reads from a derived lead — a Lead has all of it. */
export type WhyLead = Pick<Lead, "name" | "source" | "signed" | "bucket" | "status" | "subStatus">;

const ROWS_SHOWN = 12;
const TOP_REASONS = 12;
export const ALL_OTHER = "All other";

const zeroBy = () => {
  const by = {} as Record<ReasonKey, number>;
  for (const k of REASON_KEYS) by[k] = 0;
  return by;
};
const sumOf = (by: Record<ReasonKey, number>, keys: readonly ReasonKey[]) => keys.reduce((a, k) => a + by[k], 0);
const n = (v: number) => v.toLocaleString("en-US");
const whole = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Shares (families[].share, viableRate, winRate, topRowShare) are percents with
 * one decimal, like the scorecard's conversion. Leads are counted in the row
 * derive() gave them, so rows match dashboard.sources by name and members.
 */
export function whyNotSigned(leads: WhyLead[], opts: { spendByRow?: Map<string, number>; spendTotal?: number } = {}): WhyNotSigned {
  type Row = { name: string; members: Set<string>; leads: number; signed: number; by: Record<ReasonKey, number> };
  type Reason = { reason: string; family: ReasonKey; leads: number; byRow: Map<string, number> };
  const rowMap = new Map<string, Row>();
  const reasonMap = new Map<string, Reason>();   // family|keyOf(sub-status)
  const fam = zeroBy();
  let signed = 0;

  for (const l of leads) {
    const family = reasonOf(l.bucket, l.status, l.subStatus);
    fam[family]++;
    // Counted from isSigned, not from the family, so checkReasons really checks the two agree.
    if (l.signed) signed++;

    let r = rowMap.get(l.name);
    if (!r) { r = { name: l.name, members: new Set(), leads: 0, signed: 0, by: zeroBy() }; rowMap.set(l.name, r); }
    r.leads++; r.by[family]++;
    if (l.signed) r.signed++;
    if (l.source !== NO_SOURCE && l.source !== TEAM_CHANNEL) r.members.add(l.source);

    const reason = clean(l.subStatus) || NO_REASON;
    const rk = `${family}|${keyOf(reason)}`;
    let x = reasonMap.get(rk);
    if (!x) { x = { reason, family, leads: 0, byRow: new Map() }; reasonMap.set(rk, x); }
    x.leads++;
    x.byRow.set(l.name, (x.byRow.get(l.name) ?? 0) + 1);
  }

  const total = leads.length;
  const notViable = sumOf(fam, NOT_VIABLE_KEYS);
  const viable = total - notViable;

  // Cost per viable lead uses the same paid-rows rule as cost per lead: all the
  // spend, over the rows that have spend entered, so unpaid channels don't make
  // paid ones look cheaper.
  const spendByRow = opts.spendByRow;
  let spendTotal = opts.spendTotal ?? 0;
  if (opts.spendTotal == null && spendByRow) spendByRow.forEach((v) => { spendTotal += v; });
  let paidViable = 0;
  if (spendByRow && spendByRow.size) rowMap.forEach((r) => { if (spendByRow.has(r.name)) paidViable += r.leads - sumOf(r.by, NOT_VIABLE_KEYS); });
  const costPerViable = spendTotal > 0 && paidViable > 0 ? Math.round((spendTotal / paidViable) * 100) / 100 : null;

  const byLeads = Array.from(rowMap.values()).sort((a, b) => b.leads - a.leads || b.signed - a.signed || a.name.localeCompare(b.name));
  // A single leftover row is shown by name rather than folded into "All other" on its own.
  const shown = byLeads.length > ROWS_SHOWN + 1 ? byLeads.slice(0, ROWS_SHOWN) : byLeads;
  const rest = byLeads.slice(shown.length);
  const rows: WhyNotSigned["rows"] = shown.map((r) => ({ name: r.name, members: Array.from(r.members), leads: r.leads, signed: r.signed, by: r.by }));
  if (rest.length) {
    const by = zeroBy();
    for (const r of rest) for (const k of REASON_KEYS) by[k] += r.by[k];
    // Not clickable on the page, so it carries no member list.
    rows.push({ name: ALL_OTHER, members: [], leads: rest.reduce((a, r) => a + r.leads, 0), signed: rest.reduce((a, r) => a + r.signed, 0), by, other: true });
  }

  const reasons = Array.from(reasonMap.values()).sort((a, b) => b.leads - a.leads || a.reason.localeCompare(b.reason));
  const biggestRow = (x: Reason) => {
    let name = "", most = 0;
    x.byRow.forEach((v, k) => { if (v > most || (v === most && k < name)) { name = k; most = v; } });
    return { name, most };
  };
  const top = reasons
    .filter((x) => x.family !== "signed" && x.family !== "open")
    .slice(0, TOP_REASONS)
    .map((x) => {
      const { name, most } = biggestRow(x);
      return { reason: x.reason, family: x.family, leads: x.leads, topRow: name, topRowShare: pct(most, x.leads) };
    });

  const members = {} as WhyNotSigned["members"];
  for (const k of REASON_KEYS) members[k] = [];
  for (const x of reasons) members[x.family].push({ reason: x.reason, leads: x.leads });

  // The sub-statuses a family is mostly made of, in one row or overall. "No
  // reason recorded" says nothing, so it is never named.
  const mostly = (family: ReasonKey, row: string | null, count: number) => reasons
    .filter((x) => x.family === family && x.reason !== NO_REASON)
    .map((x) => ({ reason: x.reason, n: row == null ? x.leads : x.byRow.get(row) ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((x) => x.reason);

  // Worded as a share of leads, never as "bad leads": a vendor's leads with no
  // viable claim are a screening question to put to the vendor, not a verdict.
  const insights: string[] = [];
  const biggest = byLeads.find((r) => r.name !== NO_SOURCE);
  if (biggest && biggest.leads >= 50 && total > biggest.leads) {
    const share = biggest.by.noClaim / biggest.leads;
    const others = (fam.noClaim - biggest.by.noClaim) / (total - biggest.leads);
    if (share > 0 && share >= 1.25 * others) {
      const what = mostly("noClaim", biggest.name, 3);
      insights.push(`${Math.round(share * 100)}% of ${biggest.name}'s leads had no viable claim${what.length ? ` (mostly ${what.join(", ")})` : ""}, against ${Math.round(others * 100)}% for everything else.`);
    }
  }
  if (fam.lostThem >= 20) {
    const what = mostly("lostThem", null, 2);
    insights.push(`${n(fam.lostThem)} viable leads (${whole(fam.lostThem, total)}% of all leads) chose another firm or went quiet${what.length ? ` — mostly ${andList(what)}` : ""}.`);
  }

  return {
    families: REASON_KEYS.map((key) => ({ key, label: REASON_LABEL[key], leads: fam[key], share: pct(fam[key], total) })),
    funnel: { leads: total, notViable, viable, signed, viableRate: pct(viable, total), winRate: pct(signed, viable), costPerViable },
    rows,
    top,
    members,
    insights: insights.slice(0, 2),
  };
}

/**
 * Everything that must add back to the scorecard. Empty when it all does; the
 * dashboard logs anything else as a warning and still renders.
 */
export function checkReasons(w: WhyNotSigned, totals: Counts): string[] {
  const out: string[] = [];
  const same = (what: string, got: number, want: number) => { if (got !== want) out.push(`why: ${what} is ${got}, expected ${want}`); };

  if (w.families.length !== REASON_KEYS.length || w.families.some((f, i) => f.key !== REASON_KEYS[i])) {
    out.push("why: families are not the nine reason keys in order");
  }
  const fam = zeroBy();
  for (const f of w.families) if (fam[f.key] !== undefined) fam[f.key] += f.leads;
  const rejectedFamilies = REASON_KEYS.filter((k) => k !== "signed" && k !== "open" && k !== "referred");

  same("the families' total", sumOf(fam, REASON_KEYS), totals.leads);
  same("Signed", fam.signed, totals.signed);
  same("Still open", fam.open, totals.open);
  same("Referred out, not signed", fam.referred, totals.referredOut);
  same("the rejected families", sumOf(fam, rejectedFamilies), totals.rejected + totals.notInterested);

  same("funnel leads", w.funnel.leads, totals.leads);
  same("viable + not viable", w.funnel.viable + w.funnel.notViable, totals.leads);
  same("not viable", w.funnel.notViable, REASON_KEYS.filter((k) => NOT_VIABLE.has(k)).reduce((a, k) => a + fam[k], 0));
  same("funnel signed", w.funnel.signed, totals.signed);

  let leads = 0, signed = 0;
  for (const r of w.rows) {
    leads += r.leads; signed += r.signed;
    same(`${r.name}'s bar`, sumOf(r.by, REASON_KEYS), r.leads);
    same(`${r.name}'s signed segment`, r.by.signed, r.signed);
  }
  same("the rows' leads", leads, totals.leads);
  same("the rows' signed", signed, totals.signed);
  return out;
}
