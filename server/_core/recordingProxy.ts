/**
 * Authenticated RingCentral call-recording playback.
 *
 * GET /api/recording/:logId  — streams the recording for a logged call.
 * Security:
 *  - Requires a valid session cookie (sdk.authenticateRequest).
 *  - Authorizes: managers, the call's rep, or the facility's owner only.
 *  - The RingCentral access token never reaches the browser; the server fetches
 *    the recording (token in the Authorization header) and pipes the bytes back.
 *  - The fetched URL comes from RingCentral's own API response (recording
 *    contentUri), not from user input — so this is not an open proxy / SSRF.
 */
import type { Express } from "express";
import axios from "axios";
import { eq } from "drizzle-orm";
import { seesAllData } from "@shared/permissions";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { contactLogs, facilities } from "../../drizzle/schema";
import { getValidRCTokenForUser, getValidRCToken } from "../crmRouter";

const RC_BASE = "https://platform.ringcentral.com";

function nameCandidates(user: { name?: string | null; agentName?: string | null }): string[] {
  const out = new Set<string>();
  const add = (s?: string | null) => {
    if (!s) return;
    const t = String(s).trim();
    if (!t) return;
    out.add(t.toLowerCase());
    const first = t.split(/\s+/)[0];
    if (first) out.add(first.toLowerCase());
  };
  add(user.agentName);
  add(user.name);
  return Array.from(out);
}

export function registerRecordingProxy(app: Express) {
  app.get("/api/recording/:logId", async (req, res) => {
    let user: any = null;
    try { user = await sdk.authenticateRequest(req); } catch { /* unauthenticated */ }
    if (!user) { res.status(401).send("Not authenticated"); return; }

    const logId = parseInt(String(req.params.logId), 10);
    if (!logId || Number.isNaN(logId)) { res.status(400).send("Bad call id"); return; }

    const db = await getDb();
    if (!db) { res.status(500).send("Database unavailable"); return; }

    const [log] = await db.select().from(contactLogs).where(eq(contactLogs.id, logId)).limit(1);
    if (!log || !log.rcCallId) { res.status(404).send("No recording for this call"); return; }

    // Authorization — managers, the call's rep, or the facility's owner.
    if (!seesAllData(user.role)) {
      const cands = nameCandidates(user);
      let allowed = !!(log.repName && cands.includes(String(log.repName).toLowerCase()));
      if (!allowed && log.facilityId) {
        const [f] = await db.select({ rep: facilities.assignedRepName, repId: facilities.assignedRepId }).from(facilities).where(eq(facilities.id, log.facilityId)).limit(1);
        if (f && ((f.rep && cands.includes(String(f.rep).toLowerCase())) || f.repId === user.id)) allowed = true;
      }
      if (!allowed) { res.status(403).send("Forbidden"); return; }
    }

    // Token: prefer the requester's own RingCentral; fall back to the account token.
    let token: string | null = await getValidRCTokenForUser(user.id);
    if (!token) { try { token = await getValidRCToken(); } catch { token = null; } }
    if (!token) { res.status(503).send("RingCentral not connected"); return; }

    try {
      // The recording content URI comes from RingCentral's call-log record.
      const rec = await axios
        .get(`${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log/${encodeURIComponent(log.rcCallId)}`, { headers: { Authorization: `Bearer ${token}` }, params: { view: "Detailed" } })
        .catch(() => null);
      const contentUri: string | null = rec?.data?.recording?.contentUri ?? null;
      if (!contentUri) { res.status(404).send("No recording attached to this call"); return; }

      const audio = await axios.get(contentUri, { headers: { Authorization: `Bearer ${token}` }, responseType: "stream" });
      res.set("Content-Type", (audio.headers["content-type"] as string) || "audio/mpeg");
      if (audio.headers["content-length"]) res.set("Content-Length", audio.headers["content-length"] as string);
      res.set("Cache-Control", "private, no-store");
      res.set("Accept-Ranges", "none");
      audio.data.pipe(res);
      audio.data.on("error", () => { try { res.end(); } catch { /* ignore */ } });
    } catch (e: any) {
      console.warn("[recordingProxy] failed:", e?.response?.status ?? e?.message ?? e);
      if (!res.headersSent) res.status(502).send("Could not fetch recording");
    }
  });
}
