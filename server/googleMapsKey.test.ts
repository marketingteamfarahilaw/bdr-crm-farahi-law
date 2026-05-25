import { describe, it, expect } from "vitest";
import axios from "axios";

describe("GOOGLE_MAPS_API_KEY validation", () => {
  it("Maps JavaScript API returns HTTP 200 with the configured key", async () => {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    expect(key, "GOOGLE_MAPS_API_KEY must be set").toBeTruthy();
    
    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&callback=test`,
      { timeout: 15000, validateStatus: () => true }
    );
    expect(response.status).toBe(200);
  }, 20000);
});
