import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { UtensilsCrossed, CheckCircle2, Link2, RefreshCw, Building2, AlertTriangle, Upload } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Minimal CSV parser (handles quoted fields, commas, newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
const COL: Record<string, RegExp> = {
  date: /date|time|ordered|created|when/i,
  amount: /total|amount|grand|charge|cost|price/i,
  restaurant: /restaurant|store|merchant|vendor/i,
  address: /address|delivery|destination|drop ?off|deliver/i,
  requester: /requester|employee|ordered by|^user$|^name$|first ?name|member/i,
};
function detectColumns(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (const [key, re] of Object.entries(COL)) {
    const i = header.findIndex((h) => re.test(String(h)));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}
const toAmount = (s: any) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };

export default function UberEats() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.crm.uber.status.useQuery();
  const { data: recent, refetch } = trpc.crm.uber.recent.useQuery();
  const [orderId, setOrderId] = useState("");
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [csvMap, setCsvMap] = useState<Record<string, number>>({});
  const [csvFile, setCsvFile] = useState("");

  const importExpenses = trpc.crm.uber.importExpenses.useMutation({
    onSuccess: (r) => {
      toast.success(`Imported ${r.inserted} Uber Eats expense${r.inserted !== 1 ? "s" : ""} · ${r.matched} matched a facility`);
      setCsvRows([]); setCsvFile("");
      utils.crm.uber.recent.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const onCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseCsv(String(reader.result || ""));
      if (grid.length < 2) { toast.error("No rows found in that file."); return; }
      const idx = detectColumns(grid[0]);
      setCsvMap(idx);
      if (idx.amount === undefined) { toast.error("Couldn't find an amount/total column — tell me your column headers and I'll tune it."); setCsvRows([]); return; }
      const parsed = grid.slice(1).map((r) => ({
        date: idx.date !== undefined ? r[idx.date] : undefined,
        amount: toAmount(r[idx.amount]),
        restaurant: idx.restaurant !== undefined ? r[idx.restaurant] : undefined,
        address: idx.address !== undefined ? r[idx.address] : undefined,
        requester: idx.requester !== undefined ? r[idx.requester] : undefined,
      })).filter((x) => x.amount > 0);
      setCsvRows(parsed);
    };
    reader.readAsText(file);
  };
  const csvTotal = csvRows.reduce((s, r) => s + r.amount, 0);

  const importOrder = trpc.crm.uber.importOrder.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? `Imported $${r.amount} → ${r.facilityName ?? "unmatched facility"}` : `Order not imported (${r.reason})`);
      setOrderId("");
      utils.crm.uber.recent.invalidate();
      utils.crm.uber.status.invalidate();
      utils.crm.facilities.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const webhookUrl = (typeof window !== "undefined" ? window.location.origin : "") + (status?.webhookPath ?? "/api/uber/webhook");

  return (
    <div className="dashboard-mesh min-h-full">
      <div className="max-w-3xl mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>Uber Eats</h1>
            <p className="text-sm text-muted-foreground">Auto-import the meals you send partners as expenses — via the Uber for Business Receipt API.</p>
          </div>
        </div>

        {/* Status */}
        <div className="premium-card rounded-2xl p-5">
          {status?.configured ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-foreground">Connected to Uber for Business</p>
                <p className="text-xs text-muted-foreground">{status.imported} order{status.imported !== 1 ? "s" : ""} imported{status.lastAt ? ` · last ${formatDistanceToNow(new Date(status.lastAt), { addSuffix: true })}` : ""}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Awaiting credentials</p>
                <p className="text-xs text-muted-foreground mt-1">Add your Uber for Business app credentials to the server <code className="text-foreground">.env</code> and point the webhook here (see Setup below). Orders will then import automatically.</p>
              </div>
            </div>
          )}
        </div>

        {/* CSV import */}
        <div className="premium-card rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Upload className="w-4 h-4" />Import from CSV</h2>
          <p className="text-xs text-muted-foreground">Download your Uber Eats order history (Uber Eats app → Account → <strong className="text-foreground">Download your data</strong>, or Uber for Business → Reports → export) and drop the CSV here. Each order becomes an FR expense, matched to its facility by delivery address.</p>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm cursor-pointer hover:border-primary/40 transition-colors">
            <Upload className="w-4 h-4 text-muted-foreground" /> <span className="text-foreground">{csvFile || "Choose CSV file…"}</span>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onCsv} className="hidden" />
          </label>
          {csvRows.length > 0 && (
            <div className="space-y-3">
              <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2 text-xs text-muted-foreground">
                Found <strong className="text-foreground">{csvRows.length}</strong> orders · total <strong className="text-foreground">${csvTotal.toFixed(2)}</strong>
                <div className="mt-1">Mapped: {Object.keys(COL).map((k) => <span key={k} className={csvMap[k] !== undefined ? "text-emerald-400" : "text-amber-400"}>{k}{csvMap[k] === undefined ? "✕" : "✓"}&nbsp; </span>)}</div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="px-3 py-1.5">Date</th><th className="px-3 py-1.5">Restaurant</th><th className="px-3 py-1.5">Address</th><th className="px-3 py-1.5 text-right">Amount</th></tr></thead>
                  <tbody>{csvRows.slice(0, 4).map((r, i) => (<tr key={i} className="border-b border-border/40"><td className="px-3 py-1.5 text-muted-foreground">{r.date || "—"}</td><td className="px-3 py-1.5 text-foreground">{r.restaurant || "—"}</td><td className="px-3 py-1.5 text-muted-foreground truncate max-w-[220px]">{r.address || "—"}</td><td className="px-3 py-1.5 text-right text-foreground">${r.amount.toFixed(2)}</td></tr>))}</tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">Check the columns mapped correctly. If something's off, tell me your CSV's column names and I'll tune the parser.</p>
              <Button onClick={() => importExpenses.mutate({ rows: csvRows, cardType: "Company" })} disabled={importExpenses.isPending} className="gap-2">
                {importExpenses.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}Import {csvRows.length} expense{csvRows.length !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>

        {/* Recent imports */}
        <div className="premium-card rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Uber Eats orders</h2>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Refresh</Button>
          </div>
          {(recent ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 px-4">No Uber Eats orders imported yet. Completed orders on your Uber for Business profile appear here automatically.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Restaurant</th>
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(recent as any[]).map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="px-4 py-2 text-muted-foreground text-xs">{r.orderDate ? new Date(r.orderDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2 text-foreground">{r.storeName || "—"}</td>
                    <td className="px-4 py-2">{r.facilityName ? <span className="inline-flex items-center gap-1 text-foreground text-xs"><Building2 className="w-3 h-3 text-emerald-400" />{r.facilityName}</span> : <span className="text-amber-400 text-xs">unmatched</span>}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{r.requesterName || "—"}</td>
                    <td className="px-4 py-2 text-right font-medium text-foreground">{r.amount ? `$${r.amount}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Manual import (testing) */}
        <div className="premium-card rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Import an order manually</h2>
          <p className="text-xs text-muted-foreground">For testing or backfilling a missed order — paste an Uber order ID. (Managers only.)</p>
          <div className="flex gap-2">
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Uber order_id (UUID)" className="bg-card border-border" />
            <Button onClick={() => importOrder.mutate({ orderId })} disabled={!orderId.trim() || importOrder.isPending} className="gap-2 shrink-0">
              {importOrder.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}Import
            </Button>
          </div>
        </div>

        {/* Setup */}
        <div className="premium-card rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Link2 className="w-4 h-4" />Setup</h2>
          <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-4">
            <li>In the <strong className="text-foreground">Uber Developer dashboard</strong>, create an app under your <strong className="text-foreground">Uber for Business</strong> org with the <code className="text-foreground">business.receipts</code> scope.</li>
            <li>Add to the server <code className="text-foreground">.env</code>: <code className="text-foreground">UBER_CLIENT_ID</code>, <code className="text-foreground">UBER_CLIENT_SECRET</code>, <code className="text-foreground">UBER_ORG_ID</code> (organization UUID), <code className="text-foreground">UBER_SIGNING_KEY</code> (webhook signing key).</li>
            <li>Set the app's <strong className="text-foreground">Order Receipt webhook URL</strong> to:
              <div className="mt-1 font-mono text-[11px] bg-secondary/60 rounded px-2 py-1 text-foreground break-all">{webhookUrl}</div>
            </li>
            <li>Order Uber Eats to partner facilities <strong className="text-foreground">from your Uber for Business profile</strong>. Each completed order auto-creates an FR expense here, matched to the facility by delivery address.</li>
          </ol>
          <p className="text-[11px] text-muted-foreground/80">Note: Uber has no API for personal-account order history — only orders placed on your Uber for Business profile flow through this webhook.</p>
        </div>
      </div>
    </div>
  );
}
