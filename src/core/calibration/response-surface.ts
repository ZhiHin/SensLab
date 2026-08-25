import { quadraticVertex, weightedPolynomialFit } from "../statistics";
import { logSensitivity } from "../types/brand";
import type { CalibrationDecision } from "../types/vocabulary";
import { clipBracket } from "./bracket";
import type { CandidateEstimate, ResponseSurfaceFit, SearchBracket } from "./contracts";

/**
 * The response-surface fit and the next bracket (doc 13 §13.8).
 *
 * ## Why a quadratic, and why weighted
 *
 * The response is assumed single-peaked, and a quadratic is the lowest-order model that has a
 * *location* for its peak rather than merely an ordering. Weights are inverse-variance, so a
 * candidate measured with a large standard error moves the curve less than a well-measured one —
 * without which a single noisy candidate at the bracket edge could drag the vertex across the
 * whole domain.
 *
 * ## Why estimates are pooled across rounds
 *
 * Pooling is only legitimate because `g(b)` has already removed the time effect (doc 13 §13.7).
 * Given that, the fit has three points after round 1, six after round 2 and nine plus the anchor
 * after round 3 — which is what makes a quadratic worth fitting at all rather than a curve drawn
 * through exactly as many points as it has parameters.
 *
 * ## The fallback is not a fallback to a guess
 *
 * When the fit comes out convex — no peak — the engine **does not force one**. It shifts the
 * bracket toward the best candidate and says the curve was not concave. Manufacturing a peak
 * from a convex fit would produce a confident recommendation with no evidence behind it, which
 * is the specific failure this product exists to avoid (`SENS-BR-017`).
 */

export interface SurfaceInput {
  readonly estimates: readonly CandidateEstimate[];
  readonly bracket: SearchBracket;
  readonly domainLow: number;
  readonly domainHigh: number;
  /** Physical upper bound on x, if any — the slowest sensitivity the player can execute. */
  readonly constraintHigh: number | null;
  readonly narrowing: {
    readonly gamma: number;
    readonly minHalfWidth: number;
    readonly conservativeGamma: number;
    readonly vertexClipFactor: number;
  };
}

export interface SurfaceOutcome {
  readonly fit: ResponseSurfaceFit | null;
  readonly decision: Extract<CalibrationDecision, "narrow" | "narrow_conservative" | "shift">;
  readonly nextBracket: SearchBracket;
  /** The unconstrained vertex, before clipping. Reported when the constraint bites. */
  readonly unclippedVertexX: number | null;
}

/** Fits the weighted quadratic. Returns null when there are too few usable estimates. */
export function fitResponseSurface(
  estimates: readonly CandidateEstimate[],
): ResponseSurfaceFit | null {
  const usable = estimates.filter(
    (estimate) => !estimate.insufficient && Number.isFinite(estimate.alphaHat),
  );
  // Three points is the minimum for a quadratic. With fewer, the honest answer is that the shape
  // is unknown — not a line pretending to be a curve.
  if (usable.length < 3) return null;

  const x = usable.map((estimate) => estimate.x as number);
  const y = usable.map((estimate) => estimate.alphaHat);
  const weights = usable.map((estimate) => {
    const se = estimate.standardError;
    // A zero standard error would give one point infinite leverage. Falling back to an equal
    // weight is the conservative reading of "we could not estimate this candidate's precision".
    return se > 0 && Number.isFinite(se) ? 1 / (se * se) : 1;
  });

  const outcome = weightedPolynomialFit(x, y, weights, 2);
  if (!outcome.ok) return null;

  const coefficients = outcome.fit.coefficients;
  const vertex = quadraticVertex(coefficients);

  return {
    coefficients,
    concave: vertex?.concave === true,
    rSquaredAdjusted: outcome.fit.adjustedRSquared,
    vertexX: vertex === null || !vertex.concave ? null : logSensitivity(vertex.x),
  };
}

/**
 * Chooses the next bracket from the fit (doc 13 §13.8's decision table).
 *
 * | Condition                                          | Decision              |
 * | -------------------------------------------------- | --------------------- |
 * | concave, vertex inside the tolerated range          | `narrow`              |
 * | concave, vertex outside it                          | `shift`               |
 * | convex/flat, best candidate at an edge              | `shift`               |
 * | convex/flat, best candidate interior                | `narrow_conservative` |
 */
export function decideNextBracket(input: SurfaceInput): SurfaceOutcome {
  const fit = fitResponseSurface(input.estimates);
  const { bracket, narrowing } = input;
  const width = bracket.halfWidth;

  /**
   * Places the next bracket **inside the admissible domain**, not merely centred on a point
   * within it.
   *
   * Clipping the centre alone leaves `centre − halfWidth` outside the bound, and candidates
   * are generated at the bracket's ends (doc 13 §13.5) — so a search that walked into the
   * floor tested sensitivities the product documents as inadmissible, and could fit a curve
   * across them. `clipBracket` slides the whole bracket inside instead, which is what it
   * exists for (doc 13 §13.3).
   */
  const place = (centre: number, halfWidth: number): SearchBracket =>
    clipBracket(
      {
        centre: logSensitivity(centre),
        halfWidth,
        domainLow: logSensitivity(input.domainLow),
        domainHigh: logSensitivity(input.domainHigh),
        constraintHigh: input.constraintHigh === null ? null : logSensitivity(input.constraintHigh),
      },
      narrowing.minHalfWidth,
    );

  const best = bestEstimate(input.estimates);

  if (fit !== null && fit.concave && fit.vertexX !== null) {
    const vertexX = fit.vertexX as number;
    const tolerance = narrowing.vertexClipFactor * width;
    const inside =
      vertexX >= (bracket.low as number) - tolerance &&
      vertexX <= (bracket.high as number) + tolerance;

    if (inside) {
      const halfWidth = Math.max(narrowing.gamma * width, narrowing.minHalfWidth);
      return {
        fit,
        decision: "narrow",
        nextBracket: place(vertexX, halfWidth),
        unclippedVertexX: vertexX,
      };
    }

    // The vertex is outside the tolerated range, which means the quadratic is extrapolating far
    // beyond the evidence. Moving one half-width toward it is a step, not a leap — the next
    // round measures there rather than assuming it.
    const direction = vertexX > (bracket.centre as number) ? 1 : -1;
    return {
      fit,
      decision: "shift",
      nextBracket: place((bracket.centre as number) + direction * width, width),
      unclippedVertexX: vertexX,
    };
  }

  // Convex, flat, or unfittable. There is no peak to narrow onto.
  if (best === null) {
    return { fit, decision: "shift", nextBracket: bracket, unclippedVertexX: null };
  }

  const bestX = best.x as number;
  const atEdge =
    Math.abs(bestX - (bracket.low as number)) < 1e-9 ||
    Math.abs(bestX - (bracket.high as number)) < 1e-9;

  if (atEdge) {
    const direction = bestX > (bracket.centre as number) ? 1 : -1;
    return {
      fit,
      decision: "shift",
      nextBracket: place((bracket.centre as number) + direction * width, width),
      unclippedVertexX: null,
    };
  }

  // Interior best with no concavity: narrow, but conservatively. A full narrow would claim the
  // curve has a shape the fit did not find.
  return {
    fit,
    decision: "narrow_conservative",
    nextBracket: place(
      bestX,
      Math.max(narrowing.conservativeGamma * width, narrowing.minHalfWidth),
    ),
    unclippedVertexX: null,
  };
}

/**
 * The best-scoring usable estimate.
 *
 * When two candidates tie, the midpoint is returned rather than one of them — doc 13 §13.13 is
 * explicit that a tie is spanned, not resolved by a coin flip.
 */
export function bestEstimate(estimates: readonly CandidateEstimate[]): CandidateEstimate | null {
  const usable = estimates.filter((estimate) => !estimate.insufficient);
  if (usable.length === 0) return null;

  let best = usable[0] as CandidateEstimate;
  for (const estimate of usable) {
    if (estimate.alphaHat > best.alphaHat) best = estimate;
  }

  const tied = usable.filter((estimate) => Math.abs(estimate.alphaHat - best.alphaHat) < 1e-12);
  if (tied.length < 2) return best;

  const midpoint = tied.reduce((sum, estimate) => sum + (estimate.x as number), 0) / tied.length;
  return { ...best, x: logSensitivity(midpoint) };
}
