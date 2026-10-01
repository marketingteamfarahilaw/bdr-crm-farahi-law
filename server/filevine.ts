/**
 * Filevine API v2 — the connection only, for now: a super admin enters the
 * service account's credentials in Settings and tests them. Nothing is read
 * from Filevine yet (that waits on what the team wants from it), and nothing
 * here writes to Filevine; call recaps and intake leads still go out through
 * the webhook in filevineHook.ts.
 *
 * Filevine signs a Personal Access Token in at its identity server together
 * with the Client ID and Client Secret issued alongside it, and answers with a
 * short-lived bearer token. If the Client ID or Secret is left blank the login
 * is still tried, so the test shows Filevine's own reason for refusing it.
 *
 * Secrets are stored encrypted in app_settings, like the Timeero and Anthropic
 * keys, and never sent back to a browser. Env vars override them.
 */
import axios, { type AxiosError } from "axios";
import { getSetting, setSetting } from "./db";
import { decryptKey, encryptKey } from "./_core/claude";

const IDENTITY = "https://identity.filevine.com/connect/token";
const API = "https://api.filevine.io";
const SCOPE = "fv.api.gateway.access tenant filevine.v2.api.* openid email fv.auth.tenant.read";

const SECRETS = {
  pat: ["filevine_pat_enc", "FILEVINE_PAT"],
  clientId: ["filevine_client_id_enc", "FILEVINE_CLIENT_ID"],
  clientSecret: ["filevine_client_secret_enc", "FILEVINE_CLIENT_SECRET"],
} as const;
const PLAIN = {
  orgId: ["filevine_org_id", "FILEVINE_ORG_ID"],
  userId: ["filevine_user_id", "FILEVINE_USER_ID"],
  account: ["filevine_account", "FILEVINE_ACCOUNT"],
} as const;
type SecretName = keyof typeof SECRETS;
type PlainName = keyof typeof PLAIN;

async function readSecret(name: SecretName) {
  const [setting, env] = SECRETS[name];
  const fromEnv = process.env[env]?.trim();
  if (fromEnv) return fromEnv;
  const stored = await getSetting(setting);
  return stored ? decryptKey(stored) : null;
}
async function readPlain(name: PlainName) {
  const [setting, env] = PLAIN[name];
  return process.env[env]?.trim() || (await getSetting(setting))?.trim() || null;
}

export async function filevineStatus() {
  const [pat, clientId, clientSecret, orgId, userId, account] = await Promise.all([
    readSecret("pat"), readSecret("clientId"), readSecret("clientSecret"), readPlain("orgId"), readPlain("userId"), readPlain("account"),
  ]);
  return {
    patTail: pat ? pat.slice(-4) : null,
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    // Enough to check what was saved against what IT sent, without showing the secret.
    clientIdTail: clientId ? clientId.slice(-4) : null,
    clientIdLength: clientId?.length ?? 0,
    secretTail: clientSecret ? clientSecret.slice(-2) : null,
    secretLength: clientSecret?.length ?? 0,
    orgId, userId, account,
    fromServer: !!process.env.FILEVINE_PAT?.trim(),
  };
}

export type FilevineInput = {
  pat?: string | null; clientId?: string | null; clientSecret?: string | null;
  orgId?: string | null; userId?: string | null; account?: string | null;
};

/** Saves what was filled in (a blank field keeps what's stored; null clears it), then tests. */
export async function saveFilevine(input: FilevineInput) {
  for (const name of Object.keys(SECRETS) as SecretName[]) {
    const v = input[name];
    if (v === undefined || v === "") continue;
    await setSetting(SECRETS[name][0], v === null ? null : encryptKey(v.trim()));
  }
  for (const name of Object.keys(PLAIN) as PlainName[]) {
    const v = input[name];
    if (v === undefined) continue;
    await setSetting(PLAIN[name][0], v === null || !v.trim() ? null : v.trim());
  }
  return testFilevine();
}

export async function disconnectFilevine() {
  for (const name of Object.keys(SECRETS) as SecretName[]) await setSetting(SECRETS[name][0], null);
  return { ok: true as const };
}

const reason = (e: unknown) => {
  const r = (e as AxiosError).response;
  if (!r) return `couldn't reach Filevine (${(e as Error)?.message ?? "no answer"})`;
  const d = r.data as any;
  const said = typeof d === "object" && d ? d.error_description || d.error || d.detail || d.title || JSON.stringify(d).slice(0, 200) : String(d ?? "").slice(0, 200);
  return `Filevine answered ${r.status}${said ? `: ${said}` : ""}`;
};

async function signIn() {
  const [pat, clientId, clientSecret] = await Promise.all([readSecret("pat"), readSecret("clientId"), readSecret("clientSecret")]);
  if (!pat) throw new Error("No Filevine Personal Access Token is saved.");
  const post = (inHeader: boolean) => {
    const form = new URLSearchParams({ grant_type: "personal_access_token", token: pat, scope: SCOPE });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (inHeader && clientId && clientSecret) {
      // HTTP Basic, each part form-encoded first as OAuth asks (the secret has + ? ~ in it).
      headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
    } else {
      if (clientId) form.set("client_id", clientId);
      if (clientSecret) form.set("client_secret", clientSecret);
    }
    return axios.post(IDENTITY, form.toString(), { timeout: 20_000, headers });
  };
  try {
    // OAuth servers take the client in the body or in a Basic header; Filevine's docs show the body,
    // so that goes first and the header is tried only when the client is refused.
    const r = await post(false).catch((e) => {
      const err = (e as AxiosError).response?.data as any;
      if (clientId && clientSecret && err?.error === "invalid_client") return post(true);
      throw e;
    });
    const token = r.data?.access_token as string | undefined;
    if (!token) throw new Error("Filevine's login answered without a token.");
    return token;
  } catch (e) {
    if ((e as AxiosError).isAxiosError) {
      const missing = !clientId || !clientSecret;
      const err = ((e as AxiosError).response?.data as any)?.error;
      const hint = missing ? " The Client ID and Client Secret issued with the token are probably needed."
        : err === "invalid_client" ? " Filevine doesn't recognise this Client ID and Secret together — check both were copied exactly (compare the ending and length shown here), and that they were issued with this token."
        : err === "invalid_grant" ? " The Client ID and Secret were accepted but the token wasn't — it may be expired, revoked, or from another client."
        : "";
      throw new Error(`Login refused — ${reason(e)}.${hint}`);
    }
    throw e;
  }
}

export async function testFilevine(): Promise<
  { ok: true; userId: string | null; orgs: { id: string; name: string }[]; orgMatches: boolean | null } | { ok: false; error: string }
> {
  try {
    const token = await signIn();
    const r = await axios.post(`${API}/fv-app/v2/utils/GetUserOrgsWithToken`, {}, {
      timeout: 20_000, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }).catch((e) => { throw new Error(`Signed in, but the API refused — ${reason(e)}.`); });
    const body = r.data ?? {};
    const userId = body.user?.userId?.native != null ? String(body.user.userId.native) : null;
    const orgs = (Array.isArray(body.orgs) ? body.orgs : []).map((o: any) => ({ id: String(o.orgId), name: String(o.name ?? "") }));
    const orgId = await readPlain("orgId");
    return { ok: true, userId, orgs, orgMatches: orgId ? orgs.some((o: { id: string }) => o.id === orgId) : null };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
