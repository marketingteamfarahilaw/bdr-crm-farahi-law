import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { UtensilsCrossed, CheckCircle2, Link2, RefreshCw, Building2, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function UberEats() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.crm.uber.status.useQuery();
  const { data: recent, refetch } = trpc.crm.uber.recent.useQuery();
  const [orderId, setOrderId] = useState("");

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
