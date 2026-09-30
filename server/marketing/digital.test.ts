import { describe, expect, it } from "vitest";
import {
  DIGITAL_SOURCE_PATTERN, JFJ_WEBSITE, MERCH, NO_SOURCE, OTHER_CHANNELS, TEAM_CHANNEL, TOLL_FREE,
  digitalChannelOf, digitalGroupOf, gbpLocationOf, isDigitalSource, isTollFreeLine, sourceCategoryOf,
} from "@shared/marketing";
import { dmBucketOf, dmOutcomeOf } from "./digital";
import { keepsTriple } from "./leadFilter";

// Lead Docket source names seen in the team's data (no client names).
const DIGITAL = [
  "GMB 525 W Main St Visalia", "Google My Business", "Motorcyclist Atty - GMB 12079 Jefferson Blvd", "Google Local Services Ads",
  "Google Search Engine", "Web Search", "JustinforJustice Website", "Justin For Justice Toll Free for Website", "Kapwa Justice Website",
  "Collision Repair US Landing Page", "Website Pool - RND", "Intaker - JFJ", "Intaker - All Source", "Email Campaigns", "Avvo", "Yelp",
  "Spanish PPC Campaign-Hispanic Lawyers", "KJ FB Organic", "Ayuda California", "J4J California Car Accident", "RND Worx",
  "Labor Law Advocates", "Womens Right Group - Toll Free Number", "Brain Injury Help Center", "JFJ Facebook", "Motorcyclist Attorney Website",
];
const NOT_DIGITAL = [
  "Walker Advertising Contract 26", "Walker Advertising", "Walker Employment Contract - NEW", TEAM_CHANNEL, NO_SOURCE,
  "FLF Employee", "Felix Cedillo Marketing", "Existing Client", "Attorney Referral", "Justin Farahi",
  "Justin - Note Pad and Post it", "Afterhours Call Service", "West Los Angeles",
];

// The list Youssef confirmed on 2026-09-30.
describe("digital sources", () => {
  it("counts the firm's own online channels", () => {
    for (const s of DIGITAL) expect(isDigitalSource(s), s).toBe(true);
  });
  it("leaves out Walker, the team, staff, referrals, merch and the rest", () => {
    for (const s of NOT_DIGITAL) expect(isDigitalSource(s), s).toBe(false);
  });
  it("gives every digital source a group, and none to the rest — so the switch and the report count the same leads", () => {
    for (const s of DIGITAL) expect(digitalGroupOf(s), s).not.toBeNull();
    for (const s of NOT_DIGITAL) expect(digitalGroupOf(s), s).toBeNull();
    // The SQL side reads the same pattern, lower-cased.
    const re = new RegExp(DIGITAL_SOURCE_PATTERN);
    for (const s of [...DIGITAL, ...NOT_DIGITAL.filter((x) => x !== NO_SOURCE && x !== TEAM_CHANNEL)]) {
      expect(re.test(s.trim().toLowerCase()), s).toBe(digitalGroupOf(s) !== null);
    }
  });
  it("groups the Marketing Report's digital view as the digital team does", () => {
    expect(digitalChannelOf("Intaker - JFJ")).toBe("Websites");
    expect(digitalChannelOf("Kapwa Justice Website")).toBe("Websites");
    expect(digitalChannelOf("Justin For Justice Toll Free for Website")).toBe("Websites");
    expect(digitalChannelOf("GMB Panorama")).toBe("Google Business Profile (GMB)");
    expect(digitalChannelOf("Google Local Services Ads")).toBe("Google Local Services Ads");
    expect(digitalChannelOf("Avvo")).toBe("Email & directories");
    expect(digitalChannelOf("RND Worx")).toBe("RND Worx Google Ads");
  });
});

describe("digitalGroupOf", () => {
  const cases: [string, string, string][] = [
    ["GMB 525 W Main St Visalia", "GBP", "GBP Visalia"],
    ["Motorcyclist Atty - GMB 12079 Jefferson Blvd", "GBP", "GBP Motorcyclist Atty - 12079 Jefferson Blvd"],
    ["Google My Business", "GBP", "GBP (unspecified)"],
    ["JustinforJustice Website", "SEO", JFJ_WEBSITE],
    ["Intaker - All Source", "SEO", JFJ_WEBSITE],
    ["Web Search", "SEO", JFJ_WEBSITE],
    ["Google Search Engine", "SEO", JFJ_WEBSITE],
    ["J4J California Car Accident", "SEO", JFJ_WEBSITE],
    ["Justin For Justice Toll Free for Website", "SEO", TOLL_FREE],
    ["Kapwa Justice Website", "SEO", "Kapwa Justice"],
    ["Womens Right Group - Toll Free Number", "SEO", "Women's Rights Group"],
    ["Motorcyclist Attorney Website", "SEO", "Motorcyclist Attorney"],
    ["Collision Repair US Landing Page", "SEO", "Collision Repair"],
    ["Website Pool - RND", "SEO", "RND Website Pool"],
    ["Email Campaigns", "SEO", OTHER_CHANNELS],
    ["Yelp", "SEO", OTHER_CHANNELS],
    ["Google Local Services Ads", "Ads", "LSA"],
    ["Spanish PPC Campaign-Hispanic Lawyers", "Ads", "Internal PPC"],
    ["KJ FB Organic", "Ads", "Social Media"],
    ["JFJ Facebook", "Ads", "Social Media"],
    ["RND Worx", "Ads", "RND Worx Google Ads"],
  ];
  for (const [source, group, label] of cases) {
    it(`${source} → ${group} / ${label}`, () => expect(digitalGroupOf(source)).toEqual({ group, label }));
  }
  it("merges Lead Docket's duplicate spellings of one brand", () => {
    expect(digitalGroupOf("JustinforJustice Website")?.label).toBe(digitalGroupOf("Justin For Justice website")?.label);
  });
});

describe("gbpLocationOf", () => {
  const cases: [string, string][] = [
    ["GMB 525 W Main St Visalia", "GBP Visalia"],
    ["GMB 5340 Alla Road", "GBP Los Angeles"],
    ["GMB 5601 Truxtun Ave", "GBP Bakersfield"],
    ["GMB 3111 Edison Hwy", "GBP Bakersfield"],
    ["GMB 4701 Patrick Henry Dr", "GBP Santa Clara"],
    ["GMB 14500 Roscoe Blvd", "GBP Panorama"],
    ["GMB Panorama", "GBP Panorama"],
    ["GMB 222 West 6th St", "GBP San Pedro"],
    ["GMB 22760 Hawthorne Blvd", "GBP Torrance"],
    ["GMB 836 57th St", "GBP Sacramento"],
    ["GMB Lancaster", "GBP Lancaster"],
    ["GMB 1010 Crenshaw Blvd", "GBP Los Angeles (Crenshaw)"],
    ["GMB 1444 Fulton St", "GBP Fresno"],
    ["GMB Fresno", "GBP Fresno"],
    ["GMB 1900 South Norfolk St", "GBP San Mateo"],
    ["GMB MA Bakersfield", "GBP MA Bakersfield"],
    ["GMB MA Visalia", "GBP MA Visalia"],
    ["GMB San Francisco", "GBP San Francisco"],
    ["Google My Business", "GBP (unspecified)"],
    ["GMB", "GBP (unspecified)"],
    ["GMB 100 Unknown Ave", "GBP 100 Unknown Ave"],
  ];
  for (const [source, label] of cases) it(`${source} → ${label}`, () => expect(gbpLocationOf(source)).toBe(label));
});

describe("the toll-free line and merch", () => {
  it("matches the number on its digits, whatever the format", () => {
    for (const v of ["800-738-0000", "(800) 738-0000", "1-800-738-0000", "8007380000", "Call 800.738.0000", "Justin For Justice Toll Free for Website"]) {
      expect(isTollFreeLine(v), v).toBe(true);
    }
    for (const v of ["800-738-0001", "Womens Right Group - Toll Free Number", "", null]) expect(isTollFreeLine(v), String(v)).toBe(false);
  });
  it("counts a source naming the number as the toll-free row", () => {
    expect(digitalGroupOf("JFJ 800-738-0000")).toEqual({ group: "SEO", label: TOLL_FREE });
  });
  it("knows merch is not digital", () => {
    expect(digitalGroupOf("Justin - Note Pad and Post it")).toBeNull();
    expect(sourceCategoryOf("Justin - Note Pad and Post it")).toEqual({ kind: "merch", label: MERCH });
    expect(sourceCategoryOf("Walker Advertising")).toEqual({ kind: "other" });
    expect(sourceCategoryOf("Avvo")).toEqual({ kind: "digital", group: "SEO", label: OTHER_CHANNELS });
  });
});

describe("the team table's columns and the GBP outcome rows", () => {
  it("splits Lost out of the scorecard's Rejected, and keeps the rest", () => {
    expect(dmBucketOf("Lost", "Lost")).toBe("lostNI");
    expect(dmBucketOf("Rejected", "Rejected")).toBe("rejected");
    expect(dmBucketOf("Rejected - PD Leads Only", "Rejected - PD Leads Only")).toBe("rejected");
    expect(dmBucketOf("Referred Out", "Referred")).toBe("referredOut");
    expect(dmBucketOf("Signed Referred Out", "Referred")).toBe("signedReferred");
    expect(dmBucketOf("Signed", "Signed Up")).toBe("signedInHouse");
    expect(dmBucketOf("Pending Referral", "Pending Referral")).toBe("open");
  });
  it("names where a referral stands", () => {
    expect(dmOutcomeOf("Pending Referral", "Pending Referral", "Disputed liability")).toBe("pendingReferral");
    expect(dmOutcomeOf("Chase", "Chase", "Continued Attempt")).toBe("open");
    expect(dmOutcomeOf("Referred Out", "Referred", "Declined")).toBe("referredDeclined");
    expect(dmOutcomeOf("Referred Out", "Referred", "Rejected Lead Referral")).toBe("referredDeclined");
    expect(dmOutcomeOf("Referred Out", "Referred", "Pending Review - Referrals Dept")).toBe("referredPendingReview");
    expect(dmOutcomeOf("Referred Out", "Referred", "Reviewing")).toBe("referredReviewing");
    expect(dmOutcomeOf("Referred Out", "Referred", null)).toBe("referred");
    expect(dmOutcomeOf("Signed Referred Out", "Referred", "Signed Up")).toBe("referredSignedUp");
    expect(dmOutcomeOf("Signed", "Signed Up", "N/A")).toBe("signedInHouse");
    expect(dmOutcomeOf("Lost", "Lost", "No Show")).toBe("lostNI");
  });
  it("drills into exactly those leads", () => {
    expect(keepsTriple({ outcome: "Lost", status: "Lost", subStatus: "No Show" }, { status: "all", dmBucket: "lostNI" })).toBe(true);
    expect(keepsTriple({ outcome: "Rejected", status: "Rejected", subStatus: "Spam" }, { status: "all", dmBucket: "lostNI" })).toBe(false);
    expect(keepsTriple({ outcome: "Referred Out", status: "Referred", subStatus: "Reviewing" }, { status: "all", dmOutcome: "referredReviewing" })).toBe(true);
    expect(keepsTriple({ outcome: "Referred Out", status: "Referred", subStatus: "Declined" }, { status: "all", dmOutcome: "referredReviewing" })).toBe(false);
  });
});
