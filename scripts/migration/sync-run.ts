import dotenv from "dotenv";
dotenv.config({ quiet: true });
import axios from "axios";
// Dynamic import AFTER dotenv so env.ts (which reads process.env at import time)
// sees the loaded .env — otherwise transcription's forge config is empty.
const { syncRecentCalls } = await import("../../server/rcSync");

const RC = "https://platform.ringcentral.com";
const token = (
  await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: process.env.RINGCENTRAL_JWT! }),
    { auth: { username: process.env.RINGCENTRAL_CLIENT_ID!, password: process.env.RINGCENTRAL_CLIENT_SECRET! }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  )
).data.access_token;

const lookback = Number(process.argv[2] ?? 180);
console.log(`Real sync — last ${lookback} min (logging + transcribing)…`);
const r = await syncRecentCalls(token, { lookbackMinutes: lookback, settleMinutes: 3 });
console.log("RESULT:", JSON.stringify(r));
process.exit(0);
