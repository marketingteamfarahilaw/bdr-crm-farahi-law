/**
 * The Digital Marketing Report's "Sign-up sheet" tab: the FLF sign-up sheet
 * (its Current Month tab), live from Google Sheets via server/signupSheet.ts.
 * Every sign-up the sheet logs — not only digital ones — with a filter for
 * the digital rows (GBP, website, social ads) the Audit tab compares with Lead Docket.
 *
 * Intake case facts (liability, medical visits, case manager, referred
 * attorney…) arrive only for those allowed them; the columns are left out for
 * everyone else. Phone and email never leave the server.
 */
import { useState } from "react";
import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { trpc } from "@/lib/trpc";
import { downloadCsv } from "@/components/ReportBits";
import type { SignupSheetRow } from "@shared/digitalSheet";
import { fmt } from "../SignupsDashboard";
import { LoadError } from "../signups/LoadError";

type Scope = "all" | "digital";
type Outcome = "all" | "signed" | "referred";
const isReferred = (r: SignupSheetRow) => /^referred/i.test(r.outcome);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A sheet day (YYYY-MM-DD) as "Nov 2, 2026". It is already a calendar day: no time-zone shift. */
const dayLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const GROUP_LABEL = { GBP: "GBP", SEO: "Website", Ads: "Ads" } as const;

/** The intake case-fact columns, shown only when the server sent them. */
const FACT_COLS: [keyof NonNullable<SignupSheetRow["facts"]>, string][] = [
  ["liability", "Liability"], ["language", "Language"], ["erVisit", "ER / UC visit"], ["firstMedical", "First medical"],
  ["sentTo", "Sent to"], ["caseManager", "Case manager"], ["investigator", "PD / investigator"],
  ["referredAttorney", "Referred attorney"], ["referralFee", "Referral fee"], ["activeStatus", "Active status"],
];

export function SignupSheetTab() {
  const utils = trpc.useUtils();
  const q = trpc.marketing.signupSheet.useQuery({ fresh: false }, { staleTime: 60_000 });
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await utils.marketing.signupSheet.fetch({ fresh: true });
      utils.marketing.signupSheet.setData({ fresh: false }, fresh);
    } finally { setRefreshing(false); }
  };

  if (q.isError) return <LoadError what="the FLF sign-up sheet" message={q.error.message} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="sr-skel" style={{ height: 320 }} />;
  const d = q.data;
  const facts = d.caseFacts;

  const k = search.trim().toLowerCase();
  const rows = d.rows.filter((r) =>
    (scope === "all" || r.group) &&
    (outcome === "all" || (outcome === "referred") === isReferred(r)) &&
    (!k || [r.clientName, r.source, r.leadSource, r.signedUpBy, r.intaker, r.caseType].some((v) => v.toLowerCase().includes(k))));

  const referred = rows.filter(isReferred).length;
  const digital = d.rows.filter((r) => r.group).length;
  // Digital marketing's sign-ups by the sheet's Source column, grouped GBP,
  // Website, Ads and most first within each. Walker, referrals and the reps'
  // sign-ups aren't digital marketing's, so they aren't listed here.
  const bySource = new Map<string, { signed: number; referred: number; group: NonNullable<SignupSheetRow["group"]> }>();
  for (const r of rows) {
    if (!r.group) continue;
    const s = bySource.get(r.source || "(blank)") ?? { signed: 0, referred: 0, group: r.group };
    if (isReferred(r)) s.referred++; else s.signed++;
    bySource.set(r.source || "(blank)", s);
  }
  const GROUP_ORDER = { GBP: 0, SEO: 1, Ads: 2 } as const;
  const sources = Array.from(bySource.entries()).sort((a, b) =>
    GROUP_ORDER[a[1].group] - GROUP_ORDER[b[1].group] || b[1].signed + b[1].referred - (a[1].signed + a[1].referred));
  const sourceTotal = sources.reduce((t, [, s]) => ({ signed: t.signed + s.signed, referred: t.referred + s.referred }), { signed: 0, referred: 0 });

  const exportCsv = () => downloadCsv(`flf-signup-sheet-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["Sign-up date", "Source", "Lead source", "Digital group", "Signed up by", "Intake by", "Outcome", "Client name", "Value", "Tier", "Case type", "Referral status", ...(facts ? FACT_COLS.map(([, l]) => l) : [])],
    ...rows.map((r) => [r.day, r.source, r.leadSource, r.group ? GROUP_LABEL[r.group] : "", r.signedUpBy, r.intaker, r.outcome, r.clientName, r.value, r.tier, r.caseType, r.referralStatus,
      ...(facts ? FACT_COLS.map(([f]) => r.facts?.[f] ?? "") : [])]),
  ]);

  return (
    <>
      <div className="sr-panel">
        <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
          <div className="sr-ttl"><h2>FLF sign-up sheet</h2><span className="sr-count">{fmt(d.rows.length)}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="sr-btn2" href={d.sheetUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open sheet</a>
            <button className="sr-btn2" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <Loader2 className="sr-spin" /> : <RefreshCw />} Refresh</button>
          </div>
        </div>
        <p className="sr-sub">
          Live from Google Sheets — tab <b>{d.tab}</b>, read {formatDistanceToNow(new Date(d.fetchedAt), { addSuffix: true })}. Every sign-up the sheet logs;
          {" "}<b>{fmt(digital)}</b> are digital marketing (GMB, the JFJ website and brand sites, Intaker, Yelp, Facebook, Instagram) and are the ones the Data audit compares with Lead Docket.
          {!facts && <> Intake case details aren't shown for your role.</>}
        </p>
        <div className="dm-kpis">
          <div className="dm-kpi hl"><b>{fmt(rows.length)}</b><span>Sign-ups shown</span></div>
          <div className="dm-kpi"><b>{fmt(rows.length - referred)}</b><span>Signed in-house</span></div>
          <div className="dm-kpi"><b>{fmt(referred)}</b><span>Referred out</span></div>
          <div className="dm-kpi"><b>{fmt(rows.filter((r) => r.group === "GBP").length)}</b><span>GBP</span></div>
          <div className="dm-kpi"><b>{fmt(rows.filter((r) => r.group === "SEO").length)}</b><span>Website</span></div>
          <div className="dm-kpi"><b>{fmt(rows.filter((r) => r.group === "Ads").length)}</b><span>Ads (social)</span></div>
        </div>
      </div>

      <div className="sr-panel">
        <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
          <div className="sr-ttl"><h2>By source — digital marketing</h2></div>
        </div>
        <p className="sr-sub">GMB, the JFJ website and brand sites, Intaker, Yelp, Facebook and Instagram. Walker, referrals and the reps' sign-ups aren't digital marketing's and aren't listed.</p>
        {sources.length === 0 ? <p className="sr-nil">No digital marketing sign-ups match.</p> : (
          <div className="sr-scroll">
            <table className="sr-t dm-t" style={{ minWidth: 420 }}>
              <thead><tr><th>Source</th><th>Group</th><th className="num">Signed in-house</th><th className="num">Referred out</th><th className="num">Total</th></tr></thead>
              <tbody>
                {sources.map(([name, s]) => (
                  <tr key={name}>
                    <td className="l"><b>{name}</b></td>
                    <td>{GROUP_LABEL[s.group]}</td>
                    <td className="num">{fmt(s.signed)}</td><td className="num">{fmt(s.referred)}</td><td className="num"><b>{fmt(s.signed + s.referred)}</b></td>
                  </tr>
                ))}
                <tr className="foot">
                  <td className="l" colSpan={2}>Digital marketing</td>
                  <td className="num">{fmt(sourceTotal.signed)}</td><td className="num">{fmt(sourceTotal.referred)}</td><td className="num"><b>{fmt(sourceTotal.signed + sourceTotal.referred)}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="sr-panel">
        <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
          <div className="sr-ttl"><h2>Sign-ups</h2><span className="sr-count">{fmt(rows.length)}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="sr-seg" role="group" aria-label="Sources">
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All sources</button>
              <button className={scope === "digital" ? "on" : ""} onClick={() => setScope("digital")}>Digital only</button>
            </div>
            <div className="sr-seg" role="group" aria-label="Outcome">
              <button className={outcome === "all" ? "on" : ""} onClick={() => setOutcome("all")}>All</button>
              <button className={outcome === "signed" ? "on" : ""} onClick={() => setOutcome("signed")}>Signed</button>
              <button className={outcome === "referred" ? "on" : ""} onClick={() => setOutcome("referred")}>Referred out</button>
            </div>
            <input className="sr-input" placeholder="Search name, source, rep…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sign-ups" style={{ width: 220 }} />
            <button className="sr-btn2" disabled={!rows.length} onClick={exportCsv}><Download /> CSV</button>
          </div>
        </div>
        {rows.length === 0 ? <p className="sr-nil">{d.rows.length ? "No sign-ups match." : "The sheet has no sign-ups yet."}</p> : (
          <div className="sr-scroll">
            <table className="sr-t dm-t sr-leads" style={{ minWidth: facts ? 1900 : 1100 }}>
              <thead>
                <tr>
                  <th className="num">#</th><th>Signed</th><th>Source</th><th>Lead source</th><th>Signed up by</th><th>Intake by</th><th>Outcome</th>
                  <th>Client name</th><th>Value</th><th>Tier</th><th>Case type</th><th>Referral status</th>
                  {facts && FACT_COLS.map(([f, l]) => <th key={f}>{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${i}-${r.clientName}`}>
                    <td className="num muted">{i + 1}</td>
                    <td className="nowrap">{r.day ? dayLabel(r.day) : <span className="muted">—</span>}</td>
                    <td className="nowrap">{r.source}{r.group && <span className="muted"> · {GROUP_LABEL[r.group]}</span>}</td>
                    <td className="nowrap" title={r.leadSource}>{r.leadSource}</td>
                    <td className="nowrap">{r.signedUpBy}</td>
                    <td className="nowrap">{r.intaker}</td>
                    <td className="nowrap">{r.outcome}</td>
                    <td className="client"><b>{r.clientName}</b></td>
                    <td className="nowrap">{r.value}</td>
                    <td className="nowrap">{r.tier}</td>
                    <td className="nowrap">{r.caseType}</td>
                    <td className="nowrap">{r.referralStatus}</td>
                    {facts && FACT_COLS.map(([f]) => {
                      const v = r.facts?.[f];
                      return <td key={f} className="nowrap">{v ? (f === "firstMedical" ? dayLabel(v) : v) : <span className="muted">—</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
