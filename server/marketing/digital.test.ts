import { describe, expect, it } from "vitest";
import { digitalChannelOf, isDigitalSource, NO_SOURCE, TEAM_CHANNEL } from "@shared/marketing";

// The list Youssef confirmed on 2026-09-30.
describe("digital sources", () => {
  it("counts the firm's own online channels", () => {
    for (const s of ["GMB 525 W Main St Visalia", "Google My Business", "Motorcyclist Atty - GMB 12079 Jefferson Blvd", "Google Local Services Ads",
      "Google Search Engine", "Web Search", "JustinforJustice Website", "Justin For Justice Toll Free for Website", "Kapwa Justice Website",
      "Collision Repair US Landing Page", "Website Pool - RND", "Intaker - JFJ", "Intaker - All Source", "Email Campaigns", "Avvo", "Yelp",
      "Spanish PPC Campaign-Hispanic Lawyers", "KJ FB Organic", "Ayuda California", "J4J California Car Accident"]) {
      expect(isDigitalSource(s), s).toBe(true);
    }
  });
  it("leaves out Walker, the team, staff, referrals and the rest", () => {
    for (const s of ["Walker Advertising Contract 26", "Walker Advertising", "Walker Employment Contract - NEW", TEAM_CHANNEL, NO_SOURCE,
      "FLF Employee", "Felix Cedillo Marketing", "RND Worx", "Existing Client", "Attorney Referral", "Malvin Rosales", "Justin Farahi",
      "Justin - Note Pad and Post it", "Womens Right Group - Toll Free Number", "Afterhours Call Service", "West Los Angeles"]) {
      expect(isDigitalSource(s), s).toBe(false);
    }
  });
  it("groups websites and their chat together", () => {
    expect(digitalChannelOf("Intaker - JFJ")).toBe("Websites");
    expect(digitalChannelOf("Kapwa Justice Website")).toBe("Websites");
    expect(digitalChannelOf("Justin For Justice Toll Free for Website")).toBe("Websites");
    expect(digitalChannelOf("GMB Panorama")).toBe("Google Business Profile (GMB)");
    expect(digitalChannelOf("Google Local Services Ads")).toBe("Search & ads");
  });
});
