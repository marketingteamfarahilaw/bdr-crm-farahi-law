import "dotenv/config";
import axios from "axios";
import mysql from "mysql2/promise";
import { getValidRCTokenForUser } from "../server/crmRouter";
import { transcribeAudio } from "../server/_core/voiceTranscription";
const RC = "https://platform.ringcentral.com";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
// one June recorded-but-untranscribed call from Ernesto (ext 663833022)
const [rows]: any = await c.query("SELECT ic.id, ic.rcCallId, ic.agentId, ic.durationSeconds FROM intake_calls ic WHERE ic.callDate>='2026-06-05' AND ic.hasRecording=1 AND (ic.transcript IS NULL OR ic.transcript='') AND ic.agentId=8790033 ORDER BY ic.callDate LIMIT 1");
await c.end();
const call = rows[0];
console.log("test call:", JSON.stringify(call));
const admin = await getValidRCTokenForUser(4710004);
// fetch the call record from the extension log to get contentUri
const rec = await axios.get(`${RC}/restapi/v1.0/account/~/extension/663833022/call-log/${encodeURIComponent(call.rcCallId)}`, { headers: { Authorization: "Bearer " + admin }, params: { view: "Detailed" } }).catch((e) => { console.log("call-log fetch FAIL:", e.response?.status, JSON.stringify(e.response?.data).slice(0, 200)); return null; });
const uri = rec?.data?.recording?.contentUri;
console.log("contentUri:", uri ? uri.slice(0, 80) + "…" : "(none)");
if (uri) {
  // try raw download first to see the HTTP status
  const dl = await axios.get(`${uri}?access_token=${admin}`, { responseType: "arraybuffer", validateStatus: () => true });
  console.log("download status:", dl.status, "| bytes:", dl.data?.length ?? 0, "| rate headers:", dl.headers["x-rate-limit-remaining"] ?? "?", "/", dl.headers["x-rate-limit-limit"] ?? "?");
  if (dl.status === 200) {
    const tr = await transcribeAudio({ audioUrl: `${uri}?access_token=${admin}` });
    console.log("transcribe result:", "error" in tr ? "ERROR: " + JSON.stringify(tr).slice(0, 300) : "OK — " + (tr.text ?? "").slice(0, 120));
  }
}
process.exit(0);
