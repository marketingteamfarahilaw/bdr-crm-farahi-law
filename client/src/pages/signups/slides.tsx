/**
 * The slides of the Sign-ups Report's presentation mode (Presentation.tsx): one
 * idea per slide for the CEO, built only from the report data already on screen.
 *
 * A slide whose data would be empty or meaningless is left out rather than shown
 * blank: no trend for a single month, no FR-vs-BDR split under the BDR filter,
 * no targets for All time, and a period with no leads is a single calm cover. Client names never appear:
 * leadList is not read anywhere here, and nothing clicks through to it.
 *
 * Sizes in Presentation.css are design pixels on the 1920×1080 stage, which the
 * deck scales evenly to the screen.
 */
import type { ReactNode } from "react";
import { RepFace } from "@/components/RepFace";
import { CheckCircle2, Handshake, Info, Percent, TrendingUp, Trophy, Users } from "lucide-react";
import { MONTHLY_SIGNUP_TARGET, type TeamRole } from "@shared/team";
import {
  SC_TITLE, ScorecardTable, fmt, hueStyle, initials, iso, monthAbbr, monthLabel, rangeLabel, roleName,
  type ReportData,
} from "../SignupsDashboard";

export type DeckContext = {
  from: string;
  to: string;
  role: "all" | TeamRole;
  team: "all" | "current";
  /** The period button that is on ("This month"…); none for custom dates. */
  preset?: string;
};
/** A slide's place in the deck, for its footer: "3 / 10". */
export type Pos = { n: number; of: number };
export type Slide = {
  id: string;
  /** For screen readers: "3 of 10: FRS scorecard". */
  label: string;
  /** The closing briefing is dark edge to edge, letterbox included. */
  dark?: boolean;
  render: (pos: Pos) => ReactNode;
};

type Group = ReportData["scorecard"]["groups"][number];
type RepRow = Group["rows"][number];
type MonthRow = ReportData["months"][number];

const TEAM: Record<string, string> = { FR: "Field Representatives", BDR: "BDRs", Intake: "Intake" };
const INSIGHT_ICONS = [CheckCircle2, Trophy, Percent, Users, TrendingUp, Handshake, Info];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const count = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
// Share of target, rounded down: a team that is short must never read "100%".
// The epsilon absorbs float noise in the server's two-decimal values (57.3 * 10 = 572.999…).
const pctDown = (v: number | null | undefined) => `${Math.floor((v ?? 0) + 1e-6)}%`;
/**
 * The scorecard's percentages on a slide: one decimal, as the deck shows
 * conversion everywhere else, so "100.0%" fits a column at projector size where
 * the page's "100.00%" would run into its neighbour. Achieved rounds down (see pctDown).
 */
const scorecardPct = (v: number | null, of: "achieved" | "conversion") =>
  v == null ? "—" : `${(of === "achieved" ? Math.floor(v * 10 + 1e-6) / 10 : Math.round(v * 10) / 10).toFixed(1)}%`;
/** A long list cut into slides of `size`; the Marketing deck pages its rejected cases with it too. */
export function pages<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** What every slide says about the selection, worked out once. */
type Meta = {
  /** "September 1–25, 2026", or "Since Jan 2024" for All time. */
  period: string;
  scopes: string[];
  /** Every slide's footer, so a photo of the screen still says what it shows. */
  foot: string;
  who: string;
  allTime: boolean;
  /**
   * Whether targets are worth showing. Not for All time: it starts in Jan 2020,
   * years before the first lead, and the server counts a month of target for
   * every one of those months, so the team would read as a few % of target.
   */
  targets: boolean;
  /** Months the targets cover (per rep per month). */
  months: number;
  /** The period's last month while it is still running: its targets are for the whole month. */
  progress: { month: string; name: string; day: number; days: number } | null;
};

function metaOf(data: ReportData, ctx: DeckContext): Meta {
  const allTime = ctx.preset === "All time";
  const first = data.period.firstLead;
  const period = allTime ? (first ? `Since ${monthLabel(first)}` : "All time") : rangeLabel(ctx.from, ctx.to);
  const scopes = [
    ctx.role === "all" ? "BD & FR team" : TEAM[ctx.role] ?? ctx.role,
    ...(ctx.team === "current" ? ["Current team only"] : []),
  ];
  // A month is only "in progress" when the period runs to today (or beyond). A
  // period that stopped in the past is closed, even if it stopped mid-month:
  // no "so far", and no pace, for a month that is over.
  const today = iso(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return {
    period,
    scopes,
    foot: ["Sign-ups report", period, ...scopes].join(" · "),
    who: ctx.role === "all" ? "BD/FR" : ctx.role,
    allTime,
    targets: !allTime,
    months: data.scorecard.months,
    progress: ctx.to >= today && d < days
      ? { month: today.slice(0, 7), name: new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" }), day: d, days }
      : null,
  };
}

/** Every month from the first to the last, the empty ones as 0 so gaps show. */
function allMonths(months: MonthRow[]): MonthRow[] {
  if (!months.length) return [];
  const have = new Map(months.map((m) => [m.month, m]));
  const last = months[months.length - 1].month;
  let [y, m] = months[0].month.split("-").map(Number);
  const out: MonthRow[] = [];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(have.get(key) ?? { month: key, leads: 0, signed: 0, conversion: 0 });
    if (key >= last || out.length > 600) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function buildSlides(data: ReportData, ctx: DeckContext): Slide[] {
  const meta = metaOf(data, ctx);
  const slides: Slide[] = [
    { id: "cover", label: "Sign-ups for the period", render: (pos) => <Cover data={data} ctx={ctx} meta={meta} pos={pos} /> },
  ];
  // No leads: the cover says so, and nothing else would be worth a slide.
  if (!data.totals.leads) return slides;

  if (ctx.role === "all" && data.roles.filter((r) => r.leads > 0).length >= 2) {
    slides.push({ id: "split", label: "FR and BDR", render: (pos) => <Split data={data} meta={meta} pos={pos} /> });
  }

  for (const g of data.scorecard.groups) {
    const name = SC_TITLE[g.role] ?? g.role;
    // Up to 11 reps fit on one slide; a longer team is paged by 10 and totalled on its last page.
    const parts = g.rows.length >= 12 ? pages(g.rows, 10) : [g.rows];
    parts.forEach((rows, i) => {
      const of = parts.length > 1 ? ` · ${i + 1} of ${parts.length}` : "";
      slides.push({
        id: `scorecard-${g.role}${parts.length > 1 ? `-${i + 1}` : ""}`,
        label: `${name} scorecard${of}`,
        render: (pos) => <ScorecardSlide group={g} rows={rows} band={`${name}${of}`} last={i === parts.length - 1} meta={meta} pos={pos} />,
      });
    });
  }

  // A single month is a number, not a trend.
  if (data.months.length >= 2) {
    // Zero months are filled in for the bars only. The average divides by the
    // months that have leads, as the report's "average per month" does, so the
    // two never disagree on the same filters.
    const months = allMonths(data.months);
    const perMonth = Math.round(data.totals.signed / data.months.length);
    slides.push({ id: "trend", label: "Sign-ups by month", render: (pos) => <Trend months={months} total={data.totals.signed} perMonth={perMonth} meta={meta} pos={pos} /> });
  }

  // Every rep with a sign-up. The first version kept the top six, which left the
  // seventh (Queenie Miranda) off the slide; eight fit on one, more go on another.
  const leaders = data.reps.filter((r) => r.signed > 0);
  const leaderPages = pages(leaders, 8);
  leaderPages.forEach((page, i) => {
    const part = leaderPages.length > 1 ? `${i + 1} of ${leaderPages.length}` : null;
    slides.push({
      id: i ? `leaders-${i + 1}` : "leaders",
      label: part ? `Top representatives, ${part}` : "Top representatives",
      render: (pos) => <Leaders reps={leaders} page={page} part={part} meta={meta} pos={pos} />,
    });
  });

  const targeted = meta.targets ? data.scorecard.groups.filter((g) => g.total.target != null && g.rows.length > 0) : [];
  if (targeted.length && targeted.every((g) => g.rows.length <= 12)) {
    slides.push({
      id: "targets",
      label: "Representatives vs target",
      render: (pos) => <Targets columns={targeted.map((g) => ({ group: g, rows: g.rows }))} all={targeted} meta={meta} pos={pos} />,
    });
  } else {
    // Too many rows for side-by-side columns: a slide per team, paged by 12.
    for (const g of targeted) {
      const parts = pages(g.rows, 12);
      parts.forEach((rows, i) => {
        const of = parts.length > 1 ? ` · ${i + 1} of ${parts.length}` : "";
        slides.push({
          id: `targets-${g.role}${parts.length > 1 ? `-${i + 1}` : ""}`,
          label: `${TEAM[g.role] ?? g.role} vs target${of}`,
          render: (pos) => <Targets columns={[{ group: g, rows }]} all={targeted} kicker={`Against target · ${TEAM[g.role] ?? g.role}${of}`} meta={meta} pos={pos} />,
        });
      });
    }
  }

  if (data.partners.length) {
    slides.push({ id: "partners", label: "Top referring partners", render: (pos) => <Partners data={data} meta={meta} pos={pos} /> });
  }
  // One case type is a sentence, not a chart.
  if (data.caseTypes.length >= 2) {
    slides.push({ id: "case-types", label: "Case types", render: (pos) => <CaseTypes data={data} meta={meta} pos={pos} /> });
  }
  if (data.insights.length) {
    slides.push({ id: "briefing", label: "Executive briefing", dark: true, render: (pos) => <Briefing data={data} meta={meta} pos={pos} /> });
  }
  return slides;
}

/* ---------------------------------------------------------------- frame */

function Frame({ meta, pos, kicker, title, sub, className = "", children }: {
  meta: Meta; pos: Pos; kicker?: ReactNode; title?: string; sub?: ReactNode; className?: string; children: ReactNode;
}) {
  // A long title (a partner's full name) steps down a size rather than wrapping into the body.
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

function Cover({ data, ctx, meta, pos }: { data: ReportData; ctx: DeckContext; meta: Meta; pos: Pos }) {
  const kicker = (
    <>
      <span>Sign-ups report · {ctx.preset ?? "Custom period"}</span>
      {meta.scopes.map((s) => <span key={s} className="sr-deck-pill">{s}</span>)}
    </>
  );

  if (!data.totals.leads) {
    return (
      <Frame meta={meta} pos={pos} kicker={kicker} title={meta.period}>
        <div className="sr-cv-nil">
          <p className="sr-cv-nil-h">{meta.allTime ? `No ${meta.who} leads yet.` : `No ${meta.who} leads in ${meta.period}.`}</p>
          <p>Pick another period on the report, then press Present again.</p>
        </div>
      </Frame>
    );
  }

  // Against target: only FR and BDR have one (and All time none, see Meta.targets);
  // without a target the ring shows conversion, as the page does.
  const targeted = meta.targets ? data.scorecard.groups.filter((g) => g.total.target) : [];
  const target = sum(targeted.map((g) => g.total.target ?? 0));
  const signedVsTarget = sum(targeted.map((g) => g.total.signed));
  // Whole numbers first, then divide: exact, and rounded down so 896 of 900 reads 99%, not 100%.
  const achieved = target ? Math.floor((signedVsTarget * 100) / target) : null;
  const met = target > 0 && signedVsTarget >= target;
  const ring = achieved ?? data.totals.signedPct;
  const R = 70, CIRC = 2 * Math.PI * R;

  return (
    <Frame meta={meta} pos={pos} kicker={kicker} title={meta.period}>
      <div className="sr-cv">
        <div className="sr-cv-main">
          <div className="sr-cv-num">
            <b>{fmt(data.totals.signed)}</b>
            <span>{data.totals.signed === 1 ? "client signed" : "clients signed"}</span>
          </div>
          <div className="sr-cv-stats">
            <div><b>{fmt(data.totals.leads)}</b><span>Leads</span></div>
            <div><b>{data.totals.signedPct}%</b><span>Conversion</span></div>
          </div>
        </div>
        <div className="sr-cv-side">
          <div className="sr-cv-ring">
            <svg viewBox="0 0 164 164" aria-hidden="true">
              <circle className="trk" cx="82" cy="82" r={R} />
              {ring > 0 && <circle className="val" cx="82" cy="82" r={R} strokeDasharray={`${(CIRC * Math.min(ring, 100)) / 100} ${CIRC}`} />}
            </svg>
            <div className="sr-cv-ring-c">
              <b>{ring}%</b>
              <span>{achieved == null ? "of leads signed" : "of target"}</span>
            </div>
          </div>
          {achieved != null && <p className="sr-cv-of">{fmt(signedVsTarget)} of {fmt(target)} sign-ups</p>}
          {met && <span className="sr-deck-pill sun">Target met</span>}
          {/* Targets are for whole months, so a month still running mustn't read as a miss. */}
          {achieved != null && meta.progress && (
            <p className="sr-cv-note">{meta.progress.name} in progress: {meta.progress.day} of {meta.progress.days} days</p>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Split({ data, meta, pos }: { data: ReportData; meta: Meta; pos: Pos }) {
  const roles = (["FR", "BDR", "Intake"] as const)
    .map((role) => data.roles.find((r) => r.role === role))
    .filter((r): r is ReportData["roles"][number] => !!r && r.leads > 0);
  // Stable sort: on a tie FR stays ahead of BDR, so the title reads "FR and BDR".
  const [a, b] = [...roles].sort((x, y) => y.signed - x.signed);
  const title = !data.totals.signed
    ? "No sign-ups yet in this period"
    : b && a.signed === b.signed
      ? `${a.role} and ${b.role} signed the same number`
      : `${TEAM[a.role] ?? a.role} signed ${a.share}% of sign-ups`;
  const signedRoles = roles.filter((r) => r.signed > 0);

  return (
    <Frame meta={meta} pos={pos} kicker="FR and BDR" title={title}>
      <div className="sr-sp">
        <div className={`sr-sp-cards n${roles.length}`}>
          {roles.map((r) => {
            const t = data.scorecard.groups.find((g) => g.role === r.role)?.total;
            return (
              <div key={r.role} className={`sr-sp-card ${r.role.toLowerCase()}`}>
                <div className="sr-sp-name">{TEAM[r.role] ?? r.role}</div>
                <div className="sr-sp-n">{fmt(r.signed)}</div>
                <div className="sr-sp-share">{r.signed === 1 ? "sign-up" : "sign-ups"} · {r.share}% of all</div>
                <div className="sr-sp-stats">
                  <div><b>{fmt(r.leads)}</b><span>Leads</span></div>
                  <div><b>{r.conversion}%</b><span>Conversion</span></div>
                  {meta.targets && t?.target ? <div><b>{pctDown(t.achieved)}</b><span>of target ({fmt(t.signed)} of {fmt(t.target)})</span></div> : null}
                </div>
              </div>
            );
          })}
        </div>
        {signedRoles.length > 0 && (
          <div className="sr-sp-bar" aria-hidden="true">
            {signedRoles.map((r) => (
              <i key={r.role} className={r.role.toLowerCase()} style={{ flexGrow: r.signed }}>{r.role} {r.share}%</i>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

function ScorecardSlide({ group, rows, band, last, meta, pos }: {
  group: Group; rows: RepRow[]; band: string; last: boolean; meta: Meta; pos: Pos;
}) {
  const perRep = MONTHLY_SIGNUP_TARGET[group.role as TeamRole];
  const targets = !perRep
    ? ""
    : !meta.targets
      ? "Targets are left out for All time; pick a shorter period to see them. "
      : `Targets: ${perRep} sign-ups a month per ${group.role}${meta.months > 1 ? ` × ${meta.months} months = ${fmt(perRep * meta.months)} each` : ""}. `;
  return (
    // No slide title: the team's own sheet gets the room.
    <Frame meta={meta} pos={pos} className="sr-dsc-slide">
      <div className={`sr-sc${rows.length > 8 ? " dense" : ""}`}>
        <div className="sr-sc-title">{meta.period}</div>
        <div className="sr-sc-band">{band}</div>
        <ScorecardTable role={group.role} rows={rows} total={last ? group.total : undefined} pct={scorecardPct} targets={meta.targets} />
      </div>
      <p className="sr-dsc-note">{targets}Each lead counts once, in the column where it ended up.</p>
    </Frame>
  );
}

function Trend({ months, total, perMonth, meta, pos }: { months: MonthRow[]; total: number; perMonth: number; meta: Meta; pos: Pos }) {
  const shown = months.slice(-12);
  const max = Math.max(1, ...shown.map((m) => m.signed));
  const best = months.reduce((b, m) => (m.signed >= b.signed ? m : b));
  const latest = shown[shown.length - 1];
  const partial = meta.progress?.month === latest.month ? meta.progress : null;
  const sub = total
    ? `Average ${fmt(perMonth)} a month · best: ${monthLabel(best.month)} with ${fmt(best.signed)}`
    : "No sign-ups yet in these months";
  const notes = [
    partial
      ? `${partial.name} so far: ${count(latest.signed, "sign-up")} in ${partial.day} of ${partial.days} days — on pace for about ${fmt(Math.round((latest.signed / partial.day) * partial.days))}.`
      : "",
    months.length > 12 ? `Last 12 of ${months.length} months.` : "",
  ].filter(Boolean);

  return (
    <Frame meta={meta} pos={pos} kicker="Trend" title="Sign-ups by month" sub={sub}>
      <div className="sr-tr">
        <div className="sr-tr-chart">
          {shown.map((m, i) => {
            const hot = i === shown.length - 1;
            const part = hot && !!partial;
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

function Leaders({ reps, page, part, meta, pos }: {
  reps: ReportData["reps"]; page: ReportData["reps"]; part: string | null; meta: Meta; pos: Pos;
}) {
  const top = page;
  const max = reps[0].signed;
  const tied = reps.filter((r) => r.signed === max);
  const each = count(max, "sign-up");
  const title = tied.length === 1
    ? `${tied[0].name} leads with ${each}`
    : tied.length === 2
      ? `${tied[0].name} and ${tied[1].name} lead with ${each} each`
      : `${tied.length} representatives share the lead with ${each} each`;

  return (
    <Frame meta={meta} pos={pos} kicker={part ? `Leaderboard · ${part}` : "Leaderboard"} title={title}>
      <div className={`sr-ld${top.length > 6 ? " dense" : ""}`}>
        {top.map((r) => {
          const rank = 1 + reps.filter((x) => x.signed > r.signed).length;
          return (
            <div key={r.name} className={`sr-ld-row${rank === 1 ? " first" : ""}`}>
              <span className="sr-ld-rank">{rank}</span>
              <span className="sr-deck-av" style={hueStyle(r.name)}><RepFace name={r.name} fallback={initials(r.name)} /></span>
              <div className="sr-ld-who">
                <b>{r.name}{!r.current && <span className="sr-deck-former">former</span>}</b>
                <i>{roleName(r.role)} · {count(r.leads, "lead")} · {r.conversion}% conversion</i>
              </div>
              <div className="sr-deck-bar-t"><i style={{ width: `${(r.signed / max) * 100}%` }} /></div>
              <span className="sr-ld-n">{fmt(r.signed)}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Targets({ columns, all, kicker = "Against target", meta, pos }: {
  columns: { group: Group; rows: RepRow[] }[]; all: Group[]; kicker?: string; meta: Meta; pos: Pos;
}) {
  const everyone = all.flatMap((g) => g.rows);
  const met = everyone.filter((r) => (r.achieved ?? 0) >= 100).length;
  const per = all.map((g) => `${g.role} ${MONTHLY_SIGNUP_TARGET[g.role as TeamRole] ?? "—"}`).join(", ");
  const sub = `Target: ${per} sign-ups a month per rep${meta.months > 1 ? ` × ${meta.months} months` : ""}` +
    (meta.progress ? ` · ${meta.progress.name} in progress: ${meta.progress.day} of ${meta.progress.days} days` : "");
  const most = Math.max(...columns.map((c) => c.rows.length));
  const layout = columns.length === 1 ? (most <= 7 ? " single roomy" : " single") : "";

  return (
    <Frame meta={meta} pos={pos} kicker={kicker} title={`${met} of ${count(everyone.length, "representative")} at or above target`} sub={sub}>
      <div className={`sr-tg${layout}${most > 8 ? " dense" : ""}`}>
        {columns.map(({ group, rows }) => <TargetColumn key={group.role} group={group} rows={rows} />)}
      </div>
    </Frame>
  );
}

function TargetColumn({ group, rows }: { group: Group; rows: RepRow[] }) {
  // One scale per team (across its pages too): 0 to its best result, at least the target, at most twice it.
  const top = Math.min(200, Math.max(100, ...group.rows.map((r) => r.achieved ?? 0)));
  const at = (v: number) => `${(Math.min(v, top) / top) * 100}%`;
  const each = group.rows[0]?.target ?? 0;
  return (
    <div className="sr-tg-col">
      <div className="sr-tg-head">{TEAM[group.role] ?? group.role} · target {fmt(each)} each</div>
      <div className="sr-tg-row sr-tg-mark" aria-hidden="true">
        <span />
        <div className="sr-tg-scale"><em style={{ left: at(100) }}>Target</em></div>
        <span />
      </div>
      {rows.map((r) => {
        const a = r.achieved ?? 0;
        return (
          <div key={r.name} className={`sr-tg-row${a >= 100 ? " met" : ""}`}>
            <b className="sr-tg-name">{r.name}{!r.current && <span className="sr-deck-former">former</span>}</b>
            <div className="sr-tg-track">
              <i style={{ width: at(a) }} />
              <span className="sr-tg-line" style={{ left: at(100) }} />
              {a > top && <span className="sr-tg-over">›</span>}
            </div>
            <span className="sr-tg-v"><b>{fmt(r.signed)} / {fmt(r.target ?? 0)}</b><span>{pctDown(a)}</span></span>
          </div>
        );
      })}
    </div>
  );
}

function Partners({ data, meta, pos }: { data: ReportData; meta: Meta; pos: Pos }) {
  const top = data.partners.slice(0, 6);
  const [a, b] = top;
  const tiedAtTop = data.partners.filter((p) => p.signed === a.signed).length;
  const title = !a.signed || tiedAtTop > 2
    ? "Top referring partners"
    : tiedAtTop === 2
      ? `${a.name} and ${b.name} sent the most sign-ups`
      : `${a.name} sent the most sign-ups`;
  const max = Math.max(1, a.signed);
  // Only about a third of leads name a partner; say so, or this reads as all leads.
  const sub = `From the ${fmt(data.totals.attributed)} of ${fmt(data.totals.leads)} leads that name a partner we can match.`;

  return (
    <Frame meta={meta} pos={pos} kicker="Referring partners" title={title} sub={sub}>
      <div className="sr-pt">
        {top.map((p, i) => (
          <div key={p.facilityId} className={`sr-pt-row${i === 0 && p.signed ? " first" : ""}`}>
            <span className="sr-deck-av" style={hueStyle(p.name)}>{initials(p.name)}</span>
            <div className="sr-pt-who"><b>{p.name}</b><i>{p.territory || "No territory"}</i></div>
            <div className="sr-deck-bar-t"><i style={{ width: `${(p.signed / max) * 100}%` }} /></div>
            <div className="sr-pt-n"><b>{fmt(p.signed)}</b><span>of {count(p.leads, "lead")} · {p.conversion}%</span></div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function CaseTypes({ data, meta, pos }: { data: ReportData; meta: Meta; pos: Pos }) {
  const all = data.caseTypes;
  const rest = all.slice(6);
  const restLeads = sum(rest.map((c) => c.leads)), restSigned = sum(rest.map((c) => c.signed));
  const rows = all.length > 7
    ? [...all.slice(0, 6), {
        name: `Other (${rest.length} types)`, leads: restLeads, signed: restSigned,
        conversion: restLeads ? Math.round((restSigned / restLeads) * 1000) / 10 : 0,
      }]
    : all;
  const max = Math.max(1, ...rows.map((c) => c.leads));
  const top = all[0];
  const share = Math.round((top.leads / data.totals.leads) * 100);
  const title = top.name === "Not recorded" ? `${share}% of leads have no case type recorded` : `${top.name} is ${share}% of leads`;
  const avg = data.totals.signedPct;

  return (
    <Frame meta={meta} pos={pos} kicker="Case types" title={title}>
      <div className="sr-ct">
        <div className="sr-ct-legend" aria-hidden="true">
          <span><i className="s" /> Signed</span>
          <span><i className="l" /> Leads</span>
        </div>
        {rows.map((c, i) => (
          <div key={c.name} className={`sr-ct-row${i === 0 ? " first" : ""}`}>
            <b className="sr-ct-name">{c.name}</b>
            <div className="sr-ct-bar">
              <i className="l" style={{ width: `${(c.leads / max) * 100}%` }} />
              <i className="s" style={{ width: `${(c.signed / max) * 100}%` }} />
            </div>
            <span className="sr-ct-of">{fmt(c.signed)} of {fmt(c.leads)} signed</span>
            <span className={`sr-badge ${c.conversion >= avg ? "sr-b-ok" : "sr-b-grey"}`}>{c.conversion}%</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** The report's dark briefing card as the closing slide. Text as the server wrote it: rep and partner names, never clients. */
function Briefing({ data, meta, pos }: { data: ReportData; meta: Meta; pos: Pos }) {
  const chars = [...data.insights, ...data.recommendations].join("").length;
  const density = chars > 1300 ? " xdense" : chars > 900 ? " dense" : "";
  const recs = data.recommendations;
  return (
    <Frame meta={meta} pos={pos} kicker="Executive briefing" title="What the numbers say" className={`sr-slide-dark${density}`}>
      <div className={`sr-bf${recs.length ? "" : " solo"}`}>
        <div className="sr-bf-list">
          {data.insights.map((text, n) => {
            const Icon = INSIGHT_ICONS[n % INSIGHT_ICONS.length];
            return (
              <div key={n} className="sr-bf-i">
                <span className="sr-bf-ic"><Icon /></span>
                <p>{text}</p>
              </div>
            );
          })}
        </div>
        {recs.length > 0 && (
          <div className="sr-bf-recs">
            <div className="sr-bf-h">Recommendations</div>
            {recs.map((r, n) => <div key={n} className="sr-bf-rec">{r}</div>)}
          </div>
        )}
      </div>
    </Frame>
  );
}
