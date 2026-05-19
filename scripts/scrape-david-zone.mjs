/**
 * Targeted scrape for David Carrillo's zone cities
 * Cities: Pasadena, Burbank, Glendale, Torrance, Inglewood, Downey, Compton, Pomona
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

const CATEGORIES = [
  { value: "auto_body_shop",     query: "auto body shop collision repair" },
  { value: "chiropractor",       query: "chiropractor chiropractic" },
  { value: "physical_therapist", query: "physical therapy rehabilitation" },
  { value: "medical_clinic",     query: "medical clinic urgent care" },
  { value: "orthopedic_doctor",  query: "orthopedic surgeon doctor" },
  { value: "imaging_center",     query: "MRI imaging radiology center" },
];

const DAVID_CITIES = [
  { name: "Pasadena",   lat: 34.1478, lng: -118.1445 },
  { name: "Burbank",    lat: 34.1808, lng: -118.3090 },
  { name: "Glendale",   lat: 34.1425, lng: -118.2551 },
  { name: "Torrance",   lat: 33.8358, lng: -118.3406 },
  { name: "Inglewood",  lat: 33.9617, lng: -118.3531 },
  { name: "Downey",     lat: 33.9401, lng: -118.1331 },
  { name: "Pomona",     lat: 34.0553, lng: -117.7500 },
  { name: "El Monte",   lat: 34.0686, lng: -118.0276 },
];

function scoreLead(place) {
  const rating = place.rating ?? 0;
  const reviews = place.user_ratings_total ?? 0;
  const ratingScore = Math.min(rating / 5.0, 1.0) * 30;
  const reviewScore = Math.min(reviews / 200, 1.0) * 40;
  const categoryScore = 20;
  const proximityScore = 10;
  const total = Math.round(ratingScore + reviewScore + categoryScore + proximityScore);
  const tier = total >= 70 ? "hot" : total >= 45 ? "warm" : "cold";
  return { total, tier };
}

async function searchNearby(lat, lng, keyword, radius = 5000) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("key", GOOGLE_KEY);

  const results = [];
  let pageToken = null;
  let pages = 0;

  do {
    if (pageToken) {
      url.searchParams.set("pagetoken", pageToken);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      url.searchParams.delete("pagetoken");
    }

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.results) results.push(...data.results);
    pageToken = data.next_page_token ?? null;
    pages++;
  } while (pageToken && pages < 3);

  return results;
}

async function main() {
  const conn = await mysql.createConnection(DB_URL);
  console.log("Connected to DB");

  // Get existing placeIds to avoid duplicates
  const [existing] = await conn.execute("SELECT placeId FROM saved_leads");
  const existingIds = new Set(existing.map(r => r.placeId));
  console.log(`Existing leads: ${existingIds.size}`);

  let totalInserted = 0;

  for (const city of DAVID_CITIES) {
    for (const cat of CATEGORIES) {
      console.log(`\nScraping ${cat.value} in ${city.name}...`);
      
      try {
        const places = await searchNearby(city.lat, city.lng, cat.query);
        console.log(`  Found ${places.length} places`);

        for (const place of places) {
          if (existingIds.has(place.place_id)) continue;
          existingIds.add(place.place_id);

          const { total, tier } = scoreLead(place);
          const lat = place.geometry?.location?.lat ?? null;
          const lng = place.geometry?.location?.lng ?? null;

          await conn.execute(
            `INSERT INTO saved_leads 
              (userId, placeId, source, name, address, phone, website, email, 
               rating, reviewCount, latitude, longitude, category, 
               qualificationScore, scoreTier, scoreBreakdown, assignedAgent, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              1,
              place.place_id,
              "google",
              place.name,
              place.vicinity ?? "",
              null,
              null,
              null,
              place.rating ?? null,
              place.user_ratings_total ?? null,
              lat,
              lng,
              cat.value,
              total,
              tier,
              JSON.stringify({ ratingScore: 0, reviewScore: 0, proximityScore: 10, categoryScore: 20, total, tier }),
              "David Carrillo",
            ]
          );
          totalInserted++;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      }
    }
  }

  console.log(`\n✅ Done! Inserted ${totalInserted} new leads for David Carrillo's zone.`);
  await conn.end();
}

main().catch(console.error);
