import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

// Local / offline login — replaces the Manus OAuth flow when running the app
// outside Manus. It mints the SAME session cookie the OAuth callback would,
// for an existing user (the owner by default), with no external calls.
//
// SECURITY: gated behind ALLOW_LOCAL_LOGIN=true. Leave it unset/false in any
// real deployment, or anyone reaching the server could sign in as the owner.
export function registerLocalLoginRoutes(app: Express) {
  app.get("/api/local-login", async (req: Request, res: Response) => {
    if (process.env.ALLOW_LOCAL_LOGIN !== "true") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const requested =
        typeof req.query.openId === "string" ? req.query.openId : undefined;
      const openId = requested || process.env.OWNER_OPEN_ID || "";
      if (!openId) {
        res
          .status(400)
          .json({ error: "Set OWNER_OPEN_ID or pass ?openId= to log in" });
        return;
      }

      const user = await db.getUserByOpenId(openId);
      if (!user) {
        res.status(404).json({ error: `No user found for openId "${openId}"` });
        return;
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: user.name || user.email || openId,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[LocalLogin] failed", error);
      res.status(500).json({ error: "Local login failed" });
    }
  });
}
