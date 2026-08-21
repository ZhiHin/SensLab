import { describe, expect, it } from "vitest";
import { naturalCubicSpline } from "@/core/statistics/spline";
import {
  DEFAULT_RESAMPLES,
  bootstrap,
  pairedBootstrap,
  resampleIndices,
} from "@/core/statistics/bootstrap";
import { median } from "@/core/statistics/descriptive";
import { deriveRng } from "@/core/random";

const unwrapSpline = (outcome: ReturnType<typeof naturalCubicSpline>) => {
  if (!outcome.ok) throw new Error(`expected a spline, got ${outcome.failure.kind}`);
  return outcome.spline;
};

describe("naturalCubicSpline", () => {
  const xs = [0, 1, 2, 3, 4];
  const ys = [0, 0.8, 0.9, 0.1, -0.8];

  it("passes exactly through every knot", () => {
    const spline = unwrapSpline(naturalCubicSpline(xs, ys));
    xs.forEach((x, i) => {
      expect(spline.evaluate(x)).toBeCloseTo(ys[i] as number, 10);
    });
  });

  it("interpolates smoothly between knots", () => {
    const spline = unwrapSpline(naturalCubicSpline(xs, ys));
    const mid = spline.evaluate(0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.9);
    // Continuity: tiny steps produce tiny changes.
    expect(Math.abs(spline.evaluate(1.5) - spline.evaluate(1.5001))).toBeLessThan(1e-3);
  });

  it("tracks a cubic it was sampled from to within the error natural end conditions allow", () => {
    const f = (x: number) => 0.5 * x ** 3 - 2 * x ** 2 + x + 3;
    const knots = [-3, -1.5, 0, 1.5, 3, 4.5];
    const spline = unwrapSpline(naturalCubicSpline(knots, knots.map(f)));

    // A *natural* spline forces the second derivative to zero at both ends, so it cannot
    // reproduce a true cubic exactly — the boundary error propagates inward. That is the
    // correct trade for our use: we have no information about behaviour beyond the observed
    // blocks, and assuming curvature we did not measure would be worse than this error.
    // The guarantee we do rely on is that the interpolant stays close in relative terms.
    const range = Math.abs(f(4.5) - f(-3));
    const relativeError = (x: number) => Math.abs(spline.evaluate(x) - f(x)) / range;

    // Interior, away from both boundaries: within 1% of the function's range.
    expect(relativeError(0.75)).toBeLessThan(0.01);
    expect(relativeError(2.25)).toBeLessThan(0.01);

    // Adjacent to a boundary, where the zero-curvature condition bites hardest: within 3%.
    expect(relativeError(-0.75)).toBeLessThan(0.03);
    expect(relativeError(3.75)).toBeLessThan(0.03);
  });

  it("extends linearly outside the knot range instead of extrapolating a cubic", () => {
    const spline = unwrapSpline(naturalCubicSpline(xs, ys));
    const a = spline.evaluate(-1);
    const b = spline.evaluate(-2);
    const c = spline.evaluate(-3);
    // Equal steps outside the range produce equal differences: a straight line.
    expect(b - a).toBeCloseTo(c - b, 8);

    const p = spline.evaluate(5);
    const q = spline.evaluate(6);
    const r = spline.evaluate(7);
    expect(q - p).toBeCloseTo(r - q, 8);
  });

  it("rejects too few knots, unsorted knots and duplicates", () => {
    const few = naturalCubicSpline([0, 1], [0, 1]);
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.failure.kind).toBe("insufficient_knots");

    const unsorted = naturalCubicSpline([0, 2, 1], [0, 1, 2]);
    expect(unsorted.ok).toBe(false);
    if (!unsorted.ok) expect(unsorted.failure.kind).toBe("unsorted_knots");

    const duplicate = naturalCubicSpline([0, 1, 1], [0, 1, 2]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.failure.kind).toBe("duplicate_knots");
  });

  it("rejects mismatched array lengths", () => {
    expect(() => naturalCubicSpline([0, 1, 2], [0, 1])).toThrow(RangeError);
  });
});

describe("resampleIndices", () => {
  it("produces indices inside the sample range", () => {
    const rng = deriveRng(1234, "test");
    const indices = resampleIndices(50, rng);
    expect(indices).toHaveLength(50);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(50);
    }
  });

  it("rejects a non-positive size", () => {
    expect(() => resampleIndices(0, deriveRng(1, "t"))).toThrow(RangeError);
    expect(() => resampleIndices(2.5, deriveRng(1, "t"))).toThrow(RangeError);
  });
});

describe("bootstrap", () => {
  const sample = [12, 14, 15, 15, 16, 17, 18, 21, 25, 40];

  it("is fully deterministic for a given seed — SENS-BR-031", () => {
    const first = bootstrap(sample, (s) => median([...s]), {
      resamples: 500,
      rng: deriveRng(99, "bootstrap"),
    });
    const second = bootstrap(sample, (s) => median([...s]), {
      resamples: 500,
      rng: deriveRng(99, "bootstrap"),
    });
    expect(second.interval.low).toBe(first.interval.low);
    expect(second.interval.high).toBe(first.interval.high);
    expect(second.standardError).toBe(first.standardError);
  });

  it("differs for a different seed", () => {
    const a = bootstrap(sample, (s) => median([...s]), {
      resamples: 500,
      rng: deriveRng(1, "bootstrap"),
    });
    const b = bootstrap(sample, (s) => median([...s]), {
      resamples: 500,
      rng: deriveRng(2, "bootstrap"),
    });
    expect(a.interval.low === b.interval.low && a.interval.high === b.interval.high).toBe(false);
  });

  it("reports the statistic of the original sample as the point estimate", () => {
    const outcome = bootstrap(sample, (s) => median([...s]), {
      resamples: 200,
      rng: deriveRng(7, "bootstrap"),
    });
    expect(outcome.point).toBe(median(sample));
    expect(outcome.interval.low).toBeLessThanOrEqual(outcome.point);
    expect(outcome.interval.high).toBeGreaterThanOrEqual(outcome.point);
  });

  it("counts non-computable resamples rather than silently coercing them", () => {
    let calls = 0;
    const outcome = bootstrap(
      sample,
      (s) => {
        calls += 1;
        // Fail every third resample (the first call is the original sample).
        return calls % 3 === 0 ? null : median([...s]);
      },
      { resamples: 300, rng: deriveRng(3, "bootstrap") },
    );
    expect(outcome.discarded).toBeGreaterThan(50);
    expect(outcome.estimates.length + outcome.discarded).toBe(300);
  });

  it("returns estimates in ascending order", () => {
    const outcome = bootstrap(sample, (s) => median([...s]), {
      resamples: 100,
      rng: deriveRng(5, "bootstrap"),
    });
    const sorted = [...outcome.estimates].sort((a, b) => a - b);
    expect(outcome.estimates).toEqual(sorted);
  });

  it("refuses to bootstrap an empty sample or an uncomputable statistic", () => {
    expect(() => bootstrap([], () => 1, { resamples: 10, rng: deriveRng(1, "t") })).toThrow(
      RangeError,
    );
    expect(() => bootstrap(sample, () => null, { resamples: 10, rng: deriveRng(1, "t") })).toThrow(
      RangeError,
    );
    expect(() =>
      bootstrap(sample, (s) => median([...s]), { resamples: 1, rng: deriveRng(1, "t") }),
    ).toThrow(RangeError);
  });

  it("exposes a sane default resample count", () => {
    expect(DEFAULT_RESAMPLES).toBe(2000);
  });
});

describe("pairedBootstrap", () => {
  it("detects a real paired difference", () => {
    // Candidate is consistently ~5 better than baseline.
    const pairs = Array.from({ length: 24 }, (_, i) => ({
      baseline: 100 + (i % 5),
      candidate: 105 + (i % 5),
    }));
    const outcome = pairedBootstrap(pairs, { resamples: 500, rng: deriveRng(11, "paired") });
    expect(outcome.point).toBeCloseTo(5, 6);
    expect(outcome.interval.low).toBeGreaterThan(0);
  });

  it("produces an interval spanning zero when there is no difference", () => {
    const pairs = Array.from({ length: 30 }, (_, i) => ({
      baseline: 100 + ((i * 7) % 11),
      candidate: 100 + ((i * 5) % 11),
    }));
    const outcome = pairedBootstrap(pairs, { resamples: 800, rng: deriveRng(13, "paired") });
    expect(outcome.interval.low).toBeLessThanOrEqual(0);
    expect(outcome.interval.high).toBeGreaterThanOrEqual(0);
  });
});
