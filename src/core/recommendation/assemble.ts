import type { CalibrationResult } from "../calibration/contracts";
import { computeConfidence, type ConfidenceInputs, type ConfidenceOutcome } from "../confidence";
import type { AimProfileParams } from "../params/aim-profile-rules-v1";
import type { ConfidenceParams } from "../params/confidence-model-v1";
import type { ReferenceDistributionParams } from "../params/reference-dist-provisional-v1";
import type { ScoringParameters } from "../scoring/contracts";
import type { ObservedTrial } from "../scoring/standardise";
import { cmPer360FromCounts, countsPer360FromCm } from "../sensitivity/canonical";
import { settingsReliabilityForDpiSource } from "../sensitivity/dpi";
import { median, medianAbsoluteDeviation, MAD_TO_SD } from "../statistics";
import type { CalibrationVerdict, DpiSource, SettingsReliability } from "../types/vocabulary";
import { computeDimensionScores, withShape, type DimensionOutcome } from "./dimensions";
import {
  explainProfile,
  explainStrengths,
  type AimProfileExplanation,
  type StrengthsExplanation,
} from "./explanation";
import { classifyAimProfile, strengthsAndAreas, type ProfileClassification } from "./profile";
import { buildResponseCurve, type ResponseCurve } from "./response-curve";

/**
 * Assembles the recommendation (doc 16 §16.1).
 *
 * A recommendation is an **object, not a number**: the canonical value, two ranges that answer
 * two different questions, a confidence index with its breakdown, the aim profile with the
 * evidence that produced it, and the response curve — everything a reader needs to see not
 * only *what* SensLab recommends but *why*.
 *
 * This is a pure function of persisted facts. Running it twice on the same session produces
 * the same object (`SENS-BR-030`), and nothing here touches a game: game settings are derived
 * later from the canonical block by an adapter, and are a cache (`SENS-BR-025`).
 */

export interface AssembleInputs {
  readonly calibration: CalibrationResult;
  readonly trials: readonly ObservedTrial[];
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly currentCmPer360: number | null;
  /** What the mode asked for, summed over the scored tests per candidate per round. */
  readonly targetTrials: number;
  readonly environment: ConfidenceInputs["environment"];
  readonly params: {
    readonly scoring: ScoringParameters;
    readonly reference: ReferenceDistributionParams;
    readonly confidence: ConfidenceParams;
    readonly aimProfile: AimProfileParams;
  };
  readonly versions: {
    readonly scoring: string;
    readonly calibration: string;
    readonly confidence: string;
    readonly aimProfile: string;
  };
}

export interface Recommendation {
  readonly verdict: CalibrationVerdict;
  readonly canonical: {
    readonly recommendedCountsPer360: number | null;
    readonly recommendedCmPer360: number | null;
    readonly degreesPerCm: number | null;
  };
  readonly ranges: {
    readonly highPerformance: {
      readonly lowCm360: number;
      readonly highCm360: number;
      readonly level: number;
    } | null;
    readonly comfort: { readonly lowCm360: number; readonly highCm360: number };
    readonly constraint: { readonly maxCm360: number; readonly source: string } | null;
  };
  readonly quality: {
    readonly confidence: ConfidenceOutcome | null;
    readonly settingsReliability: SettingsReliability;
  };
  readonly profile: {
    readonly classification: ProfileClassification;
    readonly explanation: AimProfileExplanation;
    readonly dimensions: readonly DimensionOutcome[];
    readonly strengths: StrengthsExplanation;
  };
  readonly evidence: {
    readonly responseCurve: ResponseCurve;
    readonly drift: CalibrationResult["drift"];
    readonly anchor: CalibrationResult["anchorRetest"];
    readonly sample: {
      readonly validTrials: number;
      readonly degradedTrials: number;
      readonly invalidTrials: number;
      readonly targetTrials: number;
    };
    readonly stopReason: CalibrationResult["stopReason"];
  };
  readonly provenance: AssembleInputs["versions"] & { readonly seed: string; readonly dpi: number };
}

/** Valid trials count 1, degraded 0.5, invalid 0 (doc 15 §15.2, C2). */
function sampleSummary(trials: readonly ObservedTrial[]) {
  let valid = 0;
  let degraded = 0;
  let invalid = 0;
  for (const trial of trials) {
    if (trial.isPractice) continue;
    if (trial.validity === "valid") valid += 1;
    else if (trial.validity === "degraded") degraded += 1;
    else invalid += 1;
  }
  return { valid, degraded, invalid };
}

/** Robust CV of the de-drifted candidate effects' trial-level spread, for C3. */
function trialScoreRcv(calibration: CalibrationResult): number | null {
  // The candidate effects are the composite the objective produced; their spread across
  // candidates is the between-candidate signal, not the player's variance. The within-candidate
  // variance is what C3 wants, and the standard error of each effect carries it: se² · n is the
  // trial-level variance. Pooled across usable candidates.
  const usable = calibration.estimates.filter((e) => !e.insufficient && e.validTrials > 1);
  if (usable.length === 0) return null;
  const sds = usable.map((e) => e.standardError * Math.sqrt(e.validTrials));
  const centres = usable.map((e) => Math.abs(e.alphaHat));
  const sd = median(sds);
  const centre = median(centres);
  // Scores are standardised within session, so a centre near zero is normal; the robust CV is
  // therefore taken against the spread of the effects themselves when the centre vanishes.
  const denominator =
    centre > 1e-6
      ? centre
      : Math.max(1e-6, MAD_TO_SD * medianAbsoluteDeviation(usable.map((e) => e.alphaHat)) || 1);
  return Number.isFinite(sd / denominator) ? sd / denominator : null;
}

/**
 * The two ranges as shown (doc 16 §16.3): the high-performance range is the credible interval
 * and the comfort range is the plateau, **both clipped by the physical constraint**, and the
 * comfort range always contains the high-performance range. The engine already clips the
 * plateau; the interval is the statistical evidence and stays unclipped on the curve, so the
 * clip is applied here, where the ranges become a claim about what the player can use.
 */
function clippedRanges(
  calibration: CalibrationResult,
  dpi: number,
): Pick<Recommendation["ranges"], "highPerformance" | "comfort"> {
  const ceiling = calibration.constraint.maxCmPer360;
  let highPerformance: Recommendation["ranges"]["highPerformance"] =
    calibration.verdict === "peak_found" && calibration.credibleInterval !== null
      ? {
          lowCm360: cmPer360FromCounts(2 ** calibration.credibleInterval.low, dpi),
          highCm360: cmPer360FromCounts(2 ** calibration.credibleInterval.high, dpi),
          level: calibration.credibleInterval.level,
        }
      : null;
  if (highPerformance !== null && ceiling !== null && ceiling > highPerformance.lowCm360) {
    highPerformance = {
      ...highPerformance,
      highCm360: Math.min(highPerformance.highCm360, ceiling),
    };
  }
  const comfort = {
    lowCm360: Math.min(
      calibration.comfortRange.lowCm360,
      highPerformance?.lowCm360 ?? Number.POSITIVE_INFINITY,
    ),
    highCm360: Math.max(
      calibration.comfortRange.highCm360,
      highPerformance?.highCm360 ?? Number.NEGATIVE_INFINITY,
    ),
  };
  return { highPerformance, comfort };
}

export function assembleRecommendation(inputs: AssembleInputs): Recommendation {
  const { calibration, params, dpi } = inputs;
  // The recommendation is the **constrained** optimum (doc 13 §13.13): a sensitivity the
  // player cannot physically execute is not a recommendation, it is a description of somebody
  // else’s desk. `calibration.xStar` deliberately stays unclipped — it is the fitted optimum
  // and doc 13 §13.11 persists it as evidence, which is also how "the unconstrained optimum is
  // reported separately" stays available to the result screen.
  //
  // The engine already confines the search to the constraint (doc 13 §13.3) and refuses a peak
  // whose vertex sits beyond the measured span, so what remains here is the narrow case of a
  // vertex just inside the span but just above the ceiling.
  const ceilingCm = calibration.constraint.maxCmPer360;
  const fittedCm =
    calibration.countsPer360 === null ? null : cmPer360FromCounts(calibration.countsPer360, dpi);
  const cm =
    fittedCm === null ? null : ceilingCm === null ? fittedCm : Math.min(fittedCm, ceilingCm);
  const counts =
    cm === null || fittedCm === null
      ? null
      : cm === fittedCm
        ? calibration.countsPer360
        : countsPer360FromCm(cm, dpi);

  const dimensions = withShape(
    computeDimensionScores({
      trials: inputs.trials,
      scoring: params.scoring,
      reference: params.reference,
    }),
    params.aimProfile.shapeSpreadFloor,
  );

  // The band for an indistinguishable result is the centre of the comfort range: it is the
  // only sensitivity statement the session can make.
  const bandCm = cm ?? (calibration.comfortRange.lowCm360 + calibration.comfortRange.highCm360) / 2;
  const classification = classifyAimProfile(dimensions, bandCm, params.aimProfile);
  const explanation = explainProfile(classification, dimensions, cm);
  const strengths = explainStrengths(strengthsAndAreas(dimensions, params.aimProfile));

  const sample = sampleSummary(inputs.trials);

  const confidence =
    calibration.verdict === "insufficient_data"
      ? null
      : computeConfidence(
          {
            verdict: calibration.verdict,
            credibleInterval: calibration.credibleInterval,
            effectiveValidTrials: sample.valid + 0.5 * sample.degraded,
            targetTrials: inputs.targetTrials,
            trialScoreRcv: trialScoreRcv(calibration),
            environment: inputs.environment,
            drift: {
              deltaFirstToLast: calibration.drift.deltaFirstToLast,
              form: calibration.drift.form,
            },
            fit:
              calibration.fit === null
                ? null
                : {
                    rSquaredAdjusted: calibration.fit.rSquaredAdjusted,
                    distinctSensitivities: new Set(
                      calibration.estimates
                        .filter((e) => !e.insufficient)
                        .map((e) => (e.x as number).toFixed(9)),
                    ).size,
                  },
            anchor: calibration.anchorRetest,
          },
          params.confidence,
          inputs.versions.confidence,
        );

  const ranges = clippedRanges(calibration, dpi);

  return {
    verdict: calibration.verdict,
    canonical: {
      recommendedCountsPer360: counts,
      recommendedCmPer360: cm,
      degreesPerCm: cm === null ? null : 360 / cm,
    },
    ranges: {
      highPerformance: ranges.highPerformance,
      comfort: ranges.comfort,
      constraint:
        calibration.constraint.maxCmPer360 === null
          ? null
          : { maxCm360: calibration.constraint.maxCmPer360, source: calibration.constraint.source },
    },
    quality: {
      confidence,
      settingsReliability: settingsReliabilityForDpiSource(inputs.dpiSource),
    },
    profile: { classification, explanation, dimensions, strengths },
    evidence: {
      responseCurve: buildResponseCurve(calibration, dpi, inputs.currentCmPer360),
      drift: calibration.drift,
      anchor: calibration.anchorRetest,
      sample: {
        validTrials: sample.valid,
        degradedTrials: sample.degraded,
        invalidTrials: sample.invalid,
        targetTrials: inputs.targetTrials,
      },
      stopReason: calibration.stopReason,
    },
    provenance: { ...inputs.versions, seed: calibration.seed.toString(), dpi },
  };
}
