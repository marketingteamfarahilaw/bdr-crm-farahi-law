/**
 * The Digital Marketing Report's charts (recharts), in the report's palette:
 * charcoal for in-house, sun for referred out, quiet greys for leads and the
 * target. Colours are read from the page's CSS variables, so dark mode swaps
 * them with everything else. One y-axis per chart: conversion sits in its own
 * slim chart under the counts rather than on a second scale, and every chart
 * has a table of its numbers beside or below it.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmt, monthShort, pct1 } from "../SignupsDashboard";

type Colors = { char: string; sun: string; mute: string; mute2: string; line: string; ink2: string; ads: string; pace: string; leads: string };
const FALLBACK: Colors = { char: "#262626", sun: "#f6cf4b", mute: "#7b7a73", mute2: "#a6a59e", line: "rgba(28,28,28,.07)", ink2: "#3a3a38", ads: "#8a887f", pace: "#a6a59e", leads: "rgba(28,28,28,.16)" };

/** The report's colours, re-read when the app switches between light and dark. */
export function useSrColors(): Colors {
  const [c, setC] = useState<Colors>(FALLBACK);
  useEffect(() => {
    const read = () => {
      const el = document.querySelector(".sr .dm") ?? document.querySelector(".sr");
      if (!el) return;
      const s = getComputedStyle(el);
      const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
      setC({
        char: v("--char", FALLBACK.char), sun: v("--sun", FALLBACK.sun), mute: v("--mute", FALLBACK.mute), mute2: v("--mute2", FALLBACK.mute2),
        line: v("--line", FALLBACK.line), ink2: v("--ink2", FALLBACK.ink2), ads: v("--dm-ads", FALLBACK.ads), pace: v("--dm-pace", FALLBACK.pace),
        leads: v("--dm-leads", FALLBACK.leads),
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** The dark tooltip every chart shares: a title and one line per series, in the text colours. */
function Tip({ active, payload, label, title, format }: {
  active?: boolean; payload?: { name?: string; value?: number | string | null; color?: string; dataKey?: string | number }[]; label?: string;
  title: (label: string) => string; format?: (v: number, key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dm-tip">
      <b>{title(String(label ?? ""))}</b>
      {payload.map((p) => (
        <div key={String(p.dataKey)}>
          <i style={{ background: p.color }} />{p.name}: {p.value == null ? "—" : format ? format(Number(p.value), String(p.dataKey)) : fmt(Number(p.value))}
        </div>
      ))}
    </div>
  );
}

const axis = (c: Colors) => ({ stroke: c.line, tickLine: false, axisLine: false, tick: { fill: c.mute, fontSize: 11 } });

function Frame({ height, label, children }: { height: number; label: string; children: ReactNode }) {
  return (
    <div className="dm-chart" role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
    </div>
  );
}

const dayLabel = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Sign-ups building up through the period, against an even pace to the target. */
export function CumulativeChart({ rows, daily, target }: {
  rows: { step: string; targeted: number; total: number; pace: number | null }[]; daily: boolean; target: number | null;
}) {
  const c = useSrColors();
  const label = (s: string) => (daily ? dayLabel(s) : monthShort(s));
  return (
    <Frame height={260} label={`Sign-ups building up through the period against the target of ${target ?? "none"}`}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={c.line} vertical={false} />
        <XAxis dataKey="step" tickFormatter={label} {...axis(c)} minTickGap={18} />
        <YAxis allowDecimals={false} {...axis(c)} width={40} />
        <Tooltip content={<Tip title={label} />} cursor={{ stroke: c.mute2, strokeDasharray: "3 3" }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        {target != null && <Line type="linear" dataKey="pace" name="Target pace (GBP + SEO)" stroke={c.pace} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />}
        <Line type="monotone" dataKey="targeted" name="Signed, GBP + SEO" stroke={c.char} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="total" name="Signed, all digital" stroke={c.sun} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}

export type MonthPoint = { month: string; leads: number; signedInHouse: number; signedReferred: number; signed: number; conversion: number | null };

/** Leads and sign-ups (in-house and referred out) by month, and conversion beneath on its own scale. */
export function MonthlyChart({ rows, what }: { rows: MonthPoint[]; what: string }) {
  const c = useSrColors();
  return (
    <>
      <Frame height={230} label={`${what}: leads and sign-ups by month`}>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={2}>
          <CartesianGrid stroke={c.line} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axis(c)} />
          <YAxis allowDecimals={false} {...axis(c)} width={40} />
          <Tooltip content={<Tip title={(m) => monthShort(m)} />} cursor={{ fill: c.line }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="leads" name="Leads" fill={c.leads} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="signedInHouse" name="Signed in-house" stackId="s" fill={c.char} isAnimationActive={false} />
          <Bar dataKey="signedReferred" name="Signed referred out" stackId="s" fill={c.sun} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </Frame>
      <Frame height={110} label={`${what}: conversion by month`}>
        <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={c.line} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axis(c)} hide />
          <YAxis {...axis(c)} width={40} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<Tip title={(m) => monthShort(m)} format={(v) => pct1(v)} />} cursor={{ stroke: c.mute2, strokeDasharray: "3 3" }} />
          <Line type="monotone" dataKey="conversion" name="Conversion (total signed ÷ leads)" stroke={c.char} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </Frame>
    </>
  );
}

export type QualityPoint = { month: string; leads: number; qualified: number; quality: number; signed: number; conversion: number | null; qualityRate: number | null };

/** Leads narrowing to qualified, quality and signed, month by month; and the two rates beneath. */
export function QualityChart({ rows, what }: { rows: QualityPoint[]; what: string }) {
  const c = useSrColors();
  return (
    <>
      <Frame height={240} label={`${what}: leads, qualified, quality and signed by month`}>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={1}>
          <CartesianGrid stroke={c.line} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axis(c)} />
          <YAxis allowDecimals={false} {...axis(c)} width={40} />
          <Tooltip content={<Tip title={(m) => monthShort(m)} />} cursor={{ fill: c.line }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="leads" name="Leads" fill={c.leads} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="qualified" name="Qualified" fill={c.mute2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="quality" name="Quality" fill={c.sun} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="signed" name="Total signed" fill={c.char} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </Frame>
      <Frame height={150} label={`${what}: conversion and quality rate by month`}>
        <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={c.line} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthShort} {...axis(c)} />
          <YAxis {...axis(c)} width={40} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<Tip title={(m) => monthShort(m)} format={(v) => pct1(v)} />} cursor={{ stroke: c.mute2, strokeDasharray: "3 3" }} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="qualityRate" name="Quality rate (quality ÷ leads)" stroke={c.sun} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="conversion" name="Conversion (signed ÷ leads)" stroke={c.char} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </Frame>
    </>
  );
}
