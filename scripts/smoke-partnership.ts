/** Runtime smoke test of the partnership data layer against the live DB. */
import "dotenv/config";
import { listPods, getQuotaSummary, getLoopBoard, getPodHealth, getLeadershipSummary, getPodFeed, listVisitRequests } from "../server/partnershipDb";

const pods = await listPods();
console.log("listPods →", pods.length, "pod(s):", pods.map((p) => `${p.id}:${p.name}`).join(", "));

const quota = await getQuotaSummary();
console.log("getQuotaSummary →", quota.month, "| pods:", quota.pods.length, "| sample:", JSON.stringify(quota.pods[0] ?? null));

const board = await getLoopBoard({ all: true });
console.log("getLoopBoard counts →", JSON.stringify(board.counts));

if (pods[0]) {
  const health = await getPodHealth(pods[0].id);
  console.log("getPodHealth →", JSON.stringify({ score: health?.score, band: health?.band, warnings: health?.warnings, metrics: health?.metrics }));
  const feed = await getPodFeed(pods[0].id, 5);
  console.log("getPodFeed →", feed.length, "events");
}

const lead = await getLeadershipSummary();
console.log("getLeadershipSummary totals →", JSON.stringify(lead.totals));

const reqs = await listVisitRequests({ all: true });
console.log("listVisitRequests →", reqs.length, "facilities flagged");
console.log("✓ partnership data layer OK");
process.exit(0);
