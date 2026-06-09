/**
 * Server-side Google Maps Proxy
 *
 * Forwards Google Maps JavaScript API requests from the frontend through our
 * Express server, using the GOOGLE_MAPS_API_KEY environment variable.
 * This avoids origin-restriction issues with the forge proxy.
 *
 * Routes registered:
 *   GET /api/maps-proxy/*  → forwards to maps.googleapis.com/*
 */

import type { Express, Request, Response } from "express";
import axios from "axios";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./sdk";

const GOOGLE_MAPS_BASE = "https://maps.googleapis.com";

export function registerMapsProxy(app: Express) {
  const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsKey) {
    console.warn("[MapsProxy] GOOGLE_MAPS_API_KEY not set — maps proxy disabled");
    return;
  }

  // Match /api/maps-proxy/<anything>
  app.get("/api/maps-proxy/*", async (req: Request, res: Response) => {
    // Require a valid login session — this proxy spends the firm's billable
    // Maps key, so it must never be an open/unauthenticated proxy.
    const token = parseCookie(req.headers.cookie || "")[COOKIE_NAME];
    const session = await sdk.verifySession(token);
    if (!session) { res.status(401).send("Authentication required"); return; }
    try {
      // Strip the /api/maps-proxy prefix to get the downstream path
      const downstreamPath = req.path.replace(/^\/api\/maps-proxy/, "");

      // Build the target URL pointing to the real Google Maps API
      const targetUrl = `${GOOGLE_MAPS_BASE}${downstreamPath}`;

      // Forward all query params but replace the `key` param with our server key
      const params = { ...req.query, key: googleMapsKey };

      const upstream = await axios.get(targetUrl, {
        params,
        responseType: "arraybuffer",
        timeout: 15000,
        maxRedirects: 0,
      });

      // Forward content-type and cache headers (same-origin only — no CORS *).
      const ct = upstream.headers["content-type"];
      if (ct) res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "private, max-age=3600");

      res.status(upstream.status).send(upstream.data);
    } catch (err: any) {
      const status = err?.response?.status ?? 502;
      const body   = err?.response?.data
        ? Buffer.from(err.response.data).toString("utf8")
        : err?.message ?? "Maps proxy error";
      console.error("[MapsProxy] Error:", status, body.slice(0, 200));
      res.status(status).send(body);
    }
  });

  console.log("[MapsProxy] Registered at /api/maps-proxy/* → maps.googleapis.com");
}
