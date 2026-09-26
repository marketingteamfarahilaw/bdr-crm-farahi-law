/**
 * Rejected cases and why: every lead in the scorecard's Rejected column
 * (rejected, lost or closed in Lead Docket), newest first, each with the reason
 * intake recorded (its sub-status), and above them the reasons, largest first,
 * which narrow the list when clicked. Youssef asked for the list (Sept 2026);
 * the presentation's appendix shows the same one.
 *
 * The reason is an intake case fact (CLAUDE.md's hard wall), so the page shows
 * this panel only to those cleared for it (data.caseFacts); the server strips it
 * for anyone else regardless.
 *
 * The unfiltered list is fetched once, 500 at most (rejectedQuery), and shown 50
 * at a time: it is the deck's own query, so presenting after this panel has
 * loaded doesn't wait. A reason or a search asks the server again, so their
 * lists are complete even when the period has more than 500.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { REASON_LABEL, type ReasonKey } from "@shared/marketing";
import type { LeadListRow } from "../../../../server/marketing/leadFilter";
import { trpc } from "@/lib/trpc";
import { fmt, leadDay, outcomeBadge } from "../SignupsDashboard";
import { ExportButton, LoadFailed, useDebounced } from "./Clients";
import { rejectedQuery, rowNameOf, type Group } from "./shared";

// The server's NO_REASON (server/marketing/leadFilter.ts): how a lead with no
// sub-status is listed, and what '' asks for in a sub-status filter.
const NO_REASON = "No reason recorded";
const PAGE = 50;

// A rejected lead never signed, so its lead date is the day it came in (as Clients.tsx reads it).
const cameIn = (l: LeadListRow) => l.createdAt ?? l.date;
// Lost and Closed say something Rejected doesn't; a plain Rejected goes without saying here.
const outcomeNote = (l: LeadListRow) => (l.outcome && !/^rejected/i.test(l.outcome) ? l.outcome : null);
const INK = { color: "var(--ink)", fontWeight: 600 } as const;

/** A reason bar: the sub-status, and its family, since one sub-status can sit in two. */
type Pick = { reason: string; family: ReasonKey };

export type RejectedProps = {
  from: string;
  to: string;
  group: Group;
  /** The scorecard's Rejected total, shown until the list arrives. */
  count: number;
};

export function Rejected({ from, to, group, count }: RejectedProps) {
  const [search, setSearch] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const [shown, setShown] = useState(PAGE);
  const q = useDebounced(search.trim());
  // A reason picked in one period may not be in the next.
  useEffect(() => setPick(null), [from, to]);
  useEffect(() => setShown(PAGE), [from, to, pick, q]);

  const all = trpc.marketing.leads.useQuery(rejectedQuery(from, to), { placeholderData: (prev) => prev });
  // The family narrows too, so the list holds exactly the bar's count (see Pick).
  const scope = {
    ...(pick ? { subStatus: pick.reason === NO_REASON ? "" : pick.reason, reasons: [pick.family] } : {}),
    ...(q ? { search: q } : {}),
  };
  const narrowed = !!pick || !!q;
  const some = trpc.marketing.leads.useQuery(
    { ...rejectedQuery(from, to), withWhy: false, ...scope },
    { enabled: narrowed, placeholderData: (prev) => prev },
  );
  const list = narrowed ? some : all;
  const data = list.data;
  const rows = data?.rows ?? [];

  const why = all.data?.why ?? [];   // the eight biggest reasons, over every rejected case
  const whyMax = Math.max(1, ...why.map((w) => w.n));
  const others = (all.data?.total ?? 0) - why.reduce((a, w) => a + w.n, 0);

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl">
          <h2>Rejected cases and why</h2>
          <span className="sr-count">{fmt(all.data?.total ?? count)}</span>
          {(all.isFetching || some.isFetching) && <Loader2 size={13} className="sr-spin" />}
        </div>
        <div className="mk-cl-filters">
          {/* The server takes at most 100 characters (marketing.leads). */}
          <input className="sr-input mk-cl-search" placeholder="Search client, case type, reason, city…" value={search} maxLength={100}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search rejected cases" />
          <ExportButton input={{ from, to, bucket: "rejected", status: "all", ...scope }}
            name={pick ? `rejected ${pick.reason}` : "rejected"} total={data?.total} />
        </div>
      </div>
      <p className="sr-sub">
        The scorecard's Rejected column: leads rejected, lost or closed in Lead Docket, each with the reason intake recorded
        (its sub-status). Click a reason to list only its cases.
      </p>

      {!all.data && all.isError ? <LoadFailed what="the rejected cases" onRetry={() => all.refetch()} /> : (
        <>
          {why.length > 0 && (
            <>
              <div className="mk-why-h"><h3>Reasons</h3><span>Largest first.</span></div>
              <div className="sr-hb">
                {why.map((w) => {
                  const on = pick?.reason === w.reason && pick.family === w.family;
                  return (
                    <button key={w.family + "|" + w.reason} type="button" aria-pressed={on}
                      className={`sr-hb-row sr-click mk-why-btn mk-why-top${on ? " lead" : ""}`}
                      title={on ? "Show every reason again" : `${w.reason} · ${REASON_LABEL[w.family]}: list these ${fmt(w.n)}`}
                      onClick={() => setPick(on ? null : { reason: w.reason, family: w.family })}>
                      <span className="mk-why-lbl">
                        <b>{w.reason}</b>
                        <span className="mk-why-meta"><span className="sr-badge sr-b-grey mk-why-chip">{REASON_LABEL[w.family]}</span></span>
                      </span>
                      <span className="sr-hb-t"><i style={{ width: `${Math.max(2, (w.n / whyMax) * 100)}%` }} /></span>
                      <span className="sr-hb-v">{fmt(w.n)}</span>
                    </button>
                  );
                })}
              </div>
              {others > 0 && <p className="sr-sub">{fmt(others)} more {others === 1 ? "has" : "have"} other reasons; search for one to list them.</p>}
            </>
          )}

          <div className="mk-why-h">
            <h3>{pick ? `${pick.reason} · ${REASON_LABEL[pick.family]}` : "Cases"}</h3>
            {pick
              ? <button type="button" className="sr-link-btn" onClick={() => setPick(null)}>Show every reason</button>
              : <span>Newest first.</span>}
          </div>
          {!data ? (list.isError
              ? <LoadFailed what="these cases" onRetry={() => list.refetch()} />
              : <p className="sr-nil"><Loader2 size={13} className="sr-spin" /> Loading…</p>)
            : rows.length === 0 ? <p className="sr-nil">{narrowed ? "No rejected cases match." : "No rejected leads in this period."}</p>
            : (
              <>
                <RejectedTable rows={rows.slice(0, shown)} group={group} />
                {(rows.length > shown || data.total > rows.length) && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                    {rows.length > shown
                      ? <button className="sr-btn2" onClick={() => setShown(shown + PAGE)}>Show {fmt(Math.min(PAGE, rows.length - shown))} more of {fmt(data.total)}</button>
                      : <p className="sr-sub">Showing the newest {fmt(rows.length)} of {fmt(data.total)} — search, pick a reason or export to see the rest.</p>}
                  </div>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}

/** The cases as a table; on a phone, as two-line blocks (Clients.css). Dates are Pacific days. */
function RejectedTable({ rows, group }: { rows: LeadListRow[]; group: Group }) {
  return (
    <>
      <div className="sr-scroll mk-cl-table">
        <table className="sr-t sr-leads" style={{ minWidth: 860 }}>
          <thead>
            <tr><th>Client</th><th>Case type</th><th>{group === "channel" ? "Channel" : "Source"}</th><th>Came in</th><th>Why</th></tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const outcome = outcomeNote(l);
              return (
                <tr key={l.id}>
                  <td className="client"><b>{l.name}</b></td>
                  <td className="nowrap">{l.caseType}</td>
                  <td className="partner">{rowNameOf(l.source, group)}{l.rep && <span className="mk-muted"> · {l.rep}</span>}</td>
                  <td className="nowrap">{leadDay(cameIn(l))}</td>
                  <td className="partner">
                    {l.reason ? <b style={INK}>{l.reason}</b> : <span className="mk-muted">{NO_REASON}</span>}
                    {outcome && <span className="mk-muted"> · {outcome}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mk-cl-list">
        {rows.map((l) => {
          const bits = [
            l.caseType,
            l.rep ? `${rowNameOf(l.source, group)} · ${l.rep}` : rowNameOf(l.source, group),
            `came in ${leadDay(cameIn(l))}`,
          ];
          return (
            <li key={l.id}>
              <div className="mk-cl-l1">
                <b>{l.name}</b>
                <span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`} title={l.outcome}>{l.outcome || "—"}</span>
              </div>
              <p className="mk-cl-l2">
                {l.reason ? <b style={INK}>{l.reason}</b> : NO_REASON} · {bits.join(" · ")}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
