/**
 * Monthly spend entry: per name, pasted from a spreadsheet, or copied from last
 * month — and the accordion that explains how spend becomes cost.
 *
 * Names are matched the way the server matches them (case and spacing don't
 * matter), so what the badges say here is what the scorecard will do.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { NO_SOURCE, TEAM_CHANNEL, channelOfSource } from "@shared/marketing";
import { parseSpendPaste } from "@shared/marketingSpendPaste";
import type { SpendAssignment } from "../../../../server/marketing/spend";
import { prevMonth, usd, type Group } from "./shared";
import "./SpendEditor.css";

export type SpendEditorProps = {
  months: string[];
  group: Group;
  rows: { name: string; members: string[] }[];
  unmatched: SpendAssignment["unmatched"];
};

const keyOf = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const toCents = (n: number) => Math.round(n * 100);
const dateOf = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
const monthName = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "long" });
const monthAbbr = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short" });
const monthLabel = (m: string) => dateOf(m).toLocaleDateString("en-US", { month: "short", year: "numeric" });
/** Whole dollars unless there are cents to show. */
const money = (n: number) => usd(n, !Number.isInteger(n));
// The most setSpendMany takes in one save.
const MAX_ROWS = 300;
export const SPEND_EDITOR_ID = "marketing-spend";

type Entered = { name: string; cents: number };

/**
 * A channel and one of its sources both with spend in the month: the Channels
 * view adds the two, which is right only if the channel figure leaves the
 * source out. Name key → the explanation, for both the channel and the source.
 */
function countedTwice(entered: Map<string, Entered>, month: string) {
  const out = new Map<string, string>();
  const withSpend = Array.from(entered.values()).filter((v) => v.cents > 0);
  const spendKeys = new Map(withSpend.map((v) => [keyOf(v.name), v.name] as [string, string]));
  const parts = new Map<string, string[]>();
  for (const v of withSpend) {
    const ck = keyOf(channelOfSource(v.name));
    if (ck === keyOf(v.name) || !spendKeys.has(ck)) continue;
    parts.set(ck, (parts.get(ck) ?? []).concat(v.name));
  }
  parts.forEach((sources, ck) => {
    const channel = spendKeys.get(ck) ?? ck;
    const title = `${monthName(month)} has spend for ${channel} and for ${sources.join(", ")}. The Channels view adds them together, so check the ${channel} figure doesn't already include ${sources.length === 1 ? "it" : "them"}.`;
    out.set(ck, title);
    sources.forEach((p) => out.set(keyOf(p), title));
  });
  return out;
}

/** Monthly spend per source or channel — what turns lead counts into cost per lead and per sign-up. */
export function SpendEditor({ months, group, rows, unmatched }: SpendEditorProps) {
  const utils = trpc.useUtils();
  const listId = useId();
  const latest = months[months.length - 1] ?? "";
  const [month, setMonth] = useState(latest);
  const [extra, setExtra] = useState("");
  useEffect(() => { if (!months.includes(month)) setMonth(latest); }, [months, month, latest]);
  const prev = month ? prevMonth(month) : "";

  // The month before the range too, so its first month can offer last month's figures.
  const ask = useMemo(() => (months.length ? [prevMonth(months[0]), ...months].slice(-240) : []), [months]);
  const { data: spend = [] } = trpc.marketing.spend.useQuery({ months: ask }, { enabled: ask.length > 0 });
  const names = trpc.marketing.sourceNames.useQuery(undefined, { staleTime: 10 * 60_000 });
  const ld = useMemo(() => names.data ?? [], [names.data]);
  // Until the names load (or if none came back) nothing is called misspelt.
  const ldReady = names.isSuccess && ld.length > 0;

  const done = (message: string) => {
    utils.marketing.spend.invalidate();
    utils.marketing.dashboard.invalidate();
    toast.success(message);
  };
  const fail = (e: { message: string }) => toast.error(e.message);
  const save = trpc.marketing.setSpend.useMutation({ onSuccess: () => done("Spend saved"), onError: fail });
  const saveMany = trpc.marketing.setSpendMany.useMutation({ onError: fail });
  const copy = trpc.marketing.copySpend.useMutation({ onError: fail });

  // month → name key → amount. Case twins are summed, as the report sums them.
  const byMonth = useMemo(() => {
    const out = new Map<string, Map<string, Entered>>();
    for (const r of spend) {
      const m = out.get(r.month) ?? new Map<string, Entered>();
      const k = keyOf(r.source);
      const v = m.get(k) ?? { name: r.source.replace(/\s+/g, " ").trim(), cents: 0 };
      v.cents += toCents(Number(r.amount));
      m.set(k, v);
      out.set(r.month, m);
    }
    return out;
  }, [spend]);
  const cur = byMonth.get(month) ?? new Map<string, Entered>();
  const before = byMonth.get(prev) ?? new Map<string, Entered>();
  const amountIn = (m: Map<string, Entered>, name: string) => {
    const v = m.get(keyOf(name));
    return v && v.cents ? v.cents / 100 : null;
  };

  // Every Lead Docket source and channel, for suggestions and the spelling check.
  const known = useMemo(() => {
    const s = new Set<string>([keyOf(NO_SOURCE), keyOf(TEAM_CHANNEL)]);
    for (const n of ld) { s.add(keyOf(n.source)); s.add(keyOf(n.channel)); }
    for (const r of rows) { s.add(keyOf(r.name)); r.members.forEach((m) => s.add(keyOf(m))); }
    return s;
  }, [ld, rows]);
  const isKnown = (name: string) => !ldReady || known.has(keyOf(name));
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (n: string) => { const k = keyOf(n); if (k && !seen.has(k)) { seen.add(k); out.push(n); } };
    ld.forEach((n) => add(n.source));
    ld.forEach((n) => add(n.channel));
    return out;
  }, [ld]);

  // The period's rows, then anything with spend this month or last but no leads
  // in the period — a billboard that brought none, a contract not producing yet.
  const list: string[] = [];
  const listed = new Set<string>();
  const addName = (n: string) => { const k = keyOf(n); if (k && !listed.has(k)) { listed.add(k); list.push(n); } };
  rows.forEach((r) => { if (r.name !== NO_SOURCE) addName(r.name); });
  Array.from(cur.values()).concat(Array.from(before.values()))
    .filter((v) => v.cents > 0).map((v) => v.name)
    .sort((a, b) => a.localeCompare(b))
    .forEach(addName);

  const lost = new Map(unmatched.map((u) => [keyOf(u.source), u.why] as [string, SpendAssignment["unmatched"][number]["why"]]));
  const twice = countedTwice(cur, month);
  const missing = Array.from(before.entries()).filter(([k, v]) => v.cents > 0 && !(cur.get(k)?.cents));
  const sumOf = (m: Map<string, Entered>) => Array.from(m.values()).reduce((a, v) => a + v.cents, 0) / 100;
  const entered = Array.from(cur.values()).filter((v) => v.cents > 0).length;
  const total = sumOf(cur);
  const prevTotal = sumOf(before);

  const commit = (source: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw.replace(/[$,\s]/g, ""));
    if (value != null && (!Number.isFinite(value) || value < 0)) { toast.error("Enter an amount in dollars."); return; }
    if (value != null && value > 10_000_000) { toast.error("That's more than $10 million — check the amount."); return; }
    const had = amountIn(cur, source);
    if ((value || null) === had) return;
    save.mutate({ month, source, amount: value });
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };

  const doCopy = () => copy.mutate({ from: prev, to: month }, {
    onSuccess: (r) => done(r.skipped ? `Copied ${r.copied}, kept ${r.skipped} already entered` : `Copied ${r.copied}`),
  });

  if (!months.length || !month) return null;
  const unit = group === "channel" ? "channel" : "source";

  return (
    // The id is what the scorecard's Spend cells and "Needs attention" scroll to.
    <div className="sr-panel mk-sp" id={SPEND_EDITOR_ID}>
      <div className="sr-panel-h mk-sp-head">
        <div className="sr-ttl"><h2>Marketing spend</h2></div>
        <div className="mk-sp-tools">
          <select className="sr-input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {[...months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {missing.length > 0 && (
            <button type="button" className="sr-btn2 mk-sp-copy" disabled={copy.isPending} onClick={doCopy}
              title={`Adds the ${missing.length} name${missing.length === 1 ? "" : "s"} entered for ${monthName(prev)} but not ${monthName(month)}. Nothing already entered changes.`}>
              <Copy /> Copy {monthName(prev)}'s spend
            </button>
          )}
        </div>
      </div>
      <p className="sr-sub">
        What each {unit} cost in {monthLabel(month)}. Saved when you leave the box; clear it to remove.
        {group === "channel" ? " A channel's cost also includes spend entered for any of its sources, even ones with no leads yet." : ""}
      </p>

      <div className="mk-spend">
        {list.map((name) => {
          const current = amountIn(cur, name);
          const last = amountIn(before, name);
          const why = lost.get(keyOf(name));
          return (
            <div key={month + "|" + name + "|" + current} className="mk-spend-row mk-sp-row">
              <div className="mk-sp-name">
                <span title={name}>{name}</span>
                {why === "noLeads" && <span className="sr-badge sr-b-sun mk-sp-badge" title="Spend with no matching leads: it still counts in the TOTAL">no leads this period</span>}
                {why === "channel" && (
                  <span className="sr-badge sr-b-sun mk-sp-badge" title="Entered for the whole channel; switch to Channels to see it against its leads">channel total</span>
                )}
                {!isKnown(name) && (
                  <span className="sr-badge sr-b-sun mk-sp-badge" title="No Lead Docket lead has this Marketing Source or channel — check the spelling">not a Lead Docket name</span>
                )}
                {twice.has(keyOf(name)) && <span className="sr-badge sr-b-grey mk-sp-badge" title={twice.get(keyOf(name))}>counted twice?</span>}
              </div>
              <div className="mk-sp-amt">
                {last != null && last !== current ? (
                  <button type="button" className="sr-link-btn mk-sp-same" disabled={save.isPending}
                    title={`Use ${monthName(prev)}'s ${money(last)}`} onClick={() => save.mutate({ month, source: name, amount: last })}>
                    same
                  </button>
                ) : <span className="mk-sp-gap" aria-hidden="true" />}
                <input className="sr-input" inputMode="decimal" aria-label={`${name}, ${monthLabel(month)}`}
                  placeholder={last != null ? `${monthAbbr(prev)} ${money(last)}` : "$0"} defaultValue={current ?? ""}
                  onBlur={(e) => commit(name, e.target.value)} onKeyDown={onEnter} />
              </div>
            </div>
          );
        })}
        <div className="mk-spend-row mk-sp-row mk-sp-new">
          <input className="sr-input" list={listId} placeholder="Another source, as Lead Docket names it" value={extra}
            onChange={(e) => setExtra(e.target.value)} aria-label="Another name" />
          <div className="mk-sp-amt">
            <span className="mk-sp-gap" aria-hidden="true" />
            <input className="sr-input" inputMode="decimal" placeholder="$0" disabled={!extra.trim()} aria-label="Its spend"
              onBlur={(e) => {
                if (extra.trim() && e.target.value.trim()) { commit(extra.trim(), e.target.value); setExtra(""); e.target.value = ""; }
              }}
              onKeyDown={onEnter} />
          </div>
        </div>
      </div>
      <datalist id={listId}>{suggestions.map((n) => <option key={n} value={n} />)}</datalist>
      {extra.trim() && !isKnown(extra) && (
        <p className="sr-sub mk-sp-warn">No Lead Docket lead uses “{extra.trim()}” as its Marketing Source — check the spelling against the suggestions.</p>
      )}

      <p className="sr-sub mk-sp-foot">
        {entered === 0 ? <>Nothing entered for {monthName(month)} yet.</> : (
          <>
            {monthName(month)} total: <b>{money(total)}</b> across {entered} name{entered === 1 ? "" : "s"}
            {prevTotal > 0 ? ` (${monthName(prev)}: ${money(prevTotal)})` : ""}.
          </>
        )}
      </p>

      <SpendPaste month={month} cur={cur} isKnown={isKnown} ldReady={ldReady} pending={saveMany.isPending}
        onSave={(pasted, after) => saveMany.mutate({ month, rows: pasted }, {
          onSuccess: (r) => {
            done(`Saved ${r.saved} for ${monthName(month)}${r.cleared ? `, cleared ${r.cleared}` : ""}`);
            after();
          },
        })} />
    </div>
  );
}

/** Paste two columns from a budget sheet; nothing saves until the preview has been shown. */
function SpendPaste({ month, cur, isKnown, ldReady, pending, onSave }: {
  month: string;
  cur: Map<string, Entered>;
  isKnown: (name: string) => boolean;
  ldReady: boolean;
  pending: boolean;
  onSave: (rows: { source: string; amount: number }[], after: () => void) => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseSpendPaste(text), [text]);
  // A name given twice keeps its last amount, exactly as the save resolves it.
  const pasted = useMemo(() => {
    const m = new Map<string, { line: number; source: string; amount: number }>();
    for (const r of parsed.rows) { m.delete(keyOf(r.source)); m.set(keyOf(r.source), r); }
    return Array.from(m.values());
  }, [parsed]);
  const repeats = parsed.rows.length - pasted.length;
  const tooMany = pasted.length > MAX_ROWS;

  return (
    <details className="sr-acc mk-sp-paste">
      <summary><span>Paste from a spreadsheet</span></summary>
      <p>
        One name and amount per line: copy the two columns from Excel or Google Sheets, or type “Walker Advertising, $4,500”.
        Saves to {monthLabel(month)}. An amount of 0 clears that name.
      </p>
      <textarea className="mk-sp-ta" value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false}
        aria-label="Names and amounts to paste" placeholder={"Walker Advertising\t4,500\nGMB 525 W Main St Visalia\t1,200"} />

      {pasted.length > 0 && (
        <div className="sr-scroll">
          <table className="sr-t mk-sp-prev">
            <thead><tr><th>Name</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {pasted.map((r) => {
                const had = cur.get(keyOf(r.source));
                const have = had && had.cents ? had.cents / 100 : null;
                return (
                  <tr key={keyOf(r.source)}>
                    <td className="mk-sp-pname">{r.source}</td>
                    <td className="num">{r.amount ? money(r.amount) : "$0"}</td>
                    <td>
                      <div className="mk-sp-flags">
                        {!r.amount ? (
                          <span className="sr-badge sr-b-grey mk-sp-badge">{have != null ? `clears ${money(have)}` : "nothing to clear"}</span>
                        ) : (
                          <>
                            {ldReady && (isKnown(r.source)
                              ? <span className="sr-badge sr-b-ok mk-sp-badge">matches</span>
                              : <span className="sr-badge sr-b-sun mk-sp-badge">no Lead Docket leads use this name</span>)}
                            {have != null && (
                              <span className="sr-badge sr-b-grey mk-sp-badge">
                                {toCents(have) === toCents(r.amount) ? "already entered" : `replaces ${money(have)}`}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {parsed.bad.length > 0 && (
        <ul className="mk-sp-bad">
          {parsed.bad.map((b) => <li key={b.line}>Line {b.line}: “{b.text}” isn't a name and an amount, so it won't be saved.</li>)}
        </ul>
      )}
      {repeats > 0 && <p className="sr-sub">{repeats} name{repeats === 1 ? " appears" : "s appear"} more than once; the last amount is the one saved.</p>}
      {tooMany && <p className="sr-sub mk-sp-toomany">That's {pasted.length} names; paste at most {MAX_ROWS} at a time.</p>}
      {pasted.length > 0 && (
        <div className="mk-sp-actions">
          <button type="button" className="sr-btn1" disabled={pending || tooMany}
            onClick={() => onSave(pasted.map((r) => ({ source: r.source, amount: r.amount })), () => setText(""))}>
            Save all {pasted.length}
          </button>
          <button type="button" className="sr-btn2" disabled={pending} onClick={() => setText("")}>Clear</button>
        </div>
      )}
    </details>
  );
}

/** How spend becomes cost, for "How these numbers are built". */
export function SpendAccordion() {
  return (
    <details className="sr-acc">
      <summary><span>Cost per lead and sign-up</span></summary>
      <p>
        Spend is entered below for each source or channel, per month. A channel's spend is what was entered for the channel
        plus for each of its sources — including sources with no leads in this period.
      </p>
      <p>
        Spend that matches no row is listed as “Spend with no matching leads” and still counts in the TOTAL. Each month counts
        in full, even when the range covers only part of it. The totals only use rows with spend, so unpaid channels don't make
        paid ones look cheaper.
      </p>
    </details>
  );
}
