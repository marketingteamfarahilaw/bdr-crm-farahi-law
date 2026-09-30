/**
 * Admin Overview (/bdr/admin) — the team's activity that isn't automated: field
 * visits, expenses, referral rewards, errands and referral-friendly referrals,
 * from the Centralized BDR/FR sheet (server/adminOverview.ts). Managers only.
 *
 * Today's team each get a line (FRs first), former reps share one; everything
 * follows the dates picked; months are Pacific; and the top of the page says
 * when each dataset was last filled in, so a sheet nobody updates can't pass
 * for a quiet month.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { ROLE_COLOR, SERIES, fmt$, pct, axis, grid, legend, Kpi, ChartCard, downloadCsv as download, PeriodPills } from "@/components/ReportBits";
import { periodPresets, shortMonth as monthLabel, type PeriodKey } from "@/lib/pacificPeriods";
import { MapPin, DollarSign, Gift, ClipboardList, Network, TrendingUp, Users, AlertCircle, AlertTriangle, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatInTimeZone } from "date-fns-tz";

const TZ = "America/Los_Angeles";

// A dataset's latest entry is a day ("2026-03-31"), or a month for the referral tracker ("2026-03").
const dayLabel = (d?: string | null) => (!d ? "—" : d.length === 7
  ? new Date(`${d}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
  : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }));
const daysAgo = (d?: string | null) => {
  if (!d) return null;
  const [y, m] = d.split("-").map(Number);
  const end = d.length === 7 ? Date.UTC(y, m, 0, 12) : new Date(`${d}T12:00:00Z`).getTime();
  return Math.floor((Date.now() - end) / 86400000);
};

const UNDATED_NAME: Record<string, string> = {
  visits: "field visits", frExpenses: "FR expenses", bdrExpenses: "BDR expenses", rewards: "rewards", errands: "errands", referrals: "referrals",
};

export default function BdrAdminDashboard() {
  const { user } = useAuth();
  const isAdmin = seesAllData(user?.role);
  const options = useMemo(periodPresets, []);
  const [preset, setPreset] = useState<PeriodKey>("year");
  const range = options.find((o) => o.key === preset)!.range;
  // NOTE: the hook runs on every render (Rules of Hooks) — gated with `enabled`.
  const { data, isLoading, isFetching } = trpc.bdr.adminDashboard.useQuery(range ? { ...range } : null, { enabled: isAdmin, placeholderData: (p) => p });

  if (user && !isAdmin) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="text-lg font-semibold">Admin access required</p>
        <p className="text-muted-foreground text-sm mt-1">This dashboard is only visible to managers.</p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>
      </div>
    );
  }

  const { kpis, byRep, byMonth, byErrandType, byReferralStatus, byRewardType, coverage } = data;
  const months = byMonth.map((m) => ({ ...m, label: monthLabel(m.month) }));
  // Former reps and rows with no rep appear only where they have something.
  const visitReps = byRep.filter((r) => r.role === "FR" || (!r.current && r.visits));
  const errandReps = byRep.filter((r) => r.role === "FR" || (!r.current && r.errands));
  const bdrs = byRep.filter((r) => r.role === "BDR" || (!r.current && r.referrals));
  const short = (name: string) => (name === "Former reps" ? "Former" : name === "No rep named" ? "No rep" : name.split(" ")[0]);
  const undated = Object.entries(coverage.undated).filter(([, n]) => n > 0);
  const period = options.find((o) => o.key === preset)!.label.toLowerCase();

  // When each dataset was last filled in: older than a month is flagged.
  const datasets = [
    ["Field visits", coverage.latest.visits], ["FR expenses", coverage.latest.frExpenses], ["BDR expenses", coverage.latest.bdrExpenses],
    ["Referral rewards", coverage.latest.rewards], ["Errands", coverage.latest.errands], ["Referral-friendly referrals", coverage.latest.referrals],
  ] as const;
  const stale = datasets.filter(([, d]) => (daysAgo(d) ?? 999) > 31);

  const exportReps = () => download(`admin-overview-reps-${preset}.csv`, [
    ["Representative", "Role", "Visits", "Partners visited", "Hours", "FR expenses", "BDR expenses", "Total expenses", "Rewards", "Rewards paid", "Errands", "Errands completed", "Referrals", "Referrals successful"],
    ...byRep.map((r) => [r.rep, r.role, r.visits, r.facilitiesVisited, r.hours, r.frExpenses, r.bdrExpenses, r.totalExpenses, r.rewards, r.rewardsPaid, r.errands, r.errandsCompleted, r.referrals, r.referralsSuccessful]),
  ]);
  const exportMonths = () => download(`admin-overview-months-${preset}.csv`, [
    ["Month", "Visits", "FR expenses", "BDR expenses", "Rewards paid", "Errands", "Referrals", "Referrals successful"],
    ...byMonth.map((m) => [m.month, m.visits, m.frExpenses, m.bdrExpenses, m.rewardsPaid, m.errands, m.referrals, m.referralsSuccessful]),
  ]);

  return (
    <div className="p-6 space-y-6">
      {/* Header: title, dates, export */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Field visits, expenses, rewards, errands and referrals from the Centralized BDR/FR sheet
            {coverage.sheetsSyncedAt ? <> · synced {formatInTimeZone(new Date(coverage.sheetsSyncedAt), TZ, "MMM d, h:mm a")}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <PeriodPills options={options} value={preset} onChange={setPreset} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2"><Download className="w-4 h-4" />Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportReps}>By representative (CSV)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportMonths}>By month (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Coverage: when each dataset was last filled in */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="font-medium">Latest entry:</span>
          {datasets.map(([name, d]) => {
            const old = (daysAgo(d) ?? 999) > 31;
            return <span key={name} className={old ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>{name} <b className="font-medium">{dayLabel(d)}</b></span>;
          })}
        </div>
        {stale.length > 0 && (
          <p className="mt-2 flex items-start gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-none" />
            {stale.map(([n]) => n).join(", ")} {stale.length === 1 ? "hasn't" : "haven't"} been filled in the sheet for over a month, so recent months read low here until the team catches up.
          </p>
        )}
        {undated.length > 0 && (
          <p className="mt-1 text-muted-foreground">
            No usable date in the sheet (blank, "NA", a typo like 3/23/0206, or a day that hasn't come yet):{" "}
            {undated.map(([k, n]) => `${n} ${UNDATED_NAME[k] ?? k}`).join(", ")}.
            {range ? " Left out of this period; " : " Counted here in All time, but in no month; "}fix them in the sheet to place them.
          </p>
        )}
      </div>

      {/* KPIs for the period */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={MapPin} label="Field visits" value={kpis.visits} sub={`${kpis.facilitiesVisited} partner stops`} />
        <Kpi icon={DollarSign} label="Expenses" value={fmt$(kpis.totalExpenses)} sub={`FR ${fmt$(kpis.frExpenses)} · BDR ${fmt$(kpis.bdrExpenses)}`} />
        <Kpi icon={Gift} label="Referral rewards paid" value={fmt$(kpis.rewardsPaid)} sub={`${kpis.rewards} reward${kpis.rewards === 1 ? "" : "s"}`} />
        <Kpi icon={Network} label="Referrals sent to partners" value={kpis.referrals} sub={`${kpis.referralsSuccessful} successful (${pct(kpis.referralsSuccessful, kpis.referrals)})`} />
        <Kpi icon={ClipboardList} label="FR errands" value={kpis.errands} sub={`${kpis.errandsCompleted} completed (${pct(kpis.errandsCompleted, kpis.errands)})`} />
        <Kpi icon={TrendingUp} label="Leads from partners" value={kpis.leadsFromPartners} sub="partner-referred leads received" />
        <Kpi icon={Users} label="Active representatives" value={kpis.activeReps} sub={`of ${byRep.filter((r) => r.current).length} on the team, with activity ${period}`} />
      </div>

      <Tabs defaultValue="reps">
        <TabsList className="mb-4">
          <TabsTrigger value="reps">By representative</TabsTrigger>
          <TabsTrigger value="months">By month</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdowns</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>

        <TabsContent value="reps" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Field visits by Field Rep" note="Visits logged in the sheet">
              <BarChart data={visitReps} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="rep" tickFormatter={short} {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip formatter={(v: number) => [v, "Visits"]} />
                <Bar dataKey="visits" name="Visits" radius={[4, 4, 0, 0]}>{visitReps.map((r) => <Cell key={r.rep} fill={ROLE_COLOR[r.role]} />)}</Bar>
              </BarChart>
            </ChartCard>
            <ChartCard title="Expenses by representative" note="FR expenses and BDR expenses">
              <BarChart data={byRep.filter((r) => r.totalExpenses > 0 || r.current)} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="rep" tickFormatter={short} {...axis} /><YAxis tickFormatter={(v) => fmt$(v)} width={64} {...axis} />
                <Tooltip formatter={(v: number, n: string) => [fmt$(v), n]} />
                <Bar dataKey="frExpenses" name="FR expenses" stackId="e" fill={SERIES.a} />
                <Bar dataKey="bdrExpenses" name="BDR expenses" stackId="e" fill={SERIES.b} radius={[4, 4, 0, 0]} />
                {legend}
              </BarChart>
            </ChartCard>
            <ChartCard title="Referrals sent by BDR" note="Referral-friendly facility referrals: sent vs successful">
              <BarChart data={bdrs} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="rep" tickFormatter={short} {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip />
                <Bar dataKey="referrals" name="Sent" fill={SERIES.a} radius={[4, 4, 0, 0]} />
                <Bar dataKey="referralsSuccessful" name="Successful" fill={SERIES.b} radius={[4, 4, 0, 0]} />
                {legend}
              </BarChart>
            </ChartCard>
            <ChartCard title="Errands by Field Rep" note="All errands vs completed">
              <BarChart data={errandReps} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="rep" tickFormatter={short} {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip />
                <Bar dataKey="errands" name="All" fill={SERIES.a} radius={[4, 4, 0, 0]} />
                <Bar dataKey="errandsCompleted" name="Completed" fill={SERIES.b} radius={[4, 4, 0, 0]} />
                {legend}
              </BarChart>
            </ChartCard>
            <ChartCard title="Referral rewards paid by representative" note="By each reward's sign-up date">
              <BarChart data={byRep.filter((r) => r.rewardsPaid > 0 || r.current)} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="rep" tickFormatter={short} {...axis} /><YAxis tickFormatter={(v) => fmt$(v)} width={64} {...axis} />
                <Tooltip formatter={(v: number) => [fmt$(v), "Rewards paid"]} />
                <Bar dataKey="rewardsPaid" name="Rewards paid" radius={[4, 4, 0, 0]}>{byRep.filter((r) => r.rewardsPaid > 0 || r.current).map((r) => <Cell key={r.rep} fill={ROLE_COLOR[r.role]} />)}</Bar>
              </BarChart>
            </ChartCard>
          </div>
          <p className="text-xs text-muted-foreground">Bars: <span style={{ color: ROLE_COLOR.FR }}>■</span> Field Reps · <span style={{ color: ROLE_COLOR.BDR }}>■</span> BDRs · <span style={{ color: ROLE_COLOR.Former }}>■</span> former reps (together) · <span style={{ color: ROLE_COLOR.Unassigned }}>■</span> rows with no rep named.</p>
        </TabsContent>

        <TabsContent value="months" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Field visits per month">
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip /><Bar dataKey="visits" name="Visits" fill={SERIES.a} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Expenses per month">
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="label" {...axis} /><YAxis tickFormatter={(v) => fmt$(v)} width={64} {...axis} />
                <Tooltip formatter={(v: number, n: string) => [fmt$(v), n]} />
                <Bar dataKey="frExpenses" name="FR expenses" stackId="e" fill={SERIES.a} />
                <Bar dataKey="bdrExpenses" name="BDR expenses" stackId="e" fill={SERIES.b} radius={[4, 4, 0, 0]} />
                {legend}
              </BarChart>
            </ChartCard>
            <ChartCard title="Referral rewards paid per month" note="By each reward's sign-up date">
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="label" {...axis} /><YAxis tickFormatter={(v) => fmt$(v)} width={64} {...axis} />
                <Tooltip formatter={(v: number) => [fmt$(v), "Rewards paid"]} /><Bar dataKey="rewardsPaid" name="Rewards paid" fill={SERIES.b} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Referrals sent and errands per month">
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="label" {...axis} /><YAxis allowDecimals={false} {...axis} />
                <Tooltip />
                <Bar dataKey="referrals" name="Referrals sent" fill={SERIES.a} radius={[4, 4, 0, 0]} />
                <Bar dataKey="errands" name="Errands" fill={SERIES.b} radius={[4, 4, 0, 0]} />
                {legend}
              </BarChart>
            </ChartCard>
          </div>
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard title="Referral status" height={Math.max(160, byReferralStatus.length * 38)}>
              <BarChart data={byReferralStatus} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="status" width={110} {...axis} />
                <Tooltip /><Bar dataKey="count" name="Referrals" fill={SERIES.a} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Errand types" height={Math.max(160, Math.min(10, byErrandType.length) * 34)}>
              <BarChart data={byErrandType.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey="type" width={150} {...axis} />
                <Tooltip /><Bar dataKey="count" name="Errands" fill={SERIES.a} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Rewards by referral type" height={Math.max(160, byRewardType.length * 38)}>
              <BarChart data={byRewardType} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <XAxis type="number" tickFormatter={(v) => fmt$(v)} {...axis} /><YAxis type="category" dataKey="type" width={110} {...axis} />
                <Tooltip formatter={(v: number) => [fmt$(v), "Paid"]} /><Bar dataKey="total" name="Paid" fill={SERIES.b} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
          </div>
        </TabsContent>

        <TabsContent value="table">
          <Card>
            <CardHeader><CardTitle className="text-base">By representative, {period}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Representative</th>
                    <th className="text-right py-2 px-3 font-medium">Visits</th>
                    <th className="text-right py-2 px-3 font-medium">Stops</th>
                    <th className="text-right py-2 px-3 font-medium">Hours</th>
                    <th className="text-right py-2 px-3 font-medium">FR exp.</th>
                    <th className="text-right py-2 px-3 font-medium">BDR exp.</th>
                    <th className="text-right py-2 px-3 font-medium">Total exp.</th>
                    <th className="text-right py-2 px-3 font-medium">Rewards</th>
                    <th className="text-right py-2 px-3 font-medium">Errands</th>
                    <th className="text-right py-2 pl-3 font-medium">Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {byRep.map((r) => (
                    <tr key={r.rep} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full inline-block flex-none" style={{ backgroundColor: ROLE_COLOR[r.role] }} />
                          <span className="font-medium">{r.rep}</span>
                          <span className="text-xs text-muted-foreground">{r.current ? r.role : ""}</span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3">{r.visits || "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.facilitiesVisited || "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.hours ? r.hours.toFixed(1) : "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.frExpenses ? fmt$(r.frExpenses) : "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.bdrExpenses ? fmt$(r.bdrExpenses) : "—"}</td>
                      <td className="text-right py-2.5 px-3 font-medium">{r.totalExpenses ? fmt$(r.totalExpenses) : "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.rewards ? `${fmt$(r.rewardsPaid)} (${r.rewards})` : "—"}</td>
                      <td className="text-right py-2.5 px-3">{r.errands ? `${r.errandsCompleted}/${r.errands}` : "—"}</td>
                      <td className="text-right py-2.5 pl-3">{r.referrals ? `${r.referralsSuccessful}/${r.referrals}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="py-2.5 pr-4">Total</td>
                    <td className="text-right py-2.5 px-3">{kpis.visits}</td>
                    <td className="text-right py-2.5 px-3">{kpis.facilitiesVisited}</td>
                    <td className="text-right py-2.5 px-3">{byRep.reduce((s, r) => s + r.hours, 0).toFixed(1)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.frExpenses)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.bdrExpenses)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.totalExpenses)}</td>
                    <td className="text-right py-2.5 px-3">{fmt$(kpis.rewardsPaid)} ({kpis.rewards})</td>
                    <td className="text-right py-2.5 px-3">{kpis.errandsCompleted}/{kpis.errands}</td>
                    <td className="text-right py-2.5 pl-3">{kpis.referralsSuccessful}/{kpis.referrals}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
