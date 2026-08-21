import { describe, expect, it } from "vitest";
import { cyrb128, deriveRng, sfc32 } from "@/core/random";

describe("cyrb128", () => {
  it("is deterministic", () => {
    expect(cyrb128("senslab")).toEqual(cyrb128("senslab"));
  });

  it("decorrelates near-identical inputs", () => {
    const a = cyrb128("session-1::flick::0");
    const b = cyrb128("session-1::flick::1");
    expect(a).not.toEqual(b);
    // At least three of the four words should differ; a weak mixer would leave them close.
    const differing = a.filter((word, i) => word !== b[i]).length;
    expect(differing).toBeGreaterThanOrEqual(3);
  });

  it("produces unsigned 32-bit words", () => {
    for (const word of cyrb128("x")) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("sfc32", () => {
  it("yields values in [0, 1)", () => {
    const rng = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is reproducible from the same state", () => {
    const a = sfc32(9, 8, 7, 6);
    const b = sfc32(9, 8, 7, 6);
    for (let i = 0; i < 100; i += 1) expect(a.next()).toBe(b.next());
  });

  it("is roughly uniform across deciles", () => {
    const rng = sfc32(11, 22, 33, 44);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) {
      const bucket = Math.floor(rng.next() * 10);
      buckets[bucket] = (buckets[bucket] as number) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - draws / 100);
      expect(count).toBeLessThan(draws / 10 + draws / 100);
    }
  });

  it("draws integers inside the bound", () => {
    const rng = sfc32(5, 5, 5, 5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.nextInt(7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      seen.add(value);
    }
    expect(seen.size).toBe(7);
  });

  it("rejects an invalid integer bound", () => {
    const rng = sfc32(1, 1, 1, 1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });

  it("draws within an arbitrary range", () => {
    const rng = sfc32(2, 4, 6, 8);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextRange(-5, 12);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(12);
    }
  });

  it("picks from a non-empty array and refuses an empty one", () => {
    const rng = sfc32(3, 1, 4, 1);
    const values = ["a", "b", "c"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(rng.pick(values));
    expect(seen.size).toBe(3);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("shuffles without mutating the input and preserves multiset membership", () => {
    const rng = sfc32(7, 7, 7, 7);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it("produces different orderings across successive shuffles", () => {
    const rng = sfc32(13, 17, 19, 23);
    const input = Array.from({ length: 12 }, (_, i) => i);
    const orderings = new Set<string>();
    for (let i = 0; i < 20; i += 1) orderings.add(rng.shuffle(input).join(","));
    expect(orderings.size).toBeGreaterThan(15);
  });
});

describe("deriveRng — stream separation (doc 19 §19.8)", () => {
  it("reproduces the same sequence for the same seed and stream", () => {
    const a = deriveRng(4242n, "target-placement", 1, 3);
    const b = deriveRng(4242n, "target-placement", 1, 3);
    for (let i = 0; i < 50; i += 1) expect(a.next()).toBe(b.next());
  });

  it("accepts numeric and bigint seeds interchangeably by value", () => {
    const a = deriveRng(99, "s");
    const b = deriveRng(99n, "s");
    expect(a.next()).toBe(b.next());
  });

  it("gives independent sequences to different streams from one seed", () => {
    const placement = deriveRng(1, "target-placement");
    const timing = deriveRng(1, "timing-jitter");
    const first = Array.from({ length: 20 }, () => placement.next());
    const second = Array.from({ length: 20 }, () => timing.next());
    expect(first).not.toEqual(second);
  });

  it("gives independent sequences to different indices within a stream", () => {
    const trial0 = Array.from({ length: 10 }, () => deriveRng(1, "placement", 0).next());
    const trial1 = Array.from({ length: 10 }, () => deriveRng(1, "placement", 1).next());
    expect(trial0[0]).not.toBe(trial1[0]);
  });

  it("supports the paired-stimulus design: candidate i and j draw identically for trial k", () => {
    // doc 13 §13.6 — matched seeds across candidates within a round remove stimulus variance
    // from the comparison. The stream key deliberately excludes the candidate index.
    const round = 2;
    const trial = 7;
    const forCandidateA = deriveRng(777, "target-placement", round, trial);
    const forCandidateB = deriveRng(777, "target-placement", round, trial);
    const drawsA = Array.from({ length: 8 }, () => forCandidateA.next());
    const drawsB = Array.from({ length: 8 }, () => forCandidateB.next());
    expect(drawsA).toEqual(drawsB);
  });
});
