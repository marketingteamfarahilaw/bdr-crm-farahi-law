/**
 * Google Maps Places API helper
 * Uses the Places API (Text Search + Place Details) to find business leads.
 */

import axios from "axios";

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode";

export interface PlaceLead {
  placeId: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  category: string;
  source: "google";
  types: string[];
  businessStatus: string | null;
  photoReference: string | null;
}

/** Haversine distance in miles between two lat/lng points */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Geocode a city name or zip code to lat/lng */
export async function geocodeLocation(
  location: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await axios.get(`${GEOCODE_BASE}/json`, {
      params: { address: location, key: apiKey },
    });
    const result = res.data?.results?.[0];
    if (!result) return null;
    return result.geometry.location;
  } catch {
    return null;
  }
}

/** Map our internal category key to a Google Places search query */
const CATEGORY_QUERIES: Record<string, string> = {
  body_shop: "auto body shop",
  chiropractor: "chiropractor",
  physical_therapist: "physical therapy",
  medical_clinic: "medical clinic urgent care",
  orthopedic_doctor: "orthopedic doctor",
  imaging_center: "MRI imaging center radiology",
};

/** Fetch place details (phone, website) for a single place */
async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<{ phone: string | null; website: string | null }> {
  try {
    const res = await axios.get(`${PLACES_BASE}/details/json`, {
      params: {
        place_id: placeId,
        fields: "formatted_phone_number,website",
        key: apiKey,
      },
    });
    const r = res.data?.result;
    return {
      phone: r?.formatted_phone_number ?? null,
      website: r?.website ?? null,
    };
  } catch {
    return { phone: null, website: null };
  }
}

/** Search Google Maps Places for leads */
export async function searchGooglePlaces(params: {
  category: string;
  location: string;
  lat?: number;
  lng?: number;
  radiusMiles: number;
  apiKey: string;
  maxResults?: number;
}): Promise<PlaceLead[]> {
  const { category, location, radiusMiles, apiKey, maxResults = 20 } = params;

  // Use provided coordinates, or fall back to geocoding
  let coords: { lat: number; lng: number } | null = null;
  if (params.lat != null && params.lng != null) {
    coords = { lat: params.lat, lng: params.lng };
  } else {
    coords = await geocodeLocation(location, apiKey);
  }
  if (!coords) throw new Error(`Could not geocode location: "${location}". Please select a location from the autocomplete suggestions.`);

  const query = CATEGORY_QUERIES[category] ?? category.replace(/_/g, " ");
  const radiusMeters = Math.min(radiusMiles * 1609.34, 50000); // max 50km

  const results: PlaceLead[] = [];
  let pageToken: string | undefined;

  // Fetch up to 3 pages (60 results max from Places API)
  for (let page = 0; page < 3 && results.length < maxResults; page++) {
    const params: Record<string, string | number> = {
      query: `${query} near ${location}`,
      location: `${coords.lat},${coords.lng}`,
      radius: radiusMeters,
      key: apiKey,
    };
    if (pageToken) params.pagetoken = pageToken;

    const res = await axios.get(`${PLACES_BASE}/textsearch/json`, { params });
    const data = res.data;

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places API error: ${data.status} — ${data.error_message ?? ""}`);
    }

    const places = data.results ?? [];
    for (const p of places) {
      if (results.length >= maxResults) break;
      const lat = p.geometry?.location?.lat ?? null;
      const lng = p.geometry?.location?.lng ?? null;
      const distanceMiles =
        lat != null && lng != null
          ? haversineDistance(coords.lat, coords.lng, lat, lng)
          : null;

      results.push({
        placeId: p.place_id,
        name: p.name,
        address: p.formatted_address ?? "",
        phone: null, // filled in detail fetch
        website: null,
        rating: p.rating ?? null,
        reviewCount: p.user_ratings_total ?? null,
        latitude: lat,
        longitude: lng,
        distanceMiles,
        category,
        source: "google",
        types: p.types ?? [],
        businessStatus: p.business_status ?? null,
        photoReference: p.photos?.[0]?.photo_reference ?? null,
      });
    }

    pageToken = data.next_page_token;
    if (!pageToken) break;
    // Google requires a short delay before using next_page_token
    if (page < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  // Fetch details (phone + website) in parallel, batched to avoid rate limits
  const BATCH = 5;
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    const details = await Promise.all(
      batch.map((lead) => fetchPlaceDetails(lead.placeId, apiKey))
    );
    details.forEach((d, idx) => {
      results[i + idx].phone = d.phone;
      results[i + idx].website = d.website;
    });
  }

  return results;
}
