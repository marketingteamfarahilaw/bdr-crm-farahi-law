/**
 * The clients behind any number: the drill-down modal, the lead table it and
 * the lead list share, and the page's searchable lead list.
 *
 * The server counts a drill-down with the dashboard's own classifiers, so the
 * modal's total is the number that was clicked; the export uses the same query,
 * so the file holds the same clients. File names come from the row or column
 * title, never from a client or a search term.
 */
import { useEffect, useRef, useState } from "react";
import type { inferRouterInputs } from "@trpc/server";
import { toast } from "sonner";
import { Download, Loader2, X } from "lucide-react";
import { NOT_VIABLE_KEYS, REASON_KEYS, REASON_LABEL, type ReasonKey } from "@shared/marketing";
import type { AppRouter } from "../../../../server/routers";
import type { DrillLink, DrillScope, RowRef } from "../../../../server/marketing/common";
import type { LeadListRow } from "../../../../server/marketing/leadFilter";
import { trpc } from "@/lib/trpc";
import { fmt, hueStyle, initials, leadDay, monthAbbr, monthLabel, outcomeBadge } from "../SignupsDashboard";
import { BUCKET_LABEL } from "./Scorecard";
import { scopeOf } from "./shared";
import "./Clients.css";

type ExportInput = inferRouterInputs<AppRouter>["marketing"]["exportLeads"];

// The server's NO_REASON (server/marketing/leadFilter.ts): how a lead with no
// sub-status is listed, and what '' asks for in a sub-status drill.
const NO_REASON = "No reason recorded";
const VIABLE_KEYS = REASON_KEYS.filter((k) => !NOT_VIABLE_KEYS.includes(k));

export type ClientsProps = {
  drill: DrillLink;
  from: string;
  to: string;
  loadingNote?: string;   // shown when the range starts before Lead Docket history is complete
  onClose: () => void;
};

/** 'Walker Advertising Contract 26' → 'walker-advertising-contract-26'. */
const slug = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "leads";

/** The months a range covers: 'Sep 2026', 'Jan–Sep 2026', 'Dec 2025 – Sep 2026'. */
function spanLabel(from: string, to: string) {
  const a = from.slice(0, 7), b = to.slice(0, 7);
  if (a === b) return monthLabel(a);
  if (a.slice(0, 4) === b.slice(0, 4)) return `${monthAbbr(a)}–${monthLabel(b)}`;
  return `${monthLabel(a)} – ${monthLabel(b)}`;
}

function reasonsLabel(keys: ReasonKey[]) {
  if (keys.length === 1) return REASON_LABEL[keys[0]];
  const has = new Set(keys);
  const same = (xs: readonly ReasonKey[]) => xs.length === has.size && xs.every((k) => has.has(k));
  if (same(NOT_VIABLE_KEYS)) return "Not a viable case";
  if (same(VIABLE_KEYS)) return "Real, viable cases";
  return keys.map((k) => REASON_LABEL[k]).join(" or ");
}

/**
 * What a drill is fixed to, when it names where the leads ended up: then the
 * modal lists all of those, and the Signed / All toggle would only confuse it.
 */
function fixedLabel(s: DrillScope): string | null {
  if (s.subStatus != null) return s.subStatus.trim() || NO_REASON;
  if (s.bucket) return BUCKET_LABEL[s.bucket];
  if (s.reasons?.length) return reasonsLabel(s.reasons);
  return null;
}

// When Lead Docket left one of the two dates empty, the lead date stands in for
// it: it is the sign-up date for a signed lead and the day it came in otherwise.
const cameIn = (l: LeadListRow) => l.createdAt ?? (l.signed ? null : l.date);
const signedOn = (l: LeadListRow) => l.signedAt ?? (l.signed ? l.date : null);

function saveCsv(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * What a list shows once its query has failed. react-query stops retrying after
 * a few seconds and leaves no data (placeholderData only covers a pending query),
 * so without this the list would say 'Loading…' for good.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="sr-nil" role="alert" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span>Couldn't load {what}.</span>
      <button className="sr-btn2" onClick={onRetry}>Try again</button>
    </div>
  );
}

// What Tab can land on inside the clients window.
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// A focus guard: tabbable but unseen, and out of the backdrop's grid.
const GUARD = { position: "fixed", opacity: 0, pointerEvents: "none", outline: "none" } as const;

/** 'Export 312 clients': the same query as the list, as a CSV with every column. */
export function ExportButton({ input, name, total }: { input: ExportInput; name: string; total: number | undefined }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await utils.marketing.exportLeads.fetch(input);
      saveCsv(r.csv, `marketing-${slug(name)}-${input.from}-to-${input.to}.csv`);
      if (r.capped) toast.warning(`Exported the newest ${fmt(r.rows)} — narrow the dates for the rest.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="sr-btn2" onClick={run} disabled={busy || !total} title="Download these clients as a spreadsheet (CSV)">
      {busy ? <Loader2 className="sr-spin" /> : <Download />}
      Export{total ? ` ${fmt(total)}` : ""} client{total === 1 ? "" : "s"}
    </button>
  );
}

/** The clients behind a clicked number, with why the unsigned ones didn't sign. */
export function Clients({ drill, from, to, loadingNote, onClose }: ClientsProps) {
  const fixed = fixedLabel(drill.scope);
  const [pick, setPick] = useState<"signed" | "all">(drill.status ?? "signed");
  const status = fixed ? "all" : pick;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    // Focus goes back to the number that opened the window, not to the top of the page.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  // Reached by Tab past the window's last control, or Shift+Tab before its first,
  // so focus wraps round instead of landing on the page behind the backdrop.
  // Guards rather than a Tab handler: the browser still visits every stop in
  // between, including a wide table Chrome makes tabbable for scrolling.
  const wrapTo = (end: "first" | "last") => {
    const el = box.current;
    if (!el) return;
    const stops = Array.from(el.querySelectorAll<HTMLElement>(TABBABLE)).filter((s) => s.getClientRects().length > 0);
    ((end === "first" ? stops[0] : stops[stops.length - 1]) ?? el).focus();
  };

  const base = { from, to, ...drill.scope };
  const shown = trpc.marketing.leads.useQuery({ ...base, status, limit: 500, withWhy: status !== "signed" });
  // Only the count of the other side, for its toggle label.
  const other = trpc.marketing.leads.useQuery({ ...base, status: status === "signed" ? "all" : "signed", limit: 1 }, { enabled: !fixed });
  const signedN = status === "signed" ? shown.data?.total : other.data?.total;
  const allN = status === "all" ? shown.data?.total : other.data?.total;
  const data = shown.data;
  const why = data?.why ?? [];
  const whyMax = Math.max(1, ...why.map((w) => w.n));

  const period = drill.scope.month ? monthLabel(drill.scope.month) : spanLabel(from, to);
  const chips = [...(drill.chips ?? [])];
  if (!chips.includes(period)) chips.push(period);

  return (
    <div className="sr-modal-back mk-cl-back" onClick={onClose}>
      <span tabIndex={0} style={GUARD} onFocus={() => wrapTo("last")} />
      <div ref={box} tabIndex={-1} className="sr-modal mk-cl-modal" role="dialog" aria-modal="true" aria-label={`${drill.title} clients`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mk-cl-head">
          <div className="sr-who mk-cl-who">
            <span className="sr-av" style={hueStyle(drill.title)}>{initials(drill.title)}</span>
            <div><b style={{ fontSize: 17 }} title={drill.title}>{drill.title}</b><i title={chips.join(" · ")}>{chips.join(" · ")}</i></div>
          </div>
          <div className="mk-cl-tools">
            {fixed ? (
              <span className="sr-badge sr-b-grey mk-cl-fixed" title="Every lead in this group, signed or not">
                {fixed}{data ? ` (${fmt(data.total)})` : ""}
              </span>
            ) : (
              <div className="sr-seg" role="group" aria-label="Show">
                <button className={status === "signed" ? "on" : ""} aria-pressed={status === "signed"} onClick={() => setPick("signed")}>
                  Signed ({signedN != null ? fmt(signedN) : "…"})
                </button>
                <button className={status === "all" ? "on" : ""} aria-pressed={status === "all"} onClick={() => setPick("all")}>
                  All leads{allN != null ? ` (${fmt(allN)})` : ""}
                </button>
              </div>
            )}
            <ExportButton input={{ ...base, status }} name={drill.title} total={data?.total} />
          </div>
          <button className="sr-arr mk-cl-x" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        {loadingNote && <p className="sr-sub mk-cl-note">{loadingNote}</p>}

        {!data ? (shown.isError
            ? <LoadFailed what="these clients" onRetry={() => { shown.refetch(); if (other.isError) other.refetch(); }} />
            : <p className="sr-nil"><Loader2 size={13} className="sr-spin" /> Loading…</p>)
          : data.rows.length === 0 ? <p className="sr-nil">None.</p>
          : <>
              {why.length > 0 && (
                <div className="mk-cl-why">
                  <h3>Why they didn't sign</h3>
                  <div className="sr-hb">
                    {why.map((w, i) => (
                      <div key={w.family + "|" + w.reason} className={`sr-hb-row mk-cl-why-row${i === 0 ? " lead" : ""}`}
                        title={`${w.reason} · ${REASON_LABEL[w.family]}: ${fmt(w.n)}`}>
                        <span className="mk-cl-why-l"><b>{w.reason}</b><i>{REASON_LABEL[w.family]}</i></span>
                        <div className="sr-hb-t"><i style={{ width: `${Math.max(2, (w.n / whyMax) * 100)}%` }} /></div>
                        <span className="sr-hb-v">{fmt(w.n)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <LeadTable rows={data.rows} />
              {data.total > data.rows.length && (
                <p className="sr-sub mk-cl-more">The newest {fmt(data.rows.length)} of {fmt(data.total)} — export for all of them, or narrow the dates.</p>
              )}
            </>}
      </div>
      <span tabIndex={0} style={GUARD} onFocus={() => wrapTo("first")} />
    </div>
  );
}

/** Clients as a table; on a phone, as two-line blocks. Dates are Pacific days. */
export function LeadTable({ rows }: { rows: LeadListRow[] }) {
  const withCampaign = rows.some((l) => l.campaign);
  return (
    <>
      <div className="sr-scroll mk-cl-table">
        <table className="sr-t sr-leads" style={{ minWidth: withCampaign ? 1000 : 860 }}>
          <thead>
            <tr>
              <th>Client</th><th>Case type</th><th>Source</th>{withCampaign && <th>Campaign</th>}
              <th>Came in</th><th>Signed</th><th>Outcome</th><th>City</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="client"><b>{l.name}</b></td>
                <td className="nowrap">{l.caseType}</td>
                <td className="partner">{l.source}{l.rep && <span className="mk-muted"> · {l.rep}</span>}</td>
                {withCampaign && <td className="partner mk-muted">{l.campaign ?? "—"}</td>}
                <td className="nowrap">{leadDay(cameIn(l))}</td>
                <td className="nowrap">{leadDay(signedOn(l))}</td>
                <td className="nowrap">
                  <span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span>
                  {l.reason && <span className="mk-cl-reason">{l.reason}</span>}
                </td>
                <td className="nowrap mk-muted">{l.city ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mk-cl-list">
        {rows.map((l) => {
          const signed = signedOn(l);
          const came = cameIn(l);
          const bits = [
            l.rep ? `${l.source} · ${l.rep}` : l.source, l.caseType,
            came ? `came in ${leadDay(came)}` : null,
            signed ? `signed ${leadDay(signed)}` : null,
            l.reason,
          ].filter(Boolean);
          return (
            <li key={l.id}>
              <div className="mk-cl-l1">
                <b>{l.name}</b>
                <span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`} title={l.outcome}>{l.outcome || "—"}</span>
              </div>
              <p className="mk-cl-l2">{bits.join(" · ")}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export type LeadListProps = {
  from: string;
  to: string;
  rows: RowRef[];   // the scorecard rows, for the source picker
  noun: string;     // 'channel' or 'source'
};

/** Every lead in the period, fetched a page at a time — the firm has far too many to send at once. */
export function LeadList({ from, to, rows: groups, noun }: LeadListProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "signed" | "open">("all");
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(50);
  const q = useDebounced(search.trim());
  useEffect(() => setLimit(50), [from, to, status, source, q]);
  const picked = groups.find((g) => g.name === source);
  const input = { from, to, status, ...(picked ? scopeOf(picked) : {}), ...(q ? { search: q } : {}) };
  const { data, isFetching, isError, refetch } = trpc.marketing.leads.useQuery({ ...input, limit }, { placeholderData: (prev) => prev });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  // Named for the source and outcome picked, never the search — that is often a client's name.
  const fileName = `${picked?.name ?? "all leads"}${status === "signed" ? " signed" : status === "open" ? " not signed" : ""}`;

  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>Leads</h2><span className="sr-count">{fmt(total)}</span>{isFetching && <Loader2 size={13} className="sr-spin" />}</div>
        <div className="mk-cl-filters">
          {/* The server takes at most 100 characters (marketing.leads). */}
          <input className="sr-input mk-cl-search" placeholder="Search client, case type, campaign, city…" value={search} maxLength={100}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" />
          <select className="sr-input mk-cl-pick" value={source} onChange={(e) => setSource(e.target.value)} aria-label={noun}>
            <option value="">All {noun}s</option>
            {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
          <div className="sr-seg" role="group" aria-label="Outcome">
            {([["all", "All"], ["signed", "Signed"], ["open", "Not signed"]] as const).map(([v, label]) => (
              <button key={v} className={status === v ? "on" : ""} aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>
            ))}
          </div>
          <ExportButton input={input} name={fileName} total={data ? total : undefined} />
        </div>
      </div>
      <p className="sr-sub">Newest first, with the day each lead came in and, for signed leads, the day it signed. The search ignores upper and lower case.</p>
      {rows.length === 0 ? (!data && isError
          ? <LoadFailed what="these leads" onRetry={() => refetch()} />
          : <p className="sr-nil">{data ? "No leads match." : "Loading…"}</p>) : (
        <>
          <LeadTable rows={rows} />
          {total > rows.length && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              {limit < 500
                ? <button className="sr-btn2" onClick={() => setLimit(Math.min(500, limit + 200))}>Show {fmt(Math.min(200, 500 - limit, total - rows.length))} more of {fmt(total)}</button>
                : <p className="sr-sub">Showing the newest 500 — search, pick a {noun} or export to see the rest.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
