// Read-only: mint an RC token from the JWT, pull recent calls, and match them
// to facilities in the DB — so we know which facility's "Sync" will show data.
import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mysql from "mysql2/promise";
import axios from "axios";

const RC = "https://platform.ringcentral.com";
const CID = process.env.RINGCENTRAL_CLIENT_ID;
const CSEC = process.env.RINGCENTRAL_CLIENT_SECRET;
const JWT = process.env.RINGCENTRAL_JWT;
const norm = (s) => (s || "").replace(/\D/g, "");

const tok = (
  await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: JWT }),
    { auth: { username: CID, password: CSEC }, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  )
).data.access_token;

const dateFrom = new Date(Date.now() - 60 * 864e5).toISOString();
const log =
  (
    await axios.get(`${RC}/restapi/v1.0/account/~/extension/~/call-log`, {
      headers: { Authorization: `Bearer ${tok}` },
      params: { dateFrom, perPage: 100, view: "Detailed" },
    })
  ).data.records || [];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [facs] = await conn.query("SELECT id, name, phone, phone2, phone3, contactPhone FROM facilities");
const facPhones = facs.flatMap((f) =>
  [f.phone, f.phone2, f.phone3, f.contactPhone].filter(Boolean).map((p) => ({ id: f.id, name: f.name, p: norm(p) })),
);
await conn.end();

console.log(`Pulled ${log.length} calls (last 60 days). Facility matches:\n`);
let matches = 0;
for (const r of log) {
  const from = norm(r.from?.phoneNumber);
  const to = norm(r.to?.phoneNumber);
  const m = facPhones.find((fp) => fp.p && (from.endsWith(fp.p) || to.endsWith(fp.p) || fp.p.endsWith(from) || fp.p.endsWith(to)));
  if (m) {
    matches++;
    const rec = r.recording ? " 🎙️rec" : "";
    console.log(`  ${r.startTime?.slice(0, 10)}  ${r.direction.padEnd(8)} ${(r.result || "").padEnd(16)} ${r.to?.phoneNumber}  → ${m.name} (#${m.id})${rec}`);
  }
}
console.log(`\n${matches} of ${log.length} calls match a facility.`);
