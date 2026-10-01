/**
 * FR expenses: Filevine beside the Centralized sheet (server/filevineExpenses.ts).
 *
 * Filevine's rows come in as an upload of the "Filevine FR expenses" workbook;
 * each upload replaces what Filevine had for the reps in it. The comparison
 * pairs each Filevine expense with a sheet row of the same rep and amount a few
 * days apart, and lists what only one side has. Nothing here changes a total.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatInTimeZone } from "date-fns-tz";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Info, Loader2, Upload } from "lucide-react";
import { fmtCents, downloadCsv, PeriodPills } from "@/components/ReportBits";
import { periodPresets, longDay, type PeriodKey } from "@/lib/pacificPeriods";

const TZ = "America/Los_Angeles";

/** The workbook's columns, by header, so their order doesn't matter. */
const COLS = {
  itemId: "Filevine item ID", projectId: "Filevine project ID", rep: "Rep", day: "Date incurred", entered: "Date entered",
  type: "Type", store: "Store", amount: "Amount", payment: "Payment", requestedBy: "Requested by", enteredBy: "Entered by",
} as const;

const asDay = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const asText = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

async function readWorkbook(file: File) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
  const missing = Object.values(COLS).filter((h) => !(h in (rows[0] ?? {})));
  if (missing.length) throw new Error(`This isn't the Filevine FR expenses workbook — missing ${missing.join(", ")}.`);
  return rows.map((r) => ({
    itemId: String(r[COLS.itemId] ?? "").trim(),
    projectId: Number(r[COLS.projectId]),
    rep: String(r[COLS.rep] ?? "").trim(),
    day: asDay(r[COLS.day]),
    entered: asDay(r[COLS.entered]),
    type: asText(r[COLS.type]),
    store: asText(r[COLS.store]),
    amount: Number(r[COLS.amount]),
    payment: asText(r[COLS.payment]),
    requestedBy: asText(r[COLS.requestedBy]),
    enteredBy: asText(r[COLS.enteredBy]),
  })).filter((r) => r.itemId && Number.isFinite(r.projectId) && Number.isFinite(r.amount) && r.rep);
}

export default function FilevineCompare() {
  const options = useMemo(periodPresets, []);
  const [preset, setPreset] = useState<PeriodKey | "custom">("year");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const range = preset === "custom"
    ? { from: custom.from || undefined, to: custom.to || undefined }
    : { from: options.find((o) => o.key === preset)!.range?.from, to: options.find((o) => o.key === preset)!.range?.to };
  const utils = trpc.useUtils();
  const { data, isLoading, isFetching } = trpc.bdr.filevineExpenses.compare.useQuery(range, { placeholderData: (p) => p });
  const upload = trpc.bdr.filevineExpenses.import.useMutation({
    onSuccess: (r) => { toast.success(`Loaded ${r.imported} Filevine expenses for ${r.projects} reps.`); utils.bdr.filevineExpenses.compare.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try { upload.mutate({ rows: await readWorkbook(f) }); } catch (e) { toast.error((e as Error).message); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportCsv = () => data && downloadCsv(`fr-expenses-filevine-vs-sheet-${range.from ?? "start"}_to_${range.to ?? "today"}.csv`, [
    ["Where", "Rep", "Date", "Amount", "Store", "Type / reason", "Facility", "Note"],
    ...data.onlyFilevine.map((f) => ["Only in Filevine", f.rep, f.day ?? "", f.amount.toFixed(2), f.store ?? "", f.type ?? "", "", f.day ? "" : "no date in Filevine"]),
    ...data.onlySheet.map((s) => ["Only in the sheet", s.rep, s.day ?? "", s.amount.toFixed(2), s.store ?? "", s.reason ?? "", s.facility ?? "", ""]),
    ...data.looseMatches.map((p) => ["Both — dates differ", p.fv.rep, `${p.fv.day ?? "no date"} / ${p.sheet.day ?? ""}`, p.fv.amount.toFixed(2), p.fv.store ?? p.sheet.store ?? "", p.fv.type ?? "", p.sheet.facility ?? "", `${p.daysApart} days apart`]),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">FR expenses — Filevine vs the sheet</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Each Field Rep's “Expenses” project in Filevine, matched with the Centralized sheet's “2.FR Expen” tab
            {data?.importedAt ? <> · Filevine loaded {formatInTimeZone(new Date(data.importedAt), TZ, "MMM d, h:mm a")}</> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Load Filevine export
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!data?.filevineRows}>
            <Download className="w-4 h-4" />Export differences
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex items-start gap-2 text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 flex-none" />
        <span>
          A Filevine expense counts as in the sheet when the same rep has the same amount within 3 days; up to 14 days apart it's listed as
          “dates differ”. Only the reps who have a Filevine project are compared. Nothing here changes an expense total — fix a missing or wrong
          expense in the sheet (or in Filevine), and the next sync or upload updates this page.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodPills options={options} value={preset} onChange={(k) => setPreset(k)} />
        <div className="flex items-center gap-1.5 text-sm">
          <Input type="date" aria-label="From" className="h-9 w-[150px]" value={preset === "custom" ? custom.from : range.from ?? ""}
            onChange={(e) => { setCustom({ from: e.target.value, to: preset === "custom" ? custom.to : range.to ?? "" }); setPreset("custom"); }} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To" className="h-9 w-[150px]" value={preset === "custom" ? custom.to : range.to ?? ""}
            onChange={(e) => { setCustom({ from: preset === "custom" ? custom.from : range.from ?? "", to: e.target.value }); setPreset("custom"); }} />
        </div>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {isLoading || !data ? <div className="h-72 bg-muted animate-pulse rounded-lg" /> : !data.filevineRows ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No Filevine expenses loaded yet. Click <b>Load Filevine export</b> and choose the “Filevine FR expenses” workbook.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Filevine</TableHead>
                  <TableHead className="text-right">Sheet</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-right">In both</TableHead>
                  <TableHead className="text-right">Only in Filevine</TableHead>
                  <TableHead className="text-right">Only in the sheet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reps.map((r) => {
                  const diff = Math.round((r.filevine.total - r.sheet.total) * 100) / 100;
                  return (
                    <TableRow key={r.rep}>
                      <TableCell className="font-medium">{r.rep}</TableCell>
                      <TableCell className="text-right">{fmtCents(r.filevine.total)} <span className="text-muted-foreground text-xs">· {r.filevine.count}</span></TableCell>
                      <TableCell className="text-right">{fmtCents(r.sheet.total)} <span className="text-muted-foreground text-xs">· {r.sheet.count}</span></TableCell>
                      <TableCell className={`text-right ${Math.abs(diff) >= 0.01 ? "font-semibold" : "text-muted-foreground"}`}>{diff > 0 ? "+" : ""}{fmtCents(diff)}</TableCell>
                      <TableCell className="text-right">{r.matched}</TableCell>
                      <TableCell className="text-right">{r.onlyFilevine.count ? <>{r.onlyFilevine.count} <span className="text-muted-foreground text-xs">· {fmtCents(r.onlyFilevine.total)}</span></> : "—"}</TableCell>
                      <TableCell className="text-right">{r.onlySheet.count ? <>{r.onlySheet.count} <span className="text-muted-foreground text-xs">· {fmtCents(r.onlySheet.total)}</span></> : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <List title="In Filevine, not in the sheet" empty="Every Filevine expense in this period is in the sheet."
            head={["Date", "Rep", "Amount", "Store", "Type", "Payment"]}
            rows={data.onlyFilevine.map((f) => [f.day ? longDay(f.day) : "no date", f.rep, fmtCents(f.amount), f.store ?? "—", f.type ?? "—", f.payment ?? "—"])} />
          <List title="In the sheet, not in Filevine" empty="Every sheet expense for these reps in this period is in Filevine."
            head={["Date", "Rep", "Amount", "Store", "Facility", "Reason"]}
            rows={data.onlySheet.map((s) => [s.day ? longDay(s.day) : "—", s.rep, fmtCents(s.amount), s.store ?? "—", s.facility ?? "—", s.reason ?? "—"])} />
          {data.looseMatches.length > 0 && (
            <List title="In both, but the dates differ" empty=""
              head={["Rep", "Amount", "Filevine date", "Sheet date", "Days apart", "Store"]}
              rows={data.looseMatches.map((p) => [p.fv.rep, fmtCents(p.fv.amount), p.fv.day ? longDay(p.fv.day) : "no date", p.sheet.day ? longDay(p.sheet.day) : "—", String(p.daysApart), p.fv.store ?? p.sheet.store ?? "—"])} />
          )}
        </>
      )}
    </div>
  );
}

function List({ title, empty, head, rows }: { title: string; empty: string; head: string[]; rows: string[][] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title} <span className="text-muted-foreground text-sm font-normal">· {rows.length}</span></h2>
      {!rows.length ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto max-h-[480px] overflow-y-auto">
          <Table>
            <TableHeader><TableRow>{head.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={j === 0 ? "whitespace-nowrap" : ""}>{c}</TableCell>)}</TableRow>)}</TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
