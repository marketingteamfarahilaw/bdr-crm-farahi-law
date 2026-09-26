/**
 * Data Check — the team's Lead Docket leads that need a person's answer before
 * the reports can be trusted (server/dataCheck.ts): a referring partner the CRM
 * can't find, no partner written at all, a client entered twice, a test lead.
 * An answer here counts everywhere the lead does, and an answer for some words
 * covers every lead that says them — these and the ones still to come.
 */
import { Fragment, useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ExternalLink, Inbox, Link2, Loader2, ShieldCheck, Wrench, X } from "lucide-react";
import { LeadDocketSyncButton } from "@/components/DataSyncPanel";
import { RepFace } from "@/components/RepFace";
import { Big, DateInput, fmt, hueStyle, initials, leadDay, outcomeBadge, presets, rangeLabel } from "./SignupsDashboard";
import { PartnerPicker, type NewPartner } from "./signups/PartnerPicker";
import "./SignupsDashboard.css";

type Data = NonNullable<inferRouterOutputs<AppRouter>["dataCheck"]["get"]>;
type Lead = Data["nothing"][number];
type Words = Data["unmatched"][number];
type Picking = { kind: "words"; words: Words } | { kind: "lead"; lead: Lead };

/** Lead Docket's page for a lead; it asks for a sign-in first when needed. */
const ldUrl = (id: string) => `https://farahi.leaddocket.com/Leads/Edit/${encodeURIComponent(id)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const PAGE = 25;

function OpenInLD({ id }: { id: string }) {
  return (
    <a className="dc-ld" href={ldUrl(id)} target="_blank" rel="noreferrer" title="Open this lead in Lead Docket">
      Lead Docket <ExternalLink />
    </a>
  );
}

export default function DataCheck() {
  const periods = presets(new Date());
  const ytd = periods.find((p) => p.label === "Year to date") ?? periods[0];
  const [from, setFrom] = useState(ytd.from);
  const [to, setTo] = useState(ytd.to);
  const [team, setTeam] = useState<"all" | "current">("all");
  // undefined until we know who is looking: a rep opens on their own leads.
  const [rep, setRep] = useState<string | null | undefined>(undefined);
  const me = trpc.dataCheck.me.useQuery(undefined, { staleTime: 10 * 60_000 });
  useEffect(() => { if (rep === undefined && me.data) setRep(me.data.rep ?? null); }, [me.data, rep]);
  // A fetch failure (a deploy restarting the server) shouldn't leave the page blank forever.
  useEffect(() => { if (rep === undefined && me.isError) setRep(null); }, [me.isError, rep]);

  const { data, isLoading, isFetching, isError } = trpc.dataCheck.get.useQuery(
    { from, to, team, ...(rep ? { rep } : {}) },
    { enabled: rep !== undefined, placeholderData: (prev) => prev },
  );
  const activePreset = periods.find((p) => p.from === from && p.to === to)?.label;
  const manager = !!data?.me.manager;

  return (
    <div className="sr">
      <div className="sr-canvas">
        <div className="sr-inner">
          <div className="sr-top">
            <div className="sr-seg" role="group" aria-label="Period">
              {periods.map((p) => (
                <button key={p.label} className={p.label === activePreset ? "on" : ""} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>
              ))}
            </div>
            {manager && (
              <select className="sr-input" value={rep ?? ""} onChange={(e) => setRep(e.target.value || null)} aria-label="Representative">
                <option value="">Everyone</option>
                {data!.repOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <select className="sr-input" value={team} onChange={(e) => setTeam(e.target.value as "all" | "current")} aria-label="Representatives">
              <option value="all">Include former reps</option>
              <option value="current">Current team only</option>
            </select>
            <span className="sr-dates">
              <DateInput value={from} onChange={setFrom} label="From" />
              –
              <DateInput value={to} onChange={setTo} label="To" />
            </span>
            {isFetching && <span className="sr-fresh"><Loader2 size={13} className="sr-spin" /> Updating…</span>}
          </div>

          <section className="sr-hero">
            <div className="sr-hero-top">
              <div>
                <h1>Data check</h1>
                <p className="sr-lead">
                  Lead Docket leads that need a partner, an answer or a second look · {rangeLabel(from, to)}{rep ? ` · ${rep}` : ""}
                </p>
              </div>
              {manager && <div className="sr-actions"><LeadDocketSyncButton className="sr-btn1" hintClassName="sr-hint" /></div>}
            </div>
            {data && <Meter data={data} />}
          </section>

          {isError && !data ? (
            <p className="sr-nil">Couldn't load the Data Check. Refresh the page in a minute.</p>
          ) : isLoading || !data ? (
            <div className="sr-features">{[0, 1, 2, 3].map((i) => <div key={i} className="sr-skel" style={{ height: 200 }} />)}</div>
          ) : data.totals.leads === 0 ? (
            <div className="sr-panel"><p className="sr-nil">
              {me.data && !me.data.manager && !me.data.rep
                ? "Lead Docket doesn't credit any leads to your name, so there is nothing to check."
                : "No leads in this period."}
            </p></div>
          ) : (
            <Checks data={data} rep={rep ?? null} onRep={manager ? setRep : undefined} />
          )}
        </div>
      </div>
    </div>
  );
}

function Meter({ data }: { data: Data }) {
  const t = data.totals;
  const fine = [
    [t.linked, "linked to a partner"],
    [t.card, "from a rep's business card"],
    [t.person, "referred by a person"],
    [t.none, "marked “no partner”"],
  ].filter(([n]) => (n as number) > 0).map(([n, what]) => `${fmt(n as number)} ${what}`);
  return (
    <div className="sr-hero-bot">
      <div>
        <div className="dc-meter" role="img" aria-label={`${t.cleanPct}% of leads are clean`}>
          <i className={t.cleanPct >= 90 ? "ok" : t.cleanPct >= 70 ? "mid" : "low"} style={{ width: `${Math.max(2, t.cleanPct)}%` }} />
        </div>
        <p className="sr-sub" style={{ marginTop: 10 }}>
          {fmt(t.clean)} of {plural(t.leads, "lead")} need nothing{fine.length ? ` — ${fine.join(", ")}` : ""}.
          {t.waiting > 0 && ` ${plural(t.waiting, "lead")} just arrived and will be checked after the next sync.`}
        </p>
      </div>
      <div className="sr-bigs">
        <Big n={`${t.cleanPct}%`} label="Clean" icon={<ShieldCheck />} />
        <Big n={fmt(t.fix)} label="To fix" icon={<Wrench />} />
        <Big n={fmt(t.leads)} label="Leads" icon={<Inbox />} />
      </div>
    </div>
  );
}

function Checks({ data, rep, onRep }: { data: Data; rep: string | null; onRep?: (rep: string | null) => void }) {
  const utils = trpc.useUtils();
  const [picking, setPicking] = useState<Picking | null>(null);
  const refresh = () => {
    utils.dataCheck.get.invalidate();
    utils.teamReports.signupsDashboard.invalidate();
  };
  const answer = trpc.dataCheck.answerWords.useMutation({
    onSuccess: (r, v) => {
      toast.success(v.facilityId == null
        ? `“${r.text}” is not a partner — ${plural(r.leads, "lead")} updated`
        : `Linked ${plural(r.leads, "lead")} that say “${r.text}”. Later ones will follow.`);
      setPicking(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const addPartner = trpc.dataCheck.addPartner.useMutation({
    onSuccess: (r) => {
      toast.success(`Partner added, and ${plural(r.leads, "lead")} that say “${r.text}” now count under it.`);
      setPicking(null);
      refresh();
      utils.dataCheck.partners.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const linkLead = trpc.dataCheck.linkLead.useMutation({
    onSuccess: (r, v) => {
      toast.success(v.facilityId == null ? "Marked: no referring partner" : `Now counts under ${r.partner}` + (r.also ? ` — with ${plural(r.also, "other lead")} saying the same` : ""));
      setPicking(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const pending = answer.isPending || addPartner.isPending || linkLead.isPending;

  return (
    <>
      <Scores data={data} rep={rep} onRep={onRep} />
      <Unmatched groups={data.unmatched} pending={pending}
        onLink={(words) => setPicking({ kind: "words", words })}
        onNotPartner={(words) => answer.mutate({ key: words.key, facilityId: null })} />
      <Nothing leads={data.nothing} pending={pending}
        onLink={(lead) => setPicking({ kind: "lead", lead })}
        onNone={(lead) => linkLead.mutate({ leadId: lead.id, facilityId: null })} />
      <Duplicates groups={data.duplicates} />
      {data.tests.length > 0 && <Tests leads={data.tests} />}
      <Remembered rows={data.remembered} manager={!!data.me.manager} />

      {picking?.kind === "words" && (
        <PartnerPicker
          title={`Link “${picking.words.text}” to a partner`}
          who={<><b style={{ color: "var(--ink)" }}>{plural(picking.words.leads.length, "lead")}</b> · {picking.words.reps.join(", ")}</>}
          said={picking.words.text}
          pending={pending}
          onPick={(facilityId) => answer.mutate({ key: picking.words.key, facilityId })}
          none={{ label: "Not a partner", run: () => answer.mutate({ key: picking.words.key, facilityId: null }) }}
          onCreate={(p: NewPartner) => addPartner.mutate({ key: picking.words.key, name: p.name, category: p.category, city: p.city || undefined })}
          hint="Every lead that says this — these and any that come in later — counts under the partner you pick."
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === "lead" && (
        <PartnerPicker
          title={`Link ${picking.lead.name} to a partner`}
          who={<><b style={{ color: "var(--ink)" }}>{picking.lead.name}</b> · {picking.lead.rep} · {leadDay(picking.lead.date)}</>}
          said={null}
          pending={pending}
          onPick={(facilityId) => linkLead.mutate({ leadId: picking.lead.id, facilityId })}
          none={{ label: "No partner", run: () => linkLead.mutate({ leadId: picking.lead.id, facilityId: null }) }}
          hint="Lead Docket has nothing written for this lead. Pick the partner who sent the client, or “No partner” if nobody did."
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

function Scores({ data, rep, onRep }: { data: Data; rep: string | null; onRep?: (rep: string | null) => void }) {
  return (
    <div className="sr-panel">
      <div className="sr-panel-h" style={{ flexWrap: "wrap" }}>
        <div className="sr-ttl"><h2>By representative</h2><span className="sr-count">{data.reps.length}</span></div>
        {rep && onRep && <button className="sr-btn2" onClick={() => onRep(null)}><X /> Show everyone</button>}
      </div>
      <p className="sr-sub">
        Clean means nothing to fix: the partner is linked, or none is needed. {onRep && !rep && "Click a representative to see only their leads."}
      </p>
      <div className="sr-scroll">
        <table className="sr-t" style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Representative</th><th className="num">Leads</th><th className="num">Linked to a partner</th><th className="num">To fix</th><th>Clean</th></tr>
          </thead>
          <tbody>
            {data.reps.map((r) => (
              <tr key={r.name} className={`${onRep ? "sr-click" : ""} ${r.current ? "" : "former"}`}
                onClick={onRep ? () => onRep(rep === r.name ? null : r.name) : undefined}>
                <td>
                  <div className="sr-who">
                    <span className="sr-av" style={hueStyle(r.name)}><RepFace name={r.name} fallback={initials(r.name)} /></span>
                    <div><b>{r.name}</b><i>{r.role}{r.current ? "" : " · former"}</i></div>
                  </div>
                </td>
                <td className="num">{fmt(r.leads)}</td>
                <td className="num">{fmt(r.linked)}</td>
                <td className="num"><span className={`sr-flag ${r.fix ? "" : "zero"}`}>{fmt(r.fix)}</span></td>
                <td>
                  <div className="dc-clean">
                    <div className="dc-meter sm"><i className={r.cleanPct >= 90 ? "ok" : r.cleanPct >= 70 ? "mid" : "low"} style={{ width: `${Math.max(2, r.cleanPct)}%` }} /></div>
                    <b>{r.cleanPct}%</b>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Unmatched({ groups, pending, onLink, onNotPartner }: {
  groups: Words[]; pending: boolean; onLink: (w: Words) => void; onNotPartner: (w: Words) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const leads = groups.reduce((a, g) => a + g.leads.length, 0);
  const shown = all ? groups : groups.slice(0, PAGE);
  return (
    <div className="sr-panel">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>Partner not found</h2><span className="sr-count">{fmt(leads)}</span></div>
      </div>
      <p className="sr-sub">
        Lead Docket names a referring partner the CRM can't match — misspelled, a nickname, or a partner not in the CRM yet.
        Link the words once and every lead that says them counts under that partner, these and future ones. If it's a person, not a business, choose “Not a partner”.
      </p>
      {groups.length === 0 ? <p className="sr-nil">Nothing to fix here.</p> : (
        <div className="sr-scroll">
          <table className="sr-t sr-leads" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>What Lead Docket says</th><th className="num">Leads</th><th>Representative</th><th>Latest</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const isOpen = open === g.key;
                return (
                  <Fragment key={g.key}>
                    <tr>
                      <td className="client"><b>“{g.text}”</b></td>
                      <td className="num">
                        <button className="dc-count" onClick={() => setOpen(isOpen ? null : g.key)} aria-expanded={isOpen}
                          title={isOpen ? "Hide the leads" : "Show the leads"}>
                          {fmt(g.leads.length)}{g.signed > 0 && <em>{fmt(g.signed)} signed</em>}<ChevronDown className={isOpen ? "up" : ""} />
                        </button>
                      </td>
                      <td className="nowrap">{g.reps.join(", ")}</td>
                      <td className="nowrap">{leadDay(g.latest)}</td>
                      <td className="dc-acts">
                        <button className="sr-link-btn" disabled={pending} onClick={() => onLink(g)}><Link2 /> Link</button>
                        <button className="dc-mini" disabled={pending} onClick={() => onNotPartner(g)}>Not a partner</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="dc-sub">
                        <td colSpan={5}>
                          <ul>
                            {g.leads.map((l) => (
                              <li key={l.id}>
                                <b>{l.name}</b> · {l.rep} · {leadDay(l.date)}
                                <span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span>
                                <OpenInLD id={l.ld} />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > shown.length && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
          <button className="sr-btn2" onClick={() => setAll(true)}>Show all {fmt(groups.length)}</button>
        </div>
      )}
    </div>
  );
}

function Nothing({ leads, pending, onLink, onNone }: {
  leads: Lead[]; pending: boolean; onLink: (l: Lead) => void; onNone: (l: Lead) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? leads : leads.slice(0, PAGE);
  return (
    <div className="sr-panel">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>No partner written</h2><span className="sr-count">{fmt(leads.length)}</span></div>
      </div>
      <p className="sr-sub">
        Lead Docket's “Referred By” and “Marketing Source Details” are empty. Pick the partner who sent the client, or “No partner” if nobody did —
        or fill it in Lead Docket, and it's picked up at the next sync. Business-card leads don't need a partner and aren't listed.
      </p>
      {leads.length === 0 ? <p className="sr-nil">Nothing to fix here.</p> : (
        <div className="sr-scroll">
          <table className="sr-t sr-leads" style={{ minWidth: 720 }}>
            <thead><tr><th>Client</th><th>Representative</th><th>Date</th><th>Outcome</th><th /></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td className="client"><b>{l.name}</b></td>
                  <td className="nowrap">{l.rep} <span className="role">{l.role}</span></td>
                  <td className="nowrap">{leadDay(l.date)}</td>
                  <td className="nowrap"><span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span></td>
                  <td className="dc-acts">
                    <button className="sr-link-btn" disabled={pending} onClick={() => onLink(l)}><Link2 /> Link</button>
                    <button className="dc-mini" disabled={pending} onClick={() => onNone(l)}>No partner</button>
                    <OpenInLD id={l.ld} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {leads.length > shown.length && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
          <button className="sr-btn2" onClick={() => setAll(true)}>Show all {fmt(leads.length)}</button>
        </div>
      )}
    </div>
  );
}

function Duplicates({ groups }: { groups: Data["duplicates"] }) {
  const utils = trpc.useUtils();
  const dismiss = trpc.dataCheck.dismissDuplicate.useMutation({
    onSuccess: () => { toast.success("Marked as different clients"); utils.dataCheck.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="sr-panel">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>Possible duplicates</h2><span className="sr-count">{fmt(groups.length)}</span></div>
      </div>
      <p className="sr-sub">
        The same client name twice within 60 days. A client entered twice counts twice — in sign-ups too. Merge or remove the extra lead in
        Lead Docket and it leaves this list at the next sync; if they really are different people, choose “Not a duplicate”.
      </p>
      {groups.length === 0 ? <p className="sr-nil">No duplicates.</p> : (
        <div className="dc-dups">
          {groups.map((g) => (
            <div key={g.key} className="dc-dup">
              <div className="dc-dup-h">
                <span className={`sr-badge ${g.why === "Same name and phone" ? "sr-b-bad" : "sr-b-sun"}`}>{g.why}</span>
                <button className="dc-mini" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ key: g.key })}>Not a duplicate</button>
              </div>
              <ul>
                {g.leads.map((l) => (
                  <li key={l.id}>
                    <b>{l.name}</b> · {l.rep} · {leadDay(l.date)}
                    <span className={`sr-badge ${outcomeBadge(l.outcome, l.signed)}`}>{l.outcome || "—"}</span>
                    <OpenInLD id={l.ld} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tests({ leads }: { leads: Lead[] }) {
  return (
    <div className="sr-panel">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>Test leads</h2><span className="sr-count">{fmt(leads.length)}</span></div>
      </div>
      <p className="sr-sub">Case type “TEST - Case”. They count like real leads until they're removed in Lead Docket.</p>
      <ul className="dc-plain">
        {leads.map((l) => (
          <li key={l.id}><b>{l.name}</b> · {l.rep} · {leadDay(l.date)} <OpenInLD id={l.ld} /></li>
        ))}
      </ul>
    </div>
  );
}

function Remembered({ rows, manager }: { rows: Data["remembered"]; manager: boolean }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const forget = trpc.dataCheck.forgetWords.useMutation({
    onSuccess: () => { toast.success("Forgotten — those leads are matched from the text again at the next sync."); utils.dataCheck.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!rows.length) return null;
  return (
    <div className="sr-panel">
      <div className="sr-panel-h">
        <div className="sr-ttl"><h2>Remembered answers</h2><span className="sr-count">{fmt(rows.length)}</span></div>
        <button className="sr-btn2" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"}</button>
      </div>
      <p className="sr-sub">What Lead Docket's words mean, as answered here or in the Sign-ups Report. Every lead with the same words follows these.</p>
      {open && (
        <div className="sr-scroll">
          <table className="sr-t" style={{ minWidth: 640 }}>
            <thead><tr><th>Lead Docket says</th><th>Means</th><th>Answered by</th>{manager && <th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>“{r.text}”</td>
                  <td>{r.partnerId ? <Link href={`/crm/facilities/${r.partnerId}`}>{r.partner ?? "a deleted partner"}</Link> : <i style={{ color: "var(--mute)" }}>Not a partner</i>}</td>
                  <td className="nowrap">{r.by ?? "—"}{r.at && <span className="role"> · {leadDay(r.at)}</span>}</td>
                  {manager && (
                    <td className="num"><button className="dc-mini" disabled={forget.isPending} onClick={() => forget.mutate({ key: r.key })}>Forget</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
