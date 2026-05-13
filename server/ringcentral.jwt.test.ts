import { describe, expect, it } from "vitest";

/**
 * Validates that the RINGCENTRAL_JWT env var can be exchanged for a valid
 * access token using the configured Client ID and Secret.
 * This test calls the real RingCentral API so it requires network access.
 */
describe("RingCentral JWT credentials", () => {
  it("exchanges JWT for a valid access token", async () => {
    const jwt = process.env.RINGCENTRAL_JWT;
    const clientId = process.env.RINGCENTRAL_CLIENT_ID;
    const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;

    // Skip if credentials not configured
    if (!jwt || !clientId || !clientSecret) {
      console.warn("RingCentral credentials not set — skipping live test");
      return;
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const resp = await fetch("https://platform.ringcentral.com/restapi/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    expect(resp.status).toBe(200);
    const data = await resp.json() as Record<string, unknown>;
    expect(data).toHaveProperty("access_token");
    expect(typeof data.access_token).toBe("string");
    expect((data.access_token as string).length).toBeGreaterThan(50);
  });
});
