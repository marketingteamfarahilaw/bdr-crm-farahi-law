/**
 * How fresh and how complete the report's Lead Docket data is: the hero's
 * 'synced' line and the backfill banner.
 *
 * Every time is Pacific, like the report's months: the team works in Pacific
 * time, and a browser elsewhere would otherwise show a sync hours off.
 */
import type { Coverage } from "../../../../server/marketing/coverage";
import "./Freshness.css";

const PT = "America/Los_Angeles";
// The regular sync runs every 8 hours; an hour's grace before calling it late.
const OVERDUE_MS = 9 * 60 * 60 * 1000;

const partsOf = (d: Date, o: Intl.DateTimeFormatOptions) => {
  const out: Record<string, string> = {};
  new Intl.DateTimeFormat("en-US", { timeZone: PT, ...o }).formatToParts(d).forEach((p) => { out[p.type] = p.value; });
  return out;
};

/** 'Jan 22, 2026', the Pacific day. */
const dayLabel = (iso: string) => {
  const p = partsOf(new Date(iso), { year: "numeric", month: "short", day: "numeric" });
  return `${p.month} ${p.day}, ${p.year}`;
};

/**
 * '9:18 pm' today, 'Sep 23, 9:18 pm' on another day (with the year when it
 * isn't this one), Pacific. withDay always names the day.
 */
export function whenLabel(iso: string, now = new Date(), withDay = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsOf(d, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const n = partsOf(now, { year: "numeric", month: "short", day: "numeric" });
  // Older engines name the AM/PM part 'dayperiod'.
  const time = `${p.hour}:${p.minute} ${(p.dayPeriod ?? p.dayperiod ?? "").toLowerCase()}`.trim();
  const today = p.year === n.year && p.month === n.month && p.day === n.day;
  if (today && !withDay) return time;
  return `${p.month} ${p.day}${p.year !== n.year ? `, ${p.year}` : ""}, ${time}`;
}

/**
 * 'about Jan 22, 2026' — how far back the data is complete — or null when it
 * all is, or when how far isn't known yet (check c.complete to tell them
 * apart). 'About' because Lead Docket numbers leads only roughly in the order
 * they came in.
 */
export function loadedLabel(c: Coverage): string | null {
  if (c.complete || !c.completeFrom) return null;
  return `about ${dayLabel(c.completeFrom)}`;
}

/** ' · Lead Docket synced 9:18 pm · newest lead 7:07 pm', for the end of the hero's lead line. */
export function FreshnessLine({ c }: { c: Coverage }) {
  const now = new Date();
  const synced = c.syncedAt ? whenLabel(c.syncedAt, now) : "";
  const newest = c.newestLeadAt ? whenLabel(c.newestLeadAt, now) : "";
  if (!synced && !newest) return null;
  const overdue = !!c.syncedAt && now.getTime() - Date.parse(c.syncedAt) > OVERDUE_MS;
  const why = c.syncState === "failed" || c.syncState === "partial" ? " Its last attempt didn't finish cleanly." : "";
  return (
    <span className="mk-fr">
      <span className="mk-fr-sep" aria-hidden="true"> · </span>
      <span className="mk-fr-part">{synced ? `Lead Docket synced ${synced}` : "Lead Docket not synced yet"}</span>
      {newest && <> · <span className="mk-fr-part">newest lead {newest}</span></>}
      {c.syncState === "running" && <> · <span className="mk-fr-part">syncing now</span></>}
      {overdue && (
        <span
          className="sr-badge sr-b-sun mk-fr-late"
          title={`The regular Lead Docket sync last ran successfully ${whenLabel(c.syncedAt!, now, true)}; recent changes may be missing.${why}`}
        >
          Sync overdue
        </span>
      )}
    </span>
  );
}

/** While the backfill runs, how much of Lead Docket is in — and from when periods can be trusted. */
export function CoverageBanner({ c }: { c: Coverage }) {
  if (c.complete || !c.total) return null;
  const share = Math.min(100, Math.round((c.stored / c.total) * 100));
  const from = loadedLabel(c);
  const trusted = c.trustedFrom ? `about ${dayLabel(c.trustedFrom)}` : null;
  return (
    <div className="mk-cov">
      <div className="mk-cov-t">
        <b>Loading Lead Docket history — {c.stored.toLocaleString("en-US")} of {c.total.toLocaleString("en-US")} leads ({share}%).</b>
        <span>
          {from ? (
            <span
              className="mk-fr-from"
              title="Lead Docket numbers leads only roughly in the order they came in, so this date is approximate. A sign-up can come up to a month after its lead, so only periods starting a month later are compared."
            >
              Complete back to {from}{trusted ? `; periods from ${trusted} on can be compared.` : "."}
            </span>
          ) : "Newest months fill in first."}
          {" "}It reads about 3,000 leads an hour, between the regular Lead Docket syncs.
        </span>
      </div>
      <div className="mk-cov-bar" role="progressbar" aria-label="Lead Docket history loaded" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
        <i style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
