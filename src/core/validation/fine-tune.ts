import type { CalibrationResult, CandidateEstimate } from "../calibration/contracts";
import { fitResponseSurface } from "../calibration/response-surface";
import { logSensitivity } from "../types/brand";
import type { ValidationOutcome } from "./analysis";

/**
 * Fine-tuning (doc 17 §17.7, FR-089, `SENS-BR-007`).
 *
 * ```
 *   candidates:  x* + { −δ₂, −δ₁, 0, +δ₁, +δ₂ }
 *   phase 1:     one screening block per candidate → fit the same quadratic → keep the top two
 *   phase 2:     the top two duel in paired blocks; stop early once the interval excludes zero
 *   output:      the same engine, run over everything measured, refines the estimate — or the
 *                original held up and nothing changed
 * ```
 *
 * The labels "Lower / Slightly lower / Recommended / Slightly higher / Higher" are **revealed
 * only after the run**. During it the player sees blind labels in a seeded order, so nobody
 * can anchor on "Recommended".
 */

export const FINE_TUNE_LABELS: readonly string[] = Object.freeze([
  "Lower",
  "Slightly lower",
  "Recommended",
  "Slightly higher",
  "Higher",
]);

export interface FineTuneCandidateSpec {
  /** Position in the offset table — what the reveal label is keyed on. */
  readonly offsetIndex: number;
  readonly offset: number;
  readonly x: number;
  readonly revealLabel: string;
}

/**
 * The five candidates around `x*`, clipped to the admissible range.
 *
 * A candidate the clip moves onto another is dropped rather than measured twice: a duplicate
 * sensitivity under two blind labels would be a test of the labels, not of the sensitivity.
 */
export function fineTuneCandidates(
  xStar: number,
  offsets: readonly number[],
  bounds: { readonly low: number; readonly high: number },
): readonly FineTuneCandidateSpec[] {
  const specs: FineTuneCandidateSpec[] = [];
  const seen = new Set<number>();
  offsets.forEach((offset, offsetIndex) => {
    const x = Math.min(bounds.high, Math.max(bounds.low, xStar + offset));
    const key = Math.round(x * 1e9);
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({
      offsetIndex,
      offset,
      x,
      revealLabel: FINE_TUNE_LABELS[offsetIndex] ?? `Offset ${offset}`,
    });
  });
  return specs;
}

export interface ScreeningEstimate {
  readonly candidateIndex: number;
  readonly x: number;
  readonly mean: number;
  readonly standardError: number;
  readonly trials: number;
}

/**
 * Ranks the screening candidates, best first.
 *
 * The same quadratic the calibration fits, evaluated at each candidate: with one short block
 * each, the fit pools the five blocks into one shape estimate and is less noisy than any
 * single block's mean. When the fit is not concave — nothing to pool around — the observed
 * means rank instead.
 */
export function screeningRanking(estimates: readonly ScreeningEstimate[]): readonly number[] {
  const asEstimates: CandidateEstimate[] = estimates.map((estimate) => ({
    candidateIndex: estimate.candidateIndex,
    roundIndex: 0,
    x: logSensitivity(estimate.x),
    alphaHat: estimate.mean,
    standardError: estimate.standardError,
    validTrials: estimate.trials,
    insufficient: false,
  }));
  const fit = fitResponseSurface(asEstimates);
  const value = (estimate: ScreeningEstimate): number => {
    if (fit === null || !fit.concave) return estimate.mean;
    const [b0 = 0, b1 = 0, b2 = 0] = fit.coefficients;
    return b0 + b1 * estimate.x + b2 * estimate.x * estimate.x;
  };
  return [...estimates]
    .sort((a, b) => value(b) - value(a) || a.candidateIndex - b.candidateIndex)
    .map((estimate) => estimate.candidateIndex);
}

export interface DuelDecision {
  readonly stop: boolean;
  /** Which arm the paired interval favours when it excludes zero; null otherwise. */
  readonly winner: "A" | "B" | null;
  readonly reason: "interval_excludes_zero" | "budget_reached" | "continue";
}

/**
 * The early-stopping rule: after each counterbalanced quartet, stop if the paired interval
 * excludes zero; otherwise continue to the budget. Pre-specified, with a fixed maximum, so the
 * number of looks is bounded by `quartetBudget` and recoverable from the stored blocks.
 */
export function duelDecision(
  outcome: ValidationOutcome,
  quartetsRun: number,
  quartetBudget: number,
): DuelDecision {
  if (outcome.kind === "analysed" && outcome.verdict !== "no_measurable_difference") {
    return {
      stop: true,
      winner: outcome.verdict === "improved" ? "B" : "A",
      reason: "interval_excludes_zero",
    };
  }
  if (quartetsRun >= quartetBudget) return { stop: true, winner: null, reason: "budget_reached" };
  return { stop: false, winner: null, reason: "continue" };
}

/**
 * Did the original recommendation hold up?
 *
 * It did unless the refined estimate both found a peak and placed the original outside its
 * credible interval. Anything less — no peak, or the original inside the new interval — is
 * "nothing changed", which doc 17 §17.7 expects to be the common and legitimate outcome.
 */
export function originalHeldUp(refined: CalibrationResult, parentXStar: number): boolean {
  if (refined.verdict !== "peak_found" || refined.credibleInterval === null) return true;
  return (
    parentXStar >= refined.credibleInterval.low && parentXStar <= refined.credibleInterval.high
  );
}
