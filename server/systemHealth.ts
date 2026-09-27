/**
 * System health, for super admins: is every background job the reports depend
 * on actually working? Call recaps stopped for eleven days in September 2026
 * (OpenAI ran out of credit) with nothing on screen to say so; this is the
 * "something's wrong" signal — a card in Settings and a banner across the app
 * while anything is down.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { getDb } from "./db";
import { callRecapQueue, contactLogs, facilityUpdates, userRingcentralTokens, users } from "../drizzle/schema";
import { getStatus, SYNC_INTERVAL_MS, type JobName } from "./dataSync";
import { claudeStatus } from "./_core/claude";
import { recapsPausedForPermission } from "./rcSync";

export type HealthState = "ok" | "warn" | "down";
export type HealthCheck = { id: string; label: string; state: HealthState; detail: string; action?: string };

const HOUR = 60 * 60 * 1000;
const BACKUP_DIR = "/root/bdcrm-backups";

const when = (d: Date) => formatInTimeZone(d, "America/Los_Angeles", "MMM d, h:mm a");
function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 2) return "just now";
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

async function syncCheck(job: JobName, label: string): Promise<HealthCheck> {
  const s = await getStatus(job);
  const last = s.lastSuccessAt ? new Date(s.lastSuccessAt) : null;
  const due = SYNC_INTERVAL_MS + 2 * HOUR;
  if (!last) return { id: job, label, state: "warn", detail: "Hasn't finished a run yet." };
  const late = Date.now() - last.getTime() > due;
  const failed = s.state === "failed";
  return {
    id: job, label,
    state: failed && late ? "down" : failed || late ? "warn" : "ok",
    detail: `Last good run ${when(last)} (${ago(last)}).` + (failed && s.error ? ` The latest run failed: ${s.error.slice(0, 160)}` : ""),
    action: failed || late ? "Run it from Settings → Data sync; if it fails again, check the Lead Docket / Google access." : undefined,
  };
}

export async function getSystemHealth(): Promise<{ checks: HealthCheck[]; worst: HealthState }> {
  const db = await getDb();
  const checks: HealthCheck[] = [];
  checks.push(await syncCheck("leaddocket", "Lead Docket sync"));
  checks.push(await syncCheck("sheets", "Google Sheets sync"));

  if (db) {
    // RingCentral: each BD/FR rep's own connection pulls their calls every 2 minutes.
    const reps = await db.select({ name: users.name, lastSyncAt: userRingcentralTokens.lastSyncAt })
      .from(userRingcentralTokens).leftJoin(users, eq(users.id, userRingcentralTokens.userId));
    const stale = reps.filter((r) => !r.lastSyncAt || Date.now() - r.lastSyncAt.getTime() > 20 * 60_000);
    checks.push(!reps.length
      ? { id: "ringcentral", label: "RingCentral calls", state: "warn", detail: "No one has connected their RingCentral, so no calls come in.", action: "Each rep connects theirs in Settings → RingCentral." }
      : {
          id: "ringcentral", label: "RingCentral calls",
          state: stale.length === reps.length ? "down" : stale.length ? "warn" : "ok",
          detail: stale.length
            ? `Not synced in the last 20 minutes: ${stale.map((r) => r.name ?? "a rep").join(", ")}.`
            : `${reps.length} connected, all synced in the last 20 minutes.`,
          action: stale.length ? "Those reps reconnect in Settings → RingCentral (their sign-in may have expired)." : undefined,
        });

    // Call recaps: transcription (OpenAI) + summary (Claude). Waiting ones are retried.
    const [q] = await db.select({ waiting: sql<number>`COUNT(*)` })
      .from(callRecapQueue).where(and(isNull(callRecapQueue.doneAt), lt(callRecapQueue.attempts, 8)));
    // Tried eight times over a day and RingCentral never had a transcript: usually a rep without the license.
    const [gone] = await db.select({ n: sql<number>`COUNT(*)` })
      .from(callRecapQueue).where(and(isNull(callRecapQueue.doneAt), gte(callRecapQueue.attempts, 8), gte(callRecapQueue.callDate, new Date(Date.now() - 7 * 24 * HOUR))));
    const weekAgo = new Date(Date.now() - 7 * 24 * HOUR);
    const [calls] = await db.select({ n: sql<number>`COUNT(*)` }).from(contactLogs)
      .where(and(eq(contactLogs.fromRingCentral, 1), eq(contactLogs.callResult, "connected"), gte(contactLogs.contactDate, weekAgo)));
    const [recaps] = await db.select({ n: sql<number>`COUNT(*)` }).from(facilityUpdates)
      .where(and(eq(facilityUpdates.updateType, "transcript"), gte(facilityUpdates.updateDate, weekAgo)));
    const waiting = Number(q?.waiting ?? 0);
    // The recap loop's own verdict, as of its last round (every 2 minutes).
    const noPermission = recapsPausedForPermission();
    const missed = Number(gone?.n ?? 0);
    const week = `This week: ${Number(recaps?.n ?? 0)} recaps for ${Number(calls?.n ?? 0)} connected calls.`
      + (missed ? ` ${missed} recorded call${missed === 1 ? "" : "s"} never got a RingCentral transcript.` : "");
    checks.push({
      id: "recaps", label: "Call recaps",
      state: noPermission ? "down" : waiting > 40 || missed > 5 ? "warn" : "ok",
      detail: noPermission
        ? `Paused: RingCentral won't share call transcripts with the CRM — nobody connected has its "AI Conversation Expert — Access Insights" permission. ${waiting} call${waiting === 1 ? "" : "s"} waiting. ${week}`
        : waiting ? `${waiting} call${waiting === 1 ? "" : "s"} waiting for RingCentral's transcript. ${week}` : week,
      action: noPermission
        ? "A RingCentral admin turns on \"AI Conversation Expert — Access Insights\" for one connected user's role (service.ringcentral.com → Users → Roles → Artificial Intelligence). The waiting calls then fill in by themselves."
        : missed > 5 ? "Calls get a transcript only when the rep holds a RingCentral AI Conversation Expert license — check the reps' licenses." : undefined,
    });
  }

  const c = await claudeStatus();
  checks.push(c.connected
    ? { id: "claude", label: "AI — Claude", state: "ok", detail: `Connected (key ending ${c.tail}). Writes call recaps, performance reviews and the Intake Desk analysis.` }
    : {
        id: "claude", label: "AI — Claude", state: "down",
        detail: c.unreadable ? "The saved key can't be read any more." : "Not connected: call recaps, performance reviews and the Intake Desk analysis don't run.",
        action: "Connect a key in the AI card above.",
      });

  // The nightly database backup, where the app runs on the server that makes it.
  if (fs.existsSync(BACKUP_DIR)) {
    const newest = fs.readdirSync(BACKUP_DIR).filter((f) => /^farahi-prod-.*\.sql\.gz$/.test(f))
      .map((f) => fs.statSync(path.join(BACKUP_DIR, f)).mtime).sort((a, b) => b.getTime() - a.getTime())[0];
    checks.push(!newest
      ? { id: "backup", label: "Nightly backup", state: "down", detail: "No backup files found.", action: "Check the backup job on the server (scripts/backup-nightly.sh)." }
      : {
          id: "backup", label: "Nightly backup",
          state: Date.now() - newest.getTime() > 50 * HOUR ? "down" : Date.now() - newest.getTime() > 30 * HOUR ? "warn" : "ok",
          detail: `Latest ${when(newest)} (${ago(newest)}). Kept 30 days, on the same server as the app.`,
          action: Date.now() - newest.getTime() > 30 * HOUR ? "Check the backup job on the server (scripts/backup-nightly.sh)." : undefined,
        });
  }

  const worst: HealthState = checks.some((x) => x.state === "down") ? "down" : checks.some((x) => x.state === "warn") ? "warn" : "ok";
  return { checks, worst };
}
