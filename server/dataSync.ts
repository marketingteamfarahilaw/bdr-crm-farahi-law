/**
 * Background data syncs, runnable on a schedule or from a button in the app.
 *
 *   leaddocket — BD/FR leads and sign-ups from Lead Docket (the source of truth
 *                for both). Incremental: only leads changed since the last
 *                successful run are re-read.
 *   sheets     — the Centralized BDR/FR workbook, read live from Google Sheets:
 *                facilities (additive, never deletes), call history, expenses,
 *                referrals, errands and field visits.
 *
 * Each job runs the same tested scripts used for the manual imports, as a child
 * process, so there is exactly one implementation of every import. A job never
 * runs twice at once, and its outcome — including partial failures — is stored
 * in app_settings so the Settings page can show what happened and when.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./db";
import { downloadWorkbook } from "./googleSheets";

/**
 * leaddocket_history is a one-off backfill of every sign-up since 2020. It
 * scans Signed Up and Referred plus Closed and Lost — a client signed in 2023
 * whose case was later lost is still a 2023 sign-up. Manual only, never
 * scheduled. It shares Lead Docket's 50-reads-a-minute budget with the regular
 * sync, so the two never run at the same time.
 */
export type JobName = "leaddocket" | "leaddocket_history" | "sheets";

/** Jobs that draw on the same external rate limit and must not overlap. */
const SHARES_BUDGET: Record<JobName, JobName[]> = {
  leaddocket: ["leaddocket_history"],
  leaddocket_history: ["leaddocket"],
  sheets: [],
};

export type JobStatus = {
  state: "idle" | "running" | "ok" | "partial" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  summary: string | null;
  error: string | null;
  trigger: "schedule" | "manual" | null;
};

const KEY = (job: JobName) => `sync_status_${job}`;
const running = new Set<JobName>();

/** Every eight hours, per the team's request. */
export const SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000;

export async function getStatus(job: JobName): Promise<JobStatus> {
  const raw = await getSetting(KEY(job));
  const base: JobStatus = { state: "idle", startedAt: null, finishedAt: null, lastSuccessAt: null, summary: null, error: null, trigger: null };
  if (!raw) return base;
  try {
    const s = { ...base, ...JSON.parse(raw) } as JobStatus;
    // A "running" record left behind by a restart mid-job is not really running.
    if (s.state === "running" && !running.has(job)) s.state = "failed", s.error = s.error ?? "interrupted by a server restart";
    return s;
  } catch { return base; }
}

async function save(job: JobName, patch: Partial<JobStatus>) {
  const cur = await getStatus(job);
  await setSetting(KEY(job), JSON.stringify({ ...cur, ...patch }));
}

/** Run one script to completion; resolves with its output and exit code. */
function runScript(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve(process.cwd(), script), ...args], {
      cwd: process.cwd(), env: process.env,
    });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { out += b.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (e) => resolve({ code: 1, out: out + "\n" + e.message }));
  });
}

const tail = (s: string, n = 600) => s.trim().slice(-n);

async function runLeadDocket(): Promise<{ ok: boolean; partial?: boolean; summary: string }> {
  const prev = await getStatus("leaddocket");
  // First run covers the whole reporting year — the Sign-ups Report opens on
  // year-to-date, so anything less would leave months missing. Later runs only
  // read what changed since the last good run. At Lead Docket's 50/minute cap
  // the first run can take a few hours; it runs in the background.
  const since = prev.lastSuccessAt
    ? new Date(new Date(prev.lastSuccessAt).getTime() - 60 * 60 * 1000)      // 1h overlap, in case of clock skew
    : new Date(new Date().getFullYear(), 0, 1);
  return runLeadDocketScript(["--since", since.toISOString()], "changed leads");
}

/** Every sign-up since Lead Docket began (2020). Leads already checked are skipped. */
async function runLeadDocketHistory() {
  return runLeadDocketScript(
    ["--since", "2020-01-01", "--status-names", "Signed Up,Referred,Closed,Lost"],
    "historical leads",
  );
}

async function runLeadDocketScript(args: string[], what: string): Promise<{ ok: boolean; partial?: boolean; summary: string }> {
  const { code, out } = await runScript("scripts/migration/sync-leaddocket.mjs", args);
  const line = out.split("\n").find((l) => l.startsWith("SYNC_RESULT "));
  if (!line) return { ok: false, summary: tail(out) || `exited with code ${code}` };

  const r = JSON.parse(line.slice("SYNC_RESULT ".length));
  const reps = Object.entries(r.byRep ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ");
  let summary = `${r.scanned} ${what} read, ${r.ours} belong to the team (${r.inserted} new, ${r.updated} updated)` +
    (r.failed ? ` — ${r.failed} could not be read and will be retried next run` : "") + (reps ? `. ${reps}` : "");

  // The sync fills lead_intake, which only the Sign-ups Report reads. The
  // Command Center, facility profiles and rep reports read facility_leads, so
  // mirror into it every time — otherwise new leads appear on one page only.
  const m = await runScript("scripts/migration/mirror-leads-to-facilities.mjs", []);
  const mline = m.out.split("\n").find((l) => l.startsWith("MIRROR_RESULT "));
  if (m.code !== 0 || !mline) {
    return { ok: false, summary: summary + ` — but updating the other CRM pages failed: ${tail(m.out, 300)}` };
  }
  const mr = JSON.parse(mline.slice("MIRROR_RESULT ".length));
  summary += `. Shown across the CRM: ${mr.leads} team leads, ${mr.signed} signed, ${mr.linked} linked to a partner.`;
  return { ok: code === 0, partial: code === 2, summary };
}

async function runSheets(): Promise<{ ok: boolean; summary: string }> {
  const { file, bytes } = await downloadWorkbook("centralized");
  try {
    const steps: [string, string[], string][] = [
      ["scripts/migration/sync-facilities-additive.mjs", [file, "--apply"], "facilities"],
      ["scripts/migration/import-calls-from-excel.mjs", [file], "call history"],
      ["scripts/migration/import-bdr-from-excel.mjs", [file], "expenses, referrals, errands, visits"],
      ["scripts/migration/repair-data.mjs", ["--apply"], "links and totals"],
    ];
    const done: string[] = [];
    for (const [script, args, label] of steps) {
      const { code, out } = await runScript(script, args);
      if (code !== 0) return { ok: false, summary: `stopped at ${label}: ${tail(out, 400)}` };
      done.push(label);
    }
    return { ok: true, summary: `Read ${(bytes / 1048576).toFixed(1)} MB from Google Sheets; updated ${done.join(", ")}.` };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

/**
 * Start a job in the background. Returns false if it is already running, so a
 * double-click or a scheduled run landing mid-manual-run can't start a second copy.
 */
export async function startJob(job: JobName, trigger: "schedule" | "manual"): Promise<boolean> {
  if (running.has(job)) return false;
  // Two jobs on the same external rate limit would each run at half speed and
  // trip it; wait for the other to finish instead.
  if (SHARES_BUDGET[job].some((other) => running.has(other))) return false;
  running.add(job);
  const startedAt = new Date().toISOString();
  await save(job, { state: "running", startedAt, finishedAt: null, error: null, trigger });

  (async () => {
    try {
      const result =
        job === "leaddocket" ? await runLeadDocket()
        : job === "leaddocket_history" ? await runLeadDocketHistory()
        : await runSheets();
      const finishedAt = new Date().toISOString();
      const partial = "partial" in result && result.partial;
      await save(job, {
        state: result.ok ? "ok" : partial ? "partial" : "failed",
        finishedAt,
        summary: result.summary,
        error: result.ok ? null : result.summary,
        // Only a complete run moves the watermark. If some leads couldn't be read
        // (e.g. during a rate-limit lockout), the next run re-covers the same
        // window rather than skipping them for good.
        lastSuccessAt: result.ok ? startedAt : (await getStatus(job)).lastSuccessAt,
      });
      console.log(`[dataSync] ${job} (${trigger}) ${result.ok ? "ok" : "failed"}: ${result.summary.slice(0, 200)}`);
    } catch (e: any) {
      await save(job, { state: "failed", finishedAt: new Date().toISOString(), error: e?.message ?? String(e) });
      console.warn(`[dataSync] ${job} (${trigger}) threw:`, e?.message ?? e);
    } finally {
      running.delete(job);
    }
  })();
  return true;
}

/**
 * Called on a short timer from server start. Runs a job when its last success is
 * older than the interval — so the schedule survives restarts and deploys instead
 * of resetting (or firing) every time the process starts.
 */
export async function runDueJobs() {
  for (const job of ["leaddocket", "sheets"] as JobName[]) {
    if (job === "leaddocket" && !process.env.LEADDOCKET_API_KEY) continue;
    const s = await getStatus(job);
    const last = s.lastSuccessAt ? new Date(s.lastSuccessAt).getTime() : 0;
    if (Date.now() - last >= SYNC_INTERVAL_MS && !running.has(job)) {
      await startJob(job, "schedule");
    }
  }
}

export const isRunning = (job: JobName) => running.has(job);
