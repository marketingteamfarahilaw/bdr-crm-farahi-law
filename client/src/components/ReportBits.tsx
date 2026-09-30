/**
 * Small pieces shared by the sheet-data report pages (Admin Overview, Expenses):
 * KPI cards, chart cards, CSV download, and one colour scheme — FRs charcoal,
 * BDRs amber, former reps grey — so a rep reads the same on every page.
 */
import { CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const ROLE_COLOR: Record<string, string> = { FR: "#3a3a38", BDR: "#c99a00", Former: "#a6a59e", Unassigned: "#d6d4cc" };
export const SERIES = { a: "#3a3a38", b: "#c99a00" };

export const fmt$ = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtCents = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export const axis = { tick: { fontSize: 11 }, stroke: "var(--muted-foreground)" } as const;
export const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />;
// Legend text stays in ink; the swatch beside it carries the series colour.
export const legend = <Legend formatter={(v: string) => <span className="text-muted-foreground">{v}</span>} />;

export function Kpi({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 flex items-start gap-4">
        <div className="mt-0.5 text-foreground/70"><Icon className="w-7 h-7" /></div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-tight tabular-nums">{value}</p>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartCard({ title, note, height = 240, children }: { title: string; note?: string; height?: number; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Period pills: This month … All time (see lib/pacificPeriods). */
export function PeriodPills<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K | "custom"; onChange: (k: K) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-full border border-border bg-card p-1 text-sm" role="group" aria-label="Period">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`px-3 py-1 rounded-full transition-colors ${value === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
