/**
 * Small helpers every Marketing Report panel shares: money formats, the row →
 * drill scope rule, and the change pill's wording and colour.
 */
import { NO_SOURCE, TEAM_CHANNEL, channelOfSource } from "@shared/marketing";
import type { DrillScope, RowRef } from "../../../../server/marketing/common";

export type Group = "channel" | "source";

export const usd = (n: number | null | undefined, cents = false) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/** Compact money for tight spots: '$950', '$4.5k', '$12k', '$1.2M'. */
export const usdK = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const short = (v: number) => String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  if (a >= 999_500) return `${sign}$${short(a / 1_000_000)}M`;
  if (a >= 1000) return `${sign}$${short(a / 1000)}k`;
  return `${sign}$${Math.round(a)}`;
};

/** '2026-09' → '2026-08'. */
export const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

// The row the server keeps whole in both views: leads with no source.
export const SPECIAL = new Set([NO_SOURCE, TEAM_CHANNEL]);

/** The scorecard row a lead's source counts in, as the server's rowNameOf: the two special rows stay whole. */
export const rowNameOf = (source: string, group: Group) =>
  group === "channel" && !SPECIAL.has(source) ? channelOfSource(source) : source;

/** What to ask the server for a row's clients: a channel asks for all its Lead Docket sources. */
export const scopeOf = (row: RowRef): DrillScope =>
  SPECIAL.has(row.name) || !row.members.length ? { source: row.name } : { sources: row.members };

/**
 * Every rejected case in a range, with why: the scorecard's Rejected column
 * (rejected, lost or closed), newest first, up to the 500 the endpoint allows.
 * The Rejected panel and the presentation's appendix ask with exactly this, so
 * they share one cached answer and the deck opens without waiting for it.
 */
export const rejectedQuery = (from: string, to: string) =>
  ({ from, to, bucket: "rejected", status: "all", limit: 500, withWhy: true }) as const;
/** How old that answer may be when the deck opens; older, and the deck fetches it again first. */
export const REJECTED_FRESH_MS = 60_000;

export type Delta = { text: string; tone: "ok" | "bad" | "grey" };

/**
 * How a number moved against the comparison period.
 * - count: '+12 (+9%)', '−4'; the % is left off when prev is under 10.
 * - pct (values in percent, e.g. 16.4): '+1.4 pts'.
 * - money: '+$1,200 (+12%)'.
 * 'new' when there was nothing before; '·' when both are nothing; '±0' when unchanged.
 * Tone is grey when the change is under 3% (or under 1 point) — too small to call.
 * invert: lower is better (cost), so a fall is 'ok'.
 */
export function delta(cur: number | null | undefined, prev: number | null | undefined, kind: "count" | "pct" | "money", invert = false): Delta {
  if (cur == null || prev == null) return { text: "·", tone: "grey" };
  const d = cur - prev;
  const good = (d > 0) !== invert;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  if (kind === "pct") {
    const pts = Math.round(Math.abs(d) * 10) / 10;
    return { text: pts === 0 ? "±0 pts" : `${sign}${pts.toFixed(1)} pts`, tone: pts < 1 ? "grey" : good ? "ok" : "bad" };
  }
  if (prev === 0) return cur === 0 ? { text: "·", tone: "grey" } : { text: "new", tone: good ? "ok" : "bad" };
  const abs = Math.abs(d);
  const amount = kind === "money" ? usd(Math.round(abs)) : abs.toLocaleString("en-US");
  const share = Math.round((abs / Math.abs(prev)) * 100);
  const text = d === 0 ? `±${kind === "money" ? "$0" : "0"}` : `${sign}${amount}${Math.abs(prev) >= 10 ? ` (${sign}${share}%)` : ""}`;
  return { text, tone: abs / Math.abs(prev) < 0.03 ? "grey" : good ? "ok" : "bad" };
}
