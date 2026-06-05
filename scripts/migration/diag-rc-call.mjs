/**
 * Diagnose why a call's recap isn't reaching the CRM.
 * Fetches the RingCentral account call-log (detailed) for the last 3 days and
 * reports, for the target number, whether a downloadable recording exists.
 * Usage: node scripts/migration/diag-rc-call.mjs 8610028
 */
import "dotenv/config";
import axios from "axios";

const RC = "https://platform.ringcentral.com";
const { RINGCENTRAL_CLIENT_ID: id, RINGCENTRAL_CLIENT_SECRET: secret, RINGCENTRAL_JWT: jwt } = process.env;
const needle = process.argv[2] || "8610028";

const tok = await axios.post(
  `${RC}/restapi/oauth/token`,
  new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  { auth: { username: id, password: secret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
);
const at = tok.data.access_token;

const dateFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const resp = await axios.get(`${RC}/restapi/v1.0/account/~/extension/~/call-log`, {
  headers: { Authorization: `Bearer ${at}` },
  params: { dateFrom, perPage: 250, view: "Detailed" },
});
const records = resp.data.records || [];
const withRec = records.filter((r) => r.recording).length;

console.log(`\nFetched ${records.length} call-log records (last 3 days).`);
console.log(`${withRec}/${records.length} have a downloadable recording (recording.contentUri).`);
console.log(withRec === 0 ? "  ⚠️  ZERO recordings → automatic call recording appears to be OFF." : "");

const target = records.filter((r) => JSON.stringify(r.from ?? {}) .includes(needle) || JSON.stringify(r.to ?? {}).includes(needle));
console.log(`\nCalls matching "${needle}": ${target.length}`);
for (const r of target.slice(0, 6)) {
  console.log("  ---");
  console.log("  start:", r.startTime, "| dur:", r.duration, "s | result:", r.result, "| dir:", r.direction);
  console.log("  from:", r.from?.phoneNumber, "→ to:", r.to?.phoneNumber);
  console.log("  recording:", r.recording?.contentUri ? "YES" : "NONE");
}
