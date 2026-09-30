/**
 * A representative's profile (Youssef, 2026-09-28: "when we click on a
 * representative it shows all the details regarding signups, leads and all
 * deep details and performance … in a premium profile page"). Opened from the
 * Sign-ups Report. Their numbers come from the report's own functions,
 * filtered to them, so the two pages always agree; their activity — calls,
 * recaps, visits, errands — from the performance data (server/repProfile.ts).
 */
import { useEffect, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  ArrowLeft, Building2, RotateCw, Sparkles, CheckCircle2, ChevronRight, Inbox, Layers, Loader2, MapPin, Percent, Phone, PhoneCall, Search, Target, Trophy, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { RepFace, PartnerLogo } from "@/components/RepFace";
import {
  Big, DateInput, HBar, LeadList, SC_TITLE, ScorecardTable, fmt, hueStyle, initials, iso, pct1, pctText, presets, rangeLabel, roleName, teamTops,
} from "../SignupsDashboard";
import { TrendsPanel } from "./Trends";
import { MonthlyPanel } from "./Monthly";
import { LoadError } from "./LoadError";
import "../SignupsDashboard.css";

type Act = NonNullable<inferRouterOutputs<AppRouter>["teamReports"]["repActivity"]>;

const sentimentBadge = (s: string) => (s === "positive" ? "sr-b-ok" : s === "negative" ? "sr-b-bad" : "sr-b-grey");
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function RepProfile() {
  const [, params] = useRoute("/signups-report/rep/:name");
  const member = decodeURIComponent(params?.name ?? "");
  const query = new URLSearchParams(useSearch());
  const today = new Date();
  const [from, setFrom] = useState(query.get("from") || iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(query.get("to") || iso(today));
  const periods = presets(today);
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;

  // Each keeps its last answer on screen while new dates load.
  const mine = trpc.teamReports.signupsDashboard.useQuery({ from, to, team: "all", member }, { placeholderData: (p) => p, enabled: !!member });
  const team = trpc.teamReports.signupsDashboard.useQuery({ from, to, team: "all" }, { placeholderData: (p) => p });
  const act = trpc.teamReports.repActivity.useQuery({ from, to, member }, { placeholderData: (p) => p, enabled: !!member });
  const busy = mine.isFetching || team.isFetching || act.isFetching;

  const d = mine.data;
  const a = act.data;
  // The territory and partner chips open the full list behind them.
  const [open, setOpen] = useState<"cities" | "partners" | null>(null);
  const group = d?.scorecard.groups.find((g) => g.rows.some((r) => r.name === member));
  const row = group?.rows.find((r) => r.name === member);
  const role = group?.role ?? d?.reps[0]?.role ?? a?.role ?? "";
  const current = a?.current ?? row?.current ?? true;

  // Standing in the team: rank by sign-ups among the same role, and the role's conversion.
  const peers = (team.data?.reps ?? []).filter((r) => r.role === role).sort((x, y) => y.signed - x.signed || y.leads - x.leads);
  const rank = peers.findIndex((r) => r.name === member) + 1;
  const roleConv = team.data?.roles.find((r) => r.role === role)?.conversion ?? null;
  const isTop = team.data ? teamTops(team.data.reps).has(member) : false;
  const conv = d?.totals.signedPct ?? 0;

  // Back to the report as it was left: its role, team and tab rode along in the link, plus the dates picked here.
  const back = `/signups-report?${new URLSearchParams({ ...Object.fromEntries(query), from, to })}`;
  return (
    <div className="sr">
      <div className="sr-canvas">
        <div className="sr-inner">
          <div className="sr-top">
            <Link href={back} className="sr-btn2 rp-back"><ArrowLeft /> Sign-ups report</Link>
            <div className="sr-seg" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>
              ))}
            </div>
            <span className="sr-dates">
              <DateInput value={from} onChange={setFrom} label="From" />–<DateInput value={to} onChange={setTo} label="To" />
            </span>
            {busy && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          </div>

          <section className="sr-hero rp-hero">
            <div className="rp-head">
              <span className="rp-photo" style={hueStyle(member)}><RepFace name={member} fallback={initials(member)} /></span>
              <div className="rp-id">
                <span className="rp-kicker">{roleName(role) || "Representative"}{current ? "" : " · former"}</span>
                <h1>{member}</h1>
                <p className="sr-lead">
                  {rangeLabel(from, to)}
                  {rank > 0 && <> · #{rank} of {peers.length} {role}s by sign-ups</>}
                </p>
                <div className="rp-chips">
                  {isTop && <span className="sr-award"><Trophy /> Top {role}</span>}
                  {a?.profile?.phone && <a className="rp-chip" href={`tel:${a.profile.phone.replace(/[^\d+]/g, "")}`}><Phone /> {a.profile.phone}</a>}
                  {!!a?.profile?.cities.length && (
                    <button type="button" className="rp-chip rp-chip-btn" aria-haspopup="dialog" onClick={() => setOpen("cities")}>
                      <MapPin /> {a.profile.cities.slice(0, 3).join(", ")}{a.profile.cities.length > 3 ? ` +${a.profile.cities.length - 3}` : ""}
                      <ChevronRight className="rp-chev" />
                    </button>
                  )}
                  {a && (
                    <button type="button" className="rp-chip rp-chip-btn" aria-haspopup="dialog" disabled={!a.partners} onClick={() => setOpen("partners")}>
                      <Building2 /> {fmt(a.partners)} partner{a.partners === 1 ? "" : "s"} assigned
                      {!!a.partners && <ChevronRight className="rp-chev" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="sr-bigs rp-bigs">
              <Big n={fmt(d?.totals.leads ?? 0)} label="Leads" icon={<Inbox />} />
              <Big n={fmt(d?.totals.signed ?? 0)} label="Signed" icon={<CheckCircle2 />} />
              <Big n={fmt(row?.unique ?? 0)} label="Unique cases" icon={<Layers />} />
              <Big n={pct1(conv)} label={roleConv != null ? `Conversion · ${role}s ${pct1(roleConv)}` : "Conversion"} icon={<Percent />} />
              {row?.target != null && <Big n={pctText(row.achieved)} label={`Of the ${fmt(row.target)} target`} icon={<Target />} />}
            </div>
          </section>

          {open === "cities" && a?.profile && <CitiesList member={member} cities={a.profile.cities} onClose={() => setOpen(null)} />}
          {open === "partners" && a && (
            <PartnersList member={member} partners={a.assignedPartners} period={d?.partners ?? []} periodLabel={rangeLabel(from, to)} onClose={() => setOpen(null)} />
          )}

          {!d && mine.isError ? (
            <LoadError what={`${member}'s numbers`} message={mine.error?.message} onRetry={() => mine.refetch()} />
          ) : !d ? (
            <div className="sr-features">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 240 }} />)}</div>
          ) : (
            <>
              {row && group && (
                <div className="sr-sc-wrap">
                  <div className="sr-sc">
                    <div className="sr-sc-title">{rangeLabel(from, to)}</div>
                    <div className="sr-sc-band">{SC_TITLE[group.role] ?? group.role}</div>
                    <div className="sr-scroll"><ScorecardTable role={group.role} rows={[row]} /></div>
                  </div>
                </div>
              )}

              <TrendsPanel role="all" team="all" member={member} />
              <MonthlyPanel role="all" team="all" member={member} />

              <div className="sr-board">
                <div style={{ minWidth: 0 }}>
                  <LeadList leads={d.leadList} showRep={false} />
                  {!!(a?.calls.total || a?.recaps.count) && <RepReview member={member} from={from} to={to} />}
                  {!!a?.recaps.count && <Recaps recaps={a.recaps.latest} total={a.recaps.count} />}
                </div>
                <aside>
                  <Activity a={a} />
                  <div className="sr-panel">
                    <div className="sr-panel-h"><div className="sr-ttl"><h2>Top partners</h2><span className="sr-count">{d.partners.length}</span></div></div>
                    {d.partners.length === 0 ? <p className="sr-nil">No lead names a partner we can match.</p> : (
                      <div className="rp-partners">
                        {d.partners.slice(0, 6).map((p) => (
                          <Link key={p.facilityId} href={`/crm/facilities/${p.facilityId}`} className="rp-partner">
                            <span className="sr-av" style={hueStyle(p.name)}><PartnerLogo facilityId={p.facilityId} fallback={initials(p.name)} /></span>
                            <span className="rp-pname"><b>{p.name}</b><i>{fmt(p.leads)} lead{p.leads === 1 ? "" : "s"} · {fmt(p.signed)} signed</i></span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="sr-panel">
                    <div className="sr-panel-h"><div className="sr-ttl"><h2>Case types</h2><span className="sr-count">{d.caseTypes.length}</span></div></div>
                    {d.caseTypes.length === 0 ? <p className="sr-nil">No leads in this period.</p> : (
                      <div className="sr-hb">
                        {d.caseTypes.slice(0, 8).map((c, i) => (
                          <HBar key={c.name} label={c.name} value={c.leads} max={Math.max(1, d.caseTypes[0].leads)} lead={i === 0} />
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Calls, recaps and time in the field, for the dates picked. */
function Activity({ a }: { a: Act | undefined }) {
  if (!a) return <div className="sr-skel" style={{ height: 260, marginBottom: 16 }} />;
  const { calls, recaps, field } = a;
  const s = recaps.sentiment;
  const tone = s.positive + s.neutral + s.negative;
  const pct = (n: number) => (tone ? `${(n / tone) * 100}%` : "0%");
  // Only what this rep does: Field Reps don't call through the CRM, so a wall of
  // zeros would say nothing.
  const stats = ([
    [calls.total, "calls", fmt(calls.total)],
    [calls.connected, "connected", fmt(calls.connected)],
    [calls.talkMinutes, "minutes talking", fmt(calls.talkMinutes)],
    [calls.partnersContacted, "partners reached", fmt(calls.partnersContacted)],
    [recaps.count, "call recaps", fmt(recaps.count)],
    [field.visits, "field visits", fmt(field.visits)],
    [field.facilitiesVisited, "partners visited", fmt(field.facilitiesVisited)],
    [field.hours, "hours in the field", fmt(field.hours)],
    [field.errands, "errands done", `${fmt(field.errandsCompleted)}/${fmt(field.errands)}`],
  ] as const).filter(([n]) => n > 0);
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Activity</h2></div><PhoneCall size={16} /></div>
      {stats.length === 0 ? <p className="sr-nil">No calls, visits or errands recorded in these dates.</p> : (
        <div className="rp-stats">
          {stats.map(([, label, shown]) => <div key={label}><b>{shown}</b><span>{label}</span></div>)}
        </div>
      )}
      {tone > 0 && (
        <>
          <p className="sr-sub" style={{ margin: "12px 0 6px" }}>How partners sounded on recapped calls</p>
          <div className="rp-tone" role="img" aria-label={`${s.positive} positive, ${s.neutral} neutral, ${s.negative} negative`}>
            {s.positive > 0 && <i className="pos" style={{ width: pct(s.positive) }} />}
            {s.neutral > 0 && <i className="neu" style={{ width: pct(s.neutral) }} />}
            {s.negative > 0 && <i className="neg" style={{ width: pct(s.negative) }} />}
          </div>
          <div className="rp-tone-l"><span><i className="pos" />{s.positive} positive</span><span><i className="neu" />{s.neutral} neutral</span><span><i className="neg" />{s.negative} negative</span></div>
        </>
      )}
    </div>
  );
}

/** The latest call recaps: what was said with which partner. */
const RATING: Record<string, { label: string; badge: string }> = {
  strong: { label: "Strong", badge: "sr-b-ok" },
  solid: { label: "Solid", badge: "sr-b-grey" },
  needs_improvement: { label: "Needs improvement", badge: "sr-b-sun" },
};

/**
 * The AI performance review for this rep and the dates picked above — written
 * from their call recaps, as on the Representative Performance page. It opens
 * by itself; the server keeps it a few hours, and Regenerate writes a new one.
 */
function RepReview({ member, from, to }: { member: string; from: string; to: string }) {
  const utils = trpc.useUtils();
  const input = { member, from, to };
  const q = trpc.teamReports.repReview.useQuery(input, { staleTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const [regenerating, setRegenerating] = useState(false);
  const regenerate = async () => {
    setRegenerating(true);
    try {
      utils.teamReports.repReview.setData(input, await utils.teamReports.repReview.fetch({ ...input, fresh: true }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the review.");
    } finally {
      setRegenerating(false);
    }
  };
  const r = q.data;
  const rating = r ? RATING[r.performanceRating] ?? RATING.solid : null;
  const busy = q.isFetching || regenerating;
  return (
    <div className="sr-panel rp-review">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2><Sparkles className="rp-review-ic" /> Performance review</h2>{rating && <span className={`sr-badge ${rating.badge}`}>{rating.label}</span>}</div>
        {r && <button className="sr-btn2" onClick={regenerate} disabled={busy}>{busy ? <Loader2 className="sr-spin" /> : <RotateCw />} Regenerate</button>}
      </div>
      <p className="sr-sub">{rangeLabel(from, to)} · written by AI from {member}'s calls and call recaps in these dates.</p>
      {busy && !r ? (
        <p className="sr-nil" style={{ display: "flex", gap: 8, alignItems: "center" }}><Loader2 className="sr-spin" size={14} /> Reading the call recaps and writing the review…</p>
      ) : q.isError && !r ? (
        <LoadError what="the review" message={q.error.message} onRetry={() => q.refetch()} />
      ) : r ? (
        <div className="rp-review-b" style={regenerating ? { opacity: 0.6 } : undefined}>
          <p className="rp-review-sum">{r.overallSummary}</p>
          {([["Strengths", r.strengths, "ok"], ["Challenges", r.challenges, "bad"], ["Recommendations", r.recommendations, "sun"]] as const)
            .filter(([, items]) => items.length)
            .map(([title, items, tone]) => (
              <div key={title} className={`rp-review-l ${tone}`}>
                <h3>{title}</h3>
                <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            ))}
          {r.daily.length > 0 && (
            <details className="sr-acc">
              <summary><span>Day by day</span></summary>
              <div className="rp-review-days">
                {r.daily.map((d, i) => <div key={i}><span>{dayLabel(d.date)}</span><p>{d.summary}</p></div>)}
              </div>
            </details>
          )}
          <p className="sr-sub" style={{ marginTop: 10 }}>
            From {fmt(r.basedOnRecaps)} call recap{r.basedOnRecaps === 1 ? "" : "s"}{r.writtenBy ? ` · ${r.writtenBy}` : ""}
            {" "}· {new Date(r.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Recaps({ recaps, total }: {
  recaps: { date: string; facilityId: number | null; facility: string; summary: string; sentiment: string }[];
  total: number;
}) {
  return (
    <div className="sr-panel">
      <div className="sr-panel-h"><div className="sr-ttl"><h2>Latest call recaps</h2><span className="sr-count">{fmt(total)}</span></div></div>
      {recaps.length === 0 ? <p className="sr-nil">No call recaps in this period.</p> : (
        <div className="rp-recaps">
          {recaps.map((r, i) => (
            <div key={i} className="rp-recap">
              <div className="rp-recap-h">
                {r.facilityId ? <Link href={`/crm/facilities/${r.facilityId}`}><b>{r.facility}</b></Link> : <b>{r.facility}</b>}
                <span>{dayLabel(r.date)}</span>
                <span className={`sr-badge ${sentimentBadge(r.sentiment)}`}>{r.sentiment}</span>
              </div>
              <p>{r.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Escape closes a list, as the report's other windows do. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const matches = (q: string, ...fields: (string | null | undefined)[]) =>
  !q.trim() || fields.some((f) => String(f ?? "").toLowerCase().includes(q.trim().toLowerCase()));

/** Every city in the rep's territory (agent_zones), from the hero's territory chip. */
function CitiesList({ member, cities, onClose }: { member: string; cities: string[]; onClose: () => void }) {
  useEscape(onClose);
  const [q, setQ] = useState("");
  const shown = cities.slice().sort((x, y) => x.localeCompare(y)).filter((c) => matches(q, c));
  return (
    <div className="sr-modal-back" onClick={onClose}>
      <div className="sr-modal rp-list" role="dialog" aria-modal="true" aria-label={`${member}'s territory`} onClick={(e) => e.stopPropagation()}>
        <div className="sr-panel-h rp-list-h">
          <div className="sr-ttl"><MapPin size={18} /><h2>{member}'s territory</h2><span className="sr-count">{fmt(cities.length)}</span></div>
          <button className="sr-arr" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        {cities.length > 12 && <ListSearch value={q} onChange={setQ} placeholder="Find a city" />}
        {shown.length === 0 ? <p className="sr-nil">No city matches.</p> : (
          <div className="rp-cities">{shown.map((c) => <span key={c} className="rp-city">{c}</span>)}</div>
        )}
        <p className="sr-sub rp-list-foot">From the rep's territory in the CRM. <Link href="/territories">Open the territories map</Link></p>
      </div>
    </div>
  );
}

type Assigned = Act["assignedPartners"][number];
const pacificDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** Every partner assigned to the rep in the CRM, with what each sent in the dates picked — from the partners chip. */
function PartnersList({ member, partners, period, periodLabel, onClose }: {
  member: string; partners: Assigned[]; period: { facilityId: number; leads: number; signed: number }[]; periodLabel: string; onClose: () => void;
}) {
  useEscape(onClose);
  const [q, setQ] = useState("");
  const sent = new Map(period.map((p) => [p.facilityId, p]));
  // Partners who sent leads in the dates picked first, then A to Z.
  const shown = partners
    .filter((p) => matches(q, p.name, p.city, p.type))
    .sort((x, y) => (sent.get(y.id)?.signed ?? 0) - (sent.get(x.id)?.signed ?? 0) || (sent.get(y.id)?.leads ?? 0) - (sent.get(x.id)?.leads ?? 0) || x.name.localeCompare(y.name));
  const active = partners.filter((p) => sent.has(p.id)).length;
  return (
    <div className="sr-modal-back" onClick={onClose}>
      <div className="sr-modal rp-list" role="dialog" aria-modal="true" aria-label={`Partners assigned to ${member}`} onClick={(e) => e.stopPropagation()}>
        <div className="sr-panel-h rp-list-h">
          <div className="sr-ttl"><Building2 size={18} /><h2>Partners assigned to {member}</h2><span className="sr-count">{fmt(partners.length)}</span></div>
          <button className="sr-arr" aria-label="Close" onClick={onClose}><X /></button>
        </div>
        <p className="sr-sub">{fmt(active)} of them sent leads in {periodLabel}. Click a partner to open it.</p>
        <ListSearch value={q} onChange={setQ} placeholder="Find a partner, city or type" />
        {shown.length === 0 ? <p className="sr-nil">No partner matches.</p> : (
          <div className="rp-plist">
            {shown.map((p) => {
              const s = sent.get(p.id);
              const meta = [p.type, p.city, p.lastContact ? `last contact ${dayLabel(pacificDay(p.lastContact))}` : null].filter(Boolean).join(" · ");
              return (
                <Link key={p.id} href={`/crm/facilities/${p.id}`} className="rp-partner">
                  <span className="sr-av" style={hueStyle(p.name)}><PartnerLogo facilityId={p.id} fallback={initials(p.name)} /></span>
                  <span className="rp-pname"><b>{p.name}</b><i>{meta}</i></span>
                  <span className="rp-psent">
                    {s ? <>{fmt(s.leads)} lead{s.leads === 1 ? "" : "s"}<br /><b>{fmt(s.signed)} signed</b></> : <span className="rp-none">no leads</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ListSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="rp-search">
      <Search />
      <input autoFocus className="sr-input" type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
