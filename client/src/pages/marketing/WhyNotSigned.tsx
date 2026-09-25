/**
 * Why leads didn't sign: the funnel from all leads to real, viable cases to
 * sign-ups, one stacked bar per scorecard row, and the biggest sub-status
 * reasons. Every lead is in exactly one family, so each bar is that row's
 * leads. That is what tells a marketing problem (no viable claim, not a case we
 * take) from an intake one (chose another firm). Every segment, funnel bar and
 * reason opens the clients behind it.
 */
import { NOT_VIABLE_KEYS, REASON_KEYS, REASON_LABEL, type ReasonKey } from "@shared/marketing";
import type { WhyNotSigned as WhyData } from "../../../../server/marketing/reasons";
import type { DrillLink } from "../../../../server/marketing/common";
import { fmt, standing } from "../SignupsDashboard";
import { scopeOf, usd } from "./shared";
import "./WhyNotSigned.css";

export type WhyNotSignedProps = {
  why: WhyData;
  avg: number;               // the firm's conversion, in percent
  loadingMonths: string[];   // labels of months in range that aren't fully loaded
  onDrill: (d: DrillLink) => void;
};

type Row = WhyData["rows"][number];
type Top = WhyData["top"][number];

// The server's NO_REASON (server/marketing/reasons.ts) — what an empty
// sub-status is listed as. The page can't import server values.
const NO_REASON = "No reason recorded";
const VIABLE_KEYS = REASON_KEYS.filter((k) => !NOT_VIABLE_KEYS.includes(k));
const MINUS = "−";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const whole = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const width = (n: number, of: number) => `${Math.max(2, of ? (n / of) * 100 : 0)}%`;
// Referred reuses the page's hatch; every other family is a token in WhyNotSigned.css.
const swatch = (k: ReasonKey) => `mk-r-${k}${k === "referred" ? " sr-s-hatch" : ""}`;

/** 'Jan 2026', 'Feb 2026' → 'Jan–Feb 2026'; across years it keeps both. */
function spanOf(labels: string[]) {
  const first = labels[0], last = labels[labels.length - 1];
  if (labels.length === 1) return first;
  const a = first.lastIndexOf(" "), b = last.lastIndexOf(" ");
  return a > 0 && b > 0 && first.slice(a) === last.slice(b) ? `${first.slice(0, a)}–${last}` : `${first}–${last}`;
}

/** Where a reason's leads came from; "mostly" only when it really is most of them. */
function whereFrom(t: Top) {
  const share = Math.round(t.topRowShare);
  if (share >= 100) return `all ${t.topRow}`;
  return share >= 50 ? `mostly ${t.topRow} (${share}%)` : `largest: ${t.topRow} (${share}%)`;
}

export function WhyNotSigned({ why, avg, loadingMonths, onDrill }: WhyNotSignedProps) {
  const f = why.funnel;
  // In the Sources view every row is its own single source; a channel groups
  // differently named ones. If nothing was grouped, "source" is accurate anyway.
  const noun = why.rows.some((r) => !r.other && r.members.some((m) => m !== r.name)) ? "channel" : "source";
  const topMax = Math.max(1, ...why.top.map((t) => t.leads));

  return (
    <div className="sr-panel mk-why">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Why leads didn't sign</h2></div></div>
      <p className="sr-sub">From Lead Docket's sub-status. Every lead is in exactly one group, so each bar adds up to that {noun}'s leads.</p>
      {loadingMonths.length > 0 && (
        <p className="sr-sub">
          {spanOf(loadingMonths)} {loadingMonths.length === 1 ? "is" : "are"} still loading from Lead Docket; {loadingMonths.length === 1 ? "its" : "their"} shares may still shift.
        </p>
      )}

      {f.leads === 0 ? <p className="sr-nil">No leads in this period.</p> : (
        <>
          <div className="sr-hb mk-why-funnel">
            <button type="button" className="sr-hb-row sr-click mk-why-btn mk-why-f" title={`See all ${fmt(f.leads)} leads`}
              onClick={() => onDrill({ title: "All leads", scope: {}, status: "all" })}>
              <b>All leads</b>
              <span className="sr-hb-t"><i style={{ width: "100%" }} /></span>
              <span className="sr-hb-v">{fmt(f.leads)}</span>
            </button>
            <button type="button" className="sr-hb-row sr-click mk-why-btn mk-why-f" title={`See the ${fmt(f.viable)} real, viable cases`}
              onClick={() => onDrill({ title: "Real, viable cases", chips: VIABLE_KEYS.map((k) => REASON_LABEL[k]), scope: { reasons: VIABLE_KEYS }, status: "all" })}>
              <b>Real, viable cases</b>
              <span className="sr-hb-t"><i style={{ width: width(f.viable, f.leads) }} /></span>
              <span className="sr-hb-v">{fmt(f.viable)} <em>({Math.round(f.viableRate)}%)</em></span>
            </button>
            {f.notViable > 0 && (
              <button type="button" className="sr-click mk-why-drop" title={`See the ${fmt(f.notViable)} leads that weren't a viable case`}
                onClick={() => onDrill({ title: "Not a viable case", chips: NOT_VIABLE_KEYS.map((k) => REASON_LABEL[k]), scope: { reasons: NOT_VIABLE_KEYS }, status: "all" })}>
                {MINUS}{fmt(f.notViable)} no viable claim, not a case we take, past the deadline or junk
              </button>
            )}
            <button type="button" className="sr-hb-row lead sr-click mk-why-btn mk-why-f" title={`See the ${fmt(f.signed)} sign-ups`}
              onClick={() => onDrill({ title: "Signed", scope: {}, status: "signed" })}>
              <b>Signed</b>
              <span className="sr-hb-t"><i style={{ width: width(f.signed, f.leads) }} /></span>
              <span className="sr-hb-v">{fmt(f.signed)} <em>({Math.round(f.winRate)}% of viable)</em></span>
            </button>
          </div>
          {f.costPerViable != null && (
            <div className="mk-costs mk-why-cost"><div><b>{usd(f.costPerViable)}</b><i>per viable lead</i></div></div>
          )}

          <div className="mk-why-h"><h3>By {noun}</h3><span>Click a segment for its clients.</span></div>
          <div className="sr-hb">
            {why.rows.map((r) => <StackRow key={r.name + (r.other ? "|other" : "")} row={r} avg={avg} onDrill={onDrill} />)}
          </div>
          <div className="sr-legend mk-why-legend">
            {REASON_KEYS.map((k) => <span key={k}><i className={swatch(k)} />{REASON_LABEL[k]}</span>)}
          </div>

          {why.top.length > 0 && (
            <>
              <div className="mk-why-h"><h3>Top reasons</h3><span>Lead Docket sub-statuses, leaving out signed and still-open leads.</span></div>
              <div className="sr-hb">
                {why.top.map((t) => (
                  // The family narrows the drill too: the same sub-status can sit in two
                  // families (Med Mal referred out, Med Mal rejected), and the modal must match this bar.
                  <button key={t.family + "|" + t.reason} type="button" className="sr-hb-row sr-click mk-why-btn mk-why-top"
                    title={`${t.reason} · ${REASON_LABEL[t.family]}: see the ${fmt(t.leads)} lead${t.leads === 1 ? "" : "s"}`}
                    onClick={() => onDrill({
                      title: t.reason, chips: [REASON_LABEL[t.family]],
                      scope: { subStatus: t.reason === NO_REASON ? "" : t.reason, reasons: [t.family] }, status: "all",
                    })}>
                    <span className="mk-why-lbl">
                      <b>{t.reason}</b>
                      <span className="mk-why-meta">
                        <span className="sr-badge sr-b-grey mk-why-chip">{REASON_LABEL[t.family]}</span>
                        <i>{whereFrom(t)}</i>
                      </span>
                    </span>
                    <span className="sr-hb-t"><i style={{ width: width(t.leads, topMax) }} /></span>
                    <span className="sr-hb-v">{fmt(t.leads)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One scorecard row as a stacked bar, in REASON_KEYS order; each segment opens its clients. */
function StackRow({ row, avg, onDrill }: { row: Row; avg: number; onDrill: (d: DrillLink) => void }) {
  const conversion = pct(row.signed, row.leads);
  return (
    <div className={`sr-hb-row mk-why-row${row.other ? " mk-why-other" : ""}`}>
      <b title={row.name}>{row.name}</b>
      <div className="mk-stack" role="group" aria-label={`${row.name}, by why leads didn't sign`}>
        {REASON_KEYS.map((k) => {
          const n = row.by[k];
          if (!n) return null;
          const title = `${row.name} · ${REASON_LABEL[k]}: ${fmt(n)} (${whole(n, row.leads)}%)`;
          const cls = `mk-seg ${swatch(k)}`;
          const style = { flex: `${n} 1 0` };
          // "All other" folds many rows together, so it has no one set of clients to open.
          if (row.other) return <span key={k} className={cls} style={style} title={title} />;
          return (
            <button key={k} type="button" className={`${cls} sr-click`} style={style} title={title} aria-label={title}
              onClick={() => onDrill({ title: row.name, chips: [REASON_LABEL[k]], scope: { ...scopeOf(row), reasons: [k] }, status: "all" })} />
          );
        })}
      </div>
      <span className={`sr-badge ${standing(conversion, avg).badge}`}>{conversion}% signed</span>
    </div>
  );
}

/** For "How these numbers are built": what each family held this period, and the viable-case definition. */
export function WhyAccordion({ why }: { why: WhyData }) {
  return (
    <details className="sr-acc mk-why-acc">
      <summary><span>Why leads didn't sign</span></summary>
      <p>
        Each lead is in one group. Signed, still-open and referred-out leads go by their scorecard column; rejected,
        lost and not-interested leads by what Lead Docket's sub-status says. This period's sub-statuses, by group
        (a new one Lead Docket adds shows up under Other until it is given a group):
      </p>
      {REASON_KEYS.map((k) => why.members[k].length > 0 && (
        <p key={k}><b>{REASON_LABEL[k]}:</b> {why.members[k].map((m) => `${m.reason} ${fmt(m.leads)}`).join(", ")}</p>
      ))}
      <p>
        <span className="sr-badge sr-b-sun mk-why-chip">Definition to confirm</span>{" "}
        Real, viable cases = every lead except no viable claim, not a case we take, past the deadline and junk.
        Referred-out, still-open and unexplained leads count as viable. It is a new measure and changes no existing count.
      </p>
    </details>
  );
}
