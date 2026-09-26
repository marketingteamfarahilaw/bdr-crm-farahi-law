/**
 * Claude (Anthropic) for the CRM's AI writing — the Representative Performance
 * review first (Youssef, 2026-09-26: "use the Anthropic API instead of
 * ChatGPT"). Call transcription stays on OpenAI's Whisper: Claude doesn't take
 * audio.
 *
 * The API key comes from the server's environment (ANTHROPIC_API_KEY) or, so a
 * super admin can connect it without touching the server, from Settings, where
 * it is stored encrypted (AES-256-GCM, keyed from JWT_SECRET) and never sent
 * back to a browser — only its last four characters. With no key, callers keep
 * their OpenAI path.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "../db";
import { ENV } from "./env";

export const CLAUDE_MODEL = "claude-opus-5";
export const CLAUDE_LABEL = "Claude Opus 5 (Anthropic)";

const SETTING = "anthropic_api_key_enc";
const CACHE_MS = 60_000;

// ── the stored key, encrypted ────────────────────────────────────────────────

const cipherKey = (secret: string) => createHash("sha256").update(`anthropic-api-key:${secret}`).digest();

export function encryptKey(plain: string, secret = ENV.cookieSecret): string {
  if (!secret) throw new Error("JWT_SECRET is not set, so the key can't be stored safely.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** null when it can't be read — tampered with, or JWT_SECRET changed since it was saved. */
export function decryptKey(stored: string, secret = ENV.cookieSecret): string | null {
  try {
    const [v, iv, tag, data] = stored.split(":");
    if (v !== "v1" || !secret) return null;
    const d = createDecipheriv("aes-256-gcm", cipherKey(secret), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

type Resolved = { key: string; source: "server" | "settings" } | null;
let cache: { at: number; value: Resolved; unreadable: boolean } | null = null;

async function resolveKey(): Promise<{ value: Resolved; unreadable: boolean }> {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return { value: { key: env, source: "server" }, unreadable: false };
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const stored = await getSetting(SETTING);
  const key = stored ? decryptKey(stored) : null;
  cache = { at: Date.now(), value: key ? { key, source: "settings" } : null, unreadable: !!stored && !key };
  return cache;
}

/** A Claude client, or null when no key is connected. */
export async function claude(): Promise<Anthropic | null> {
  const { value } = await resolveKey();
  return value ? new Anthropic({ apiKey: value.key }) : null;
}

/** For Settings: whether Claude is connected, from where, and the key's last four characters. */
export async function claudeStatus() {
  const { value, unreadable } = await resolveKey();
  return {
    connected: !!value,
    source: value?.source ?? null,
    tail: value ? value.key.slice(-4) : null,
    // A saved key that no longer decrypts (the server's JWT_SECRET changed): enter it again.
    unreadable,
    model: CLAUDE_LABEL,
  };
}

/** Anthropic's answer for a key: can it use the model? Costs no tokens. */
async function check(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 }).models.retrieve(CLAUDE_MODEL);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Anthropic didn't accept that key. Copy it again from console.anthropic.com → API keys." };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: `That key can't use ${CLAUDE_LABEL}. Check the key's workspace in the Anthropic console.` };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, error: `${CLAUDE_LABEL} isn't available to that account.` };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Anthropic is rate-limiting this key right now — try again in a minute." };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Anthropic answered with an error (${e.status ?? "no status"}). Try again in a minute.` };
    return { ok: false, error: "Couldn't reach Anthropic from the server. Try again in a minute." };
  }
}

/** Save a key after Anthropic accepts it, or remove the saved one (null). */
export async function saveClaudeKey(key: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (key == null) {
    await setSetting(SETTING, null);
    cache = null;
    return { ok: true };
  }
  const k = key.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return { ok: false, error: "That doesn't look like an Anthropic API key (they start with sk-ant-)." };
  const checked = await check(k);
  if (!checked.ok) return checked;
  await setSetting(SETTING, encryptKey(k));
  cache = null;
  return { ok: true };
}

/** Test the connected key. */
export async function testClaude(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { value, unreadable } = await resolveKey();
  if (!value) return { ok: false, error: unreadable ? "The saved key can't be read any more — enter it again." : "No Claude key is connected." };
  return check(value.key);
}
