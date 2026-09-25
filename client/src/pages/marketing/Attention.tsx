/**
 * 'Needs attention': the alert strip under the hero, and the accordion that
 * says when an alert fires. It sits above the scorecard so that on a phone it
 * isn't buried under the stacked side panels.
 */
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Alert } from "../../../../server/marketing/alerts";
import type { DrillLink } from "../../../../server/marketing/common";
import "./Attention.css";

export type AttentionProps = {
  alerts: Alert[];
  vsLabel: string | null;
  onDrill: (d: DrillLink) => void;
  onSpend: () => void;
};

// Enough to read in a glance; the rest wait behind 'Show N more'.
const SHOWN = 4;

const LEVEL_WORDS: Record<Alert["level"], string> = { bad: "Needs action", warn: "Worth a look", good: "Good news" };

export function Attention({ alerts, vsLabel, onDrill, onSpend }: AttentionProps) {
  const [all, setAll] = useState(false);
  const shown = all ? alerts : alerts.slice(0, SHOWN);
  const more = alerts.length - shown.length;

  return (
    <section className="mk-att" aria-labelledby="mk-att-h">
      <div className="mk-att-h">
        <div className="sr-ttl"><h2 id="mk-att-h">Needs attention</h2><span className="sr-count">{alerts.length}</span></div>
      </div>
      {alerts.length === 0 ? (
        <p className="sr-nil mk-att-nil">{vsLabel ? `Nothing unusual against ${vsLabel}.` : "Nothing flagged for this period."}</p>
      ) : (
        <div className="mk-att-grid">
          {shown.map((a) => <Item key={a.key} a={a} onDrill={onDrill} onSpend={onSpend} />)}
        </div>
      )}
      {(more > 0 || (all && alerts.length > SHOWN)) && (
        <div className="mk-att-foot">
          <button className="sr-link-btn" onClick={() => setAll(!all)}>{more > 0 ? `Show ${more} more` : "Show fewer"}</button>
        </div>
      )}
    </section>
  );
}

function Item({ a, onDrill, onSpend }: { a: Alert; onDrill: (d: DrillLink) => void; onSpend: () => void }) {
  const go = a.drill ? () => onDrill(a.drill!) : a.action === "spend" ? onSpend : null;
  const body = (
    <>
      <span className="mk-att-dot" role="img" aria-label={LEVEL_WORDS[a.level]} title={LEVEL_WORDS[a.level]} />
      <span className="mk-att-t">
        {a.text}
        {/* Gone-quiet looks at the last 63 days up to the sync, not the dates picked above. */}
        {a.asOfSync && <span className="mk-att-sync">as of last sync</span>}
      </span>
      {go && <ArrowUpRight size={14} className="mk-att-go" aria-hidden="true" />}
    </>
  );
  return go ? (
    <button type="button" className={`mk-att-i ${a.level} sr-click`} onClick={go}
      title={a.drill ? "See these clients" : "Enter spend"}>
      {body}
    </button>
  ) : (
    <div className={`mk-att-i ${a.level}`}>{body}</div>
  );
}

/**
 * When an alert fires, in plain words. The numbers mirror the constants at the
 * top of server/marketing/alerts.ts — change them together.
 */
export function AlertsAccordion() {
  return (
    <details className="sr-acc">
      <summary><span>When an alert fires</span></summary>
      <p>
        <b className="mk-att-b">Up or down.</b> A channel's sign-ups (or, failing that, its leads) moved by more than about a
        third against the comparison period, and by more than chance would explain for a number that size. A channel needs at
        least 6 sign-ups or 15 leads in the earlier period to be judged, and the three biggest moves are shown, drops first.
      </p>
      <p>
        <b className="mk-att-b">Converting worse.</b> A channel with at least 30 leads in both periods signs at least 5 points
        fewer of them, by more than chance would explain.
      </p>
      <p>
        <b className="mk-att-b">Gone quiet.</b> A Google listing — or any other channel — that usually brings several leads a
        week has had none for long enough that it is very unlikely to be chance: about five leads' worth of silence, and at
        least two days. It looks at the last 9 weeks up to the last Lead Docket sync, whatever dates are picked, and only at
        sources with 20 or more leads in that time. Each Google listing is judged on its own; Walker, Intaker and the rest as a
        whole channel. Referrals, existing clients and employees aren't checked.
      </p>
      <p>
        <b className="mk-att-b">Spend, nothing signed.</b> Spend is entered for a channel that signed no one in the period —
        amber while the month is still running, red once it's over, and off until the period is fully loaded from Lead Docket.
      </p>
      <p>
        <b className="mk-att-b">Cost per sign-up.</b> Up by a quarter or more, only between whole months with spend entered for
        both.
      </p>
      <p>
        <b className="mk-att-b">Still open.</b> Five or more leads from the period have no outcome yet.
      </p>
      <p>
        <b className="mk-att-b">Housekeeping.</b> No spend entered; 5% or more of leads with no Marketing Source; or channels with
        at least 16 leads (50 when the period has 500 or more) signing at under half the firm's rate.
      </p>
      <p>
        Comparison alerts stay off while the earlier period isn't fully loaded from Lead Docket, so a half-loaded period never
        looks like a drop. Clicking an alert opens exactly the clients its number counts.
      </p>
    </details>
  );
}
