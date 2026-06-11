/**
 * Retell AI voice-agent webhook.
 *
 * POST /api/voice-agent/webhook?token=<secret>
 * Retell calls this when Maya (the AI intake specialist) finishes a call.
 * The transcript is delivered ready-made, so the call flows straight into the
 * same pipeline as human-taken intake calls: extraction → CA SOL → score →
 * lead in the queue.
 *
 * Security: the URL carries a random token generated at agent-setup time and
 * stored in app_settings (voice_agent_webhook_token). Requests without it are
 * rejected; the payload itself is treated as data only.
 */
import type { Express } from "express";
import { getDb, getSetting } from "../db";
import { createIntakeCall, updateIntakeCall, VOICE_AGENT_NAME } from "../intakeDb";
import { routeAnalyzedTranscript } from "../intakeSync";
import { intakeCalls } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export function registerVoiceAgentWebhook(app: Express) {
  app.post("/api/voice-agent/webhook", async (req, res) => {
    try {
      const expected = await getSetting("voice_agent_webhook_token");
      if (!expected || String(req.query.token ?? "") !== expected) {
        res.status(403).json({ ok: false });
        return;
      }

      const event = String(req.body?.event ?? "");
      const call = req.body?.call ?? {};
      const retellId: string = String(call.call_id ?? "");
      if (!retellId) { res.json({ ok: true, ignored: "no call_id" }); return; }

      // Only act once the transcript exists. Retell sends call_started /
      // call_ended / call_analyzed — call_ended already carries the transcript;
      // call_analyzed repeats it with analysis. Process whichever arrives first
      // with a transcript; dedupe by the Retell call id.
      const transcript: string = String(call.transcript ?? "");
      if (!transcript || (event !== "call_ended" && event !== "call_analyzed")) {
        res.json({ ok: true, ignored: event });
        return;
      }

      const db = await getDb();
      if (!db) { res.status(500).json({ ok: false }); return; }
      const rcKey = `retell_${retellId}`;
      const [existing] = await db.select({ id: intakeCalls.id, aiProcessed: intakeCalls.aiProcessed })
        .from(intakeCalls).where(eq(intakeCalls.rcCallId, rcKey)).limit(1);

      const fromNumber = call.from_number ?? null;
      const toNumber = call.to_number ?? null;
      const durationSecs = Math.round((call.duration_ms ?? 0) / 1000) ||
        Math.max(0, Math.round(((call.end_timestamp ?? 0) - (call.start_timestamp ?? 0)) / 1000));
      const callDate = call.start_timestamp ? new Date(call.start_timestamp) : new Date();
      const recordingUrl = call.recording_url ?? null;

      let callId: number;
      if (existing) {
        if (existing.aiProcessed === 1) { res.json({ ok: true, deduped: true }); return; }
        callId = existing.id;
        if (recordingUrl) await updateIntakeCall(callId, { recordingUrl, hasRecording: 1 });
      } else {
        callId = await createIntakeCall({
          direction: call.direction === "outbound" ? "Outbound" : "Inbound",
          fromNumber, toNumber,
          callerName: null,
          callDate,
          durationSeconds: durationSecs,
          callResult: "connected",
          agentId: null,
          agentName: VOICE_AGENT_NAME,
          rcCallId: rcKey,
          rcSessionId: null,
          hasRecording: recordingUrl ? 1 : 0,
          recordingUrl,
        });
      }

      // TEST MODE (default): Maya's calls are analyzed and visible ONLY on the
      // super admin's Agents page — no leads are created and the team never
      // sees them. Flip to live from the Agents page when testing is done.
      const mode = (await getSetting("voice_agent_mode")) ?? "test";
      const r = await routeAnalyzedTranscript({
        callId,
        transcript,
        direction: "Inbound",
        callerNumber: fromNumber,
        durationSecs,
        callDate,
        agent: { id: null, name: VOICE_AGENT_NAME },
        createLeads: mode === "live",
      });
      console.log(`[voiceAgent] processed Retell call ${retellId} (${mode}): lead ${r.leadCreated ? "created" : r.leadUpdated ? "updated" : "none"}.`);
      res.json({ ok: true });
    } catch (e: any) {
      console.warn("[voiceAgent] webhook failed:", e?.message ?? e);
      if (!res.headersSent) res.status(500).json({ ok: false });
    }
  });
}
