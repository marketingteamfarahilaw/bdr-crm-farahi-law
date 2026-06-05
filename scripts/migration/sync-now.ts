/**
 * Force an immediate RingCentral sync with NO settle delay (process even very
 * recent calls). Logs + transcribes recent calls and attaches recaps.
 *   corepack pnpm exec tsx scripts/migration/sync-now.ts [lookbackMinutes]
 */
import "dotenv/config";
import axios from "axios";

const RC = "https://platform.ringcentral.com";
const id = process.env.RINGCENTRAL_CLIENT_ID!;
const secret = process.env.RINGCENTRAL_CLIENT_SECRET!;
const jwt = process.env.RINGCENTRAL_JWT!;

const tok = await axios.post(
  `${RC}/restapi/oauth/token`,
  new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  { auth: { username: id, password: secret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
);
const lookback = parseInt(process.argv[2] || "240", 10);
const { syncRecentCalls } = await import("../../server/rcSync");
const res = await syncRecentCalls(tok.data.access_token, { lookbackMinutes: lookback, settleMinutes: 0 });
console.log("sync result:", JSON.stringify(res));
process.exit(0);
