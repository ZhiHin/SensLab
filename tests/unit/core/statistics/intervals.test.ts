import { describe, expect, it } from "vitest";
import {
  bootstrapStandardError,
  excludesZero,
  intervalsOverlap,
  normalQuantile,
  percentileInterval,
  wilsonInterval,
  zForLevel,
} from "@/core/statistics/intervals";

describe("normalQuantile", () => {
  it("matches published critical values", () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 6);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644853627, 6);
    expect(normalQuantile(0.9)).toBeCloseTo(1.281551566, 6);
    expect(normalQuantile(0.99)).toBeCloseTo(2.326347874, 6);
  });

  it("is antisymmetric about the median", () => {
    for (const p of [0.001, 0.02, 0.1, 0.3, 0.45]) {
      expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 6);
    }
  });

  it("covers the far tails using the alternate branches", () => {
    expect(normalQuantile(0.0001)).toBeCloseTo(-3.719016485, 5);
    expect(normalQuantile(0.9999)).toBeCloseTo(3.719016485, 5);
  });

  it("rejects probabilities at or beyond the boundary", () => {
    expect(() => normalQuantile(0)).toThrow(RangeError);
    expect(() => normalQuantile(1)).toThrow(RangeError);
    expect(() => normalQuantile(-0.2)).toThrow(RangeError);
  });
});

describe("zForLevel", () => {
  it("returns two-sided critical values", () => {
    expect(zForLevel(0.9)).toBeCloseTo(1.644853627, 6);
    expect(zForLevel(0.95)).toBeCloseTo(1.959963985, 6);
    expect(zForLevel(0.8)).toBeCloseTo(1.281551566, 6);
  });

  it("rejects invalid levels", () => {
    expect(() => zForLevel(0)).toThrow(RangeError);
    expect(() => zForLevel(1)).toThrow(RangeError);
  });
});

describe("wilsonInterval", () => {
  it("reports the observed proportion as the point estimate", () => {
    const interval = wilsonInterval(7, 10, 0.9);
    expect(interval.point).toBeCloseTo(0.7, 12);
    expect(interval.level).toBe(0.9);
  });

  it("brackets the observed proportion", () => {
    const interval = wilsonInterval(7, 10, 0.9);
    expect(interval.low).toBeLessThan(0.7);
    expect(interval.high).toBeGreaterThan(0.7);
  });

  it("stays inside [0, 1] at the extremes, where the normal approximation fails", () => {
    const perfect = wilsonInterval(10, 10, 0.95);
    expect(perfect.low).toBeGreaterThan(0);
    expect(perfect.high).toBe(1);

    const zero = wilsonInterval(0, 10, 0.95);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeLessThan(1);
  });

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(5, 10, 0.9);
    const large = wilsonInterval(500, 1000, 0.9);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("rejects impossible counts", () => {
    expect(() => wilsonInterval(3, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 10)).toThrow(RangeError);
  });
});

describe("percentileInterval", () => {
  const samples = Array.from({ length: 101 }, (_, i) => i); // 0..100

  it("takes symmetric tails at the requested level", () => {
    const interval = percentileInterval(samples, 50, 0.9);
    expect(interval.low).toBeCloseTo(5, 6);
    expect(interval.high).toBeCloseTo(95, 6);
    expect(interval.point).toBe(50);
  });

  it("keeps the supplied point estimate rather than the resample mean", () => {
    expect(percentileInterval(samples, 7.5, 0.8).point).toBe(7.5);
  });

  it("rejects empty samples and invalid levels", () => {
    expect(() => percentileInterval([], 1)).toThrow(RangeError);
    expect(() => percentileInterval(samples, 1, 1)).toThrow(RangeError);
  });
});

describe("excludesZero", () => {
  it("is the test behind SENS-BR-016: an interval spanning zero proves nothing", () => {
    expect(excludesZero({ low: 0.2, point: 0.5, high: 0.9, level: 0.9 })).toBe(true);
    expect(excludesZero({ low: -0.9, point: -0.5, high: -0.2, level: 0.9 })).toBe(true);
    expect(excludesZero({ low: -0.1, point: 0.4, high: 0.9, level: 0.9 })).toBe(false);
    expect(excludesZero({ low: 0, point: 0.4, high: 0.9, level: 0.9 })).toBe(false);
  });
});

describe("intervalsOverlap", () => {
  it("detects overlap conservatively, including touching endpoints", () => {
    const a = { low: 1, point: 2, high: 3, level: 0.9 };
    expect(intervalsOverlap(a, { low: 2.5, point: 3, high: 4, level: 0.9 })).toBe(true);
    expect(intervalsOverlap(a, { low: 3, point: 3.5, high: 4, level: 0.9 })).toBe(true);
    expect(intervalsOverlap(a, { low: 3.1, point: 3.5, high: 4, level: 0.9 })).toBe(false);
  });
});

describe("bootstrapStandardError", () => {
  it("equals the sample standard deviation of the resample statistics", () => {
    expect(bootstrapStandardError([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it("requires at least two resamples", () => {
    expect(() => bootstrapStandardError([1])).toThrow(RangeError);
  });
});
