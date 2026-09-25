/**
 * The scorecard: one row per channel or source, laid out like the team's sheet,
 * where every number opens the clients behind it. With a comparison on it gains
 * a change column and the rows that had leads then and none now.
 *
 * The desktop table and the phone cards are built from the same rows and the
 * same drill links (drillsOf), and CSS picks one, so the two can't disagree —
 * and the server classifies a drill with the dashboard's own counters, so the
 * list a number opens always holds exactly that many clients.
 */
import type { ReactNode } from "react";
import type { Counts, DrillLink, DrillScope, RowRef, ScoreBucket } from "../../../../server/marketing/common";
import type { SpendAssignment } from "../../../../server/marketing/spend";
import { fmt, standing } from "../SignupsDashboard";
import { delta, scopeOf, usd, type Delta, type Group } from "./shared";
import "./Scorecard.css";

type Money = { conversion: number; spend: number | null; costPerLead: number | null; costPerSignup: number | null };

export type ScorecardProps = {
  rows: (RowRef & Counts & Money)[];
  totals: Counts & Money;
  label: string;
  group: Group;
  compare: {
    label: string;
    partial: boolean;
    byName: Record<string, { leads: number; signed: number; conversion: number }>;
    totals: { signed: number };
  } | null;
  gone: { name: string; members: string[]; leads: number; signed: number }[];
  unmatched: SpendAssignment["unmatched"];
  notes: string[];
  onDrill: (d: DrillLink) => void;
  onSpend: () => void;
};

/** The scorecard's outcome columns by name — also the clients modal's label for a column drill. */
export const BUCKET_LABEL: Record<ScoreBucket, string> = {
  open: "Open",
  rejected: "Rejected",
  referredOut: "Referred Out",
  notInterested: "Not Interested",
  signedReferred: "Signed Referred Out",
  signedInHouse: "Signed In-House",
};

// In the sheet's order, with its column colours.
const OUTCOMES: { key: ScoreBucket; th?: string; td?: string }[] = [
  { key: "open" }, { key: "rejected" }, { key: "referredOut" }, { key: "notInterested" },
  { key: "signedReferred", th: "cyan", td: "cyan" },
  { key: "signedInHouse", th: "yellow", td: "yellow em" },
];

type Drills = {
  row: DrillLink;      // the name: Signed / All toggle, signed first
  leads: DrillLink;    // Total Leads and Conversion
  signed: DrillLink;   // Total Signed
  bucket: (b: ScoreBucket) => DrillLink;
};

/** Every link a row's numbers open. The TOTAL row passes an empty scope: the whole report. */
function drillsOf(title: string, scope: DrillScope): Drills {
  return {
    row: { title, scope },
    leads: { title, scope, status: "all" },
    signed: { title, scope, status: "signed" },
    bucket: (b) => ({ title, chips: [BUCKET_LABEL[b]], scope: { ...scope, bucket: b }, status: "all" }),
  };
}

const ALL_TITLE = "All leads";
const see = (n: number) => (n === 1 ? "See this client" : `See these ${fmt(n)} clients`);
// The change column is narrow, so it carries the count only; the % is in the hover text.
const short = (d: Delta) => d.text.replace(/\s*\(.*\)$/, "");
const conv = (v: number) => `${v.toFixed(1)}%`;
// Spend is kept to the cent. Rounded to whole dollars cell by cell, a column with
// cents in it stops adding up to its TOTAL, so if any amount has cents, all show them.
const hasCents = (vs: (number | null)[]) => vs.some((v) => v != null && Math.round(v * 100) % 100 !== 0);

/** A number cell. Non-zero ones open their clients; the button inside makes them reachable by keyboard. */
function Num({ n, drill, onDrill, className, children }: {
  n: number; drill: DrillLink; onDrill: (d: DrillLink) => void; className?: string; children?: ReactNode;
}) {
  const body = children ?? fmt(n);
  if (!n) return <td className={className}>{body}</td>;
  return (
    <td className={`${className ? className + " " : ""}sr-click`} title={see(n)} onClick={() => onDrill(drill)}>
      <button type="button" className="mk-sc-n">{body}</button>
    </td>
  );
}

export function Scorecard({ rows, totals: t, label, group, compare, gone, unmatched, notes, onDrill, onSpend }: ScorecardProps) {
  if (!rows.length && !gone.length && !unmatched.length) return null;
  const noun = group === "channel" ? "Channel" : "Source";
  const all = drillsOf(ALL_TITLE, {});
  const unmatchedSum = Math.round(unmatched.reduce((a, u) => a + u.amount, 0) * 100) / 100;
  const spendCents = hasCents([t.spend, unmatchedSum, ...rows.map((s) => s.spend)]);
  // The hover list adds up to the unmatched cell, so it follows the same rule.
  const unmatchedCents = spendCents || hasCents(unmatched.map((u) => u.amount));
  const unmatchedTitle = unmatched
    .map((u) => `${u.source} — ${usd(u.amount, unmatchedCents)} (${u.why === "channel" ? "entered for a whole channel; see the Channels view" : "no leads this period"})`)
    .join("\n");

  // What the change column says for a row, and its hover text.
  const change: ChangeOf = (name, signed) => {
    if (!compare) return null;
    const was = Object.prototype.hasOwnProperty.call(compare.byName, name) ? compare.byName[name] : null;
    const d = delta(signed, was?.signed ?? 0, "count");
    const title = (was
      ? `${compare.label}: ${fmt(was.leads)} leads, ${fmt(was.signed)} signed (${was.conversion}%)`
      : `${compare.label}: no leads`) + (compare.partial ? " — not fully loaded yet, so not compared" : "");
    return { text: short(d), tone: compare.partial ? "grey" : d.tone, title };
  };
  const totalChange = compare ? delta(t.signed, compare.totals.signed, "count") : null;
  const totalChangeTitle = compare
    ? `${compare.label}: ${fmt(compare.totals.signed)} signed` + (compare.partial ? " — not fully loaded yet, so not compared" : "")
    : "";

  const sub = [
    "From Lead Docket. Each lead counts once, in the column for where it ended up, so the columns add up to Total Leads. "
      + "Lost counts as Rejected. Cost columns use the spend entered below."
      + (group === "channel" ? " Channels group Lead Docket's per-contract and per-listing sources; switch to Sources to see each one." : ""),
    ...notes.filter(Boolean),
  ];
  sub[sub.length - 1] += " Click any number to see the clients behind it.";

  return (
    <div className="sr-sc-wrap">
      <div className="sr-sc mk-sc-wrap">
        <div className="sr-sc-title">{label}</div>
        <div className="sr-sc-band">{group === "channel" ? "MARKETING CHANNELS" : "MARKETING SOURCES"}</div>
        <div className="sr-scroll mk-sc-scroll">
          <table className={`sr-sct mk-sc${compare ? " mk-sc-cmp" : ""}`}>
            <thead>
              <tr>
                <th className="l">{noun}</th><th>Total Leads</th>
                {OUTCOMES.map((o) => <th key={o.key} className={o.th}>{BUCKET_LABEL[o.key]}</th>)}
                <th className="tot">Total Signed</th>
                {compare && <th className="mk-sc-chg" title={`Change in sign-ups against ${compare.label}`}>vs {compare.label}</th>}
                <th>Conversion</th><th>Spend</th><th>Cost / Lead</th><th>Cost / Sign-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const d = drillsOf(s.name, scopeOf(s));
                const st = standing(s.conversion, t.conversion);
                const c = change(s.name, s.signed);
                return (
                  <tr key={s.name}>
                    <td className="l sr-click" title={`See ${s.name}'s clients`} onClick={() => onDrill(d.row)}>
                      <button type="button" className="mk-sc-n"><b>{s.name}</b></button>
                      {group === "channel" && s.members.length > 1 && <span className="former">{s.members.length} sources</span>}
                    </td>
                    <Num n={s.leads} drill={d.leads} onDrill={onDrill} />
                    {OUTCOMES.map((o) => <Num key={o.key} n={s[o.key]} drill={d.bucket(o.key)} onDrill={onDrill} className={o.td} />)}
                    <Num n={s.signed} drill={d.signed} onDrill={onDrill} className="tot blue" />
                    {c && <td className={`mk-sc-chg mk-sc-${c.tone}`} title={c.title}>{c.text}</td>}
                    <Num n={s.leads} drill={d.leads} onDrill={onDrill}>
                      <span className={`sr-badge ${st.badge}`}>{s.conversion}%</span>
                    </Num>
                    <td>{usd(s.spend, spendCents)}</td><td>{usd(s.costPerLead, true)}</td><td>{usd(s.costPerSignup, true)}</td>
                  </tr>
                );
              })}

              {gone.map((g) => {
                const c = change(g.name, 0);
                return (
                  <tr key={"gone|" + g.name} className="mk-sc-gone">
                    <td className="l"><span><b>{g.name}</b><span className="former">no leads this period</span></span></td>
                    <td>0</td>
                    {OUTCOMES.map((o) => <td key={o.key} className={o.td}>0</td>)}
                    <td className="tot">0</td>
                    {c && <td className={`mk-sc-chg mk-sc-${c.tone}`} title={c.title}>{c.text}</td>}
                    <td>·</td><td>·</td><td>·</td><td>·</td>
                  </tr>
                );
              })}

              {unmatched.length > 0 && (
                <tr className="mk-unmatched sr-click" title={unmatchedTitle} onClick={onSpend}>
                  <td className="l"><button type="button" className="mk-sc-n">Spend with no matching leads</button></td>
                  <td>·</td>
                  {OUTCOMES.map((o) => <td key={o.key}>·</td>)}
                  <td>·</td>
                  {compare && <td>·</td>}
                  <td>·</td><td>{usd(unmatchedSum, spendCents)}</td><td>·</td><td>·</td>
                </tr>
              )}

              <tr className="total">
                <td className="l sr-click" title="See every client" onClick={() => onDrill(all.row)}>
                  <button type="button" className="mk-sc-n">TOTAL</button>
                </td>
                <Num n={t.leads} drill={all.leads} onDrill={onDrill} />
                {OUTCOMES.map((o) => <Num key={o.key} n={t[o.key]} drill={all.bucket(o.key)} onDrill={onDrill} />)}
                <Num n={t.signed} drill={all.signed} onDrill={onDrill} className="big" />
                {totalChange && <td className="big mk-sc-chg" title={totalChangeTitle}>{short(totalChange)}</td>}
                <Num n={t.leads} drill={all.leads} onDrill={onDrill} className="big">{t.conversion}%</Num>
                <td className="big">{usd(t.spend, spendCents)}</td><td className="big">{usd(t.costPerLead, true)}</td><td className="big">{usd(t.costPerSignup, true)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Cards rows={rows} totals={t} compare={compare} gone={gone} unmatchedSum={unmatched.length ? unmatchedSum : null}
          spendCents={spendCents} unmatchedTitle={unmatchedTitle} change={change} totalChange={totalChange} totalChangeTitle={totalChangeTitle}
          onDrill={onDrill} onSpend={onSpend} />
      </div>
      <div className="mk-sc-subs">
        {sub.map((line, i) => <p key={i} className="sr-sub">{line}</p>)}
      </div>
    </div>
  );
}

type ChangeOf = (name: string, signed: number) => { text: string; tone: Delta["tone"]; title: string } | null;

const toneBadge = (tone: Delta["tone"]) => (tone === "ok" ? "sr-b-ok" : tone === "bad" ? "sr-b-bad" : "sr-b-grey");

/** The phone layout: TOTAL first, then a card per row, from the same rows and links as the table. */
function Cards({ rows, totals: t, compare, gone, unmatchedSum, spendCents, unmatchedTitle, change, totalChange, totalChangeTitle, onDrill, onSpend }: {
  rows: ScorecardProps["rows"]; totals: ScorecardProps["totals"]; compare: ScorecardProps["compare"]; gone: ScorecardProps["gone"];
  unmatchedSum: number | null; spendCents: boolean; unmatchedTitle: string; change: ChangeOf; totalChange: Delta | null; totalChangeTitle: string;
  onDrill: (d: DrillLink) => void; onSpend: () => void;
}) {
  const totalPill = totalChange && {
    text: short(totalChange), tone: compare?.partial ? "grey" as const : totalChange.tone, title: totalChangeTitle,
  };
  return (
    <div className="mk-sc-cards">
      <Card name="TOTAL" c={t} drills={drillsOf(ALL_TITLE, {})} pill={totalPill} spendCents={spendCents} onDrill={onDrill} total />
      {rows.map((s) => (
        <Card key={s.name} name={s.name} c={s} drills={drillsOf(s.name, scopeOf(s))} pill={change(s.name, s.signed)} spendCents={spendCents} onDrill={onDrill} />
      ))}
      {unmatchedSum != null && (
        <button type="button" className="mk-sc-unm" title={unmatchedTitle} onClick={onSpend}>
          Spend with no matching leads: {usd(unmatchedSum, spendCents)}
        </button>
      )}
      {gone.length > 0 && (
        <p className="mk-sc-gone-line">
          Had leads in {compare?.label ?? "the earlier period"}, none now: {gone.map((g) => g.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

function Card({ name, c, drills, pill, spendCents, onDrill, total }: {
  name: string; c: Counts & Money; drills: Drills; pill: { text: string; tone: Delta["tone"]; title: string } | null;
  spendCents: boolean; onDrill: (d: DrillLink) => void; total?: boolean;
}) {
  const cost = c.spend == null ? null : c.costPerSignup != null ? `${usd(c.costPerSignup)} / sign-up` : `${usd(c.spend, spendCents)} spent`;
  return (
    <div className={`mk-sc-card${total ? " mk-sc-total" : ""}`}>
      <button type="button" className="mk-sc-main" title={total ? "See every client" : `See ${name}'s clients`} onClick={() => onDrill(drills.row)}>
        <span className="mk-sc-l1"><b>{name}</b><span className="mk-sc-big">{fmt(c.signed)}</span></span>
        <span className="mk-sc-l2">
          <span>of {fmt(c.leads)} lead{c.leads === 1 ? "" : "s"} · {conv(c.conversion)}</span>
          {pill && <span className={`sr-badge ${toneBadge(pill.tone)}`} title={pill.title}>{pill.text}</span>}
          {cost && <span>{cost}</span>}
        </span>
      </button>
      <details className="sr-acc mk-sc-acc">
        <summary><span>Where they ended up</span></summary>
        <div className="mk-sc-pills">
          {OUTCOMES.map((o) => {
            const n = c[o.key];
            return (
              <button key={o.key} type="button" className="sr-m sr-m-grey mk-sc-pill" disabled={!n}
                title={n ? `${BUCKET_LABEL[o.key]}: ${see(n).toLowerCase()}` : `${BUCKET_LABEL[o.key]}: none`}
                onClick={() => onDrill(drills.bucket(o.key))}>
                <i>{BUCKET_LABEL[o.key]}</i>{fmt(n)}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
