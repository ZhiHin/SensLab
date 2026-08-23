import type { CalibrationResult } from "../calibration/contracts";
import { cmPer360FromCounts } from "../sensitivity/canonical";

/**
 * The response curve data contract (doc 16 §16.7).
 *
 * Everything needed to redraw the evidence chart without re-running the fit, stored with the
 * recommendation so the chart a user saw a year ago is the chart they see today. It carries
 * both x representations — log2 counts/360 for the maths and cm/360 for the axis — because
 * the chart's x axis is log-scaled cm/360 (doc 25 §25.9) and converting at render time would
 * put a DPI dependency inside a view.
 */

export interface ResponseCurveCandidate {
  readonly xLog2: number;
  readonly cm360: number;
  /** De-drifted candidate effect, in standardised score units. */
  readonly alphaHat: number;
  readonly se: number;
  readonly n: number;
  readonly roundIndex: number;
  readonly blindLabel: string;
  readonly isAnchor: boolean;
  /** True when the candidate fell below the sample floor and was excluded from the fit. */
  readonly insufficient: boolean;
}

export interface ResponseCurve {
  readonly candidates: readonly ResponseCurveCandidate[];
  readonly fit: {
    readonly b0: number;
    readonly b1: number;
    readonly b2: number;
    readonly concave: boolean;
    readonly r2Adj: number | null;
  } | null;
  /** Sampled bootstrap envelope of the fit, in cm/360. Empty when no band could be formed. */
  readonly band: readonly { readonly cm360: number; readonly lo: number; readonly hi: number }[];
  readonly xStar: {
    readonly cm360: number;
    readonly ciLow: number;
    readonly ciHigh: number;
  } | null;
  readonly comfortBand: { readonly lo: number; readonly hi: number };
  readonly constraint: { readonly maxCm360: number } | null;
  /** The player's own starting sensitivity, if they told us. The detail that makes it personal. */
  readonly currentSens: { readonly cm360: number } | null;
  /** The minimum detectable effect in score units — the resolution of "different". */
  readonly minimumDetectableEffect: number;
  readonly dpi: number;
}

export function buildResponseCurve(
  result: CalibrationResult,
  dpi: number,
  currentCmPer360: number | null,
): ResponseCurve {
  const toCm = (xLog2: number): number => cmPer360FromCounts(2 ** xLog2, dpi);

  const candidateRows = new Map(
    result.candidates.map((candidate) => [
      `${candidate.roundIndex}:${candidate.candidateIndex}`,
      candidate,
    ]),
  );

  const candidates = result.estimates.map((estimate) => {
    const row = candidateRows.get(`${estimate.roundIndex}:${estimate.candidateIndex}`);
    return {
      xLog2: estimate.x as number,
      cm360: toCm(estimate.x as number),
      alphaHat: estimate.alphaHat,
      se: estimate.standardError,
      n: estimate.validTrials,
      roundIndex: estimate.roundIndex,
      blindLabel: row?.blindLabel ?? "?",
      isAnchor: row?.source === "anchor",
      insufficient: estimate.insufficient,
    };
  });

  const fit =
    result.fit === null
      ? null
      : {
          b0: result.fit.coefficients[0] ?? 0,
          b1: result.fit.coefficients[1] ?? 0,
          b2: result.fit.coefficients[2] ?? 0,
          concave: result.fit.concave,
          r2Adj: result.fit.rSquaredAdjusted,
        };

  const xStar =
    result.xStar === null || result.credibleInterval === null
      ? null
      : {
          cm360: toCm(result.xStar as number),
          // Counts and cm are proportional, so a higher x is a higher cm/360: the interval
          // keeps its orientation.
          ciLow: toCm(result.credibleInterval.low),
          ciHigh: toCm(result.credibleInterval.high),
        };

  return {
    candidates,
    fit,
    band: result.fitBand.map((point) => ({
      cm360: toCm(point.x),
      lo: point.low,
      hi: point.high,
    })),
    xStar,
    comfortBand: { lo: result.comfortRange.lowCm360, hi: result.comfortRange.highCm360 },
    constraint:
      result.constraint.maxCmPer360 === null ? null : { maxCm360: result.constraint.maxCmPer360 },
    currentSens: currentCmPer360 === null ? null : { cm360: currentCmPer360 },
    minimumDetectableEffect: result.minimumDetectableEffect,
    dpi,
  };
}

/** Evaluates the stored fit at a cm/360, in score units. Null without a fit. */
export function fitValueAt(curve: ResponseCurve, cm360: number): number | null {
  if (curve.fit === null) return null;
  const x = Math.log2((cm360 * curve.dpi) / 2.54);
  return curve.fit.b0 + curve.fit.b1 * x + curve.fit.b2 * x * x;
}
