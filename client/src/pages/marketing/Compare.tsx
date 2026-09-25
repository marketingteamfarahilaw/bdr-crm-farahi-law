/**
 * Comparison with the previous period or last year: the vs control, the change
 * pills under the big numbers, the months card with pace, and the biggest mover.
 *
 * Everything here reads the server's Comparison, which counts the earlier
 * period with the dashboard's own classifiers — so a pill's "before" number is
 * exactly what the scorecard shows when that range is picked on its own. While
 * Lead Docket hasn't loaded the earlier period, the pills go grey rather than
 * show a change that is really missing history.
 */
import type { ReactNode } from "react";
import type { Comparison, Pace } from "../../../../server/marketing/compare";
import type { MonthState } from "../../../../server/marketing/coverage";
import type { DrillLink } from "../../../../server/marketing/common";
import { Big, fmt, hueStyle, initials, monthAbbr, monthLabel } from "../SignupsDashboard";
import { delta, scopeOf, usd } from "./shared";
import "./Compare.css";

export type CompareChoice = "prev" | "yoy" | "off";

/** The comparison a period preset opens with. */
export function compareDefault(presetLabel: string | undefined): CompareChoice {
  if (presetLabel === "Year to date") return "yoy";
  if (presetLabel === "All time") return "off";
  return "prev";
}

export type VsControlProps = {
  value: CompareChoice;
  onChange: (v: CompareChoice) => void;
  allTime: boolean;   // nothing earlier to compare with: Previous and Last year are disabled
};

const CHOICES: { v: CompareChoice; label: string }[] = [
  { v: "prev", label: "Previous" },
  { v: "yoy", label: "Last year" },
  { v: "off", label: "Off" },
];

export function VsControl({ value, onChange, allTime }: VsControlProps) {
  // All time has nothing before it, whatever was chosen for the last range.
  const shown = allTime ? "off" : value;
  return (
    <div className="sr-seg mk-cmp-vs" role="group" aria-label="Compare with">
      <span className="mk-cmp-vs-l" aria-hidden="true">vs</span>
      {CHOICES.map(({ v, label }) => {
        const blocked = allTime && v !== "off";
        return (
          <button key={v} className={shown === v ? "on" : ""} aria-pressed={shown === v} disabled={blocked}
            title={blocked ? "Nothing earlier to compare with" : undefined} onClick={() => onChange(v)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export type BigWithDeltaProps = {
  n: string;
  label: string;
  icon: ReactNode;
  cur: number | null;
  prev: number | null | undefined;
  kind: "count" | "pct" | "money";
  invert?: boolean;
  partial: boolean;
  vsLabel: string | null;
  onClick?: () => void;
};

const shownAs = (v: number, kind: BigWithDeltaProps["kind"]) => (kind === "pct" ? `${v}%` : kind === "money" ? usd(v) : fmt(v));

/** The pill's words, colour and hover text; null when there's nothing to compare. */
function pillOf(p: BigWithDeltaProps): { text: string; cls: string; title: string } | null {
  if (!p.vsLabel || p.prev === undefined) return null;
  if (p.partial) {
    return {
      text: `${p.vsLabel} not fully loaded`,
      cls: "sr-b-grey",
      title: `Lead Docket history for ${p.vsLabel} is still loading, so it would look smaller than it was. `
        + "The change shows once the history reaches 30 days before that period starts, because sign-ups trail leads.",
    };
  }
  if (p.cur == null || p.prev == null) return null;
  const d = delta(p.cur, p.prev, p.kind, p.invert);
  const was = `${p.vsLabel}: ${shownAs(p.prev, p.kind)}`;
  // Under 3% (or a point) is within ordinary wobble, so it isn't called up or down.
  if (d.tone === "grey") return { text: "level", cls: "sr-b-grey", title: d.text === "·" ? was : `${was} · ${d.text}` };
  return { text: d.text, cls: d.tone === "ok" ? "sr-b-ok" : "sr-b-bad", title: was };
}

/** A hero number with its change against the comparison period under it. */
export function BigWithDelta(p: BigWithDeltaProps) {
  const pill = pillOf(p);
  const body = (
    <>
      <Big n={p.n} label={p.label} icon={p.icon} />
      {pill && <span className={`sr-badge mk-delta ${pill.cls}`} title={pill.title}>{pill.text}</span>}
    </>
  );
  if (!p.onClick) return <div className="mk-cmp-big">{body}</div>;
  const open = p.onClick;
  return (
    <div className="mk-cmp-big sr-click" role="button" tabIndex={0} aria-label={`${p.label}: ${p.n}${pill ? `, ${pill.text}` : ""} — see the clients`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
      {body}
    </div>
  );
}

/** The conversion ring's note: the change against the comparison, or `fallback` without one. */
export function conversionNote(avg: number, compare: Comparison | null, fallback: string): string {
  // Grey comparisons make no claims anywhere, the ring included.
  if (!compare || compare.partial || !compare.totals.leads) return fallback;
  const d = Math.round((avg - compare.totals.conversion) * 10) / 10;
  if (d === 0) return `Level with ${compare.label}.`;
  return `${d > 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(1)} pts on ${compare.label}.`;
}

export type MonthsCardProps = {
  monthly: { month: string; leads: number; signed: number; conversion: number }[];
  compare: Comparison | null;
  pace: Pace | null;
  states: MonthState[];
};

/**
 * Sign-ups by month. The month in progress gets a dashed ghost up to its pace,
 * so it doesn't read as a drop; against last year, a hollow ring on each stick
 * marks the same month a year earlier.
 */
export function MonthsCard({ monthly, compare, pace, states }: MonthsCardProps) {
  const offset = Math.max(0, monthly.length - 8);
  const recent = monthly.slice(offset);
  const total = monthly.reduce((s, m) => s + m.signed, 0);
  const perMonth = monthly.length ? Math.round(total / monthly.length) : 0;
  // A month Lead Docket hasn't fully loaded would sit low for want of history, not of sign-ups.
  const yoy = compare?.mode === "yoy" ? compare : null;
  const ringAt = (i: number) => {
    const p = yoy?.monthly[offset + i];
    return p && p.loaded ? p : null;
  };
  const paceAt = (month: string) => (pace && pace.projected != null && pace.month === month ? pace.projected : null);
  const stickMax = Math.max(1, ...recent.map((m, i) => Math.max(m.signed, paceAt(m.month) ?? 0, ringAt(i)?.signed ?? 0)));
  const height = (v: number) => `${Math.max(6, (v / stickMax) * 100)}%`;
  const rings = recent.some((_, i) => ringAt(i));

  return (
    <div className="sr-card">
      <div className="sr-bh"><h2>Sign-ups by month</h2></div>
      <div className="sr-kv"><span className="n">{perMonth}</span><span className="u">average<br />per month</span></div>
      {recent.length === 0 ? <p className="sr-nil">No sign-ups in this period.</p> : (
        <>
          <div className="sr-cols">
            {recent.map((m, i) => {
              const hot = i === recent.length - 1;
              const proj = paceAt(m.month);
              const ring = ringAt(i);
              const state = states[offset + i];
              const thin = state != null && state !== "full";
              const title = `${monthLabel(m.month)}: ${fmt(m.signed)} signed of ${fmt(m.leads)} leads (${m.conversion}%)`
                + (proj != null ? ` · on pace for about ${fmt(proj)}` : "")
                + (ring ? ` · ${monthLabel(ring.month)}: ${fmt(ring.signed)}` : "")
                + (thin ? " · Lead Docket history for this month is still loading" : "");
              return (
                <div key={m.month} className={`sr-col${hot ? " hot" : ""}${thin ? " mk-cmp-thin" : ""}`} title={title}>
                  {hot && (
                    // The longer pace tip is pinned to the column's right edge so it stays inside the card.
                    <span className={`sr-tipp${proj != null && recent.length > 2 ? " mk-cmp-tipp" : ""}`}>
                      {fmt(m.signed)}{proj != null && ` · pace ${fmt(proj)}`}
                    </span>
                  )}
                  <div className="sr-stick">
                    {proj != null && <i className="ghost" style={{ height: height(proj) }} aria-hidden="true" />}
                    <i style={{ height: height(m.signed) }} />
                    {ring && (
                      <span className="mk-cmp-ring" style={{ bottom: `${(ring.signed / stickMax) * 100}%` }}
                        title={`${monthLabel(ring.month)}: ${fmt(ring.signed)}`} />
                    )}
                  </div>
                  <span className="sr-lab">{monthAbbr(m.month)}</span>
                </div>
              );
            })}
          </div>
          {rings && <p className="mk-cmp-legend"><i aria-hidden="true" />same month last year</p>}
        </>
      )}
    </div>
  );
}

export type MoverCardProps = {
  mover: NonNullable<Comparison["mover"]>;
  vsLabel: string;
  /** False when the mover has no leads in this range (a row that's gone): there are no clients to show. */
  clickable: boolean;
  onDrill: (d: DrillLink) => void;
};

/** The spotlight, when there's a comparison: the row whose sign-ups moved most. */
export function MoverCard({ mover, vsLabel, clickable, onDrill }: MoverCardProps) {
  const up = mover.delta > 0;
  const body = (
    <>
      <span className="sr-spot-tag"><span>Biggest change vs {vsLabel}</span></span>
      <div className="sr-spot-ini">{initials(mover.name)}</div>
      <div className="sr-spot-foot">
        <div><b>{mover.name}</b><i>was {fmt(mover.prev)}, now {fmt(mover.cur)}</i></div>
        <span className="sr-spot-pill">{up ? "+" : "−"}{fmt(Math.abs(mover.delta))} signed</span>
      </div>
    </>
  );
  // The mover can be a row that stopped entirely: no leads this range, so no
  // clients to list, as Needs attention leaves a gone swing without a drill.
  if (!clickable) {
    return (
      <div className="sr-spot mk-cmp-mover" style={hueStyle(mover.name)} title={`No leads from ${mover.name} in this period`}>
        {body}
      </div>
    );
  }
  // Down to no sign-ups, the signed list would be empty; its leads show why instead.
  const signed = mover.cur > 0;
  const open = () => onDrill({ title: mover.name, scope: scopeOf(mover), status: signed ? "signed" : "all" });
  return (
    <div className="sr-spot mk-cmp-mover sr-click" style={hueStyle(mover.name)} role="button" tabIndex={0}
      title={signed ? `See ${mover.name}'s signed clients` : `See ${mover.name}'s clients`} onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
      {body}
    </div>
  );
}

export function CompareAccordion() {
  return (
    <details className="sr-acc">
      <summary><span>How comparisons work</span></summary>
      <p>
        "Previous" compares the range with the one just before it: this month so far with the same days of last month,
        a whole month with the month before, several months with the same number of months before them. A range that
        doesn't start on the 1st is compared with the same number of days just before it. "Last year" compares the same
        dates a year earlier.
      </p>
      <p>
        An earlier period is compared only once Lead Docket history is loaded back to 30 days before it starts, because
        sign-ups trail leads. Until then its changes show grey as "not fully loaded" and stay out of the briefing and
        Needs attention.
      </p>
      <p>
        Past periods drift a little as their leads sign: a lead from Aug 30 that signs on Sep 3 moves from August's Open
        to September's Signed. So a month's numbers can still change after it ends.
      </p>
      <p>
        Cost changes are shown only between whole months that both have spend entered. A month's spend counts in full
        even when the range covers part of it, which would make a part-month change misleading.
      </p>
      <p>
        A month still in progress shows its pace from the 5th on: its sign-ups so far, scaled to the whole month.
      </p>
    </details>
  );
}
