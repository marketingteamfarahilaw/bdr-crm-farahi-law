import { describe, it, expect } from "vitest";
import axios from "axios";

describe("RingCentral JWT Token Validation", () => {
  it("should authenticate with the JWT token and get an access token", async () => {
    const jwt = process.env.RINGCENTRAL_JWT;
    const clientId = process.env.RINGCENTRAL_CLIENT_ID;
    const clientSecret = process.env.RINGCENTRAL_CLIENT_SECRET;

    expect(jwt).toBeTruthy();
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();

    const resp = await axios.post(
      "https://platform.ringcentral.com/restapi/oauth/token",
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt!,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
      }
    );

    expect(resp.status).toBe(200);
    expect(resp.data.access_token).toBeTruthy();

    // Verify the token has ReadCallLog scope
    expect(resp.data.scope).toContain("ReadCallLog");
  }, 15000);
});
