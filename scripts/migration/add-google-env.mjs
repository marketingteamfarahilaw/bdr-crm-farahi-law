/**
 * Append Google OAuth credentials from a downloaded client_secret_*.json into
 * the local .env (gitignored). Reads from the file so the secret is never
 * passed on the command line or printed.
 *   node scripts/migration/add-google-env.mjs <client_secret.json>
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node add-google-env.mjs <client_secret.json>"); process.exit(1); }

const j = JSON.parse(fs.readFileSync(file, "utf8")).web;
let env = "";
try { env = fs.readFileSync(".env", "utf8"); } catch {}

if (env.includes("GOOGLE_CLIENT_ID=")) {
  console.log("GOOGLE_CLIENT_ID is already in .env — leaving it as-is.");
} else {
  const block = `\n# --- Google OAuth login ---\nGOOGLE_CLIENT_ID=${j.client_id}\nGOOGLE_CLIENT_SECRET=${j.client_secret}\nGOOGLE_ALLOWED_DOMAIN=farahilaw.com\n`;
  fs.appendFileSync(".env", block);
  console.log(`OK: added GOOGLE_CLIENT_ID (${j.client_id.slice(0, 30)}…) + secret + domain to .env`);
}
console.log("registered redirect_uris:", JSON.stringify(j.redirect_uris));
