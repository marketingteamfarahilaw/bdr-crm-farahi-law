export interface ScoreBreakdown {
  ratingScore: number;
  reviewScore: number;
  proximityScore: number;
  categoryScore: number;
  lienScore: number;
  total: number;
  tier: "hot" | "warm" | "cold";
  lienFriendly: boolean;
  lienSignals: string[];
}

export interface Lead {
  placeId: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  email: string | null;
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
  qualificationScore: number;
  scoreTier: "hot" | "warm" | "cold";
  scoreBreakdown: ScoreBreakdown;
  lienFriendly: boolean;
  lienSignals: string[];
  lienTexts: string[];
}

export const CATEGORIES = [
  { value: "body_shop", label: "Auto Body Shops" },
  { value: "chiropractor", label: "Chiropractors" },
  { value: "physical_therapist", label: "Physical Therapists" },
  { value: "medical_clinic", label: "Medical Clinics" },
  { value: "orthopedic_doctor", label: "Orthopedic Doctors" },
  { value: "imaging_center", label: "Imaging Centers" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export function getCategoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
