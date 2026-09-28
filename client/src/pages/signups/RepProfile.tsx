/**
 * A representative's profile (Youssef, 2026-09-28: "when we click on a
 * representative it shows all the details regarding signups, leads and all
 * deep details and performance … in a premium profile page"). Opened from the
 * Sign-ups Report. Their numbers come from the report's own functions,
 * filtered to them, so the two pages always agree; their activity — calls,
 * recaps, visits, errands — from the performance data (server/repProfile.ts).
 */
import { useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  ArrowLeft, Building2, CheckCircle2, Inbox, Layers, Loader2, MapPin, Percent, Phone, PhoneCall, Target, Trophy,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { RepFace, PartnerLogo } from "@/components/RepFace";
import {
  Big, DateInput, HBar, LeadList, SC_TITLE, ScorecardTable, fmt, hueStyle, initials, iso, pctText, presets, rangeLabel, roleName, teamTops,
} from "../SignupsDashboard";
import { TrendsPanel } from "./Trends";
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

  const back = `/signups-report?from=${from}&to=${to}`;
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
                    <span className="rp-chip" title={a.profile.cities.join(", ")}>
                      <MapPin /> {a.profile.cities.slice(0, 3).join(", ")}{a.profile.cities.length > 3 ? ` +${a.profile.cities.length - 3}` : ""}
                    </span>
                  )}
                  {a && <span className="rp-chip"><Building2 /> {fmt(a.partners)} partner{a.partners === 1 ? "" : "s"} assigned</span>}
                </div>
              </div>
            </div>
            <div className="sr-bigs rp-bigs">
              <Big n={fmt(d?.totals.leads ?? 0)} label="Leads" icon={<Inbox />} />
              <Big n={fmt(d?.totals.signed ?? 0)} label="Signed" icon={<CheckCircle2 />} />
              <Big n={fmt(row?.unique ?? 0)} label="Unique cases" icon={<Layers />} />
              <Big n={`${conv}%`} label={roleConv != null ? `Conversion · ${role}s ${roleConv}%` : "Conversion"} icon={<Percent />} />
              {row?.target != null && <Big n={pctText(row.achieved)} label={`Of the ${fmt(row.target)} target`} icon={<Target />} />}
            </div>
          </section>

          {!d ? (
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

              <div className="sr-board">
                <div style={{ minWidth: 0 }}>
                  <LeadList leads={d.leadList} showRep={false} />
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
