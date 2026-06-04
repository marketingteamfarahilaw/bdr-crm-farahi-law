import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerLocalLoginRoutes } from "./localLogin";
import { registerStorageProxy } from "./storageProxy";
import { registerMapsProxy } from "./mapsProxy";
import { registerUberWebhook } from "./uberWebhook";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getValidRCToken } from "../crmRouter";
import { syncRecentCalls } from "../rcSync";
// Note: RingCentral auto-connect via JWT has been removed.
// Agents now log in to RingCentral directly through the embedded widget UI.
// The server still stores tokens when agents connect via OAuth through the widget.

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerMapsProxy(app);
  registerOAuthRoutes(app);
  registerLocalLoginRoutes(app);
  registerUberWebhook(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startRingCentralAutoSync();
  });
}

// ─── Background: auto-sync RingCentral calls every few minutes ───────────────
// The team calls from the RingCentral desktop app / desk phone; this pulls new
// calls, matches them to facilities, and transcribes + summarizes the recorded
// ones. Deduped by call id, so re-runs are cheap and safe.
let rcSyncRunning = false;
function startRingCentralAutoSync() {
  const configured =
    process.env.RINGCENTRAL_JWT && process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_CLIENT_SECRET;
  if (!configured) {
    console.log("[rcSync] RingCentral not configured — auto-sync disabled.");
    return;
  }
  const INTERVAL_MS = 5 * 60 * 1000;
  const tick = async () => {
    if (rcSyncRunning) return; // never overlap runs
    rcSyncRunning = true;
    try {
      const token = await getValidRCToken();
      const res = await syncRecentCalls(token, { lookbackMinutes: 90 });
      if (res.logged > 0 || res.transcribed > 0) {
        console.log(`[rcSync] synced ${res.logged} new call(s), transcribed ${res.transcribed} (matched ${res.matched}/${res.scanned}).`);
      }
    } catch (e: any) {
      console.warn("[rcSync] auto-sync error:", e?.response?.status ?? e?.message ?? e);
    } finally {
      rcSyncRunning = false;
    }
  };
  setTimeout(tick, 30 * 1000); // first pass shortly after boot
  setInterval(tick, INTERVAL_MS);
  console.log(`[rcSync] auto-sync enabled — every ${INTERVAL_MS / 60000} min.`);
}

startServer().catch(console.error);
