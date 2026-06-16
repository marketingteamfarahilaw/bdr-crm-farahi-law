/**
 * Verifies the address-based rename candidates against Google Places.
 * For each candidate, ask Google for the address of BOTH the current CRM name
 * and the proposed Excel name, and also reverse-geocode the stored address to a
 * business. Whichever name Google actually places at the stored address is the
 * correct one. Proves whether the Excel-by-address rename is trustworthy.
 *
 * Run: node scripts/migration/verify-address-names.mjs
 */
import "dotenv/config";
import fs from "fs";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const { candidates } = JSON.parse(fs.readFileSync("scripts/migration/fix-names-by-address-report.json", "utf8"));
const pick = candidates.filter((x) => x.cityConfirmed);

const addrOf = async (q) => {
  try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(q)}&inputtype=textquery&fields=name,formatted_address&key=${KEY}`); const j = await r.json(); const c = (j.candidates || [])[0]; return c ? `${c.name} — ${c.formatted_address}` : "(no result)"; } catch (e) { return "(error)"; }
};
const bizAt = async (addr) => {
  try { const r = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(addr)}&inputtype=textquery&fields=name,formatted_address,types&key=${KEY}`); const j = await r.json(); const c = (j.candidates || [])[0]; return c ? `${c.name} (${(c.types||[]).slice(0,2).join(",")})` : "(no result)"; } catch { return "(error)"; }
};

for (const x of pick) {
  console.log(`\n#${x.id}  stored address: ${x.address}`);
  console.log(`  CRM name "${x.crmName}"  → Google: ${await addrOf(x.crmName + " " + (x.city || ""))}`);
  console.log(`  Excel name "${x.newName}" → Google: ${await addrOf(x.newName + " " + (x.city || ""))}`);
  console.log(`  Business AT stored address per Google: ${await bizAt(x.address)}`);
}
