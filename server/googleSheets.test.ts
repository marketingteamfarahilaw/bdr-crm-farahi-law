import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { downloadWorkbook, parseServiceAccount } from "./googleSheets";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  type: "service_account", client_email: "crm-sheets@farahi-crm.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token",
};
const xlsxBody = () => new Response(new Uint8Array(4096), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
const signIn = () => new Response(new Uint8Array(500), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });

afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; });

describe("Google service account", () => {
  it("accepts only a service-account key", () => {
    expect(() => parseServiceAccount("not json")).toThrow(/valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow(/service-account key/);
    expect(parseServiceAccount(JSON.stringify(KEY)).client_email).toBe(KEY.client_email);
  });

  it("signs in with a verifiable JWT and downloads the sheet with the token", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === KEY.token_uri) return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
      if (url.startsWith("https://docs.google.com/") && (init?.headers as any)?.Authorization === "Bearer tok-1") return xlsxBody();
      return signIn();
    }));
    const { file, bytes } = await downloadWorkbook("marketing");
    fs.rmSync(file, { force: true });
    expect(bytes).toBe(4096);

    const assertion = new URLSearchParams(String(calls[0].init?.body)).get("assertion")!;
    const [h, p, sig] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ iss: KEY.client_email, aud: KEY.token_uri, scope: "https://www.googleapis.com/auth/drive.readonly" });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it("says which address to share with when neither the account nor the link can read it", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === KEY.token_uri) return new Response(JSON.stringify({ access_token: "tok-2", expires_in: 3600 }), { status: 200 });
      if (url.startsWith("https://www.googleapis.com/")) return new Response("{}", { status: 404 });
      return signIn();
    }));
    await expect(downloadWorkbook("marketing")).rejects.toThrow(`Share it in Google Sheets with ${KEY.client_email} as Viewer`);
  });

  it("still reads a link-shared sheet when no key is saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => xlsxBody()));
    const { file } = await downloadWorkbook("centralized");
    fs.rmSync(file, { force: true });
  });
});
