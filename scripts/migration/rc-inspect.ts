import dotenv from "dotenv";
dotenv.config({ quiet: true });
import axios from "axios";
const RC = "https://platform.ringcentral.com";
const token = (
  await axios.post(
    `${RC}/restapi/oauth/token`,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: process.env.RINGCENTRAL_JWT! }),
    { auth: { username: process.env.RINGCENTRAL_CLIENT_ID!, password: process.env.RINGCENTRAL_CLIENT_SECRET! }, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  )
).data.access_token;
const dateFrom = new Date(Date.now() - 1440 * 60000).toISOString();
const recs = (await axios.get(`${RC}/restapi/v1.0/account/~/extension/~/call-log`, { headers: { Authorization: `Bearer ${token}` }, params: { dateFrom, perPage: 100, view: "Detailed" } })).data.records || [];
const withRec = recs.filter((r: any) => r.recording);
console.log(`${recs.length} calls, ${withRec.length} have a recording`);
console.log("sample (result / duration / hasRecording):", recs.slice(0, 10).map((r: any) => `${r.result}|${r.duration}s|${r.recording ? "REC" : "-"}`).join("  "));
for (const r of withRec.slice(0, 2)) {
  console.log("--- recorded call ---");
  console.log(JSON.stringify({ id: r.id, result: r.result, duration: r.duration, recording: r.recording }, null, 2));
}
process.exit(0);
