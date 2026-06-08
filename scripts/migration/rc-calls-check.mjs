/**
 * Lists recent calls on the JWT owner's extension and whether each has a
 * recording attached (recordings are required for transcript + AI recap).
 * Usage: node scripts/migration/rc-calls-check.mjs "<creds.json>" "<jwt-label>"
 */
import fs from "node:fs";
import axios from "axios";

const path = process.argv[2];
const creds = JSON.parse(fs.readFileSync(path, "utf8"));
const RC = creds.server || "https://platform.ringcentral.com";
const jwtKey = process.argv[3] || Object.keys(creds.jwt ?? {}).pop();
const jwt = (creds.jwt ?? {})[jwtKey];

const r = await axios.post(
  `${RC}/restapi/oauth/token`,
  new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  { auth: { username: creds.clientId, password: creds.clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
);
const token = r.data.access_token;

const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const cl = await axios.get(`${RC}/restapi/v1.0/account/~/extension/~/call-log`, {
  headers: { Authorization: `Bearer ${token}` },
  params: { dateFrom, perPage: 50, view: "Detailed" },
});
const recs = cl.data.records ?? [];
let withRec = 0;
for (const c of recs) {
  const hasRec = !!c.recording?.contentUri;
  if (hasRec) withRec++;
  console.log(
    `${(c.startTime || "").slice(0, 16)}  ${c.direction?.padEnd(8) ?? ""} ${(c.from?.phoneNumber ?? "?")}→${(c.to?.phoneNumber ?? "?")}  ${String(c.duration ?? 0).padStart(4)}s  ${c.result?.padEnd(16) ?? ""} rec=${hasRec ? "YES" : "no"}`
  );
}
console.log(`\nTotal: ${recs.length} calls in last 30d, ${withRec} WITH a recording.`);
