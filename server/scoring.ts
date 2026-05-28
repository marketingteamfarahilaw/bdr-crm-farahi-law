/**
 * Lead Qualification Scoring Engine
 *
 * Formula (sums to 100):
 *  - Rating score:     25 pts  (Google rating 0–5 → 0–25)
 *  - Review volume:    25 pts  (review count, capped at 500 for max)
 *  - Proximity:        20 pts  (distance from searched location)
 *  - Category:         20 pts  (relevance to personal injury referrals)
 *  - Lien score:       10 pts  (signals that facility works on lien / no insurance)
 *
 * Lien-friendly bonus: if lienFriendly === true, tier threshold is lowered by 5 pts
 * so lien-based facilities are more likely to surface as Hot/Warm.
 */

export interface ScoreBreakdown {
  ratingScore: number;       // 0–25
  reviewScore: number;       // 0–25
  proximityScore: number;    // 0–20
  categoryScore: number;     // 0–20
  lienScore: number;         // 0–10
  total: number;             // 0–100
  tier: "hot" | "warm" | "cold";
  lienFriendly: boolean;
  lienSignals: string[];     // which signals were detected
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
 * Keywords that strongly indicate a facility works on a lien / letter of protection
 * basis and does NOT require insurance upfront.
 */
export const LIEN_KEYWORDS = [
  // Direct lien language
  "lien",
  "letter of protection",
  "lop",
  "medical lien",
  "attorney lien",
  // No-insurance language
  "no insurance",
  "no insurance needed",
  "no insurance required",
  "cash pay",
  "cash only",
  "self pay",
  "self-pay",
  "uninsured",
  // PI attorney relationship signals
  "personal injury",
  "pi attorney",
  "pi lawyer",
  "accident attorney",
  "accident lawyer",
  "work with attorneys",
  "attorney referral",
  "we work with your attorney",
  // Accident / injury treatment signals
  "auto accident",
  "car accident",
  "accident victim",
  "accident injury",
  "injury from accident",
  "we treat accident",
  "collision injury",
  "whiplash",
  "accident related",
  // Payment flexibility signals
  "payment plan",
  "flexible payment",
  "no upfront cost",
  "no out of pocket",
  "no out-of-pocket",
  "deferred payment",
  "we bill your attorney",
  "billed to your attorney",
];

/**
 * Detect lien-friendly signals in any text (reviews, website, description, name).
 * Returns the list of matched signals (deduplicated).
 */
export function detectLienSignals(texts: (string | null | undefined)[]): string[] {
  const combined = texts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const found = new Set<string>();
  for (const kw of LIEN_KEYWORDS) {
    if (combined.includes(kw.toLowerCase())) {
      found.add(kw);
    }
  }
  return Array.from(found);
}

/** Normalize a Google rating (0–5) to a 0–100 scale. */
function normalizeRating(rating: number | null | undefined): number {
  if (!rating || rating <= 0) return 0;
  return Math.min((rating / 5) * 100, 100);
}

/** Normalize review count to 0–100 scale. Cap at 500 reviews for full score. */
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

/** Get category relevance score (0–100). */
function getCategoryRelevance(category: string | null | undefined): number {
  if (!category) return 50;
  const key = category.toLowerCase().replace(/\s+/g, "_");
  if (CATEGORY_RELEVANCE[key] !== undefined) return CATEGORY_RELEVANCE[key];
  for (const [k, v] of Object.entries(CATEGORY_RELEVANCE)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return 50;
}

/**
 * Calculate the full qualification score and breakdown for a lead.
 *
 * @param lienTexts - Array of text fields to scan for lien signals
 *   (e.g. reviews, website URL, business description, name)
 */
export function calculateScore(params: {
  rating: number | null | undefined;
  reviewCount: number | null | undefined;
  distanceMiles: number | null | undefined;
  category: string | null | undefined;
  lienTexts?: (string | null | undefined)[];
}): ScoreBreakdown {
  const ratingRaw    = normalizeRating(params.rating);
  const reviewRaw    = normalizeReviewCount(params.reviewCount);
  const proximityRaw = normalizeProximity(params.distanceMiles);
  const categoryRaw  = getCategoryRelevance(params.category);

  // Lien detection
  const lienSignals  = detectLienSignals(params.lienTexts ?? []);
  const lienFriendly = lienSignals.length > 0;

  // Lien score: 10 pts max — scale by number of distinct signals (capped at 5)
  const lienRaw = lienFriendly ? Math.min(lienSignals.length / 5, 1) * 100 : 0;

  // Apply weights (sum = 100)
  const ratingScore    = Math.round(ratingRaw    * 0.25);
  const reviewScore    = Math.round(reviewRaw    * 0.25);
  const proximityScore = Math.round(proximityRaw * 0.20);
  const categoryScore  = Math.round(categoryRaw  * 0.20);
  const lienScore      = Math.round(lienRaw      * 0.10);

  const total = Math.min(100, ratingScore + reviewScore + proximityScore + categoryScore + lienScore);

  // Lien-friendly facilities get a 5-pt tier bonus (lower threshold)
  const tierBonus = lienFriendly ? 5 : 0;
  let tier: "hot" | "warm" | "cold";
  if (total + tierBonus >= 70) tier = "hot";
  else if (total + tierBonus >= 40) tier = "warm";
  else tier = "cold";

  return {
    ratingScore,
    reviewScore,
    proximityScore,
    categoryScore,
    lienScore,
    total,
    tier,
    lienFriendly,
    lienSignals,
  };
}
