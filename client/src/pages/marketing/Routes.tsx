/**
 * How leads reached us: the contact route (the door) beside the marketing
 * source (who gets the credit). The doors convert very differently, which is
 * what says whether website chat or the answering service earns its keep.
 * A route opens the clients behind its bar.
 */
import type { Routes as RoutesData } from "../../../../server/marketing/routes";
import type { DrillLink } from "../../../../server/marketing/common";
import { fmt, standing } from "../SignupsDashboard";
import "./Routes.css";

export type RoutesProps = {
  routes: RoutesData;
  avg: number;               // the firm's conversion, in percent
  loadingMonths: string[];   // labels of months in range that aren't fully loaded
  onDrill: (d: DrillLink) => void;
};

type Row = RoutesData["rows"][number];

const TOP = 8;
// A rate from a handful of leads says nothing about the door, so it isn't coloured.
const MIN_LEADS = 20;
// The leads endpoint takes at most this many Contact Source values (leadScope in server/routers.ts).
const MAX_MEMBERS = 200;
const OTHER_SHOWN = 40;

const share = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/** 'Jan 2026', 'Feb 2026' → 'Jan–Feb 2026'; across years it keeps both. */
function spanOf(labels: string[]) {
  const first = labels[0], last = labels[labels.length - 1];
  if (labels.length === 1) return first;
  const a = first.lastIndexOf(" "), b = last.lastIndexOf(" ");
  return a > 0 && b > 0 && first.slice(a) === last.slice(b) ? `${first.slice(0, a)}–${last}` : `${first}–${last}`;
}

function RouteRow({ r, max, lead, avg, onDrill }: { r: Row; max: number; lead: boolean; avg: number; onDrill: (d: DrillLink) => void }) {
  const canDrill = r.members.length > 0 && r.members.length <= MAX_MEMBERS;
  const title = [
    `${r.name}: ${fmt(r.signed)} signed of ${fmt(r.leads)} leads (${r.conversion}%)`,
    `${share(r.notViable, r.leads)}% not a viable case`,
    r.lostThem ? `${share(r.lostThem, r.leads)}% chose another firm or went quiet` : "",
  ].filter(Boolean).join(" · ")
    + (canDrill ? "" : ` — ${fmt(r.members.length)} Contact Source values are too many to open at once; narrow the dates.`);
  const body = (
    <>
      <b>{r.name}</b>
      <div className="sr-hb-t"><i style={{ width: `${Math.max(2, (r.leads / max) * 100)}%` }} /></div>
      <span className="sr-hb-v">{fmt(r.leads)}</span>
      <span className="mk-rt-conv">
        {r.leads >= MIN_LEADS
          ? <span className={`sr-badge ${standing(r.conversion, avg).badge}`}>{r.conversion}%</span>
          : <span className="mk-rt-na">—</span>}
      </span>
    </>
  );
  const cls = `sr-hb-row mk-rt-row${lead ? " lead" : ""}`;
  if (!canDrill) return <div className={cls} title={title}>{body}</div>;
  return (
    <button type="button" className={`${cls} sr-click`} title={title}
      onClick={() => onDrill({ title: r.name, chips: ["Contact route"], scope: { contactSources: r.members }, status: "all" })}>
      {body}
    </button>
  );
}

export function Routes({ routes, avg, loadingMonths, onDrill }: RoutesProps) {
  const { rows, otherMembers, sameAsSource } = routes;
  const max = Math.max(1, ...rows.map((r) => r.leads));
  const top = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const others = otherMembers.slice(0, OTHER_SHOWN).map((o) => `${o.value} ${fmt(o.leads)}`).join(", ");
  const moreOthers = otherMembers.length - OTHER_SHOWN;
  const row = (r: Row, n: number) => <RouteRow key={r.name} r={r} max={max} lead={n === 0} avg={avg} onDrill={onDrill} />;

  return (
    <div className="sr-panel mk-rt">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>How leads reached us</h2>{rows.length > 0 && <span className="sr-count">{rows.length}</span>}</div>
      </div>
      <p className="sr-sub">
        Marketing Source says who gets the credit; Contact Source is the door the lead came through.
        {rows.length > 0 && sameAsSource >= 1 && ` For about ${Math.round(sameAsSource)}% of leads they are the same (Walker's own lines).`}
        {rows.length > 0 && " Click a route for its clients."}
      </p>
      {loadingMonths.length > 0 && (
        <p className="sr-sub">
          {spanOf(loadingMonths)} {loadingMonths.length === 1 ? "is" : "are"} still loading from Lead Docket; {loadingMonths.length === 1 ? "its" : "their"} shares may still shift.
        </p>
      )}
      {rows.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
        <>
          <div className="sr-hb mk-rt-rows">{top.map((r, n) => row(r, n))}</div>
          {(rest.length > 0 || otherMembers.length > 0) && (
            <details className="sr-acc mk-rt-acc">
              <summary><span>{rest.length ? `All ${rows.length} routes` : "What's in Other"}</span></summary>
              {rest.length > 0 && <div className="sr-hb mk-rt-rows">{rest.map((r, n) => row(r, n + TOP))}</div>}
              {otherMembers.length > 0 && (
                <p className="mk-rt-other">
                  <b>Other</b> is the Contact Source values no rule covers yet, so a new one shows up here first:{" "}
                  {others}{moreOthers > 0 ? `… and ${fmt(moreOthers)} more.` : "."}
                </p>
              )}
            </details>
          )}
        </>
      )}
    </div>
  );
}
