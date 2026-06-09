import type { Express } from "express";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./env";
import { sdk } from "./sdk";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    // Require a valid login session — stored objects (uploads, photos, exports)
    // must not be fetchable by anonymous callers who guess an object key.
    const token = parseCookie(req.headers.cookie || "")[COOKIE_NAME];
    const session = await sdk.verifySession(token);
    if (!session) { res.status(401).send("Authentication required"); return; }

    const key = (req.params as Record<string, string>)[0];
    if (!key || key.includes("..")) {
      res.status(400).send("Missing or invalid storage key");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
