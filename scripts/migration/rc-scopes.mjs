/**
 * Prints the RingCentral scopes granted to the firm's app (no call placed).
 * If "RingOut" is listed, click-to-call will work. If not, add the RingOut
 * permission in the RingCentral developer console (Auth & Permissions).
 */
import "dotenv/config";
import axios from "axios";

const RC = "https://platform.ringcentral.com";
const { RINGCENTRAL_CLIENT_ID: id, RINGCENTRAL_CLIENT_SECRET: secret, RINGCENTRAL_JWT: jwt } = process.env;

if (!id || !secret || !jwt) {
  console.error("❌ Missing RINGCENTRAL_CLIENT_ID / _SECRET / _JWT in .env");
  process.exit(1);
}

try {
  const r = await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    { auth: { username: id, password: secret }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const scopes = (r.data.scope || "").split(/\s+/).filter(Boolean);
  console.log("\nGranted scopes:\n  " + scopes.join("\n  "));
  const hasRingOut = scopes.some((s) => s.toLowerCase() === "ringout");
  console.log("\n" + (hasRingOut
    ? "✅ RingOut IS granted — click-to-call will work."
    : "⚠️  RingOut is NOT in the granted scopes.\n   Add it: RingCentral Developer console → your app → Auth & Permissions →\n   add 'RingOut' → Save (no graduation needed), then it works."));
} catch (e) {
  console.error("❌ Token mint failed:", e.response?.status, JSON.stringify(e.response?.data ?? e.message));
  process.exit(1);
}
