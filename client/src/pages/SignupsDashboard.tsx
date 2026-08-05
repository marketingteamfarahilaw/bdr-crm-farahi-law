import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Building2, Truck, MapPin, Lightbulb, ClipboardList, Target,
  CheckCircle2, FileBarChart2, Download, AlertTriangle,
} from "lucide-react";

/** Executive palette — deep navy + teal, readable on both themes. */
const NAVY = "#12306b";
const TEAL = "#0f9b8e";

const fmt = (n: number) => n.toLocaleString();
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export default function SignupsDashboard() {
  const today = new Date();
  const [from, setFrom] = useState(`${today.getFullYear()}-01-01`);
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const { data, isLoading } = trpc.teamReports.signupsDashboard.useQuery({ from, to });

  const exportCsv = () => {
    if (!data) return;
    const lines = [
      `Sign-ups report,${from} to ${to}`, "",
      "Summary,Value",
      `Total leads,${data.totals.leads}`,
      `Signed,${data.totals.signed} (${data.totals.signedPct}%)`,
      `Best facility type,${data.headline.bestType?.name ?? "—"} (${data.headline.bestType?.leads ?? 0})`,
      `Best territory,${data.headline.bestTerritory?.name ?? "—"} (${data.headline.bestTerritory?.leads ?? 0})`,
      `Attribution rate,${data.totals.matchRate}%`, "",
      "Facility type,Leads",
      ...data.byType.map((t) => `"${t.name}",${t.leads}`), "",
      "Territory,Leads",
      ...data.byTerritory.map((t) => `"${t.name}",${t.leads}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `signups-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading || !data) {
    return <div className="p-6 space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  const typeMax = Math.max(1, ...data.byType.map((t) => t.leads));
  const terrMax = Math.max(1, ...data.byTerritory.map((t) => t.leads));
  const topTerritories = data.byTerritory.slice(0, 10);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: NAVY }}>
            <span className="dark:text-white">Sign-ups</span>
          </h1>
          <p className="text-sm italic text-muted-foreground mt-0.5">
            Reporting period: {data.period.firstLead ? monthLabel(data.period.firstLead) : from} – {data.period.lastLead ? monthLabel(data.period.lastLead) : to}
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-4 h-4 mr-1.5" /> CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label="Total Leads" value={fmt(data.totals.leads)} icon={<Users className="w-7 h-7" />} big />
            <Kpi
              label="Best Facility Type"
              value={data.headline.bestType?.name ?? "—"}
              sub={`${fmt(data.headline.bestType?.leads ?? 0)} leads`}
              icon={<Building2 className="w-7 h-7" />}
            />
            <Kpi
              label="Second Best Facility"
              value={data.headline.secondType?.name ?? "—"}
              sub={`${fmt(data.headline.secondType?.leads ?? 0)} leads`}
              icon={<Truck className="w-7 h-7" />}
            />
            <Kpi
              label="Best Territory"
              value={data.headline.bestTerritory?.name ?? "—"}
              sub={`${fmt(data.headline.bestTerritory?.leads ?? 0)} leads`}
              icon={<MapPin className="w-7 h-7" />}
            />
            <Kpi
              label="Second Best Territory"
              value={data.headline.secondTerritory?.name ?? "—"}
              sub={`${fmt(data.headline.secondTerritory?.leads ?? 0)} leads`}
              icon={<MapPin className="w-7 h-7" />}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Facility Type Breakdown" icon={<Building2 className="w-4 h-4" />}>
              <div className="space-y-2">
                {data.byType.map((t) => <Bar key={t.name} label={t.name} value={t.leads} max={typeMax} color={TEAL} muted={t.name === "N/A"} />)}
              </div>
              {data.headline.bestType && (
                <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 text-sm">
                  <span className="text-2xl font-bold" style={{ color: TEAL }}>{data.headline.bestTypeShare}%</span>
                  <span className="text-muted-foreground">{data.headline.bestType.name} — {data.headline.bestTypeShare}% of all leads</span>
                </div>
              )}
            </Panel>

            <Panel title="Territory Performance" icon={<MapPin className="w-4 h-4" />}>
              <div className="space-y-2">
                {topTerritories.map((t) => <Bar key={t.name} label={t.name} value={t.leads} max={terrMax} color={NAVY} muted={t.name === "N/A"} />)}
              </div>
              <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 text-sm">
                <Target className="w-4 h-4 shrink-0" style={{ color: NAVY }} />
                <span className="text-muted-foreground">
                  Top 2 territories account for <strong className="text-foreground">{fmt(data.headline.topTwoTerritoryLeads)}</strong> leads
                </span>
              </div>
            </Panel>
          </div>

          {/* Executive summary */}
          <Panel title="Executive Summary" icon={<FileBarChart2 className="w-4 h-4" />}>
            <table className="w-full text-sm">
              <tbody>
                <Row k="Total Leads" v={fmt(data.totals.leads)} />
                <Row k="Signed" v={`${fmt(data.totals.signed)} (${data.totals.signedPct}%)`} />
                <Row k="Best Facility Type" v={data.headline.bestType ? `${data.headline.bestType.name} (${data.headline.bestType.leads} leads)` : "—"} accent />
                <Row k="Second Best Facility" v={data.headline.secondType ? `${data.headline.secondType.name} (${data.headline.secondType.leads} leads)` : "—"} accent />
                <Row k="Best Territory" v={data.headline.bestTerritory ? `${data.headline.bestTerritory.name} (${data.headline.bestTerritory.leads} leads)` : "—"} accent />
                <Row k="Second Best Territory" v={data.headline.secondTerritory ? `${data.headline.secondTerritory.name} (${data.headline.secondTerritory.leads} leads)` : "—"} accent />
                <Row k="Attribution rate" v={`${data.totals.matchRate}% of leads matched to a partner`} />
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-border">
            <div className="px-4 py-2.5 text-white text-sm font-semibold flex items-center gap-2" style={{ background: NAVY }}>
              <ClipboardList className="w-4 h-4" /> Important Insights / Notes
            </div>
            <div className="p-4 bg-card">
              <ul className="space-y-2.5 text-sm">
                {data.insights.map((i, n) => (
                  <li key={n} className="flex gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: NAVY }} />
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Panel title="Key Insight" icon={<Lightbulb className="w-4 h-4" />}>
            <p className="text-sm">
              {data.headline.bestType && data.headline.secondType ? (
                <><strong>{data.headline.bestType.name}</strong> and <strong>{data.headline.secondType.name}</strong> drive the majority of sign-ups.</>
              ) : "Not enough data for this period."}
            </p>
          </Panel>

          <Panel title="Recommendations" icon={<CheckCircle2 className="w-4 h-4" />}>
            <ul className="space-y-2.5 text-sm">
              {data.recommendations.map((r, n) => (
                <li key={n} className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: TEAL }} />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {data.totals.matchRate < 100 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="p-4 flex gap-3 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">How “N/A” happens</div>
                  <p className="text-muted-foreground mt-1">
                    Sign-ups record their source as free text, so type and territory are matched back to your partner
                    list. {data.totals.matchRate}% matched ({fmt(data.totals.attributed)} of {fmt(data.totals.withFacilityText)} with a
                    source named). The rest are shown as N/A rather than guessed.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
          <FileBarChart2 className="w-4 h-4 shrink-0" />
          <span><strong className="text-foreground">Management note:</strong> consolidates sign-ups per facility into one executive view. Figures update live from the CRM.</span>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, icon, big }: { label: string; value: string; sub?: string; icon: React.ReactNode; big?: boolean }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-1.5 text-white text-[11px] font-semibold uppercase tracking-wide" style={{ background: NAVY }}>{label}</div>
      <div className="p-3 bg-card flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-bold leading-tight truncate ${big ? "text-3xl" : "text-lg"}`} style={{ color: big ? undefined : TEAL }}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        <span className="shrink-0 opacity-70" style={{ color: NAVY }}>{icon}</span>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 text-white text-sm font-semibold flex items-center gap-2" style={{ background: NAVY }}>{icon} {title}</div>
      <div className="p-4 bg-card">{children}</div>
    </div>
  );
}

function Bar({ label, value, max, color, muted }: { label: string; value: number; max: number; color: string; muted?: boolean }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-28 shrink-0 truncate text-right text-muted-foreground" title={label}>{label}</div>
      <div className="flex-1 h-5 rounded-sm bg-muted/50 overflow-hidden">
        <div className="h-full rounded-sm transition-all" style={{ width: `${pct}%`, background: color, opacity: muted ? 0.35 : 1 }} />
      </div>
      <div className="w-10 shrink-0 tabular-nums text-right font-medium">{value}</div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-3 text-muted-foreground">{k}</td>
      <td className="py-2 text-right font-medium" style={accent ? { color: TEAL } : undefined}>{v}</td>
    </tr>
  );
}
