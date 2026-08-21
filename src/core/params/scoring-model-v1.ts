import type { ScoringParameters } from "../scoring/contracts";
import type { ParameterSet } from "./types";

/**
 * `scoring_model_v1` — dimension weights and the calibration objective (doc 14).
 *
 * Two structural rules the weights encode, worth stating because they are easy to lose:
 *
 *  - **No dimension depends on a single test.** Every one draws from at least two, so one
 *    noisy round cannot dominate it (doc 09 §9.15).
 *  - **Speed contains no accuracy term and Precision contains no time term.** If both
 *    contained both they would be correlated by construction and the Aim DNA shape would
 *    carry no information. Keeping them clean is what makes "fast but imprecise" a visible,
 *    real pattern rather than an artefact.
 *
 * Objective weights reflect **information per unit of session time**, not perceived
 * importance: a test with high variance and few trials contributes less signal, and
 * weighting it higher would import noise into the recommendation.
 */

export const SCORING_MODEL_V1: ParameterSet<ScoringParameters> = Object.freeze({
  kind: "scoring",
  version: "scoring_model_v1",
  releasedAt: "2026-08-20",
  notes:
    "Initial release. Dimension weights are product judgements informed by doc 14 §14.5 and " +
    "are expected to be revisited once real variance data exists.",
  params: Object.freeze({
    version: "scoring_model_v1",
    metricRegistryVersion: 1,

    // Prevents an unusually consistent player from producing unbounded z-scores when their
    // MAD is near zero (doc 14 §14.3).
    robustScaleFloors: Object.freeze({
      adjustedAcquisitionTime: 8,
      targetAcquisitionTime: 8,
      timeToTarget: 8,
      switchingTime: 8,
      switchingTravelTime: 8,
      settleTime: 5,
      flickErrorNorm: 0.02,
      microAdjustmentError: 0.02,
      trackingError: 0.01,
      trackingAccuracy: 0.01,
      trackingStability: 0.01,
      pathEfficiency: 0.01,
      correctionCount: 0.2,
      consistency: 0.01,
    }),

    // Bounded influence: 4·tanh(z/4). Not trimming — no trial is removed, every trial still
    // moves the estimate, and the mapping is monotone and invertible (doc 14 §14.3).
    clipConstant: 4,

    dimensions: Object.freeze([
      Object.freeze({
        dimension: "flick" as const,
        displayName: "Flick",
        description: "Ballistic acquisition of targets at meaningful distance.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "adjustedAcquisitionTime",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "flickErrorNorm",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "firstShotAccuracy",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "pathEfficiency",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.1,
          }),
          Object.freeze({
            metricKey: "switchingTravelTime",
            fromTests: Object.freeze(["switching" as const]),
            weight: 0.1,
          }),
        ]),
      }),
      Object.freeze({
        dimension: "precision" as const,
        displayName: "Precision",
        description: "Accuracy of placement when accuracy is what is being asked for.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "firstShotAccuracy",
            fromTests: Object.freeze(["precision" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "microAdjustmentError",
            fromTests: Object.freeze(["micro" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "flickErrorNorm",
            fromTests: Object.freeze(["precision" as const]),
            weight: 0.2,
          }),
          Object.freeze({
            metricKey: "firstShotAccuracy",
            fromTests: Object.freeze(["micro" as const]),
            weight: 0.15,
          }),
          Object.freeze({
            metricKey: "jitterRMS",
            fromTests: Object.freeze(["micro" as const, "precision" as const]),
            weight: 0.1,
          }),
        ]),
      }),
      Object.freeze({
        dimension: "tracking" as const,
        displayName: "Tracking",
        description: "Continuous following of a moving target.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "trackingAccuracy",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.35,
          }),
          Object.freeze({
            metricKey: "trackingError",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "trackingStability",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "correctionFrequency",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.1,
          }),
        ]),
      }),
      Object.freeze({
        dimension: "speed" as const,
        displayName: "Speed",
        description: "How quickly engagements are resolved. Contains no accuracy term.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "switchingTime",
            fromTests: Object.freeze(["switching" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "adjustedAcquisitionTime",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "timeToTarget",
            fromTests: Object.freeze(["flick" as const, "switching" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "settleTime",
            fromTests: Object.freeze(["micro" as const]),
            weight: 0.15,
          }),
        ]),
      }),
      Object.freeze({
        dimension: "control" as const,
        displayName: "Control",
        description: "Stability and economy of movement. The anti-overshoot dimension.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "overshootRate",
            fromTests: Object.freeze(["flick" as const, "micro" as const, "switching" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "correctionCount",
            fromTests: Object.freeze(["flick" as const, "micro" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "pathEfficiency",
            fromTests: Object.freeze(["flick" as const, "switching" as const]),
            weight: 0.2,
          }),
          Object.freeze({
            metricKey: "undershootRate",
            fromTests: Object.freeze(["flick" as const, "micro" as const]),
            weight: 0.15,
          }),
          Object.freeze({
            metricKey: "trackingStability",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.1,
          }),
        ]),
      }),
      Object.freeze({
        dimension: "consistency" as const,
        displayName: "Consistency",
        description:
          "Repeatability across trials. A dimension rather than a modifier, so that a player " +
          "whose limiter is variance sees that plainly instead of it silently depressing " +
          "every other score.",
        weights: Object.freeze([
          Object.freeze({
            metricKey: "consistency",
            fromTests: Object.freeze(["flick" as const]),
            weight: 0.3,
          }),
          Object.freeze({
            metricKey: "consistency",
            fromTests: Object.freeze(["precision" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "consistency",
            fromTests: Object.freeze(["tracking" as const]),
            weight: 0.25,
          }),
          Object.freeze({
            metricKey: "consistency",
            fromTests: Object.freeze(["switching" as const]),
            weight: 0.2,
          }),
        ]),
      }),
    ]),

    objectiveTestWeights: Object.freeze([
      Object.freeze({ test: "flick" as const, weight: 0.3 }),
      Object.freeze({ test: "micro" as const, weight: 0.25 }),
      Object.freeze({ test: "tracking" as const, weight: 0.2 }),
      Object.freeze({ test: "switching" as const, weight: 0.15 }),
      Object.freeze({ test: "precision" as const, weight: 0.1 }),
    ]),

    decisionMetricKeys: Object.freeze([
      "adjustedAcquisitionTime",
      "firstShotAccuracy",
      "flickErrorNorm",
      "microAdjustmentError",
      "overshootRate",
      "undershootRate",
      "correctionCount",
      "pathEfficiency",
      "trackingAccuracy",
      "trackingError",
      "trackingStability",
      "switchingTravelTime",
      "consistency",
    ]),

    // 0-100 display scale: z = 0 → 50, z = +4 → 100 (doc 14 §14.4).
    displayScaling: Object.freeze({ centre: 50, perSigma: 12.5, min: 1, max: 99 }),

    referenceDistributionVersion: "reference_dist_provisional_v1",

    // Per-game weighting exists in the model but is disabled at MVP: every game uses the
    // balanced profile, so game selection genuinely changes nothing upstream of the adapter.
    gameWeightProfilesEnabled: false,
    defaultWeightProfile: Object.freeze({
      flick: 1 / 6,
      precision: 1 / 6,
      tracking: 1 / 6,
      speed: 1 / 6,
      control: 1 / 6,
      consistency: 1 / 6,
    }),
  }),
});
