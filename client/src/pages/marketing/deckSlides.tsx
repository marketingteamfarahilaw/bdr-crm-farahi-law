/**
 * The slides of the Marketing Report's presentation mode (./Presentation.tsx,
 * on the Sign-ups deck's shell): one idea per slide, built from the dashboard
 * data already on screen, frozen when presenting began.
 *
 * Numbers are the page's own, formatted the way the page formats them; the only
 * arithmetic here is adding rows up (an "Other" row, so a table still adds to its
 * TOTAL) and one share in a title. A slide whose data would be empty or
 * meaningless is left out: no months for a single month, no changes without a
 * loaded comparison, no reasons for someone not cleared for intake case facts.
 *
 * Unlike the Sign-ups deck, this one names clients: the appendix lists every
 * rejected case with its reason, because that list is what Youssef asked the
 * deck for (Sept 2026). It is built only for marketingCaseFacts (data.caseFacts),
 * the same people the page shows the Rejected panel to; the server strips the
 * reason for anyone else regardless.
 *
 * Sizes in Presentation.css (and the Sign-ups deck's, whose classes these reuse)
 * are design pixels on the 1920×1080 stage.
 */
import type { ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { DollarSign, Info, Percent, TrendingUp, Trophy, Users } from "lucide-react";
import { NOT_VIABLE, NO_SOURCE, REASON_LABEL, TEAM_CHANNEL, type ReasonKey } from "@shared/marketing";
import type { AppRouter } from "../../../../server/routers";
import type { LeadListRow } from "../../../../server/marketing/leadFilter";
import { fmt, hueStyle, initials, leadDay, monthAbbr, monthLabel, rangeLabel, standing } from "../SignupsDashboard";
import { pages, type Pos, type Slide } from "../signups/slides";
import { delta, rowNameOf, usd, type Delta, type Group } from "./shared";
import "./WhyNotSigned.css";

type Out = inferRouterOutputs<AppRouter>["marketing"];
export type MarketingData = NonNullable<Out["dashboard"]>;
/** The appendix's cases: trpc.marketing.leads with rejectedQuery (./shared). */
export type RejectedCases = Out["leads"];

export type DeckContext = {
  from: string;
  to: string;
  group: Group;
  /** The period button that is on ("This month"…); none for custom dates. */
  preset?: string;
};

type Totals = MarketingData["totals"];
type Source = MarketingData["sources"][number];
type Month = MarketingData["monthly"][number];
type Cmp = NonNullable<MarketingData["compare"]>;
type Why = NonNullable<MarketingData["why"]>;

/** The page's briefing icons, in its order, so a line keeps its icon on the slide. */
const INSIGHT_ICONS = [Trophy, Percent, Users, DollarSign, Info, TrendingUp];
// The server's NO_REASON (server/marketing/leadFilter.ts): a lead with no sub-status.
const NO_REASON = "No reason recorded";
// Twelve cases fit a slide at a size the back of the room can read.
const CASES_PER_SLIDE = 12;
// The page leaves a contact route's conversion uncoloured under this many leads (Routes.tsx).
const ROUTE_MIN_LEADS = 20;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const count = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
/** The server's pct (server/marketing/common.ts): a percent with one decimal. */
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const width = (n: number, of: number) => `${of ? Math.min(100, (n / of) * 100) : 0}%`;
// Referred reuses the page's hatch; every other family has a token in WhyNotSigned.css.
const swatch = (k: ReasonKey) => `mk-r-${k}${k === "referred" ? " sr-s-hatch" : ""}`;
// A rejected lead never signed, so its lead date is the day it came in (as Clients.tsx reads it).
const cameIn = (l: LeadListRow) => l.createdAt ?? l.date;

/** What every slide says about the selection, worked out once. */
type Meta = {
  /** "September 1–25, 2026", as the page's hero says it. */
  period: string;
  noun: "channel" | "source";
  /** Every slide's footer, so a photo of the screen still says what it shows. */
  foot: string;
  /** The comparison, when it is worth stating: a period Lead Docket hasn't fully loaded says nothing, as on the page. */
  cmp: Cmp | null;
};

function metaOf(data: MarketingData, ctx: DeckContext): Meta {
  const period = rangeLabel(ctx.from, ctx.to);
  return {
    period,
    noun: ctx.group === "channel" ? "channel" : "source",
    foot: ["Marketing report", period, ctx.group === "channel" ? "Channels" : "Sources"].join(" · "),
    cmp: data.compare && !data.compare.partial ? data.compare : null,
  };
}

export function buildMarketingSlides(data: MarketingData, ctx: DeckContext, cases: RejectedCases | null): Slide[] {
  const meta = metaOf(data, ctx);
  const slides: Slide[] = [
    { id: "cover", label: "Leads and sign-ups for the period", render: (pos) => <Cover data={data} ctx={ctx} meta={meta} pos={pos} /> },
  ];
  // No leads: the cover says so, and nothing else would be worth a slide.
  if (!data.totals.leads) return slides;

  const signedRows = data.sources.filter((s) => s.signed > 0);
  if (signedRows.length) {
    slides.push({ id: "sources", label: "Where sign-ups came from", render: (pos) => <Sources rows={signedRows} totals={data.totals} meta={meta} pos={pos} /> });
  }
  slides.push({
    id: "scorecard",
    label: `${ctx.group === "channel" ? "Channel" : "Source"} scorecard`,
    render: (pos) => <ScorecardSlide data={data} meta={meta} pos={pos} />,
  });

  // From the first month with a lead: All time starts in Jan 2020, years before
  // Lead Docket's history, and those empty months would drag the average down.
  const first = data.monthly.findIndex((m) => m.leads > 0);
  const months = first < 0 ? [] : data.monthly.slice(first);
  // A single month is a number, not a trend.
  if (months.length >= 2) {
    slides.push({
      id: "trend", label: "Sign-ups by month",
      render: (pos) => <Trend months={months} trimmed={first > 0} pace={data.pace} meta={meta} pos={pos} />,
    });
  }

  if (meta.cmp) {
    const moves = movesOf(data.sources, meta.cmp);
    if (moves.up.length || moves.down.length) {
      slides.push({
        id: "changes", label: `Biggest changes against ${meta.cmp.label}`,
        render: (pos) => <Changes moves={moves} totals={data.totals} cmp={meta.cmp!} meta={meta} pos={pos} />,
      });
    }
  }

  // Why leads didn't sign is an intake case fact: the server sends it only to those who may see it.
  if (data.why && data.why.funnel.leads) {
    slides.push({ id: "why", label: "Why leads didn't sign", render: (pos) => <WhySlide why={data.why!} meta={meta} pos={pos} /> });
  }
  // One route, or one case type, is a sentence, not a chart.
  if (data.routes.rows.length >= 2) {
    slides.push({ id: "routes", label: "How leads reached us", render: (pos) => <RoutesSlide data={data} meta={meta} pos={pos} /> });
  }
  if (data.caseTypes.length >= 2) {
    slides.push({ id: "case-types", label: "Case types", render: (pos) => <CaseTypesSlide data={data} meta={meta} pos={pos} /> });
  }
  if (data.insights.length) {
    slides.push({ id: "briefing", label: "Executive briefing", dark: true, render: (pos) => <Briefing insights={data.insights} meta={meta} pos={pos} /> });
  }

  if (data.caseFacts && cases && cases.total > 0 && cases.rows.length > 0) {
    slides.push(...appendix(cases, data.totals.leads, ctx.group, meta));
  }
  return slides;
}

/* ---------------------------------------------------------------- frame */

/** The Sign-ups deck's frame (same markup and classes), with this report's footer. */
function Frame({ meta, pos, kicker, title, sub, className = "", children }: {
  meta: Meta; pos: Pos; kicker?: ReactNode; title?: string; sub?: ReactNode; className?: string; children: ReactNode;
}) {
  // A long title (a channel's full name) steps down a size rather than wrapping into the body.
  const fit = !title ? "" : title.length > 72 ? " t-xs" : title.length > 62 ? " t-s" : title.length > 50 ? " t-m" : "";
  return (
    <div className={`sr-slide ${className}${fit}`}>
      {(kicker || title) && (
        <header className="sr-slide-h">
          {kicker && <div className="sr-slide-kicker">{kicker}</div>}
          {title && <h2 className="sr-slide-title">{title}</h2>}
          {sub && <p className="sr-slide-sub">{sub}</p>}
        </header>
      )}
      <div className="sr-slide-body">{children}</div>
      <footer className="sr-slide-foot">
        <span>{meta.foot}</span>
        <span>{pos.n} / {pos.of}</span>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------------- slides */

function Cover({ data, ctx, meta, pos }: { data: MarketingData; ctx: DeckContext; meta: Meta; pos: Pos }) {
  const t = data.totals;
  const kicker = (
    <>
      <span>Marketing report · {ctx.preset ?? "Custom period"}</span>
      <span className="sr-deck-pill">{ctx.group === "channel" ? "By channel" : "By source"}</span>
      {meta.cmp && <span className="sr-deck-pill">vs {meta.cmp.label}</span>}
    </>
  );

  if (!t.leads) {
    return (
      <Frame meta={meta} pos={pos} kicker={kicker} title={meta.period}>
        <div className="sr-cv-nil">
          <p className="sr-cv-nil-h">No leads in {meta.period}.</p>
          <p>Pick another period on the report, then press Present again.</p>
        </div>
      </Frame>
    );
  }

  // With a comparison the side says how the period moved, and conversion joins
  // the numbers; without one the side is the conversion ring, as on the page.
  const cmp = meta.cmp;
  const stats = [
    { n: fmt(t.leads), label: "Leads" },
    ...(cmp ? [{ n: `${t.conversion}%`, label: "Conversion" }] : []),
    ...(t.costPerSignup != null ? [{ n: usd(t.costPerSignup), label: "Per sign-up" }] : []),
  ];
  const R = 70, CIRC = 2 * Math.PI * R;
  const loading = data.compare?.partial ? data.compare.label : null;

  return (
    <Frame meta={meta} pos={pos} kicker={kicker} title={meta.period}>
      <div className={`sr-cv${stats.length > 2 ? " mk-dk-cv3" : ""}`}>
        <div className="sr-cv-main">
          <div className="sr-cv-num">
            <b>{fmt(t.signed)}</b>
            <span>{t.signed === 1 ? "client signed" : "clients signed"}</span>
          </div>
          <div className="sr-cv-stats">
            {stats.map((s) => <div key={s.label}><b>{s.n}</b><span>{s.label}</span></div>)}
          </div>
        </div>
        <div className="sr-cv-side">
          {cmp ? <Against totals={t} cmp={cmp} /> : (
            <>
              <div className="sr-cv-ring">
                <svg viewBox="0 0 164 164" aria-hidden="true">
                  <circle className="trk" cx="82" cy="82" r={R} />
                  {t.conversion > 0 && <circle className="val" cx="82" cy="82" r={R} strokeDasharray={`${(CIRC * Math.min(t.conversion, 100)) / 100} ${CIRC}`} />}
                </svg>
                <div className="sr-cv-ring-c">
                  <b>{t.conversion}%</b>
                  <span>of leads signed</span>
                </div>
              </div>
              {/* The page greys a comparison Lead Docket hasn't loaded; here it is simply not made. */}
              {loading && <p className="sr-cv-note">Not compared with {loading}: Lead Docket is still loading it.</p>}
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}

/** The change pill's words without the share: "+12 (+11%)" → "+12". */
const head = (d: Delta) => (d.text === "·" ? "±0" : d.text.replace(/\s*\(.*\)$/, ""));
const share = (d: Delta) => /\((.*)\)$/.exec(d.text)?.[1] ?? null;

/** The cover's side with a comparison: the page's change pills, as numbers. */
function Against({ totals: t, cmp }: { totals: Totals; cmp: Cmp }) {
  const signed = delta(t.signed, cmp.totals.signed, "count");
  const lines: [string, Delta][] = [
    ["Leads", delta(t.leads, cmp.totals.leads, "count")],
    ["Conversion", delta(t.conversion, cmp.totals.conversion, "pct")],
  ];
  // A part month's spend counts in full, so cost is compared only between whole months (as on the page).
  if (cmp.costComparable && t.costPerSignup != null && cmp.totals.costPerSignup != null) {
    lines.push(["Per sign-up", delta(t.costPerSignup, cmp.totals.costPerSignup, "money", true)]);
  }
  const s = share(signed);
  return (
    <div className="mk-dk-vs">
      <span className="mk-dk-vs-h">Against {cmp.label}</span>
      <b className={`mk-dk-vs-n mk-dk-${signed.tone}`}>{head(signed)}</b>
      <span className="mk-dk-vs-s">sign-ups{s ? ` (${s})` : ""} · {fmt(cmp.totals.signed)} then</span>
      <div className="mk-dk-vs-l">
        {lines.map(([label, d]) => (
          <div key={label}><span>{label}</span><b className={`mk-dk-${d.tone}`}>{d.text === "·" ? "±0" : d.text}</b></div>
        ))}
      </div>
    </div>
  );
}

function Sources({ rows, totals, meta, pos }: { rows: Source[]; totals: Totals; meta: Meta; pos: Pos }) {
  // The server sends the rows most sign-ups first, as the scorecard shows them.
  const top = rows.slice(0, 8);
  const [a, b] = top;
  const tiedAtTop = rows.filter((s) => s.signed === a.signed).length;
  const title = tiedAtTop > 2
    ? "Where sign-ups came from"
    : tiedAtTop === 2
      ? `${a.name} and ${b.name} brought the most sign-ups`
      : `${a.name} brought ${fmt(a.signed)} of ${fmt(totals.signed)} sign-ups`;
  const rest = rows.slice(top.length);
  const sub = rest.length
    ? `${count(rest.length, `more ${meta.noun}`, `more ${meta.noun}s`)} signed ${count(sum(rest.map((s) => s.signed)), "client")}.`
    : undefined;
  const what = (s: Source) =>
    s.name === TEAM_CHANNEL ? "BDR and FR representatives"
      : s.name === NO_SOURCE ? "Marketing Source left empty in Lead Docket"
        : meta.noun === "channel" && s.members.length > 1 ? `${s.members.length} Lead Docket sources`
          : null;

  return (
    <Frame meta={meta} pos={pos} kicker="Where sign-ups came from" title={title} sub={sub}>
      <div className={`sr-pt mk-dk-pt${top.length > 6 ? " dense" : ""}`}>
        {top.map((s, i) => {
          const note = what(s);
          return (
            <div key={s.name} className={`sr-pt-row${i === 0 ? " first" : ""}`}>
              <span className="sr-deck-av" style={hueStyle(s.name)}>{initials(s.name)}</span>
              <div className="sr-pt-who"><b>{s.name}</b>{note && <i>{note}</i>}</div>
              <div className="sr-deck-bar-t"><i style={{ width: width(s.signed, a.signed) }} /></div>
              <div className="sr-pt-n"><b>{fmt(s.signed)}</b><span>of {count(s.leads, "lead")} · {s.conversion}%</span></div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

type Line = Pick<Source, "leads" | "open" | "rejected" | "referredOut" | "notInterested" | "signed" | "conversion" | "spend" | "costPerSignup">;

/** Rows added into one, so a table that shows only the biggest still adds up to its TOTAL. */
function fold(rows: Line[]): Line {
  const add = (k: "leads" | "open" | "rejected" | "referredOut" | "notInterested" | "signed") => sum(rows.map((r) => r[k]));
  const spent = rows.filter((r) => r.spend != null);
  const leads = add("leads"), signed = add("signed");
  return {
    leads, signed, conversion: pct(signed, leads),
    open: add("open"), rejected: add("rejected"), referredOut: add("referredOut"), notInterested: add("notInterested"),
    spend: spent.length ? sum(spent.map((r) => r.spend ?? 0)) : null,
    // The page's cost per sign-up counts only rows with spend entered, so a folded row doesn't claim one.
    costPerSignup: null,
  };
}

function ScorecardSlide({ data, meta, pos }: { data: MarketingData; meta: Meta; pos: Pos }) {
  const t = data.totals;
  // The ten biggest by leads; a single leftover row is shown by name rather than folded on its own.
  const byLeads = [...data.sources].sort((a, b) => b.leads - a.leads);
  const shown = byLeads.length > 11 ? byLeads.slice(0, 10) : byLeads;
  const rest = byLeads.slice(shown.length);
  const other = rest.length ? fold(rest) : null;
  const money = t.spend != null;
  const lines = shown.length + (other ? 1 : 0);
  const unmatched = sum(data.spendUnmatched.map((u) => u.amount));
  const Noun = meta.noun === "channel" ? "Channel" : "Source";
  // The TOTAL row's headline cells are "big", as on the page.
  const cells = (r: Line, total = false) => {
    const big = total ? "big" : undefined;
    return (
      <>
        <td>{fmt(r.leads)}</td><td>{fmt(r.open)}</td><td>{fmt(r.rejected)}</td><td>{fmt(r.referredOut)}</td><td>{fmt(r.notInterested)}</td>
        <td className={big ?? "tot blue"}>{fmt(r.signed)}</td>
        <td className={big}>{r.conversion}%</td>
        {/* Whole dollars: the page's cents don't fit a column read from the back of the room. */}
        {money && <><td className={big}>{usd(r.spend)}</td><td className={big}>{usd(r.costPerSignup)}</td></>}
      </>
    );
  };
  const note = [
    "Each lead counts once, in the column where it ended up; lost and closed count as Rejected, and Total Signed includes signed-then-referred-out.",
    other ? `The ${rest.length} smallest ${meta.noun}s are added up in one row.` : "",
    money && unmatched > 0 ? `Spend includes ${usd(unmatched)} entered for names with no leads in this period.` : "",
  ].filter(Boolean).join(" ");

  return (
    // No slide title: the sheet's own title bar says the period, as on the page.
    <Frame meta={meta} pos={pos} className="sr-dsc-slide">
      <div className={`sr-sc mk-dk-sc${money ? " money" : ""}${lines > 8 ? " dense" : ""}`}>
        <div className="sr-sc-title">{meta.period}</div>
        <div className="sr-sc-band">{meta.noun === "channel" ? "MARKETING CHANNELS" : "MARKETING SOURCES"}</div>
        <table className="sr-sct">
          <thead>
            <tr>
              <th className="l">{Noun}</th><th>Total Leads</th><th>Open</th><th>Rejected</th><th>Referred Out</th><th>Not Interested</th>
              <th className="tot">Total Signed</th><th>Conversion</th>
              {money && <><th>Spend</th><th>Cost / Sign-up</th></>}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.name}>
                {/* Without the page's "3 sources" pill: the name needs the room, and the sources slide says it. */}
                <td className="l"><b>{s.name}</b></td>
                {cells(s)}
              </tr>
            ))}
            {other && (
              <tr>
                <td className="l"><span className="last">{rest.length} smaller {meta.noun}s</span></td>
                {cells(other)}
              </tr>
            )}
            <tr className="total">
              <td className="l">TOTAL</td>
              {cells(t, true)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="sr-dsc-note">{note}</p>
    </Frame>
  );
}

function Trend({ months, trimmed, pace, meta, pos }: {
  months: Month[]; trimmed: boolean; pace: MarketingData["pace"]; meta: Meta; pos: Pos;
}) {
  const shown = months.slice(-12);
  const total = sum(months.map((m) => m.signed));
  // The page's "average per month" (MonthsCard): the period's sign-ups over its months.
  const perMonth = Math.round(total / months.length);
  const max = Math.max(1, ...shown.map((m) => m.signed));
  const best = months.reduce((b, m) => (m.signed >= b.signed ? m : b));
  const latest = shown[shown.length - 1];
  // The server's pace: set only when the period runs to today and ends in this month.
  const running = pace?.month === latest.month ? pace : null;
  const sub = total
    ? `Average ${fmt(perMonth)} a month${trimmed ? ` since ${monthLabel(months[0].month)}` : ""} · best: ${monthLabel(best.month)} with ${fmt(best.signed)}`
    : "No sign-ups yet in these months";
  const notes = [running?.text ?? "", months.length > 12 ? `Last 12 of ${months.length} months.` : ""].filter(Boolean);

  return (
    <Frame meta={meta} pos={pos} kicker="Trend" title="Sign-ups by month" sub={sub}>
      <div className="sr-tr">
        <div className="sr-tr-chart">
          {shown.map((m, i) => {
            const hot = i === shown.length - 1;
            const part = hot && !!running;
            const h = (m.signed / max) * 100;
            return (
              <div key={m.month} className={`sr-tr-col${hot ? " hot" : ""}${part ? " part" : ""}`}>
                <div className="sr-tr-plot">
                  <i className="sr-tr-fill" style={{ height: `${h}%` }} />
                  {/* Above the bar, or above its 36px base dot when the bar is shorter. */}
                  <span className="sr-tr-v" style={{ bottom: `calc(max(${h}%, 36px) + 16px)` }}>{fmt(m.signed)}{part ? " so far" : ""}</span>
                </div>
                <span className="sr-tr-m">{monthAbbr(m.month)}{i === 0 || m.month.endsWith("-01") ? ` '${m.month.slice(2, 4)}` : ""}</span>
                <span className="sr-tr-c">{m.leads ? `${Math.round(m.conversion)}%` : "—"}</span>
              </div>
            );
          })}
        </div>
        {notes.length > 0 && <p className="sr-tr-note">{notes.join(" ")}</p>}
      </div>
    </Frame>
  );
}

type Move = { name: string; cur: number; prev: number; delta: number };
type Moves = { up: Move[]; down: Move[]; unsourced: number };

/** The server's order for moves (compare.ts byMove): bigger first, then larger for its size. */
const byMove = (a: Move, b: Move) =>
  Math.abs(b.delta) - Math.abs(a.delta)
  || Math.abs(b.delta) / Math.sqrt(b.prev + 1) - Math.abs(a.delta) / Math.sqrt(a.prev + 1)
  || a.name.localeCompare(b.name);

/**
 * Each row's sign-ups against the earlier period, gone rows at zero, as the
 * scorecard's change column counts them. "No source recorded" is left out, as the
 * server's mover and briefing leave it: it is missing data, not a channel.
 */
function movesOf(rows: Source[], cmp: Cmp): Moves {
  const prevOf = (name: string) => (Object.prototype.hasOwnProperty.call(cmp.byName, name) ? cmp.byName[name].signed : 0);
  const all: Move[] = [
    ...rows.map((s) => ({ name: s.name, cur: s.signed, prev: prevOf(s.name) })),
    ...cmp.gone.map((g) => ({ name: g.name, cur: 0, prev: g.signed })),
  ].map((m) => ({ ...m, delta: m.cur - m.prev }));
  const moved = all.filter((m) => m.delta !== 0 && m.name !== NO_SOURCE).sort(byMove);
  return {
    up: moved.filter((m) => m.delta > 0).slice(0, 5),
    down: moved.filter((m) => m.delta < 0).slice(0, 5),
    unsourced: all.find((m) => m.name === NO_SOURCE)?.delta ?? 0,
  };
}

const signedNum = (n: number) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

function Changes({ moves, totals, cmp, meta, pos }: { moves: Moves; totals: Totals; cmp: Cmp; meta: Meta; pos: Pos }) {
  const cur = totals.signed, was = cmp.totals.signed, d = cur - was;
  // The server's briefing line (compare.ts): the % only once the earlier period had 10.
  const pctText = was >= 10 ? ` (${Math.round((Math.abs(d) / was) * 100)}%)` : "";
  const title = d === 0 ? `Sign-ups level with ${cmp.label}` : `Sign-ups ${d > 0 ? "up" : "down"} ${fmt(Math.abs(d))}${pctText} on ${cmp.label}`;
  const sub = `${fmt(cur)} sign-ups against ${fmt(was)}, by ${meta.noun}.`
    + (moves.unsourced ? ` Leads with no Marketing Source (${signedNum(moves.unsourced)}) aren't a ${meta.noun}, so they aren't listed.` : "");
  const col = (heading: string, list: Move[]) => list.length > 0 && (
    <div className="mk-dk-chg-col">
      <div className="mk-dk-chg-h">{heading}</div>
      {list.map((m) => (
        <div key={m.name} className="mk-dk-chg-row">
          <div className="mk-dk-chg-who"><b>{m.name}</b><i>was {fmt(m.prev)}, now {fmt(m.cur)}</i></div>
          <span className={`mk-dk-chg-d ${m.delta > 0 ? "mk-dk-ok" : "mk-dk-bad"}`}>{signedNum(m.delta)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <Frame meta={meta} pos={pos} kicker={`Against ${cmp.label}`} title={title} sub={sub}>
      <div className={`mk-dk-chg${moves.up.length && moves.down.length ? "" : " solo"}`}>
        {col("Gained the most", moves.up)}
        {col("Dropped the most", moves.down)}
      </div>
    </Frame>
  );
}

function WhySlide({ why, meta, pos }: { why: Why; meta: Meta; pos: Pos }) {
  const f = why.funnel;
  const families = why.families.filter((x) => x.leads > 0);
  const max = Math.max(1, ...families.map((x) => x.leads));
  // Worded and rounded as the page's funnel says them.
  const sub = [
    `${Math.round(f.viableRate)}% of leads`,
    `${fmt(f.signed)} signed, ${Math.round(f.winRate)}% of the viable ones`,
    f.costPerViable != null ? `${usd(f.costPerViable)} per viable lead` : "",
  ].filter(Boolean).join(" · ");

  return (
    <Frame meta={meta} pos={pos} kicker="Why leads didn't sign" title={`${fmt(f.viable)} of ${fmt(f.leads)} leads were real, viable cases`} sub={sub}>
      <div className="mk-dk-why">
        {families.map((x) => (
          <div key={x.key} className="mk-dk-why-row">
            <span className={`mk-dk-why-sw ${swatch(x.key)}`} aria-hidden="true" />
            <span className="mk-dk-why-l"><b>{x.label}</b>{NOT_VIABLE.has(x.key) && <em>not viable</em>}</span>
            <div className="mk-dk-why-t"><i className={swatch(x.key)} style={{ width: width(x.leads, max) }} /></div>
            <span className="mk-dk-why-n">{fmt(x.leads)}</span>
            <span className="mk-dk-why-p">{x.share}%</span>
          </div>
        ))}
      </div>
      <p className="mk-dk-note">
        From Lead Docket's sub-status; every lead is in one group. Viable = every lead except no viable claim, not a case we take, past the deadline and junk.
      </p>
    </Frame>
  );
}

type Bar = { name: string; leads: number; signed: number; conversion: number; badge: string | null };

/** Leads as the pale track, signed laid over it: the Sign-ups deck's case-type rows. */
function LeadsSigned({ rows }: { rows: Bar[] }) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <div className="sr-ct mk-dk-ct">
      <div className="sr-ct-legend" aria-hidden="true">
        <span><i className="s" /> Signed</span>
        <span><i className="l" /> Leads</span>
      </div>
      {rows.map((c, i) => (
        <div key={c.name} className={`sr-ct-row${i === 0 ? " first" : ""}`}>
          <b className="sr-ct-name">{c.name}</b>
          <div className="sr-ct-bar">
            <i className="l" style={{ width: width(c.leads, max) }} />
            <i className="s" style={{ width: width(c.signed, max) }} />
          </div>
          <span className="sr-ct-of">{fmt(c.signed)} of {fmt(c.leads)} signed</span>
          {c.badge ? <span className={`sr-badge ${c.badge}`}>{c.conversion}%</span> : <span className="mk-dk-na">—</span>}
        </div>
      ))}
    </div>
  );
}

/** The six biggest, and the rest added up in one row when there are two or more of them. */
function topSix<T extends { leads: number; signed: number }>(rows: T[], toBar: (r: T) => Bar, restName: (n: number) => string, badgeOf: (conv: number, leads: number) => string | null): Bar[] {
  const shown = rows.length > 7 ? rows.slice(0, 6) : rows;
  const rest = rows.slice(shown.length);
  const bars = shown.map(toBar);
  if (rest.length) {
    const leads = sum(rest.map((r) => r.leads)), signed = sum(rest.map((r) => r.signed));
    const conversion = pct(signed, leads);
    bars.push({ name: restName(rest.length), leads, signed, conversion, badge: badgeOf(conversion, leads) });
  }
  return bars;
}

function RoutesSlide({ data, meta, pos }: { data: MarketingData; meta: Meta; pos: Pos }) {
  const avg = data.totals.conversion;
  // As on the page: a rate from a handful of leads says nothing about the door, so it isn't coloured.
  const badgeOf = (conv: number, leads: number) => (leads >= ROUTE_MIN_LEADS ? standing(conv, avg).badge : null);
  const rows = data.routes.rows;   // most leads first
  const bars = topSix(rows, (r) => ({ ...r, badge: badgeOf(r.conversion, r.leads) }), (n) => `All other routes (${n})`, badgeOf);
  const top = rows[0];
  const share = Math.round((top.leads / data.totals.leads) * 100);
  const title = top.name === "Not recorded" ? `${share}% of leads have no contact route recorded` : `${share}% of leads came in through ${top.name}`;
  const same = data.routes.sameAsSource;
  const sub = "Contact Source is the door a lead came through; Marketing Source gets the credit."
    + (same >= 1 ? ` They are the same for about ${Math.round(same)}% of leads.` : "");

  return (
    <Frame meta={meta} pos={pos} kicker="How leads reached us" title={title} sub={sub}>
      <LeadsSigned rows={bars} />
    </Frame>
  );
}

function CaseTypesSlide({ data, meta, pos }: { data: MarketingData; meta: Meta; pos: Pos }) {
  const avg = data.totals.conversion;
  // The page's case-type list: green at or above the firm's conversion, grey below.
  const badgeOf = (conv: number) => (conv >= avg ? "sr-b-ok" : "sr-b-grey");
  const byLeads = [...data.caseTypes].sort((a, b) => b.leads - a.leads);
  const bars = topSix(byLeads, (c) => ({ ...c, badge: badgeOf(c.conversion) }), (n) => `Other (${n} types)`, badgeOf);
  const top = byLeads[0];
  const share = Math.round((top.leads / data.totals.leads) * 100);
  const title = top.name === "Not recorded" ? `${share}% of leads have no case type recorded` : `${top.name} is ${share}% of leads`;

  return (
    <Frame meta={meta} pos={pos} kicker="Case types" title={title}>
      <LeadsSigned rows={bars} />
    </Frame>
  );
}

/** The page's dark briefing card as the closing slide, the server's text as written. */
function Briefing({ insights, meta, pos }: { insights: string[]; meta: Meta; pos: Pos }) {
  const chars = insights.join("").length;
  const density = chars > 1300 ? " xdense" : chars > 900 ? " dense" : "";
  return (
    <Frame meta={meta} pos={pos} kicker="Executive briefing" title="What the numbers say" className={`sr-slide-dark${density}`}>
      <div className="sr-bf solo">
        <div className="sr-bf-list">
          {insights.map((text, n) => {
            const Icon = INSIGHT_ICONS[n % INSIGHT_ICONS.length];
            return (
              <div key={n} className="sr-bf-i">
                <span className="sr-bf-ic"><Icon /></span>
                <p>{text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------------- appendix: rejected cases */

const reasonOf = (l: LeadListRow) => l.reason ?? NO_REASON;
// Grouped as the server groups reasons (keyOf): spellings that differ only in case are one.
const reasonKey = (l: LeadListRow) => reasonOf(l).toLowerCase();

/**
 * Most common reason first, newest first within each (the server sends them
 * newest first and the sort is stable). "No reason recorded" goes last whatever
 * its size: it says nothing about why, and the list should lead with what does.
 */
function byReason(rows: LeadListRow[]): LeadListRow[] {
  const n = new Map<string, number>();
  for (const l of rows) n.set(reasonKey(l), (n.get(reasonKey(l)) ?? 0) + 1);
  const none = NO_REASON.toLowerCase();
  const rank = (k: string) => (k === none ? -1 : n.get(k) ?? 0);
  return [...rows].sort((a, b) => {
    const ka = reasonKey(a), kb = reasonKey(b);
    return rank(kb) - rank(ka) || ka.localeCompare(kb);
  });
}

function appendix(cases: RejectedCases, leads: number, group: Group, meta: Meta): Slide[] {
  const total = cases.total;
  const rows = byReason(cases.rows);
  const out: Slide[] = [
    { id: "rejected", label: "Rejected cases and why", render: (pos) => <RejectedSummary cases={cases} leads={leads} meta={meta} pos={pos} /> },
  ];
  const parts = pages(rows, CASES_PER_SLIDE);
  parts.forEach((part, i) => {
    const first = i * CASES_PER_SLIDE + 1, last = first + part.length - 1;
    const range = first === last ? `Rejected case ${fmt(first)} of ${fmt(total)}` : `Rejected cases ${fmt(first)}–${fmt(last)} of ${fmt(total)}`;
    // The endpoint sends the newest 500; the last page says so rather than end as if that were all.
    const note = i === parts.length - 1 && total > rows.length
      ? `The newest ${fmt(rows.length)} of ${fmt(total)} — narrow the period to see all.`
      : null;
    out.push({
      id: `rejected-${i + 1}`,
      label: range,
      render: (pos) => <RejectedPage rows={part} after={i > 0 ? parts[i - 1][parts[i - 1].length - 1] : null} kicker={`Appendix · ${range}`} note={note} group={group} meta={meta} pos={pos} />,
    });
  });
  return out;
}

function RejectedSummary({ cases, leads, meta, pos }: { cases: RejectedCases; leads: number; meta: Meta; pos: Pos }) {
  const why = cases.why ?? [];   // the eight biggest reasons, with each one's family
  const max = Math.max(1, ...why.map((w) => w.n));
  const listed = sum(why.map((w) => w.n));
  const rest = cases.total - listed;

  return (
    <Frame meta={meta} pos={pos} kicker="Appendix · Rejected cases and why"
      title={`${fmt(cases.total)} of ${count(leads, "lead")} were rejected`}
      sub="Rejected is the scorecard's column: rejected, lost or closed in Lead Docket. The reason is intake's sub-status.">
      <div className="mk-dk-rs">
        {why.map((w, i) => (
          <div key={w.family + "|" + w.reason} className={`mk-dk-rs-row${i === 0 ? " first" : ""}`}>
            <span className="mk-dk-rs-l"><b>{w.reason}</b><i>{REASON_LABEL[w.family]}</i></span>
            <div className="sr-deck-bar-t"><i style={{ width: width(w.n, max) }} /></div>
            <span className="mk-dk-rs-n">{fmt(w.n)}</span>
          </div>
        ))}
      </div>
      <p className="mk-dk-note">
        {rest > 0 ? `${count(rest, "more case")} ${rest === 1 ? "has" : "have"} other reasons. ` : ""}
        Every case follows, most common reason first and newest first within each.
      </p>
    </Frame>
  );
}

function RejectedPage({ rows, after, kicker, note, group, meta, pos }: {
  rows: LeadListRow[]; after: LeadListRow | null; kicker: string; note: string | null; group: Group; meta: Meta; pos: Pos;
}) {
  return (
    <Frame meta={meta} pos={pos} kicker={kicker}>
      <table className="mk-dk-cases">
        <thead>
          <tr>
            <th className="c">Client</th><th className="t">Case type</th><th className="s">{group === "channel" ? "Channel" : "Source"}</th>
            <th className="d">Came in</th><th className="r">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => {
            const prev = i > 0 ? rows[i - 1] : after;
            // A rule where one reason's cases end and the next begin.
            const starts = !!prev && reasonKey(prev) !== reasonKey(l);
            // Lost and Closed say something Rejected doesn't; a plain Rejected goes without saying here.
            const outcome = l.outcome && !/^rejected/i.test(l.outcome) ? l.outcome : null;
            return (
              <tr key={l.id} className={starts ? "grp" : undefined}>
                <td className="c"><span className="mk-dk-clamp"><b>{l.name}</b></span></td>
                <td className="t"><span className="mk-dk-clamp">{l.caseType}</span></td>
                <td className="s"><span className="mk-dk-clamp">{rowNameOf(l.source, group)}{l.rep && <em> · {l.rep}</em>}</span></td>
                <td className="d">{leadDay(cameIn(l))}</td>
                <td className="r">
                  <span className="mk-dk-clamp">{l.reason ? <b>{l.reason}</b> : <em>{NO_REASON}</em>}{outcome && <em> · {outcome}</em>}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {note && <p className="mk-dk-note">{note}</p>}
    </Frame>
  );
}
