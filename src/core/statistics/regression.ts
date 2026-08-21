import { el } from "./descriptive";
import { solveLinearSystem } from "./linear-algebra";

/**
 * Weighted polynomial least squares.
 *
 * This is the machinery behind the response-surface fit in doc 13 §13.8: candidate scores
 * are fitted with a weighted quadratic in log-sensitivity, weighted by inverse variance, and
 * the vertex of that quadratic is the estimated optimum.
 *
 * Phase 1 provides the mathematics and its tests. The calibration engine that *uses* it
 * (bracket management, narrowing, stopping) is Phase 4.
 */

export interface PolynomialFit {
  /** Coefficients in ascending power order: `y = c[0] + c[1]x + c[2]x² + …`. */
  readonly coefficients: readonly number[];
  readonly degree: number;
  /** Weighted coefficient of determination. */
  readonly rSquared: number;
  /**
   * Weighted adjusted R². `null` when there are no residual degrees of freedom — a
   * saturated fit must not be rewarded for being saturated (doc 15 §15.2, C6).
   */
  readonly adjustedRSquared: number | null;
  /** Pivot-magnitude ratio from the solve; a large value means an ill-conditioned design. */
  readonly conditionEstimate: number;
  readonly sampleCount: number;
}

export type PolynomialFitFailure =
  | { readonly kind: "insufficient_points"; readonly required: number; readonly received: number }
  | { readonly kind: "singular_design" }
  | { readonly kind: "invalid_weights" };

export type PolynomialFitOutcome =
  | { readonly ok: true; readonly fit: PolynomialFit }
  | { readonly ok: false; readonly failure: PolynomialFitFailure };

/** Evaluates a polynomial given ascending-power coefficients (Horner's method). */
export function evaluatePolynomial(coefficients: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coefficients.length - 1; i >= 0; i -= 1) {
    acc = acc * x + el(coefficients, i);
  }
  return acc;
}

/**
 * Fits `y ≈ Σ cᵢ xⁱ` by weighted least squares.
 *
 * Weights are inverse-variance in practice: a candidate measured with a large standard
 * error should move the curve less than a well-measured one.
 */
export function weightedPolynomialFit(
  x: readonly number[],
  y: readonly number[],
  weights: readonly number[],
  degree: number,
): PolynomialFitOutcome {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new RangeError(`weightedPolynomialFit() requires an integer degree >= 1, got ${degree}`);
  }
  if (x.length !== y.length || x.length !== weights.length) {
    throw new RangeError("weightedPolynomialFit() requires x, y and weights of equal length");
  }

  const terms = degree + 1;
  if (x.length < terms) {
    return {
      ok: false,
      failure: { kind: "insufficient_points", required: terms, received: x.length },
    };
  }

  let totalWeight = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = el(weights, i);
    if (!Number.isFinite(w) || w < 0) return { ok: false, failure: { kind: "invalid_weights" } };
    totalWeight += w;
  }
  if (totalWeight <= 0) return { ok: false, failure: { kind: "invalid_weights" } };

  // Powers of x up to 2*degree, and weighted cross-products with y.
  const momentCount = 2 * degree + 1;
  const moments = new Array<number>(momentCount).fill(0);
  const projections = new Array<number>(terms).fill(0);

  for (let i = 0; i < x.length; i += 1) {
    const xi = el(x, i);
    const yi = el(y, i);
    const wi = el(weights, i);
    let power = 1;
    for (let k = 0; k < momentCount; k += 1) {
      moments[k] = (moments[k] as number) + wi * power;
      if (k < terms) projections[k] = (projections[k] as number) + wi * yi * power;
      power *= xi;
    }
  }

  const normal: number[][] = [];
  for (let r = 0; r < terms; r += 1) {
    const row = new Array<number>(terms);
    for (let c = 0; c < terms; c += 1) row[c] = moments[r + c] as number;
    normal.push(row);
  }

  const solved = solveLinearSystem(normal, projections);
  if (solved === null) return { ok: false, failure: { kind: "singular_design" } };

  const coefficients = solved.solution;

  // Weighted R².
  let weightedYSum = 0;
  for (let i = 0; i < y.length; i += 1) weightedYSum += el(weights, i) * el(y, i);
  const weightedYMean = weightedYSum / totalWeight;

  let residualSS = 0;
  let totalSS = 0;
  for (let i = 0; i < y.length; i += 1) {
    const wi = el(weights, i);
    const residual = el(y, i) - evaluatePolynomial(coefficients, el(x, i));
    const deviation = el(y, i) - weightedYMean;
    residualSS += wi * residual * residual;
    totalSS += wi * deviation * deviation;
  }

  const rSquared = totalSS === 0 ? 1 : 1 - residualSS / totalSS;
  const residualDf = x.length - terms;
  const adjustedRSquared =
    residualDf > 0 && totalSS !== 0
      ? 1 - residualSS / residualDf / (totalSS / (x.length - 1))
      : null;

  return {
    ok: true,
    fit: {
      coefficients,
      degree,
      rSquared,
      adjustedRSquared,
      conditionEstimate: solved.pivotRatio,
      sampleCount: x.length,
    },
  };
}

export interface QuadraticVertex {
  readonly x: number;
  readonly y: number;
  /** True when the leading coefficient is negative, i.e. the vertex is a maximum. */
  readonly concave: boolean;
}

/**
 * Vertex of a fitted quadratic `c0 + c1 x + c2 x²`.
 *
 * Returns null when `c2` is numerically zero (the fit is effectively a straight line and
 * has no vertex). A non-concave vertex is returned with `concave: false` rather than
 * suppressed — the calibration engine needs to *know* the fit was convex so it can take
 * the documented bracketing fallback rather than inventing a peak (doc 13 §13.8).
 */
export function quadraticVertex(coefficients: readonly number[]): QuadraticVertex | null {
  if (coefficients.length < 3) {
    throw new RangeError("quadraticVertex() requires at least three coefficients");
  }
  const c1 = el(coefficients, 1);
  const c2 = el(coefficients, 2);
  if (Math.abs(c2) < 1e-12) return null;
  const x = -c1 / (2 * c2);
  return { x, y: evaluatePolynomial(coefficients, x), concave: c2 < 0 };
}
