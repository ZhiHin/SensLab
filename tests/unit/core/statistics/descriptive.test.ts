import { describe, expect, it } from "vitest";
import {
  MAD_TO_SD,
  consistencyScore,
  el,
  mean,
  median,
  medianAbsoluteDeviation,
  quantile,
  robustCoefficientOfVariation,
  robustStandardDeviation,
  rootMeanSquare,
  standardDeviation,
  sum,
  timeWeightedMean,
  variance,
  weightedMean,
} from "@/core/statistics/descriptive";

describe("el", () => {
  it("returns the element at a valid index", () => {
    expect(el([3, 5, 8], 1)).toBe(5);
  });

  it("throws rather than yielding undefined for an out-of-range index", () => {
    expect(() => el([1, 2], 5)).toThrow(RangeError);
    expect(() => el([1, 2], -1)).toThrow(RangeError);
  });
});

describe("mean / sum", () => {
  it("computes the arithmetic mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("sums an empty array to zero but refuses to average one", () => {
    expect(sum([])).toBe(0);
    expect(() => mean([])).toThrow(RangeError);
  });

  it("rejects non-finite input rather than propagating NaN", () => {
    expect(() => mean([1, Number.NaN])).toThrow(RangeError);
    expect(() => mean([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });
});

describe("variance / standardDeviation", () => {
  it("uses the Bessel correction", () => {
    // Sample variance of [2,4,4,4,5,5,7,9] is 4.571428…, population variance is 4.
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(32 / 7, 12);
  });

  it("returns zero for a single observation", () => {
    expect(variance([42])).toBe(0);
    expect(standardDeviation([42])).toBe(0);
  });

  it("throws on an empty sample", () => {
    expect(() => variance([])).toThrow(RangeError);
  });
});

describe("rootMeanSquare", () => {
  it("computes the quadratic mean", () => {
    expect(rootMeanSquare([3, 4])).toBeCloseTo(Math.sqrt(12.5), 12);
  });

  it("rejects empty and non-finite input", () => {
    expect(() => rootMeanSquare([])).toThrow(RangeError);
    expect(() => rootMeanSquare([1, Number.NaN])).toThrow(RangeError);
  });
});

describe("quantile", () => {
  it("matches the type-7 definition used by R and NumPy", () => {
    const values = [1, 2, 3, 4];
    expect(quantile(values, 0)).toBe(1);
    expect(quantile(values, 1)).toBe(4);
    expect(quantile(values, 0.5)).toBe(2.5);
    // position = 0.25 * 3 = 0.75 → 1 + 0.75*(2-1) = 1.75
    expect(quantile(values, 0.25)).toBeCloseTo(1.75, 12);
  });

  it("does not mutate its input", () => {
    const values = [5, 1, 3];
    quantile(values, 0.5);
    expect(values).toEqual([5, 1, 3]);
  });

  it("handles a single value", () => {
    expect(quantile([7], 0.9)).toBe(7);
  });

  it("rejects probabilities outside [0, 1]", () => {
    expect(() => quantile([1, 2], 1.5)).toThrow(RangeError);
    expect(() => quantile([1, 2], -0.1)).toThrow(RangeError);
  });
});

describe("median", () => {
  it("averages the two middle values for an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns the middle value for an odd count", () => {
    expect(median([9, 1, 5])).toBe(5);
  });
});

describe("medianAbsoluteDeviation and robust scale", () => {
  it("computes MAD about the median", () => {
    // median = 3; deviations = [2,1,0,1,2]; MAD = 1
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
  });

  it("scales MAD by the normal-consistency constant", () => {
    expect(robustStandardDeviation([1, 2, 3, 4, 5])).toBeCloseTo(MAD_TO_SD, 12);
  });

  it("is unmoved by a single extreme outlier, unlike the standard deviation", () => {
    const clean = [10, 11, 12, 13, 14];
    const contaminated = [10, 11, 12, 13, 900];
    expect(robustStandardDeviation(contaminated)).toBe(robustStandardDeviation(clean));
    expect(standardDeviation(contaminated)).toBeGreaterThan(standardDeviation(clean) * 50);
  });
});

describe("robustCoefficientOfVariation and consistencyScore", () => {
  it("is zero for a perfectly repeatable player", () => {
    expect(robustCoefficientOfVariation([5, 5, 5, 5])).toBe(0);
    expect(consistencyScore([5, 5, 5, 5])).toBe(1);
  });

  it("grows with spread and drives consistency down", () => {
    const tight = consistencyScore([100, 101, 99, 100]);
    const loose = consistencyScore([100, 140, 60, 130]);
    expect(tight).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0);
    expect(tight).toBeLessThanOrEqual(1);
  });

  it("uses the median floor rather than dividing by zero", () => {
    const value = robustCoefficientOfVariation([-1, 0, 1]);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  });

  it("throws on an empty sample", () => {
    expect(() => consistencyScore([])).toThrow(RangeError);
  });
});

describe("weightedMean / timeWeightedMean", () => {
  it("weights values as expected", () => {
    expect(weightedMean([1, 3], [1, 3])).toBe(2.5);
  });

  it("equals the plain mean when weights are equal", () => {
    expect(weightedMean([2, 4, 6], [1, 1, 1])).toBe(4);
  });

  it("weights tracking samples by the interval they represent", () => {
    // A frame that lasted three times as long must count three times as much.
    expect(timeWeightedMean([0, 1], [3, 1])).toBe(0.25);
  });

  it("rejects mismatched lengths, negative weights and zero total weight", () => {
    expect(() => weightedMean([1, 2], [1])).toThrow(RangeError);
    expect(() => weightedMean([1, 2], [1, -1])).toThrow(RangeError);
    expect(() => weightedMean([1, 2], [0, 0])).toThrow(RangeError);
    expect(() => weightedMean([], [])).toThrow(RangeError);
  });
});
