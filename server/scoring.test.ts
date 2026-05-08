import { describe, expect, it } from "vitest";
import { calculateScore } from "./scoring";

describe("calculateScore", () => {
  it("returns a total between 0 and 100", () => {
    const result = calculateScore({
      rating: 4.5,
      reviewCount: 200,
      distanceMiles: 5,
      category: "body_shop",
    });
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("assigns 'hot' tier for high-scoring leads", () => {
    const result = calculateScore({
      rating: 5,
      reviewCount: 500,
      distanceMiles: 0,
      category: "chiropractor",
    });
    expect(result.tier).toBe("hot");
    expect(result.total).toBeGreaterThanOrEqual(70);
  });

  it("assigns 'cold' tier for low-scoring leads", () => {
    const result = calculateScore({
      rating: 1,
      reviewCount: 2,
      distanceMiles: 30,
      category: "imaging_center",
    });
    expect(result.tier).toBe("cold");
    expect(result.total).toBeLessThan(40);
  });

  it("assigns 'warm' tier for mid-range leads", () => {
    const result = calculateScore({
      rating: 3.5,
      reviewCount: 50,
      distanceMiles: 10,
      category: "medical_clinic",
    });
    expect(result.tier).toBe("warm");
    expect(result.total).toBeGreaterThanOrEqual(40);
    expect(result.total).toBeLessThan(70);
  });

  it("score components sum to total", () => {
    const result = calculateScore({
      rating: 4.0,
      reviewCount: 100,
      distanceMiles: 8,
      category: "physical_therapist",
    });
    const sum = result.ratingScore + result.reviewScore + result.proximityScore + result.categoryScore;
    // Allow ±1 due to rounding
    expect(Math.abs(result.total - sum)).toBeLessThanOrEqual(1);
  });

  it("rating component is capped at 30", () => {
    const result = calculateScore({
      rating: 5,
      reviewCount: 0,
      distanceMiles: 0,
      category: "body_shop",
    });
    expect(result.ratingScore).toBeLessThanOrEqual(30);
  });

  it("review component is capped at 30", () => {
    const result = calculateScore({
      rating: 0,
      reviewCount: 10000,
      distanceMiles: 0,
      category: "body_shop",
    });
    expect(result.reviewScore).toBeLessThanOrEqual(30);
  });

  it("proximity component is capped at 20", () => {
    const result = calculateScore({
      rating: 0,
      reviewCount: 0,
      distanceMiles: 0,
      category: "body_shop",
    });
    expect(result.proximityScore).toBeLessThanOrEqual(20);
  });

  it("category component is capped at 20", () => {
    const result = calculateScore({
      rating: 0,
      reviewCount: 0,
      distanceMiles: 0,
      category: "chiropractor",
    });
    expect(result.categoryScore).toBeLessThanOrEqual(20);
  });

  it("handles null/undefined inputs gracefully", () => {
    const result = calculateScore({
      rating: null,
      reviewCount: null,
      distanceMiles: null,
      category: null,
    });
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(["hot", "warm", "cold"]).toContain(result.tier);
  });

  it("25+ mile distance yields 0 proximity score", () => {
    const result = calculateScore({
      rating: 0,
      reviewCount: 0,
      distanceMiles: 30,
      category: null,
    });
    expect(result.proximityScore).toBe(0);
  });
});
