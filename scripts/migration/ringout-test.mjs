/**
 * RingOut capability test.
 *
 * Verifies the firm's RingCentral app can place a server-side RingOut call:
 *   rings FROM (your phone) first, then connects it to TO.
 * This is the reliable click-to-call backbone — no browser widget, no mic.
 *
 * Usage:
 *   node scripts/migration/ringout-test.mjs "+1AAA..." "+1BBB..."
 *     arg1 = FROM  (the phone that should ring first — your cell/desk)
 *     arg2 = TO    (who it connects you to — a number you control, or a facility)
 *
 * Reads RINGCENTRAL_CLIENT_ID / _SECRET / _JWT from .env (same creds the sync uses).
 */
import "dotenv/config";
import axios from "axios";

const RC = "https://platform.ringcentral.com";
const clientId = process.env.RINGCENTRAL_CLIENT_ID;
const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
const jwt = process.env.RINGCENTRAL_JWT;

const from = process.argv[2];
const to = process.argv[3];

function die(msg) { console.error("\n❌ " + msg + "\n"); process.exit(1); }

if (!clientId || !clientSecret || !jwt) die("Missing RINGCENTRAL_CLIENT_ID / _SECRET / _JWT in .env");
if (!from || !to) die('Need two numbers: node ringout-test.mjs "+1FROM" "+1TO"');

const auth = { username: clientId, password: clientSecret };
const form = (o) => new URLSearchParams(o);

const main = async () => {
  console.log("→ Minting RingCentral token from JWT…");
  let at;
  try {
    const tok = await axios.post(
      `${RC}/restapi/oauth/token`,
      form({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      { auth, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    at = tok.data.access_token;
    console.log("  ✓ token ok\n");
  } catch (e) {
    die("Token mint failed: " + (e.response?.status ?? "") + " " + JSON.stringify(e.response?.data ?? e.message));
  }

  console.log(`→ Placing RingOut: ring ${from}  →  connect to ${to}`);
  try {
    const ro = await axios.post(
      `${RC}/restapi/v1.0/account/~/extension/~/ring-out`,
      { from: { phoneNumber: from }, to: { phoneNumber: to }, playPrompt: false },
      { headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" } }
    );
    console.log("\n✅ RINGOUT ACCEPTED — your phone should be ringing now.");
    console.log("   id:", ro.data.id, "| status:", JSON.stringify(ro.data.status));
    console.log("\n   → RingOut works on this account. I can wire it into the CRM's Call buttons.");
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;
    if (status === 403) {
      console.error("\n⚠️  403 — the RingCentral app is missing the 'RingOut' permission.");
      console.error("   Fix: RingCentral Developer console → your app → Auth & Permissions →");
      console.error("   add the 'RingOut' application scope → Save (no graduation needed). Then re-run.");
    } else {
      console.error("\n❌ RingOut failed:", status, JSON.stringify(data ?? e.message));
    }
    process.exit(1);
  }
};

main();
