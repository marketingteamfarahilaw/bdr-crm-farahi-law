/**
 * The channel × month grid, with a switch between sign-ups, leads, conversion,
 * not-viable share and cost per sign-up. Every number opens the clients behind
 * it, and months not fully loaded from Lead Docket are marked, so the backfill
 * never reads as a trend.
 */
import { useState } from "react";
import { NOT_VIABLE_KEYS } from "@shared/marketing";
import type { MonthGrid as GridData } from "../../../../server/marketing/monthGrid";
import type { MonthState } from "../../../../server/marketing/coverage";
import type { DrillLink } from "../../../../server/marketing/common";
import { fmt, monthLabel, monthShort } from "../SignupsDashboard";
import { scopeOf, usd, type Group } from "./shared";
import "./MonthGrid.css";

export type MonthGridProps = {
  grid: GridData;
  months: string[];
  monthStates: MonthState[];
  loadedLabel: string | null;
  group: Group;
  avg: number;   // the firm's conversion, in percent
  onDrill: (d: DrillLink) => void;
};

type Row = GridData["rows"][number];
type Metric = "signed" | "leads" | "conv" | "nv" | "cost";
type Cell = { text: string; cls?: string; title?: string; drill?: DrillLink };
type Foot = { name: string; cls: "foot" | "soft"; cell: (i: number) => Cell; total: Cell };

const METRICS: { key: Metric; label: string; title: string }[] = [
  { key: "signed", label: "Sign-ups", title: "Sign-ups" },
  { key: "leads", label: "Leads", title: "Leads" },
  { key: "conv", label: "Conversion", title: "Conversion" },
  { key: "nv", label: "Not viable", title: "No-viable-claim share" },
  { key: "cost", label: "$ / sign-up", title: "Cost per sign-up" },
];
const STORE = "mk:gridMetric";
// A share of fewer leads, or a cost over fewer sign-ups, swings on a single client.
const MIN_LEADS = 5;
const MIN_SIGNED = 3;

function readMetric(): Metric {
  try {
    const v = window.localStorage.getItem(STORE);
    if (METRICS.some((m) => m.key === v)) return v as Metric;
  } catch { /* storage blocked: open on sign-ups */ }
  return "signed";
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const share = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);   // the scorecard's rounding
const plural = (n: number, one: string) => `${fmt(n)} ${one}${n === 1 ? "" : "s"}`;
const level = (v: number, max: number) => (!v ? "" : v / max <= 0.25 ? "l1" : v / max <= 0.5 ? "l2" : v / max <= 0.75 ? "l3" : "l4");
const hasSpend = (r: Row) => r.spendCells.some((v) => v != null);
const spentBy = (r: Row) => r.spendCells.reduce<number>((a, v) => a + (v ?? 0), 0);

export function MonthGrid({ grid, months, monthStates, loadedLabel, group, avg, onDrill }: MonthGridProps) {
  const [metric, setMetricState] = useState<Metric>(readMetric);
  const setMetric = (m: Metric) => {
    setMetricState(m);
    try { window.localStorage.setItem(STORE, m); } catch { /* switched, just not remembered */ }
  };
  const noun = group === "channel" ? "channel" : "source";
  const title = METRICS.find((m) => m.key === metric)!.title;
  const stateOf = (i: number): MonthState => monthStates[i] ?? "full";
  const loadedFrom = loadedLabel ? `Lead Docket history is complete from ${loadedLabel}` : "Lead Docket history is still loading";
  const mon = (i: number) => grid.monthly[i] ?? { month: months[i], leads: 0, signed: 0, notViable: 0, spend: null, costPerSignup: null, costPerLead: null };

  // Columns start at the first month with anything in it. Months before the
  // loaded history are left off too: their few stray leads would only show as
  // dots, and on All time there are dozens of them.
  const first = Math.min(Math.max(0, grid.firstIdx), Math.max(0, months.length - 1));
  const loaded = months.findIndex((_, i) => i >= first && stateOf(i) !== "none");
  const start = loaded >= 0 ? loaded : first;
  const cols = months.map((_, i) => i).filter((i) => i >= start);
  const hiddenLeads = sum(grid.monthly.slice(0, start).map((m) => m.leads));
  const hiddenSpend = grid.monthly.slice(0, start).reduce<number>((a, m) => a + (m.spend ?? 0), 0);

  const tot = {
    leads: sum(grid.monthly.map((m) => m.leads)),
    signed: sum(grid.monthly.map((m) => m.signed)),
    nv: sum(grid.monthly.map((m) => m.notViable)),
    spend: grid.monthly.reduce<number>((a, m) => a + (m.spend ?? 0), 0),
  };
  const rows = grid.rows.filter((r) => (metric === "signed" ? r.signed > 0 : metric === "cost" ? hasSpend(r) : r.leads > 0));
  const unpaid = grid.rows.filter((r) => r.leads > 0 && !hasSpend(r)).length;

  // ---- drill-downs: the same row and month scope the cell was counted with
  const status: "signed" | "all" = metric === "signed" || metric === "cost" ? "signed" : "all";
  const reasons = metric === "nv" ? { reasons: [...NOT_VIABLE_KEYS] } : {};
  const rowDrill = (r: Row, i?: number, st = status): DrillLink => ({
    title: r.name,
    ...(i != null ? { chips: [monthLabel(months[i])] } : {}),
    scope: { ...scopeOf(r), ...(i != null ? { month: months[i] } : {}), ...reasons },
    status: st,
  });
  const allDrill = (i: number, st: "signed" | "all", nv = false): DrillLink => ({
    title: `All ${noun}s`,
    chips: [monthLabel(months[i])],
    scope: { month: months[i], ...(nv ? { reasons: [...NOT_VIABLE_KEYS] } : {}) },
    status: st,
  });

  // ---- heat, against what's on screen
  let countMax = 1, nvMax = 0;
  rows.forEach((r) => cols.forEach((i) => {
    if (metric === "signed") countMax = Math.max(countMax, r.signedCells[i]);
    if (metric === "leads") countMax = Math.max(countMax, r.leadCells[i]);
    if (metric === "nv" && r.leadCells[i] >= MIN_LEADS) nvMax = Math.max(nvMax, share(r.notViableCells[i], r.leadCells[i]));
  }));
  const convLevel = (p: number) => (p >= avg + 10 ? "l4" : p >= avg ? "l3" : p >= avg - 10 ? "l2" : "l1");
  // Inverted: the cheaper a sign-up against the period's average, the darker.
  const costLevel = (c: number) => {
    if (!grid.costAvg) return "";
    const x = c / grid.costAvg;
    return x <= 0.75 ? "l4" : x <= 1 ? "l3" : x <= 1.5 ? "l2" : "l1";
  };
  const loading = (i: number) => (stateOf(i) !== "full" ? " — this month's leads are still loading, so it runs high" : "");

  const bodyCell = (r: Row, i: number): Cell => {
    const L = r.leadCells[i], S = r.signedCells[i];
    const at = `${r.name} · ${monthLabel(months[i])}`;
    if (metric === "signed") return S ? { text: String(S), cls: level(S, countMax), title: `${at}: see the ${S} sign-up${S === 1 ? "" : "s"}`, drill: rowDrill(r, i) } : { text: "·" };
    if (metric === "leads") return L ? { text: String(L), cls: level(L, countMax), title: `${at}: see the ${plural(L, "lead")}`, drill: rowDrill(r, i) } : { text: "·" };
    if (metric === "conv" || metric === "nv") {
      if (!L) return { text: "·" };
      const n = metric === "conv" ? S : r.notViableCells[i];
      const what = metric === "conv" ? `${fmt(S)} of ${plural(L, "lead")} signed` : `${fmt(n)} of ${plural(L, "lead")} not viable`;
      const drill = metric === "conv" || n ? rowDrill(r, i) : undefined;
      if (L < MIN_LEADS) return { text: "·", title: `${at}: ${what} — too few leads for a share`, drill };
      const p = share(n, L);
      return { text: `${Math.round(p)}%`, cls: metric === "conv" ? convLevel(p) : level(p, nvMax), title: `${at}: ${what}`, drill };
    }
    const s = r.spendCells[i];
    if (s == null) return { text: "·" };
    // Money with nothing to show for it: the leads it did bring are the useful list.
    if (!S) return { text: "no sign-ups", cls: "mk-none", title: `${usd(s)} spent, no sign-ups`, drill: L ? rowDrill(r, i, "all") : undefined };
    const thin = S < MIN_SIGNED || stateOf(i) !== "full";
    return { text: usd(Math.round(s / S)), cls: thin ? "mk-mg-thin" : costLevel(s / S), title: `${usd(s)} / ${plural(S, "sign-up")}${loading(i)}`, drill: rowDrill(r, i) };
  };
  // A month not loaded from Lead Docket shows only a dot; the count stays in the title.
  const cellAt = (c: Cell, i: number): Cell =>
    stateOf(i) === "none" ? { text: "·", title: c.title ? `${c.title} (not loaded yet)` : undefined, drill: c.drill } : c;

  const rowTotal = (r: Row): Cell => {
    if (metric === "signed") return { text: fmt(r.signed), drill: rowDrill(r) };
    if (metric === "leads") return { text: fmt(r.leads), drill: rowDrill(r) };
    if (metric === "conv") return { text: `${pct1(r.signed, r.leads)}%`, title: `${fmt(r.signed)} of ${plural(r.leads, "lead")} signed`, drill: rowDrill(r) };
    if (metric === "nv") {
      const n = sum(r.notViableCells);
      return { text: `${pct1(n, r.leads)}%`, title: `${fmt(n)} of ${plural(r.leads, "lead")} not viable`, drill: n ? rowDrill(r) : undefined };
    }
    const s = spentBy(r);
    return r.signed
      ? { text: usd(Math.round(s / r.signed)), title: `${usd(s)} / ${plural(r.signed, "sign-up")}`, drill: rowDrill(r) }
      : { text: "no sign-ups", cls: "mk-none", title: `${usd(s)} spent, no sign-ups`, drill: rowDrill(r, undefined, "all") };
  };

  // ---- footer rows: the first is the metric's own monthly total
  const paidIn = (i: number) => grid.rows.reduce((a, r) => ((r.spendCells[i] ?? 0) > 0 ? { s: a.s + r.signedCells[i], l: a.l + r.leadCells[i] } : a), { s: 0, l: 0 });
  const paidLeads = sum(grid.rows.filter(hasSpend).map((r) => r.leads));
  const foot: Record<"signed" | "leads" | "conv" | "nv" | "cost" | "spend" | "perLead", (cls: Foot["cls"]) => Foot> = {
    signed: (cls) => ({
      name: "Signed", cls,
      cell: (i) => { const n = mon(i).signed; return { text: String(n), title: n ? `${monthLabel(months[i])}: see all ${plural(n, "sign-up")}` : undefined, drill: n ? allDrill(i, "signed") : undefined }; },
      total: { text: fmt(tot.signed) },
    }),
    leads: (cls) => ({
      name: "All leads", cls,
      cell: (i) => { const n = mon(i).leads; return { text: String(n), title: n ? `${monthLabel(months[i])}: see all ${plural(n, "lead")}` : undefined, drill: n ? allDrill(i, "all") : undefined }; },
      total: { text: fmt(tot.leads) },
    }),
    conv: (cls) => ({
      name: "Conversion", cls,
      cell: (i) => { const m = mon(i); return { text: `${Math.round(pct1(m.signed, m.leads))}%`, title: `${fmt(m.signed)} of ${plural(m.leads, "lead")} signed`, drill: m.leads ? allDrill(i, "all") : undefined }; },
      total: { text: `${avg}%` },
    }),
    nv: (cls) => ({
      name: "Not viable", cls,
      cell: (i) => {
        const m = mon(i);
        const tip = `${fmt(m.notViable)} of ${plural(m.leads, "lead")} not viable`;
        const drill = m.notViable ? allDrill(i, "all", true) : undefined;
        return m.leads >= MIN_LEADS ? { text: `${Math.round(share(m.notViable, m.leads))}%`, title: tip, drill } : { text: "·", title: m.leads ? tip : undefined, drill };
      },
      total: { text: `${pct1(tot.nv, tot.leads)}%`, title: `${fmt(tot.nv)} of ${plural(tot.leads, "lead")} not viable` },
    }),
    // Money isn't a list of clients, so the cost rows don't open one.
    cost: (cls) => ({
      name: "$ / sign-up", cls,
      cell: (i) => {
        const m = mon(i);
        if (m.spend == null) return { text: "·" };
        const paid = paidIn(i).s;
        if (m.costPerSignup == null) return { text: "no sign-ups", cls: "mk-none", title: `${usd(m.spend)} spent, no sign-ups in the ${noun}s it paid for` };
        return {
          text: usd(Math.round(m.costPerSignup)), cls: paid < MIN_SIGNED || stateOf(i) !== "full" ? "mk-mg-thin" : undefined,
          title: `${usd(m.spend)} / ${plural(paid, "sign-up")} in ${noun}s with spend${loading(i)}`,
        };
      },
      total: { text: grid.costAvg != null ? usd(Math.round(grid.costAvg)) : "—", title: grid.costAvg != null ? `${usd(tot.spend)} / sign-ups in ${noun}s with spend` : undefined },
    }),
    spend: (cls) => ({
      name: "Spend", cls,
      cell: (i) => { const s = mon(i).spend; return s == null ? { text: "·" } : { text: usd(s), title: `${monthLabel(months[i])}: all spend entered, matched or not` }; },
      total: { text: tot.spend ? usd(tot.spend) : "—" },
    }),
    perLead: (cls) => ({
      name: "$ / lead", cls,
      cell: (i) => {
        const m = mon(i);
        if (m.costPerLead == null) return { text: "·" };
        return { text: usd(Math.round(m.costPerLead)), title: `${usd(m.spend)} / ${plural(paidIn(i).l, "lead")} in ${noun}s with spend` };
      },
      total: { text: tot.spend && paidLeads ? usd(Math.round(tot.spend / paidLeads)) : "—" },
    }),
  };
  const foots: Foot[] =
    metric === "signed" ? [foot.signed("foot"), foot.leads("soft"), foot.conv("soft")]
    : metric === "leads" ? [foot.leads("foot"), foot.signed("soft"), foot.conv("soft")]
    : metric === "conv" ? [foot.conv("foot"), foot.signed("soft"), foot.leads("soft")]
    : metric === "nv" ? [foot.nv("foot"), foot.leads("soft"), foot.conv("soft")]
    : [foot.cost("foot"), foot.spend("soft"), foot.perLead("soft")];

  // A clickable cell holds a button, as the scorecard's do, so the keyboard can
  // reach it; the button's click bubbles up to the td.
  const td = (c: Cell, key: string | number, base: string) => (
    <td key={key} className={[base, c.cls, c.drill ? "sr-click" : ""].filter(Boolean).join(" ")} title={c.title}
      onClick={c.drill ? () => onDrill(c.drill!) : undefined}>
      {c.drill ? <button type="button" className="mk-sc-n">{c.text}</button> : c.text}
    </td>
  );

  const sub =
    metric === "leads" ? "Leads by the month they count in. A row adds up to its Total Leads on the scorecard."
    : metric === "conv" ? `The share of each month's leads that signed, once a month has ${MIN_LEADS} leads. Darker is further above the firm's ${avg}%.`
    : metric === "nv" ? `The share of each month's leads that weren't a viable case — no viable claim, not a case we take, past the deadline, or junk — once a month has ${MIN_LEADS} leads.`
    : metric === "cost" ? `Each month's spend over its sign-ups. Greyed with fewer than ${MIN_SIGNED} sign-ups, or while the month's leads are still loading.`
    : null;
  const hiddenNote = start > first && (hiddenLeads || hiddenSpend)
    ? `Months before ${monthLabel(months[start])} are left off — ${loadedFrom}. Their ${[hiddenLeads ? plural(hiddenLeads, "lead") : "", hiddenSpend ? `${usd(hiddenSpend)} of spend` : ""].filter(Boolean).join(" and ")} still count in the totals.`
    : cols.length > 0 && cols.every((i) => stateOf(i) === "none")
      ? `None of these months is loaded from Lead Docket yet — ${loadedFrom}. Hover a dot for what's in so far.`
      : null;

  let empty: string | null = null;
  if (!months.length || !rows.length) {
    empty = metric === "signed" ? "No sign-ups in this period."
      : metric !== "cost" ? "No leads in this period."
      : tot.spend ? `None of the spend entered matches a ${noun} with leads in this period.`
      : "Enter spend below to see cost per sign-up by month.";
  }

  return (
    <div className="sr-panel">
      <div className="sr-panel-h mk-mg-h">
        <div className="sr-ttl"><h2>{title} by {noun} and month</h2></div>
        <div className="sr-seg mk-mg-seg" role="group" aria-label="Show">
          {METRICS.map((m) => (
            <button key={m.key} className={metric === m.key ? "on" : ""} aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>{m.label}</button>
          ))}
        </div>
        <select className="sr-input mk-mg-sel" value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="Show">
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      {(sub || (metric === "cost" && rows.length > 0 && unpaid > 0)) && (
        <p className="sr-sub">
          {sub}
          {metric === "cost" && rows.length > 0 && unpaid > 0 && ` ${fmt(unpaid)} ${noun}${unpaid === 1 ? " has" : "s have"} no spend entered.`}
        </p>
      )}
      {empty ? <p className="sr-nil">{empty}</p> : (
        <>
          <div className="sr-scroll">
            <table className={`sr-grid mk-mg${metric === "cost" ? " mk-mg-money" : ""}`}>
              <thead>
                <tr>
                  <th className="name" />
                  {cols.map((i) => {
                    const st = stateOf(i);
                    return (
                      <th key={months[i]} className={st === "partial" ? "mk-part" : st === "none" ? "mk-mg-off" : undefined}
                        title={st === "partial" ? `Not fully loaded yet — ${loadedFrom}` : st === "none" ? `Not loaded yet — ${loadedFrom}` : undefined}>
                        {monthShort(months[i])}
                      </th>
                    );
                  })}
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const whole = rowDrill(r, undefined, metric === "cost" && !r.signed ? "all" : status);
                  return (
                    <tr key={r.name}>
                      <td className="name sr-click" onClick={() => onDrill(whole)}>
                        <button type="button" className="mk-sc-n"><span className="mk-mg-nm" title={r.name}>{r.name}</span></button>
                      </td>
                      {cols.map((i) => td(cellAt(bodyCell(r, i), i), i, "cell"))}
                      {td(rowTotal(r), "tot", "tot")}
                    </tr>
                  );
                })}
                {foots.map((f) => (
                  <tr key={f.name} className={f.cls}>
                    <td className="name"><span className="mk-mg-nm">{f.name}</span></td>
                    {cols.map((i) => td(cellAt(f.cell(i), i), i, "cell"))}
                    {td(f.total, "tot", "tot")}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {metric === "nv" && (
            <div className="sr-legend mk-mg-legend">
              <span>fewer</span>
              <span className="mk-mg-ramp" aria-hidden><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /></span>
              <span>more no-viable-claim</span>
            </div>
          )}
          {metric === "cost" && (
            <div className="sr-legend mk-mg-legend">
              <span>cheaper than average</span>
              <span className="mk-mg-ramp" aria-hidden><i className="l4" /><i className="l3" /><i className="l2" /><i className="l1" /></span>
              <span>dearer</span>
              <span className="mk-mg-key"><i className="mk-mg-sw-thin" aria-hidden /> too few sign-ups, or still loading</span>
            </div>
          )}
        </>
      )}
      {hiddenNote && <p className="sr-sub mk-mg-note">{hiddenNote}</p>}
    </div>
  );
}
