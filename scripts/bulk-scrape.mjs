/**
 * Bulk Lead Scraper
 * Scrapes 100 leads per category across California cities and saves to DB.
 * Run: node scripts/bulk-scrape.mjs
 */
import axios from "axios";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_USER_ID = 1; // marketingteam / youssef@farahilaw.com

if (!GOOGLE_MAPS_API_KEY) throw new Error("GOOGLE_MAPS_API_KEY not set");
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const PLACES_NEW_BASE = "https://places.googleapis.com/v1";
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode";

const CATEGORY_QUERIES = {
  body_shop: "auto body shop collision repair",
  chiropractor: "chiropractor chiropractic",
  physical_therapist: "physical therapy rehabilitation",
  medical_clinic: "medical clinic urgent care",
  orthopedic_doctor: "orthopedic doctor surgeon",
  imaging_center: "MRI imaging center radiology",
};

// California cities spread across the state for broad coverage
const CA_CITIES = [
  { name: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { name: "San Francisco, CA", lat: 37.7749, lng: -122.4194 },
  { name: "San Diego, CA", lat: 32.7157, lng: -117.1611 },
  { name: "Sacramento, CA", lat: 38.5816, lng: -121.4944 },
  { name: "San Jose, CA", lat: 37.3382, lng: -121.8863 },
  { name: "Fresno, CA", lat: 36.7378, lng: -119.7871 },
  { name: "Long Beach, CA", lat: 33.7701, lng: -118.1937 },
  { name: "Oakland, CA", lat: 37.8044, lng: -122.2712 },
  { name: "Bakersfield, CA", lat: 35.3733, lng: -119.0187 },
  { name: "Anaheim, CA", lat: 33.8366, lng: -117.9143 },
  { name: "Riverside, CA", lat: 33.9806, lng: -117.3755 },
  { name: "Stockton, CA", lat: 37.9577, lng: -121.2908 },
  { name: "Irvine, CA", lat: 33.6846, lng: -117.8265 },
  { name: "Chula Vista, CA", lat: 32.6401, lng: -117.0842 },
  { name: "Modesto, CA", lat: 37.6391, lng: -120.9969 },
  { name: "Santa Ana, CA", lat: 33.7455, lng: -117.8677 },
  { name: "Oxnard, CA", lat: 34.1975, lng: -119.1771 },
  { name: "Fontana, CA", lat: 34.0922, lng: -117.4350 },
  { name: "Moreno Valley, CA", lat: 33.9425, lng: -117.2297 },
  { name: "Glendale, CA", lat: 34.1425, lng: -118.2551 },
];

const PLACE_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.businessStatus",
].join(",");

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateScore(rating, reviewCount, distanceMiles, category) {
  const CATEGORY_RELEVANCE = {
    body_shop: 100, chiropractor: 100, physical_therapist: 95,
    medical_clinic: 85, orthopedic_doctor: 90, imaging_center: 80,
  };
  const ratingRaw = rating ? Math.min((rating / 5) * 100, 100) : 0;
  const reviewRaw = reviewCount ? Math.min((reviewCount / 500) * 100, 100) : 0;
  const proximityRaw = distanceMiles == null ? 50 : distanceMiles >= 25 ? 0 : ((25 - distanceMiles) / 25) * 100;
  const categoryRaw = CATEGORY_RELEVANCE[category] ?? 50;
  const ratingScore = Math.round(ratingRaw * 0.30);
  const reviewScore = Math.round(reviewRaw * 0.30);
  const proximityScore = Math.round(proximityRaw * 0.20);
  const categoryScore = Math.round(categoryRaw * 0.20);
  const total = Math.min(100, ratingScore + reviewScore + proximityScore + categoryScore);
  const tier = total >= 70 ? "hot" : total >= 40 ? "warm" : "cold";
  return { ratingScore, reviewScore, proximityScore, categoryScore, total, tier };
}

async function searchPlaces(category, city, maxResults = 20) {
  const query = CATEGORY_QUERIES[category];
  const results = [];
  let pageToken;

  for (let page = 0; page < 5 && results.length < maxResults; page++) {
    const body = {
      textQuery: `${query} near ${city.name}`,
      locationBias: {
        circle: {
          center: { latitude: city.lat, longitude: city.lng },
          radius: 25000, // 25km radius
        },
      },
      maxResultCount: Math.min(maxResults - results.length, 20),
      languageCode: "en",
    };
    if (pageToken) body.pageToken = pageToken;

    try {
      const res = await axios.post(`${PLACES_NEW_BASE}/places:searchText`, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": PLACE_FIELDS,
        },
        timeout: 15000,
      });

      const places = res.data?.places ?? [];
      pageToken = res.data?.nextPageToken;

      for (const p of places) {
        if (results.length >= maxResults) break;
        const loc = p.location;
        const lat = loc?.latitude ?? null;
        const lng = loc?.longitude ?? null;
        const distanceMiles = lat != null && lng != null
          ? haversineDistance(city.lat, city.lng, lat, lng) : null;
        const score = calculateScore(p.rating, p.userRatingCount, distanceMiles, category);
        results.push({
          placeId: p.id ?? "",
          name: p.displayName?.text ?? "",
          address: p.formattedAddress ?? null,
          phone: p.nationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? null,
          latitude: lat,
          longitude: lng,
          category,
          qualificationScore: score.total,
          scoreTier: score.tier,
          scoreBreakdown: JSON.stringify(score),
        });
      }

      if (!pageToken) break;
      if (page < 4) await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.error(`  Error fetching page ${page + 1} for ${category} in ${city.name}: ${e.message}`);
      break;
    }
  }
  return results;
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log("Connected to database");

  const categories = Object.keys(CATEGORY_QUERIES);
  const TARGET_PER_CATEGORY = 100;

  for (const category of categories) {
    console.log(`\n=== Scraping: ${category} (target: ${TARGET_PER_CATEGORY}) ===`);
    const allLeads = new Map(); // placeId -> lead (dedup)
    let cityIdx = 0;

    while (allLeads.size < TARGET_PER_CATEGORY && cityIdx < CA_CITIES.length) {
      const city = CA_CITIES[cityIdx++];
      const needed = TARGET_PER_CATEGORY - allLeads.size;
      console.log(`  Searching ${city.name} (have ${allLeads.size}, need ${needed} more)...`);

      const results = await searchPlaces(category, city, Math.min(needed + 5, 20));
      for (const lead of results) {
        if (lead.placeId && !allLeads.has(lead.placeId)) {
          allLeads.set(lead.placeId, lead);
        }
      }
      console.log(`  → Got ${results.length} results, total unique: ${allLeads.size}`);
      await new Promise(r => setTimeout(r, 400));
    }

    // Insert into DB
    let inserted = 0, skipped = 0;
    for (const lead of allLeads.values()) {
      if (!lead.placeId || !lead.name) { skipped++; continue; }
      try {
        // Check if already exists for this user
        const [existing] = await conn.execute(
          "SELECT id FROM saved_leads WHERE userId = ? AND placeId = ? LIMIT 1",
          [OWNER_USER_ID, lead.placeId]
        );
        if (existing.length > 0) { skipped++; continue; }

        await conn.execute(
          `INSERT INTO saved_leads 
           (userId, placeId, source, name, address, phone, website, email, category, 
            rating, reviewCount, latitude, longitude, qualificationScore, scoreTier, scoreBreakdown, createdAt)
           VALUES (?, ?, 'google', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            OWNER_USER_ID,
            lead.placeId,
            lead.name,
            lead.address,
            lead.phone,
            lead.website,
            lead.category,
            lead.rating,
            lead.reviewCount,
            lead.latitude,
            lead.longitude,
            lead.qualificationScore,
            lead.scoreTier,
            lead.scoreBreakdown,
          ]
        );
        inserted++;
      } catch (e) {
        if (!e.message.includes("Duplicate")) {
          console.error(`  DB error for ${lead.name}: ${e.message}`);
        }
        skipped++;
      }
    }
    console.log(`  ✅ ${category}: inserted ${inserted}, skipped ${skipped}`);
  }

  await conn.end();
  console.log("\n🎉 Bulk scrape complete!");
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
