/**
 * One-off diagnostic: given a downloaded RingCentral credentials JSON, verify
 * the JWT still mints an access token (i.e. whether the app currently accepts
 * the jwt-bearer grant), show the token owner, and count recent calls.
 * Usage: node scripts/migration/rc-jwt-test.mjs "<path-to-creds.json>" "<jwt-label>"
 * Reads secrets from the file — nothing is written or committed.
 */
import fs from "node:fs";
import axios from "axios";

const path = process.argv[2];
const creds = JSON.parse(fs.readFileSync(path, "utf8"));
const clientId = creds.clientId;
const clientSecret = creds.clientSecret;
const jwtObj = creds.jwt ?? {};
const jwtKey = process.argv[3] || Object.keys(jwtObj).pop();
const jwt = jwtObj[jwtKey];
const RC = creds.server || "https://platform.ringcentral.com";

console.log("Client ID:", clientId);
console.log("Using JWT label:", jwtKey);
if (!jwt) { console.error("No JWT found for that label."); process.exit(1); }

try {
  const r = await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    { auth: { username: clientId, password: clientSecret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const token = r.data.access_token;
  console.log("\n✅ JWT mint OK.");
  console.log("Scopes:", r.data.scope);
  const me = await axios.get(`${RC}/restapi/v1.0/account/~/extension/~`, { headers: { Authorization: `Bearer ${token}` } });
  console.log("Token owner:", me.data.name, "| ext id:", me.data.id, "| email:", me.data.contact?.email ?? "(none)");
  const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cl = await axios.get(`${RC}/restapi/v1.0/account/~/extension/~/call-log`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { dateFrom, perPage: 25, view: "Detailed" },
  });
  console.log("Recent calls on THIS extension (last 30d):", cl.data.records?.length ?? 0);
} catch (e) {
  console.error("\n❌ FAILED:", e.response?.status, JSON.stringify(e.response?.data ?? e.message));
}
