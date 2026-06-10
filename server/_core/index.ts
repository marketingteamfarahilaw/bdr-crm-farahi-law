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
import { registerGoogleAuth } from "./googleAuth";
import { registerRecordingProxy } from "./recordingProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getValidRCToken, getValidRCTokenForUser } from "../crmRouter";
import { syncRecentCalls } from "../rcSync";
import { syncIntakeCalls } from "../intakeSync";
import { listConnectedRcUsers, setUserRcLastSync } from "../crmDb";
import { isIntakeOnly } from "@shared/permissions";
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
  // Session cookies are HS256-signed with JWT_SECRET. A missing/weak secret lets
  // anyone forge a session — refuse to start rather than fail open.
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 16 || jwtSecret === "change-me-to-a-long-random-string") {
    throw new Error(
      "[Security] JWT_SECRET is missing, too short, or still the default placeholder. " +
      "Set a long random JWT_SECRET (32+ chars) before starting — it signs all session cookies."
    );
  }

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
  registerGoogleAuth(app);
  registerRecordingProxy(app);
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
  // Per-agent sync only needs the app credentials; the JWT is optional (used
  // only for the company/admin fallback pass).
  const configured = process.env.RINGCENTRAL_CLIENT_ID && process.env.RINGCENTRAL_CLIENT_SECRET;
  if (!configured) {
    console.log("[rcSync] RingCentral not configured — auto-sync disabled.");
    return;
  }
  const INTERVAL_MS = 2 * 60 * 1000;
  const tick = async () => {
    if (rcSyncRunning) return; // never overlap runs
    rcSyncRunning = true;
    try {
      // 1) Per-agent: pull each connected agent's OWN extension calls with their
      //    own token. HARD SPLIT by role: intake team members' calls flow into
      //    the Intake Case Desk (intake_calls / intake_leads) and NEVER into the
      //    facility CRM; BD/FR calls flow into contact_logs as before.
      let connected: Awaited<ReturnType<typeof listConnectedRcUsers>> = [];
      try { connected = await listConnectedRcUsers(); } catch (e: any) { console.warn("[rcSync] listConnectedRcUsers failed:", e?.message ?? e); }
      for (const u of connected) {
        const display = String(u.userName ?? u.ownerName ?? u.userEmail ?? "Unknown");
        try {
          const token = await getValidRCTokenForUser(u.userId);
          if (!token) continue; // not connected / refresh expired — they'll reconnect
          if (isIntakeOnly(u.userRole)) {
            const res = await syncIntakeCalls(token, { agent: { id: u.userId, name: display }, lookbackMinutes: 90 });
            await setUserRcLastSync(u.userId, new Date());
            if (res.logged > 0 || res.transcribed > 0) {
              console.log(`[intakeSync] #${u.userId} (${display}): ${res.logged} calls, ${res.transcribed} transcribed, +${res.leadsCreated} leads, ${res.leadsUpdated} updated.`);
            }
          } else {
            const res = await syncRecentCalls(token, {
              lookbackMinutes: 90,
              attribution: { repId: u.userId, repName: display },
            });
            await setUserRcLastSync(u.userId, new Date());
            if (res.logged > 0 || res.transcribed > 0) {
              console.log(`[rcSync] agent #${u.userId} (${u.userName ?? u.ownerName ?? "?"}): ${res.logged} new, ${res.transcribed} transcribed.`);
            }
          }
        } catch (e: any) {
          console.warn(`[rcSync] per-agent sync failed for user ${u.userId}:`, e?.response?.status ?? e?.message ?? e);
        }
      }

      // 2) Company/admin (JWT) BOOTSTRAP pass — only while NO agent has connected
      //    their own RingCentral yet. Once agents connect, the per-agent loop is
      //    authoritative; we stop the account pass so the JWT owner's calls are
      //    never mis-attributed to facility.assignedRep (the bug we're fixing).
      if (connected.length === 0 && process.env.RINGCENTRAL_JWT) {
        try {
          const token = await getValidRCToken();
          const res = await syncRecentCalls(token, { lookbackMinutes: 90 });
          if (res.logged > 0 || res.transcribed > 0) {
            console.log(`[rcSync] account bootstrap sync: ${res.logged} new, ${res.transcribed} transcribed (matched ${res.matched}/${res.scanned}).`);
          }
        } catch (e: any) {
          console.warn("[rcSync] account auto-sync error:", e?.response?.status ?? e?.message ?? e);
        }
      }
    } finally {
      rcSyncRunning = false;
    }
  };
  setTimeout(tick, 30 * 1000); // first pass shortly after boot
  setInterval(tick, INTERVAL_MS);
  console.log(`[rcSync] auto-sync enabled — every ${INTERVAL_MS / 60000} min (per-agent + account).`);
}

startServer().catch(console.error);
