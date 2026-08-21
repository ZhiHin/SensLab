import { describe, expect, it } from "vitest";
import {
  evaluatePolynomial,
  quadraticVertex,
  weightedPolynomialFit,
} from "@/core/statistics/regression";
import { solveLinearSystem, solveTridiagonal } from "@/core/statistics/linear-algebra";

const unwrapFit = (outcome: ReturnType<typeof weightedPolynomialFit>) => {
  if (!outcome.ok) throw new Error(`expected a fit, got ${outcome.failure.kind}`);
  return outcome.fit;
};

describe("solveLinearSystem", () => {
  it("solves a well-conditioned system", () => {
    const result = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(result).not.toBeNull();
    expect(result?.solution[0]).toBeCloseTo(1, 10);
    expect(result?.solution[1]).toBeCloseTo(3, 10);
  });

  it("uses partial pivoting so a zero leading pivot is not fatal", () => {
    const result = solveLinearSystem(
      [
        [0, 2],
        [1, 1],
      ],
      [4, 3],
    );
    expect(result?.solution[0]).toBeCloseTo(1, 10);
    expect(result?.solution[1]).toBeCloseTo(2, 10);
  });

  it("returns null for a singular system rather than producing nonsense", () => {
    expect(
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
  });

  it("reports a pivot ratio that grows with ill-conditioning", () => {
    const good = solveLinearSystem(
      [
        [1, 0],
        [0, 1],
      ],
      [1, 1],
    );
    const poor = solveLinearSystem(
      [
        [1, 1],
        [1, 1.000001],
      ],
      [2, 2],
    );
    expect(good?.pivotRatio).toBeCloseTo(1, 6);
    expect(poor?.pivotRatio).toBeGreaterThan(good?.pivotRatio ?? 0);
  });

  it("rejects a dimension mismatch", () => {
    expect(() => solveLinearSystem([[1, 2]], [1, 2])).toThrow(RangeError);
  });
});

describe("solveTridiagonal", () => {
  it("solves a diagonally dominant system", () => {
    // 2x0 + x1 = 3 ; x0 + 2x1 + x2 = 4 ; x1 + 2x2 = 3  →  x = [1, 1, 1]
    const x = solveTridiagonal([0, 1, 1], [2, 2, 2], [1, 1, 0], [3, 4, 3]);
    expect(x).not.toBeNull();
    expect(x?.[0]).toBeCloseTo(1, 10);
    expect(x?.[1]).toBeCloseTo(1, 10);
    expect(x?.[2]).toBeCloseTo(1, 10);
  });

  it("returns null when a pivot vanishes", () => {
    expect(solveTridiagonal([0, 0], [0, 1], [0, 0], [1, 1])).toBeNull();
  });

  it("rejects arrays of unequal length", () => {
    expect(() => solveTridiagonal([0], [1, 2], [0, 0], [1, 1])).toThrow(RangeError);
  });
});

describe("evaluatePolynomial", () => {
  it("evaluates in ascending power order", () => {
    // 1 + 2x + 3x²  at x = 2  →  1 + 4 + 12 = 17
    expect(evaluatePolynomial([1, 2, 3], 2)).toBe(17);
  });

  it("returns zero for an empty coefficient list", () => {
    expect(evaluatePolynomial([], 5)).toBe(0);
  });
});

describe("weightedPolynomialFit", () => {
  it("recovers a noiseless quadratic exactly", () => {
    const truth = [3, -4, 2]; // 3 - 4x + 2x²
    const x = [-2, -1, 0, 1, 2, 3];
    const y = x.map((v) => evaluatePolynomial(truth, v));
    const fit = unwrapFit(
      weightedPolynomialFit(
        x,
        y,
        x.map(() => 1),
        2,
      ),
    );

    expect(fit.coefficients[0]).toBeCloseTo(3, 8);
    expect(fit.coefficients[1]).toBeCloseTo(-4, 8);
    expect(fit.coefficients[2]).toBeCloseTo(2, 8);
    expect(fit.rSquared).toBeCloseTo(1, 8);
    expect(fit.sampleCount).toBe(6);
  });

  it("lets a high-weight point dominate a low-weight one", () => {
    const x = [0, 1, 2];
    const y = [0, 10, 0];
    const trusted = unwrapFit(weightedPolynomialFit(x, y, [1, 1000, 1], 2));
    const untrusted = unwrapFit(weightedPolynomialFit(x, y, [1000, 1, 1000], 2));
    expect(evaluatePolynomial(trusted.coefficients, 1)).toBeCloseTo(10, 6);
    expect(Math.abs(evaluatePolynomial(untrusted.coefficients, 1))).toBeLessThan(10);
  });

  it("reports adjusted R² only when residual degrees of freedom exist", () => {
    const saturated = unwrapFit(weightedPolynomialFit([0, 1, 2], [1, 2, 5], [1, 1, 1], 2));
    expect(saturated.adjustedRSquared).toBeNull();

    const overdetermined = unwrapFit(
      weightedPolynomialFit([0, 1, 2, 3, 4], [1, 2, 5, 10, 17], [1, 1, 1, 1, 1], 2),
    );
    expect(overdetermined.adjustedRSquared).not.toBeNull();
    expect(overdetermined.adjustedRSquared ?? 0).toBeCloseTo(1, 6);
  });

  it("refuses to fit with fewer points than parameters", () => {
    const outcome = weightedPolynomialFit([0, 1], [1, 2], [1, 1], 2);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe("insufficient_points");
      if (outcome.failure.kind === "insufficient_points") {
        expect(outcome.failure.required).toBe(3);
        expect(outcome.failure.received).toBe(2);
      }
    }
  });

  it("reports a singular design instead of returning arbitrary coefficients", () => {
    // All x identical: the design matrix has no rank to fit a slope, let alone curvature.
    const outcome = weightedPolynomialFit([2, 2, 2, 2], [1, 2, 3, 4], [1, 1, 1, 1], 2);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe("singular_design");
  });

  it("rejects invalid weights", () => {
    const negative = weightedPolynomialFit([0, 1, 2], [1, 2, 3], [1, -1, 1], 1);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.failure.kind).toBe("invalid_weights");

    const zeroed = weightedPolynomialFit([0, 1, 2], [1, 2, 3], [0, 0, 0], 1);
    expect(zeroed.ok).toBe(false);
    if (!zeroed.ok) expect(zeroed.failure.kind).toBe("invalid_weights");
  });

  it("validates its arguments", () => {
    expect(() => weightedPolynomialFit([0, 1], [1], [1, 1], 1)).toThrow(RangeError);
    expect(() => weightedPolynomialFit([0, 1], [1, 2], [1, 1], 0)).toThrow(RangeError);
  });
});

describe("quadraticVertex", () => {
  it("locates the maximum of a concave quadratic", () => {
    // -(x - 3)² + 5  →  -4 + 6x - x²
    const vertex = quadraticVertex([-4, 6, -1]);
    expect(vertex).not.toBeNull();
    expect(vertex?.x).toBeCloseTo(3, 10);
    expect(vertex?.y).toBeCloseTo(5, 10);
    expect(vertex?.concave).toBe(true);
  });

  it("reports a convex fit as such rather than hiding it", () => {
    // A convex fit means the data have no peak. The calibration engine must know that so it
    // can take the documented bracketing fallback instead of inventing an optimum.
    const vertex = quadraticVertex([1, -2, 1]);
    expect(vertex?.concave).toBe(false);
    expect(vertex?.x).toBeCloseTo(1, 10);
  });

  it("returns null for an effectively linear fit", () => {
    expect(quadraticVertex([1, 2, 0])).toBeNull();
    expect(quadraticVertex([1, 2, 1e-15])).toBeNull();
  });

  it("requires three coefficients", () => {
    expect(() => quadraticVertex([1, 2])).toThrow(RangeError);
  });
});
