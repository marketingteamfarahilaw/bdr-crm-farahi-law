/**
 * Intake-side RingCentral call sync — the Eve-style capture loop.
 *
 * Each intake team member connects their own RingCentral (same OAuth flow as
 * the BD side). This pulls THEIR extension's recent calls, logs every call to
 * intake_calls, transcribes the recorded ones (Whisper), runs the AI intake
 * extraction, and creates or updates the matching intake_leads row — so by the
 * time a specialist opens the queue, the case facts and the qualification
 * score are already filled in.
 *
 * Completely separate tables + matching from the facility-CRM sync: an intake
 * call NEVER lands in contact_logs and never touches facility data.
 */
import axios from "axios";
import { transcribeAudio } from "./_core/voiceTranscription";
import { analyzeIntakeTranscript } from "./intakeAI";
import {
  addLeadEvent,
  applyAnalysisToLead,
  createIntakeCall,
  createLeadFromAnalysis,
  findOpenLeadByPhone,
  getExistingIntakeRcCallIds,
  getExistingIntakeRcSessionIds,
  linkCallToLead,
  updateIntakeCall,
} from "./intakeDb";

const RC_BASE = "https://platform.ringcentral.com";

export type IntakeSyncResult = {
  scanned: number;
  logged: number;
  transcribed: number;
  leadsCreated: number;
  leadsUpdated: number;
  skippedRecent: number;
};

export async function syncIntakeCalls(
  accessToken: string,
  opts: {
    agent: { id: number; name: string };
    lookbackMinutes?: number;
    settleMinutes?: number;
    perPage?: number;
  },
): Promise<IntakeSyncResult> {
  const lookbackMinutes = opts.lookbackMinutes ?? 90;
  const settleMs = (opts.settleMinutes ?? 2) * 60 * 1000;
  const perPage = opts.perPage ?? 250;

  const dateFrom = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
  const resp = await axios.get(`${RC_BASE}/restapi/v1.0/account/~/extension/~/call-log`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { dateFrom, perPage, view: "Detailed" },
  });
  const records: any[] = resp.data?.records ?? [];
  const result: IntakeSyncResult = { scanned: records.length, logged: 0, transcribed: 0, leadsCreated: 0, leadsUpdated: 0, skippedRecent: 0 };
  if (records.length === 0) return result;

  const ids = records.map((r) => String(r.id)).filter(Boolean);
  const sessionIds = records.map((r) => String(r.telephonySessionId ?? r.sessionId ?? "")).filter(Boolean);
  const existing = await getExistingIntakeRcCallIds(ids);
  const existingSessions = await getExistingIntakeRcSessionIds(sessionIds);
  const now = Date.now();

  for (const r of records) {
    const id = String(r.id);
    const sessionId = String(r.telephonySessionId ?? r.sessionId ?? "");
    if (!id || existing.has(id)) continue;
    if (sessionId && existingSessions.has(sessionId)) continue;

    // Let RingCentral attach the recording before processing.
    const startMs = r.startTime ? new Date(r.startTime).getTime() : 0;
    if (startMs && now - startMs < settleMs) { result.skippedRecent++; continue; }

    const direction = r.direction ?? "Inbound";
    const callerNumber = direction === "Inbound" ? (r.from?.phoneNumber ?? null) : (r.to?.phoneNumber ?? null);
    const callerName = direction === "Inbound" ? (r.from?.name ?? null) : (r.to?.name ?? null);
    const durationSecs = r.duration ?? 0;
    const callDate = r.startTime ? new Date(r.startTime) : new Date();
    const callResult =
      r.result === "Call connected" || r.result === "Accepted" ? "connected"
      : r.result === "Voicemail" ? "voicemail"
      : r.result === "No Answer" || r.result === "Missed" ? "no_answer"
      : r.result === "Busy" ? "busy" : "other";
    const recordingUrl: string | null = r.recording?.contentUri ?? null;

    const callId = await createIntakeCall({
      direction,
      fromNumber: r.from?.phoneNumber ?? null,
      toNumber: r.to?.phoneNumber ?? null,
      callerName,
      callDate,
      durationSeconds: durationSecs,
      callResult,
      agentId: opts.agent.id,
      agentName: opts.agent.name,
      rcCallId: id,
      rcSessionId: sessionId || null,
      hasRecording: recordingUrl ? 1 : 0,
    });
    existing.add(id);
    if (sessionId) existingSessions.add(sessionId);
    result.logged++;

    if (!recordingUrl || durationSecs <= 0) continue;

    try {
      const authedUrl = `${recordingUrl}?access_token=${accessToken}`;
      const tr = await transcribeAudio({ audioUrl: authedUrl });
      if ("error" in tr || !tr.text) continue;
      result.transcribed++;

      const analysis = await analyzeIntakeTranscript(tr.text, {
        direction,
        callerNumber,
        agentName: opts.agent.name,
        callDate,
      });

      await updateIntakeCall(callId, {
        transcript: tr.text.slice(0, 60000),
        transcriptLang: tr.language ?? null,
        aiProcessed: analysis ? 1 : 0,
        aiSummary: analysis?.extraction.summary ?? null,
        subject: analysis?.extraction.subject?.slice(0, 255) || null,
        callPurpose: analysis?.extraction.callPurpose ?? null,
      });
      if (!analysis) continue;

      const x = analysis.extraction;
      const isCaseCall = x.isPotentialClient && (x.callPurpose === "new_case" || x.callPurpose === "follow_up");
      if (!isCaseCall) continue; // solicitors / wrong numbers / existing clients stay as plain call rows

      // HARD substance gate: never auto-create a lead from a call with zero
      // case content (internal/colleague chatter the LLM mis-flags). The call
      // stays in Calls & Transcripts where a human can "Create lead" if real.
      const hasSubstance = !!(x.caseType || x.injuries || x.incidentDescription || x.incidentDate);
      if (!hasSubstance) continue;

      const existingLead = callerNumber ? await findOpenLeadByPhone(callerNumber) : null;
      if (existingLead) {
        await linkCallToLead(callId, existingLead.id);
        await applyAnalysisToLead(existingLead.id, analysis);
        await addLeadEvent({
          leadId: existingLead.id,
          eventType: "call_linked",
          title: `${direction} call (${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s) — AI re-analyzed`,
          detail: x.summary,
          payload: { callId, rubric: analysis.rubric, tier: analysis.tier },
          actorId: opts.agent.id,
          actorName: opts.agent.name,
        });
        result.leadsUpdated++;
      } else {
        const leadId = await createLeadFromAnalysis(analysis, { phone: callerNumber, source: "phone", createdById: opts.agent.id });
        await linkCallToLead(callId, leadId);
        await addLeadEvent({
          leadId,
          eventType: "created",
          title: "Lead created from intake call (AI)",
          detail: x.summary,
          payload: { callId, rubric: analysis.rubric, tier: analysis.tier },
          actorId: opts.agent.id,
          actorName: opts.agent.name,
        });
        result.leadsCreated++;
      }
    } catch (e: any) {
      console.warn(`[intakeSync] processing failed for call ${id}:`, e?.response?.status ?? e?.message ?? e);
    }
  }

  return result;
}
