/**
 * Saves the Filevine credentials and tests the login, on the server — the same
 * thing Settings → "Filevine — API connection" → Save & test does. Run by the
 * "Connect Filevine" workflow, which hands the values over in FV_* env vars so
 * they never sit in the repo. Blank values keep what's already saved.
 *
 *   FV_PAT=… FV_CLIENT_ID=… FV_CLIENT_SECRET=… npx tsx scripts/filevine-connect.ts
 */
import "dotenv/config";
import { filevineStatus, saveFilevine } from "../server/filevine";

const v = (k: string) => process.env[k]?.trim() || undefined;
const result = await saveFilevine({
  pat: v("FV_PAT"), clientId: v("FV_CLIENT_ID"), clientSecret: v("FV_CLIENT_SECRET"),
  orgId: v("FV_ORG_ID"), userId: v("FV_USER_ID"), account: v("FV_ACCOUNT"),
});
const s = await filevineStatus();
console.log(`Saved: token ending ${s.patTail ?? "—"} · Client ID ending ${s.clientIdTail ?? "—"} (${s.clientIdLength}) · secret ending ${s.secretTail ?? "—"} (${s.secretLength}) · org ${s.orgId ?? "—"} · user ${s.userId ?? "—"}`);
if (result.ok) {
  console.log(`CONNECTED as Filevine user ${result.userId ?? "?"} · orgs: ${result.orgs.map((o) => `${o.name} (${o.id})`).join(", ") || "none"}${result.orgMatches === false ? " · WARNING: the saved Org ID isn't one of them" : ""}`);
  process.exit(0);
}
console.log(`FAILED: ${result.error}`);
process.exit(1);
