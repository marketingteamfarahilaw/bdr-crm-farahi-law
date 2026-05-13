import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import axios from "axios";
import { getRingcentralToken, upsertRingcentralToken } from "../crmDb";

/** Auto-connect RingCentral using the JWT stored in env vars */
async function autoConnectRingCentral() {
  const jwt = process.env.RINGCENTRAL_JWT;
  const clientId = process.env.RINGCENTRAL_CLIENT_ID;
  const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;
  if (!jwt || !clientId || !clientSecret) return;

  try {
    // Check if we already have a valid token (more than 10 min remaining)
    const existing = await getRingcentralToken();
    if (existing && existing.tokenExpiry.getTime() - Date.now() > 10 * 60 * 1000) {
      console.log(`[RingCentral] Already connected as ${existing.ownerName}`);
      return;
    }

    // Exchange JWT for access token
    const tokenResp = await axios.post(
      "https://platform.ringcentral.com/restapi/oauth/token",
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      {
        auth: { username: clientId, password: clientSecret },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    const { access_token, refresh_token, expires_in } = tokenResp.data;

    // Decode user info from JWT payload (avoids needing ReadAccounts scope)
    let ownerName = "RingCentral User";
    let ownerExtensionId: string | undefined;
    try {
      const jwtPayload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
      ownerExtensionId = jwtPayload.sub?.toString();
      ownerName = `RC User (${ownerExtensionId ?? "unknown"})`;
    } catch { /* ignore decode errors */ }

    // Try to get name via extension endpoint (requires ReadAccounts scope — optional)
    try {
      const meResp = await axios.get(
        "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~",
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (meResp.data?.name) ownerName = meResp.data.name;
      if (meResp.data?.id) ownerExtensionId = meResp.data.id.toString();
    } catch { /* ReadAccounts not available — use JWT-decoded info */ }

    const accountId = ownerExtensionId ?? "default";

    await upsertRingcentralToken({
      accountId,
      accessToken: access_token,
      refreshToken: refresh_token ?? "",
      tokenExpiry: new Date(Date.now() + (expires_in ?? 3600) * 1000),
      ownerName,
      ownerExtensionId,
    });
    console.log(`[RingCentral] Auto-connected as ${ownerName}`);
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message;
    console.warn("[RingCentral] Auto-connect failed:", JSON.stringify(detail));
    console.warn("[RingCentral] JWT present:", !!process.env.RINGCENTRAL_JWT, "len:", process.env.RINGCENTRAL_JWT?.length ?? 0);
    console.warn("[RingCentral] ClientId:", process.env.RINGCENTRAL_CLIENT_ID ?? "(missing)");
  }
}

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
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
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
    // Auto-connect RingCentral after server is up
    autoConnectRingCentral();
  });
}

startServer().catch(console.error);
