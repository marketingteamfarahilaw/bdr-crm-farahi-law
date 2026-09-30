/**
 * One expense ledger (Field Rep or BDR), read-only, from server/expensesView.ts.
 *
 * Expenses are entered in the Centralized BDR/FR sheet; the CRM reloads them
 * every 8 hours, so there is nothing to add or edit here — the page says where
 * to make a change instead of offering a form whose work the next sync erases.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { seesAllData } from "@shared/permissions";
import { formatInTimeZone } from "date-fns-tz";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Receipt, Calculator, CreditCard, Users, Download, ExternalLink, Search, Loader2, Info } from "lucide-react";
import { ClickToCallButton } from "@/components/RingCentralWidget";
import { ROLE_COLOR, SERIES, fmt$, fmtCents, pct, axis, grid, legend, Kpi, ChartCard, downloadCsv, PeriodPills } from "@/components/ReportBits";
import { periodPresets, shortMonth, longDay, type PeriodKey } from "@/lib/pacificPeriods";

const TZ = "America/Los_Angeles";
const PAGE = 100;

export default function ExpenseLedger({ ledger }: { ledger: "fr" | "bdr" }) {
  const { user } = useAuth();
  const isManager = seesAllData(user?.role);
  const options = useMemo(periodPresets, []);
  const [preset, setPreset] = useState<PeriodKey | "custom">("year");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [rep, setRep] = useState("all");
  const [card, setCard] = useState<"all" | "Company" | "Personal">("all");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { const t = setTimeout(() => setSearch(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);

  const range = preset === "custom"
    ? { from: custom.from || undefined, to: custom.to || undefined }
    : { from: options.find((o) => o.key === preset)!.range?.from, to: options.find((o) => o.key === preset)!.range?.to };
  const input = {
    ledger, ...range,
    rep: rep === "all" ? undefined : rep,
    card: ledger === "fr" && card !== "all" ? card : undefined,
    search: search || undefined,
  };
  const { data, isLoading, isFetching } = trpc.bdr.expenses.useQuery(input, { placeholderData: (p) => p });
  useEffect(() => setShown(PAGE), [ledger, preset, custom.from, custom.to, rep, card, search]);

  const isFR = ledger === "fr";
  const title = isFR ? "Field Rep Expenses" : "BDR Expenses";
  const periodLabel = preset === "custom"
    ? `${custom.from ? longDay(custom.from) : "the start"} – ${custom.to ? longDay(custom.to) : "today"}`
    : options.find((o) => o.key === preset)!.label.toLowerCase();

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>
        <div className="h-72 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const { rows, summary, byRep, byMonth, topStores, source } = data;
  const months = byMonth.map((m) => ({ ...m, label: shortMonth(m.month) }));
  const short = (name: string) => (name === "No rep named" ? "No rep" : name.split(" ")[0]);

  const exportCsv = () => downloadCsv(`${isFR ? "fr" : "bdr"}-expenses-${preset === "custom" ? `${custom.from || "start"}_to_${custom.to || "today"}` : preset}.csv`, [
    isFR
      ? ["Date", "Representative", "Facility", "Store", "Reason", "Amount", "Card", "Notes"]
      : ["Report month", "Date", "Representative", "Facility", "Facility phone", "Store", "Reason", "Amount"],
    ...rows.map((r) => isFR
      ? [r.day, r.rep, r.facilityName, r.store, r.reason, r.amount.toFixed(2), r.cardType, r.notes]
      : [r.reportMonth, r.day, r.rep, r.facilityName, r.facilityPhone, r.store, r.reason, r.amount.toFixed(2)]),
  ]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            From the Centralized BDR/FR sheet, tab “{source.tab}”
            {source.syncedAt ? <> · synced {formatInTimeZone(new Date(source.syncedAt), TZ, "MMM d, h:mm a")}</> : null}
            {source.latest ? <> · latest expense {longDay(source.latest)}</> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href={source.sheetUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" />Open the sheet</a>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!rows.length}>
            <Download className="w-4 h-4" />Export CSV
          </Button>
        </div>
      </div>

      {/* Where changes are made */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex items-start gap-2 text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 flex-none" />
        <span>
          To add or correct an expense, change it in the sheet — the CRM reloads it every 8 hours, so edits made here would be lost.
          {summary.zeroAmount > 0 && <> {summary.zeroAmount} {summary.zeroAmount === 1 ? "entry has" : "entries have"} no amount in the sheet.</>}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <PeriodPills options={options} value={preset} onChange={(k) => setPreset(k)} />
        <div className="flex items-center gap-1.5 text-sm">
          <Input type="date" aria-label="From" className="h-9 w-[150px]" value={preset === "custom" ? custom.from : range.from ?? ""}
            onChange={(e) => { setCustom({ from: e.target.value, to: preset === "custom" ? custom.to : range.to ?? "" }); setPreset("custom"); }} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To" className="h-9 w-[150px]" value={preset === "custom" ? custom.to : range.to ?? ""}
            onChange={(e) => { setCustom({ from: preset === "custom" ? custom.from : range.from ?? "", to: e.target.value }); setPreset("custom"); }} />
        </div>
        {isManager && (
          <Select value={rep} onValueChange={setRep}>
            <SelectTrigger className="h-9 w-[190px]" aria-label="Representative"><SelectValue placeholder="All representatives" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All representatives</SelectItem>
              {data.reps.map((r) => <SelectItem key={r.rep} value={r.rep}>{r.rep}{r.current ? "" : " (former)"}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {isFR && (
          <Select value={card} onValueChange={(v) => setCard(v as typeof card)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any card</SelectItem>
              <SelectItem value="Company">Company card</SelectItem>
              <SelectItem value="Personal">Personal card</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="h-9 w-[220px] pl-8" placeholder="Facility, store, reason…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground self-center" />}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={DollarSign} label="Total spent" value={fmt$(summary.total)} sub={periodLabel} />
        <Kpi icon={Receipt} label="Expense entries" value={summary.count.toLocaleString()} sub={`${summary.reps} representative${summary.reps === 1 ? "" : "s"}`} />
        <Kpi icon={Calculator} label="Average per entry" value={fmtCents(summary.average)} />
        {isFR
          ? <Kpi icon={CreditCard} label="On personal cards" value={fmt$(summary.personal)} sub={`${pct(summary.personal, summary.total)} of the total — to reimburse`} />
          : <Kpi icon={Users} label="Biggest spender" value={byRep[0] ? short(byRep[0].rep) : "—"} sub={byRep[0] ? `${fmt$(byRep[0].total)} · ${pct(byRep[0].total, summary.total)} of the total` : undefined} />}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
          <Receipt className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">No expenses for these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a longer period or clear the search.</p>
        </div>
      ) : (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Spend per month" note={isFR ? "Company and personal card" : undefined}>
              <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                {grid}<XAxis dataKey="label" {...axis} /><YAxis tickFormatter={(v) => fmt$(v)} width={64} {...axis} />
                <Tooltip formatter={(v: number, n: string) => [fmtCents(v), n]} />
                {isFR ? [
                  <Bar key="c" dataKey="company" name="Company card" stackId="m" fill={SERIES.a} />,
                  <Bar key="p" dataKey="personal" name="Personal card" stackId="m" fill={SERIES.b} radius={[4, 4, 0, 0]} />,
                ] : <Bar dataKey="total" name="Spent" fill={SERIES.b} radius={[4, 4, 0, 0]} />}
                {isFR ? legend : null}
              </BarChart>
            </ChartCard>
            <ChartCard title="Spend by representative" height={Math.max(160, byRep.length * 34)}>
              <BarChart data={byRep} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <XAxis type="number" tickFormatter={(v) => fmt$(v)} {...axis} /><YAxis type="category" dataKey="rep" width={130} {...axis} />
                <Tooltip formatter={(v: number, _n: string, p: any) => [`${fmtCents(v)} · ${p.payload.count} entries`, "Spent"]} />
                <Bar dataKey="total" name="Spent" radius={[0, 4, 4, 0]}>{byRep.map((r) => <Cell key={r.rep} fill={ROLE_COLOR[r.role] ?? ROLE_COLOR.Former} />)}</Bar>
              </BarChart>
            </ChartCard>
            {topStores.length > 0 && (
              <ChartCard title="Where the money goes" note="Top stores and services" height={Math.max(160, topStores.length * 34)}>
                <BarChart data={topStores} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <XAxis type="number" tickFormatter={(v) => fmt$(v)} {...axis} /><YAxis type="category" dataKey="store" width={130} {...axis} />
                  <Tooltip formatter={(v: number, _n: string, p: any) => [`${fmtCents(v)} · ${p.payload.count} entries`, "Spent"]} />
                  <Bar dataKey="total" name="Spent" fill={SERIES.a} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartCard>
            )}
          </div>

          {/* The entries */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Entries ({rows.length.toLocaleString()})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!isFR && <TableHead>Report month</TableHead>}
                    <TableHead>Date</TableHead>
                    <TableHead>Representative</TableHead>
                    <TableHead>Facility</TableHead>
                    {!isFR && <TableHead>Phone</TableHead>}
                    <TableHead>Store</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {isFR && <TableHead>Card</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, shown).map((r) => (
                    <TableRow key={r.id}>
                      {!isFR && <TableCell className="whitespace-nowrap text-muted-foreground">{r.reportMonth ?? "—"}</TableCell>}
                      <TableCell className="whitespace-nowrap">{longDay(r.day)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: ROLE_COLOR[r.role] ?? ROLE_COLOR.Former }} />
                          {r.rep}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={r.facilityName ?? undefined}>{r.facilityName ?? "—"}</TableCell>
                      {!isFR && <TableCell className="whitespace-nowrap">{r.facilityPhone ? <ClickToCallButton phoneNumber={r.facilityPhone} /> : "—"}</TableCell>}
                      <TableCell className="max-w-[140px] truncate" title={r.store ?? undefined}>{r.store ?? "—"}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground" title={[r.reason, r.notes].filter(Boolean).join(" — ") || undefined}>{r.reason ?? "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium tabular-nums">{fmtCents(r.amount)}</TableCell>
                      {isFR && <TableCell className="whitespace-nowrap text-xs">{r.cardType === "Personal"
                        ? <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">Personal</span>
                        : <span className="text-muted-foreground">Company</span>}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={isFR ? 5 : 7} className="font-semibold">Total, {periodLabel}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtCents(summary.total)}</TableCell>
                    {isFR && <TableCell />}
                  </TableRow>
                </TableFooter>
              </Table>
              {rows.length > shown && (
                <div className="pt-4 text-center">
                  <Button variant="outline" size="sm" onClick={() => setShown(rows.length)}>Show all {rows.length.toLocaleString()} entries</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
