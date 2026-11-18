/**
 * Read the team's Google Sheets directly, so nobody has to download and upload
 * workbooks by hand.
 *
 * Google exports a whole spreadsheet as .xlsx, so the existing Excel importers
 * work unchanged — the only difference is where the bytes come from. Two ways
 * in, tried in this order:
 *
 *   1. A Google service account (its JSON key saved encrypted in Settings, or
 *      GOOGLE_SERVICE_ACCOUNT_JSON). A sheet shared with the account's email as
 *      Viewer can stay restricted to farahilaw.com — nobody else gains access.
 *   2. The plain link export, for a sheet shared "Anyone with the link".
 *
 * A sheet neither can read is reported with what to share, rather than parsed
 * as a corrupt file (Google answers a refused export with a sign-in page).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSign } from "node:crypto";
import { getSetting, setSetting } from "./db";
import { decryptKey, encryptKey } from "./_core/claude";

/** The workbooks the CRM reads. Ids come from the sheet URL. */
export const SHEETS = {
  centralized: {
    id: process.env.GSHEET_CENTRALIZED_ID || "1duZo7gJ-eW0ZB08-VxYH_Z-0MiRYRBRnXKeoQvoylNw",
    label: "Centralized BDR/FR Reports",
  },
  // The digital marketing team's daily "MTD Performance Summary" (one tab per
  // day), compared with Lead Docket by marketingSheetSync.ts. It was listed here
  // as an intake sheet before anything read it; GSHEET_INTAKE_ID still works.
  marketing: {
    id: process.env.GSHEET_MARKETING_ID || process.env.GSHEET_INTAKE_ID || "1_PLPrmmOv0KIyuqd_e2AaDKpLWYFvq4byj4DFdAB49k",
    label: "Digital Marketing MTD Performance Summary",
  },
} as const;

export type SheetKey = keyof typeof SHEETS;

const exportUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── the service account ──────────────────────────────────────────────────────

const KEY_SETTING = "gsheet_service_account_enc";
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** Checks a pasted key is a service-account key, and returns just what's needed from it. */
export function parseServiceAccount(json: string): ServiceAccount {
  let k: any;
  try { k = JSON.parse(json); } catch { throw new Error("That isn't valid JSON — paste the whole key file Google downloaded."); }
  if (k?.type !== "service_account" || !k.client_email || !k.private_key) {
    throw new Error("That isn't a service-account key (it needs type \"service_account\", client_email and private_key).");
  }
  return { client_email: String(k.client_email), private_key: String(k.private_key), token_uri: k.token_uri ? String(k.token_uri) : undefined };
}

async function readServiceAccount(): Promise<ServiceAccount | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || (await (async () => {
    const stored = await getSetting(KEY_SETTING);
    return stored ? decryptKey(stored) : null;
  })());
  if (!raw) return null;
  try { return parseServiceAccount(raw); } catch { return null; }
}

let cached: { email: string; token: string; until: number } | null = null;

/**
 * A short-lived access token for the service account (read-only Drive scope),
 * from Google's JWT-bearer grant: a claim signed with the account's private key.
 */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.until > Date.now() + 60_000) return cached.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud, iat: now, exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the service account's sign-in: ${body.error_description || body.error || `HTTP ${res.status}`}`);
  }
  cached = { email: sa.client_email, token: body.access_token, until: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

/** The sheet as .xlsx through the service account, or why it can't be read that way. */
async function viaServiceAccount(sa: ServiceAccount, id: string): Promise<{ buf: Buffer } | { error: string }> {
  const token = await accessToken(sa);
  const auth = { Authorization: `Bearer ${token}` };
  // The same export the link uses, signed in; it has no size cap. Drive's own
  // export (capped at 10 MB) is the fallback if Google ever stops honouring it.
  let res = await fetch(exportUrl(id), { headers: auth, redirect: "follow" });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}&supportsAllDrives=true`, { headers: auth });
  }
  if (res.ok && !(res.headers.get("content-type") ?? "").includes("text/html")) return { buf: Buffer.from(await res.arrayBuffer()) };
  return { error: res.status === 404 || res.status === 403 ? `not shared with ${sa.client_email}` : `HTTP ${res.status}` };
}

// ── downloading ──────────────────────────────────────────────────────────────

/**
 * Download a workbook to a temp file and return its path. The caller deletes it.
 * Throws with a readable message when neither way in can read the sheet.
 */
export async function downloadWorkbook(key: SheetKey): Promise<{ file: string; bytes: number }> {
  const sheet = SHEETS[key];
  const sa = await readServiceAccount();
  let saError: string | null = null;
  let buf: Buffer | null = null;

  if (sa) {
    try {
      const r = await viaServiceAccount(sa, sheet.id);
      if ("buf" in r) buf = r.buf; else saError = r.error;
    } catch (e: any) { saError = e?.message ?? String(e); }
  }
  if (!buf) {
    const res = await fetch(exportUrl(sheet.id), { redirect: "follow" });
    const html = (res.headers.get("content-type") ?? "").includes("text/html");
    if (res.ok && !html) buf = Buffer.from(await res.arrayBuffer());
    else if (res.status === 401 || res.status === 403 || html) {
      throw new Error(
        `"${sheet.label}" can't be read. ` +
        (sa ? `Share it in Google Sheets with ${sa.client_email} as Viewer${saError ? ` (service account: ${saError})` : ""}, or set General access to "Anyone with the link".`
            : `Share it "Anyone with the link" → Viewer, or save a Google service account in Settings and share the sheet with it.`) +
        ` (id ${sheet.id})`,
      );
    } else throw new Error(`"${sheet.label}" download failed — HTTP ${res.status}`);
  }

  if (buf.length < 1000) throw new Error(`"${sheet.label}" download looks empty (${buf.length} bytes).`);
  const file = path.join(os.tmpdir(), `gsheet-${key}-${Date.now()}.xlsx`);
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

/** Whether each configured sheet is currently readable, and how — used by the settings page. */
export async function checkSheets(): Promise<{ key: SheetKey; label: string; ok: boolean; detail: string }[]> {
  const sa = await readServiceAccount();
  const out: { key: SheetKey; label: string; ok: boolean; detail: string }[] = [];
  for (const key of Object.keys(SHEETS) as SheetKey[]) {
    const { id, label } = SHEETS[key];
    try {
      if (sa) {
        // Metadata only: is the file visible to the account? Cheaper than an export.
        const token = await accessToken(sa).catch(() => null);
        const res = token ? await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } }) : null;
        if (res?.ok) { out.push({ key, label, ok: true, detail: `readable through ${sa.client_email}` }); continue; }
      }
      const res = await fetch(exportUrl(id), { method: "HEAD", redirect: "follow" });
      const ok = res.ok && !(res.headers.get("content-type") ?? "").includes("text/html");
      out.push({ key, label, ok, detail: ok ? "readable (anyone with the link)" : sa ? `not shared with ${sa.client_email}` : `HTTP ${res.status} — not shared for reading` });
    } catch (e: any) {
      out.push({ key, label, ok: false, detail: e?.message ?? "unreachable" });
    }
  }
  return out;
}

// ── Settings: the service account's key ──────────────────────────────────────

export async function googleSheetsAccountStatus() {
  const sa = await readServiceAccount();
  return { email: sa?.client_email ?? null, fromServer: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() };
}

/** Saves a service-account key (encrypted) after checking Google accepts it; returns which sheets it can read. */
export async function saveGoogleSheetsAccount(json: string) {
  const sa = parseServiceAccount(json.trim());
  cached = null;
  await accessToken(sa);   // throws with Google's reason if the key is refused
  await setSetting(KEY_SETTING, encryptKey(json.trim()));
  return { email: sa.client_email, sheets: await checkSheets() };
}

export async function clearGoogleSheetsAccount() {
  cached = null;
  await setSetting(KEY_SETTING, null);
  return { ok: true as const };
}
