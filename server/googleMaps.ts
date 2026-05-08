/**
 * Google Maps Places API (New) helper
 * Uses the Places API (New) — https://places.googleapis.com/v1/places:searchText
 * and the Geocoding API for fallback coordinate resolution.
 */

import axios from "axios";

const PLACES_NEW_BASE = "https://places.googleapis.com/v1";
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

/** Geocode a city name or zip code to lat/lng using Geocoding API (still valid) */
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

/** Map our internal category key to a Places API (New) text search query */
const CATEGORY_QUERIES: Record<string, string> = {
  body_shop: "auto body shop collision repair",
  chiropractor: "chiropractor chiropractic",
  physical_therapist: "physical therapy rehabilitation",
  medical_clinic: "medical clinic urgent care",
  orthopedic_doctor: "orthopedic doctor surgeon",
  imaging_center: "MRI imaging center radiology",
};

/**
 * Fields to request from Places API (New).
 * Billing note: only request what you need.
 */
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
  "places.types",
  "places.photos",
].join(",");

/** Search Google Maps using Places API (New) Text Search */
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
  if (!coords) {
    throw new Error(
      `Could not resolve coordinates for: "${location}". Please select a location from the autocomplete suggestions.`
    );
  }

  const query = CATEGORY_QUERIES[category] ?? category.replace(/_/g, " ");
  const radiusMeters = Math.min(radiusMiles * 1609.34, 50000);

  const results: PlaceLead[] = [];
  let pageToken: string | undefined;

  // Places API (New) allows up to 3 pages via nextPageToken
  for (let page = 0; page < 3 && results.length < maxResults; page++) {
    const body: Record<string, unknown> = {
      textQuery: `${query} near ${location}`,
      locationBias: {
        circle: {
          center: { latitude: coords.lat, longitude: coords.lng },
          radius: radiusMeters,
        },
      },
      maxResultCount: Math.min(maxResults - results.length, 20),
      languageCode: "en",
    };

    if (pageToken) body.pageToken = pageToken;

    const res = await axios.post(
      `${PLACES_NEW_BASE}/places:searchText`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACE_FIELDS,
        },
      }
    );

    const places: unknown[] = res.data?.places ?? [];
    pageToken = res.data?.nextPageToken;

    for (const p of places as Record<string, unknown>[]) {
      if (results.length >= maxResults) break;

      const loc = p.location as { latitude?: number; longitude?: number } | undefined;
      const lat = loc?.latitude ?? null;
      const lng = loc?.longitude ?? null;
      const distanceMiles =
        lat != null && lng != null
          ? haversineDistance(coords.lat, coords.lng, lat, lng)
          : null;

      const displayName = p.displayName as { text?: string } | undefined;
      const photos = p.photos as Array<{ name?: string }> | undefined;

      results.push({
        placeId: (p.id as string) ?? "",
        name: displayName?.text ?? (p.formattedAddress as string) ?? "",
        address: (p.formattedAddress as string) ?? "",
        phone: (p.nationalPhoneNumber as string | null) ?? null,
        website: (p.websiteUri as string | null) ?? null,
        rating: (p.rating as number | null) ?? null,
        reviewCount: (p.userRatingCount as number | null) ?? null,
        latitude: lat,
        longitude: lng,
        distanceMiles,
        category,
        source: "google",
        types: (p.types as string[]) ?? [],
        businessStatus: (p.businessStatus as string | null) ?? null,
        photoReference: photos?.[0]?.name ?? null,
      });
    }

    if (!pageToken) break;
    // Small delay before fetching next page
    if (page < 2) await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}
