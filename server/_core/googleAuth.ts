/**
 * Standalone "Sign in with Google" — direct Google OAuth 2.0 (no platform SDK).
 *
 * Restricted to the firm's Workspace domain (GOOGLE_ALLOWED_DOMAIN, default
 * farahilaw.com). Existing users are matched by email so their role is preserved;
 * a first-time @farahilaw.com sign-in is created as a bdr_agent.
 *
 * Env:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   — from a Google Cloud OAuth 2.0 Web client
 *   GOOGLE_ALLOWED_DOMAIN  (optional)        — defaults to "farahilaw.com"
 *   GOOGLE_REDIRECT_URI    (optional)        — else derived from the request
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import * as db from "../db";

const ALLOWED_DOMAIN = (process.env.GOOGLE_ALLOWED_DOMAIN || "farahilaw.com").toLowerCase();

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function redirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const fwd = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const proto = fwd || ((req as unknown as { secure?: boolean }).secure ? "https" : "http");
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
}

export function registerGoogleAuth(app: Express) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const configured = !!(clientId && clientSecret);

  // The login page calls this to decide whether to show the Google button.
  app.get("/api/auth/google/status", (_req, res) => res.json({ enabled: configured, domain: ALLOWED_DOMAIN }));

  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!configured) { res.status(503).send("Google sign-in is not configured."); return; }
    const state = crypto.randomBytes(16).toString("hex");
    res.cookie("g_oauth_state", state, {
      httpOnly: true, sameSite: "lax", secure: redirectUri(req).startsWith("https"),
      maxAge: 10 * 60 * 1000, path: "/",
    });
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri(req),
      response_type: "code",
      scope: "openid email profile",
      state,
      hd: ALLOWED_DOMAIN, // hint Google to the Workspace domain (still verified below)
      prompt: "select_account",
      access_type: "online",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    if (!configured) { res.status(503).send("Google sign-in is not configured."); return; }
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const cookieState = readCookie(req, "g_oauth_state");
      if (!code || !state || !cookieState || state !== cookieState) {
        res.status(400).send("Invalid sign-in request (state mismatch). Please try again.");
        return;
      }
      res.clearCookie("g_oauth_state", { path: "/" });

      const tokenResp = await axios.post(
        "https://oauth2.googleapis.com/token",
        new URLSearchParams({
          code, client_id: clientId!, client_secret: clientSecret!,
          redirect_uri: redirectUri(req), grant_type: "authorization_code",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const info = (await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenResp.data.access_token}` },
      })).data as { email?: string; email_verified?: boolean; name?: string; sub?: string };

      const emailLc = (info.email || "").toLowerCase().trim();
      if (!emailLc || info.email_verified === false) { res.status(403).send("Your Google email is not verified."); return; }
      if (!emailLc.endsWith(`@${ALLOWED_DOMAIN}`)) {
        res.status(403).send(`Only @${ALLOWED_DOMAIN} accounts can sign in to this app.`);
        return;
      }

      const existing = await db.getUserByEmail(emailLc);
      let openId: string;
      if (existing) {
        openId = existing.openId; // keep their identity + role
        await db.upsertUser({ openId, name: info.name || existing.name, email: emailLc, loginMethod: "google", lastSignedIn: new Date() });
      } else {
        openId = `google_${info.sub}`;
        await db.upsertUser({ openId, name: info.name || null, email: emailLc, role: "bdr_agent", loginMethod: "google", lastSignedIn: new Date() });
      }

      const sessionToken = await sdk.createSessionToken(openId, { name: info.name || emailLc, expiresInMs: ONE_YEAR_MS });
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (e: any) {
      console.error("[GoogleAuth] callback failed:", e?.response?.data ?? e?.message ?? e);
      res.status(500).send("Google sign-in failed. Try again, or use email + password.");
    }
  });
}
