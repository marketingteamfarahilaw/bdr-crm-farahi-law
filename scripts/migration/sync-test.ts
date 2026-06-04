import dotenv from "dotenv";
dotenv.config({ quiet: true });
import axios from "axios";
import { syncRecentCalls } from "../../server/rcSync";

const RC = "https://platform.ringcentral.com";
const token = (
  await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: process.env.RINGCENTRAL_JWT! }),
    { auth: { username: process.env.RINGCENTRAL_CLIENT_ID!, password: process.env.RINGCENTRAL_CLIENT_SECRET! }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  )
).data.access_token;

// Dry run over the last 24h — fetch + match + dedup-query, but write nothing.
const r = await syncRecentCalls(token, { lookbackMinutes: 1440, settleMinutes: 0, dryRun: true });
console.log("DRY RUN (last 24h):", r);
console.log(`→ ${r.matched} of ${r.scanned} recent calls match a facility and would be synced (${r.logged} new).`);
process.exit(0);
