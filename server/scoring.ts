/**
 * Lead Qualification Scoring Engine
 *
 * Formula (sums to 100%):
 *  - Rating score:     30% (Google rating 0–5 normalized to 0–100)
 *  - Review volume:    30% (review count, capped at 500 for max score)
 *  - Proximity:        20% (distance from searched location, 0 mi = 100, 25+ mi = 0)
 *  - Category:         20% (relevance to personal injury referrals)
 */

export interface ScoreBreakdown {
  ratingScore: number;       // 0–30
  reviewScore: number;       // 0–30
  proximityScore: number;    // 0–20
  categoryScore: number;     // 0–20
  total: number;             // 0–100
  tier: "hot" | "warm" | "cold";
}

/** Category relevance weights for personal injury referrals (0–100 internal scale) */
const CATEGORY_RELEVANCE: Record<string, number> = {
  body_shop: 100,
  chiropractor: 100,
  physical_therapist: 95,
  medical_clinic: 85,
  orthopedic_doctor: 90,
  imaging_center: 80,
};

/**
 * Normalize a Google rating (0–5) to a 0–100 scale.
 * A missing or zero rating yields 0.
 */
function normalizeRating(rating: number | null | undefined): number {
  if (!rating || rating <= 0) return 0;
  return Math.min((rating / 5) * 100, 100);
}

/**
 * Normalize review count to 0–100 scale.
 * Cap at 500 reviews for full score.
 */
function normalizeReviewCount(count: number | null | undefined): number {
  if (!count || count <= 0) return 0;
  return Math.min((count / 500) * 100, 100);
}

/**
 * Normalize proximity (distance in miles) to 0–100 scale.
 * 0 miles = 100, 25+ miles = 0, linear decay.
 */
function normalizeProximity(distanceMiles: number | null | undefined): number {
  if (distanceMiles == null || distanceMiles < 0) return 50; // unknown → neutral
  if (distanceMiles >= 25) return 0;
  return Math.max(0, ((25 - distanceMiles) / 25) * 100);
}

/**
 * Get category relevance score (0–100).
 */
function getCategoryRelevance(category: string | null | undefined): number {
  if (!category) return 50;
  const key = category.toLowerCase().replace(/\s+/g, "_");
  // Try exact match first
  if (CATEGORY_RELEVANCE[key] !== undefined) return CATEGORY_RELEVANCE[key];
  // Partial match
  for (const [k, v] of Object.entries(CATEGORY_RELEVANCE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return 50; // default neutral for unknown categories
}

/**
 * Calculate the full qualification score and breakdown for a lead.
 */
export function calculateScore(params: {
  rating: number | null | undefined;
  reviewCount: number | null | undefined;
  distanceMiles: number | null | undefined;
  category: string | null | undefined;
}): ScoreBreakdown {
  const ratingRaw = normalizeRating(params.rating);
  const reviewRaw = normalizeReviewCount(params.reviewCount);
  const proximityRaw = normalizeProximity(params.distanceMiles);
  const categoryRaw = getCategoryRelevance(params.category);

  // Apply weights
  const ratingScore = Math.round(ratingRaw * 0.30);
  const reviewScore = Math.round(reviewRaw * 0.30);
  const proximityScore = Math.round(proximityRaw * 0.20);
  const categoryScore = Math.round(categoryRaw * 0.20);

  const total = Math.min(100, ratingScore + reviewScore + proximityScore + categoryScore);

  let tier: "hot" | "warm" | "cold";
  if (total >= 70) tier = "hot";
  else if (total >= 40) tier = "warm";
  else tier = "cold";

  return {
    ratingScore,
    reviewScore,
    proximityScore,
    categoryScore,
    total,
    tier,
  };
}
