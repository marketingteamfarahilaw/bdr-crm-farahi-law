import "dotenv/config";
import mysql from "mysql2/promise";

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) { console.error("No GOOGLE_MAPS_API_KEY"); process.exit(1); }

const c = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await c.query(
  "SELECT id, name, address, city FROM facilities WHERE (latitude IS NULL OR longitude IS NULL) AND ((address IS NOT NULL AND address<>'') OR (city IS NOT NULL AND city<>''))"
);
console.log("Facilities to geocode:", rows.length);

// California-ish bounds — reject geocodes that land elsewhere (bad name matches).
const inCA = (lat, lng) => lat >= 32.3 && lat <= 42.2 && lng >= -124.6 && lng <= -114.0;

let ok = 0, fail = 0, oob = 0;

async function geocodeOne(f) {
  let query = (f.address && f.address.trim()) ? f.address.trim() : [f.name, f.city, "CA"].filter(Boolean).join(", ");
  if (!/\b(CA|California)\b/i.test(query)) query += ", CA";
  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(query) + "&region=us&bounds=32.3,-124.6|42.2,-114.0&key=" + key;
    const r = await fetch(url);
    const j = await r.json();
    if (j.status === "OK" && j.results[0]) {
      const { lat, lng } = j.results[0].geometry.location;
      if (inCA(lat, lng)) {
        await c.query("UPDATE facilities SET latitude=?, longitude=? WHERE id=?", [lat, lng, f.id]);
        ok++;
      } else { oob++; }
    } else { fail++; }
  } catch { fail++; }
}

const CONC = 8;
for (let i = 0; i < rows.length; i += CONC) {
  await Promise.all(rows.slice(i, i + CONC).map(geocodeOne));
  if ((i / CONC) % 8 === 0) console.log(`  ${Math.min(i + CONC, rows.length)}/${rows.length} — ${ok} ok, ${fail} no-result, ${oob} out-of-CA`);
  await new Promise((res) => setTimeout(res, 120));
}
console.log(`Done: ${ok} geocoded, ${fail} no result, ${oob} rejected (out of CA).`);
await c.end();
