import type { Express, Request, Response } from "express";
import { verifyUberSignature, importOrderReceipt, uberConfigured } from "../uber";

// Uber for Business posts here when an order receipt is ready (event_type
// "business_order.receipt"). We verify the signature, ack fast (Uber retries on
// non-200), then fetch + import the receipt as an expense.
export function registerUberWebhook(app: Express) {
  app.post("/api/uber/webhook", async (req: Request, res: Response) => {
    const sig = req.header("x-uber-signature");
    const raw = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (uberConfigured() && !verifyUberSignature(raw, sig)) {
      console.warn("[uber] webhook signature verification failed");
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    const body = req.body ?? {};
    res.status(200).json({ ok: true }); // ack immediately

    if (body?.event_type === "business_order.receipt" && body?.meta?.order_id) {
      try {
        const r = await importOrderReceipt(body.meta.order_id);
        console.log(`[uber] order ${body.meta.order_id}: ${r.created ? `+$${r.amount} expense → ${r.facilityName ?? "unmatched"}` : r.reason}`);
      } catch (e: any) {
        console.warn("[uber] import failed:", e?.response?.status ?? e?.message ?? e);
      }
    }
  });
  console.log(`[uber] receipt webhook at /api/uber/webhook (${uberConfigured() ? "configured" : "awaiting credentials"})`);
}
