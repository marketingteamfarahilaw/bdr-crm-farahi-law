/**
 * RingCentral Video meeting sync. Pulls the meeting history for a connected
 * agent (the RC Video API is per-authenticated-user) and stores each meeting,
 * deduped across agents by the RC meeting id. The access token is passed in by
 * the caller (router / poller) — same pattern as rcSync.
 */
import axios from "axios";
import { inArray } from "drizzle-orm";
import { getDb } from "./db";
import { rcMeetings } from "../drizzle/schema";

const RC_BASE = "https://platform.ringcentral.com";

export type MeetingSyncResult = { scanned: number; logged: number };

export async function syncRcMeetings(accessToken: string, opts: { perPage?: number; pages?: number } = {}): Promise<MeetingSyncResult> {
  const db = await getDb();
  if (!db) return { scanned: 0, logged: 0 };
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.pages ?? 3;

  const all: any[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < maxPages; p++) {
    const params: any = { perPage };
    if (pageToken) params.pageToken = pageToken;
    const resp = await axios.get(`${RC_BASE}/rcvideo/v1/history/meetings`, { headers: { Authorization: `Bearer ${accessToken}` }, params });
    const recs: any[] = resp.data?.meetings ?? [];
    all.push(...recs);
    pageToken = resp.data?.paging?.nextPageToken;
    if (!pageToken || recs.length === 0) break;
  }

  const result: MeetingSyncResult = { scanned: all.length, logged: 0 };
  if (!all.length) return result;

  const ids = all.map((m) => String(m.id)).filter(Boolean);
  const existingRows = await db.select({ rcMeetingId: rcMeetings.rcMeetingId }).from(rcMeetings).where(inArray(rcMeetings.rcMeetingId, ids));
  const existing = new Set(existingRows.map((r) => r.rcMeetingId));

  for (const m of all) {
    const rcMeetingId = String(m.id);
    if (!rcMeetingId) continue;
    const start = m.startTime ? new Date(m.startTime) : null;
    const dur = Number(m.duration ?? 0);
    const end = start && dur ? new Date(start.getTime() + dur * 1000) : null;
    const parts = Array.isArray(m.participants) ? m.participants.map((p: any) => p.displayName).filter(Boolean) : [];
    const uniqParts = Array.from(new Set<string>(parts));
    const values = {
      rcMeetingId, shortId: m.shortId ?? null, topic: m.displayName ?? "RingCentral Video meeting",
      startTime: start ?? undefined, endTime: end ?? undefined, durationSeconds: dur,
      hostExtId: m.hostInfo?.extensionId ? String(m.hostInfo.extensionId) : null, hostName: m.hostInfo?.displayName ?? null,
      participantCount: uniqParts.length, participants: uniqParts,
      hasRecording: Array.isArray(m.recordings) && m.recordings.length > 0 ? 1 : 0,
      status: m.status ?? null, raw: m,
    };
    // Upsert: a meeting seen first from a participant's history is enriched when
    // the host's history is synced (more complete participant list / host name).
    await db.insert(rcMeetings).values(values as any).onDuplicateKeyUpdate({
      set: { participantCount: values.participantCount, participants: values.participants, hostName: values.hostName, hasRecording: values.hasRecording },
    });
    if (!existing.has(rcMeetingId)) { existing.add(rcMeetingId); result.logged++; }
  }
  return result;
}
