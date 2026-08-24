import { fitValueAt, type ResponseCurve } from "../recommendation/response-curve";

/**
 * Whether validation is offered for a recommendation (doc 17 §17.2).
 *
 * Two arms are needed. Arm B is the recommendation, so a result with no point estimate has
 * nothing to validate. Arm A is the player's stated current sensitivity — or, when they had
 * none, the round-1 bracket centre, in which case validation is offered but framed as
 * "recommended vs your starting point".
 *
 * > If A and B differ by less than the MDE, validation is **not offered**; the result page
 * > states that the recommendation is effectively the user's current sensitivity.
 *
 * "Differ by less than the MDE" is read through the session's own statement of what it could
 * not separate: the credible interval on the peak, shown as the high-performance range. An A
 * inside that interval is a sensitivity the session could not tell apart from B, and a
 * validation between them would be a test the calibration already declined to call. The
 * fitted score gap `|f(x_B) − f(x_A)|` is reported alongside for the explanation, but the
 * quadratic extrapolates poorly away from the peak and is not the gate.
 */

export type ValidationOfferReason =
  | "offered"
  | "offered_vs_starting_point"
  | "no_point_estimate"
  | "within_mde"
  | "already_validated";

export interface ValidationOffer {
  readonly offered: boolean;
  readonly reason: ValidationOfferReason;
  /** Arm A in cm/360, when there is one. */
  readonly baselineCm360: number | null;
  /** Arm B in cm/360, when there is one. */
  readonly candidateCm360: number | null;
  /** Predicted composite gap on the fitted curve, in score units; null without a fit. */
  readonly predictedGap: number | null;
}

export interface ValidationOfferInput {
  readonly verdict: "peak_found" | "indistinguishable" | "insufficient_data";
  readonly recommendedCm360: number | null;
  readonly currentCm360: number | null;
  /** The round-1 bracket centre in cm/360, used as A for a cold start. */
  readonly startingPointCm360: number | null;
  readonly highPerformance: { readonly low: number; readonly high: number } | null;
  readonly curve: ResponseCurve | null;
  readonly alreadyValidated: boolean;
}

export function validationOffer(input: ValidationOfferInput): ValidationOffer {
  const candidate = input.recommendedCm360;
  if (input.verdict !== "peak_found" || candidate === null) {
    return {
      offered: false,
      reason: "no_point_estimate",
      baselineCm360: input.currentCm360,
      candidateCm360: null,
      predictedGap: null,
    };
  }

  const fromStartingPoint = input.currentCm360 === null;
  const baseline = input.currentCm360 ?? input.startingPointCm360;
  if (baseline === null) {
    return {
      offered: false,
      reason: "no_point_estimate",
      baselineCm360: null,
      candidateCm360: candidate,
      predictedGap: null,
    };
  }

  if (input.alreadyValidated) {
    return {
      offered: false,
      reason: "already_validated",
      baselineCm360: baseline,
      candidateCm360: candidate,
      predictedGap: null,
    };
  }

  const curve = input.curve;
  const atBaseline = curve === null ? null : fitValueAt(curve, baseline);
  const atCandidate = curve === null ? null : fitValueAt(curve, candidate);
  const predictedGap =
    atBaseline === null || atCandidate === null ? null : Math.abs(atCandidate - atBaseline);

  const withinMde =
    input.highPerformance !== null &&
    baseline >= input.highPerformance.low &&
    baseline <= input.highPerformance.high;

  if (withinMde) {
    return {
      offered: false,
      reason: "within_mde",
      baselineCm360: baseline,
      candidateCm360: candidate,
      predictedGap,
    };
  }

  return {
    offered: true,
    reason: fromStartingPoint ? "offered_vs_starting_point" : "offered",
    baselineCm360: baseline,
    candidateCm360: candidate,
    predictedGap,
  };
}
