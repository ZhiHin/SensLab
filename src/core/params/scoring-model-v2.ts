import type { DimensionDefinition, ScoringParameters } from "../scoring/contracts";
import type { DimensionKey, TestKey } from "../types/vocabulary";
import type { ParameterSet } from "./types";
import { SCORING_MODEL_V1 } from "./scoring-model-v1";

/**
 * `scoring_model_v2` — the post-MVP tests enter the dimensions and the objective (doc 09 §9.15,
 * doc 14 §14.5, Phase 6).
 *
 * ## Why a new version rather than an edit
 *
 * `scoring_model_v1` is released: its hash is stored against every Phase 3–5 result, and a
 * released parameter set is never edited (`SENS-BR-029`). Adding six tests to the weights
 * changes every dimension score, so it is a new version, and v1 stays compiled so that
 * historical results keep rendering under the set that produced them.
 *
 * ## What changes
 *
 *  - **The Tracking exception closes.** doc 09 §9.15 documented Tracking as single-sourced at
 *    MVP "until Strafe Tracking and Slide Tracking arrive in Phase 6". They have; Tracking now
 *    draws from three tests, and the rule holds for every dimension without exception.
 *  - **Control gains its strongest source.** Recoil is weighted for Control above all else,
 *    as doc 09 §9.12 specifies, because compensation against a sustained disturbance is the
 *    most direct measurement of control the battery has.
 *  - **Speed gets its counterweight.** The Speed test carries a large Speed weight and *no*
 *    accuracy term, which is what makes the Speed/Precision trade-off measurable.
 *
 * ## What does not change
 *
 * The robust scale floors, the clip constant, the display scaling and the disabled per-game
 * profiles are inherited from v1 unchanged. Objective weights still reflect information per
 * unit of session time, not perceived importance — the MVP five keep the majority of the
 * weight because they keep the majority of the trials.
 */

const weight = (
  metricKey: string,
  fromTests: readonly TestKey[],
  value: number,
): DimensionDefinition["weights"][number] =>
  Object.freeze({ metricKey, fromTests: Object.freeze([...fromTests]), weight: value });

const dimension = (
  key: DimensionKey,
  displayName: string,
  description: string,
  weights: readonly DimensionDefinition["weights"][number][],
): DimensionDefinition =>
  Object.freeze({ dimension: key, displayName, description, weights: Object.freeze([...weights]) });

const V1 = SCORING_MODEL_V1.params;

export const SCORING_MODEL_V2: ParameterSet<ScoringParameters> = Object.freeze({
  kind: "scoring",
  version: "scoring_model_v2",
  releasedAt: "2026-08-23",
  notes:
    "Phase 6: the post-MVP tests (Wide Flick, Strafe Tracking, Slide Tracking, Speed, Recoil, " +
    "ADS) enter the dimension weights and the objective per doc 09 §9.15. Tracking is no " +
    "longer single-sourced. Floors, clip and display scaling inherited from v1 unchanged.",
  params: Object.freeze({
    version: "scoring_model_v2",
    metricRegistryVersion: 1,

    robustScaleFloors: Object.freeze({
      ...V1.robustScaleFloors,
      reversalRecoveryTime: 10,
      peakSpeedTrackingError: 0.02,
      recoilDeviationVertical: 0.05,
      recoilDeviationHorizontal: 0.05,
      stabilityUnderRecoil: 0.01,
    }),
    clipConstant: V1.clipConstant,

    dimensions: Object.freeze([
      dimension("flick", "Flick", "Ballistic acquisition of targets at meaningful distance.", [
        weight("adjustedAcquisitionTime", ["flick"], 0.22),
        weight("flickErrorNorm", ["flick"], 0.18),
        weight("firstShotAccuracy", ["flick"], 0.18),
        weight("pathEfficiency", ["flick"], 0.07),
        weight("switchingTravelTime", ["switching"], 0.08),
        weight("adjustedAcquisitionTime", ["wide-flick"], 0.12),
        weight("flickErrorNorm", ["wide-flick"], 0.05),
        weight("adjustedAcquisitionTime", ["speed"], 0.05),
        weight("adjustedAcquisitionTime", ["ads"], 0.05),
      ]),
      dimension(
        "precision",
        "Precision",
        "Accuracy of placement when accuracy is what is being asked for.",
        [
          weight("firstShotAccuracy", ["precision"], 0.26),
          weight("microAdjustmentError", ["micro"], 0.22),
          weight("flickErrorNorm", ["precision"], 0.17),
          weight("firstShotAccuracy", ["micro"], 0.12),
          weight("jitterRMS", ["micro", "precision"], 0.08),
          weight("flickErrorNorm", ["ads"], 0.06),
          weight("firstShotAccuracy", ["ads"], 0.05),
          weight("flickErrorNorm", ["wide-flick"], 0.02),
          weight("recoilDeviationHorizontal", ["recoil"], 0.02),
        ],
      ),
      dimension("tracking", "Tracking", "Continuous following of a moving target.", [
        weight("trackingAccuracy", ["tracking"], 0.22),
        weight("trackingError", ["tracking"], 0.18),
        weight("trackingStability", ["tracking"], 0.14),
        weight("correctionFrequency", ["tracking"], 0.06),
        weight("trackingError", ["strafe-tracking"], 0.1),
        weight("reversalRecoveryTime", ["strafe-tracking"], 0.08),
        weight("trackingAccuracy", ["strafe-tracking"], 0.03),
        weight("peakSpeedTrackingError", ["slide-tracking"], 0.1),
        weight("trackingError", ["slide-tracking"], 0.06),
        weight("stabilityUnderRecoil", ["recoil"], 0.03),
      ]),
      dimension(
        "speed",
        "Speed",
        "How quickly engagements are resolved. Contains no accuracy term.",
        [
          weight("switchingTime", ["switching"], 0.2),
          weight("adjustedAcquisitionTime", ["flick"], 0.2),
          weight("timeToTarget", ["flick", "switching"], 0.16),
          weight("settleTime", ["micro"], 0.1),
          weight("adjustedAcquisitionTime", ["speed"], 0.16),
          weight("adjustedAcquisitionTime", ["wide-flick"], 0.08),
          weight("peakSpeedTrackingError", ["slide-tracking"], 0.06),
          weight("adjustedAcquisitionTime", ["ads"], 0.04),
        ],
      ),
      dimension(
        "control",
        "Control",
        "Stability and economy of movement. The anti-overshoot dimension.",
        [
          weight("overshootRate", ["flick", "micro", "switching"], 0.2),
          weight("correctionCount", ["flick", "micro"], 0.16),
          weight("pathEfficiency", ["flick", "switching"], 0.12),
          weight("undershootRate", ["flick", "micro"], 0.08),
          weight("trackingStability", ["tracking"], 0.07),
          weight("recoilDeviationVertical", ["recoil"], 0.12),
          weight("stabilityUnderRecoil", ["recoil"], 0.08),
          weight("trackingStability", ["strafe-tracking"], 0.07),
          weight("reversalRecoveryTime", ["strafe-tracking"], 0.04),
          weight("trackingStability", ["slide-tracking"], 0.03),
          weight("overshootRate", ["ads"], 0.03),
        ],
      ),
      dimension(
        "consistency",
        "Consistency",
        "Repeatability across trials. A dimension rather than a modifier, so that a player " +
          "whose limiter is variance sees that plainly instead of it silently depressing " +
          "every other score.",
        [
          weight("consistency", ["flick"], 0.2),
          weight("consistency", ["precision"], 0.17),
          weight("consistency", ["tracking"], 0.17),
          weight("consistency", ["switching"], 0.12),
          weight("consistency", ["recoil"], 0.1),
          weight("consistency", ["strafe-tracking"], 0.08),
          weight("consistency", ["ads"], 0.08),
          weight("consistency", ["wide-flick"], 0.04),
          weight("consistency", ["speed"], 0.02),
          weight("consistency", ["slide-tracking"], 0.02),
        ],
      ),
    ]),

    // Information per unit of session time. The MVP five keep the majority because they keep
    // the majority of the trials; the new tests add resolution where they are run.
    objectiveTestWeights: Object.freeze([
      Object.freeze({ test: "flick" as const, weight: 0.2 }),
      Object.freeze({ test: "micro" as const, weight: 0.17 }),
      Object.freeze({ test: "tracking" as const, weight: 0.13 }),
      Object.freeze({ test: "switching" as const, weight: 0.1 }),
      Object.freeze({ test: "precision" as const, weight: 0.07 }),
      Object.freeze({ test: "wide-flick" as const, weight: 0.08 }),
      Object.freeze({ test: "strafe-tracking" as const, weight: 0.08 }),
      Object.freeze({ test: "slide-tracking" as const, weight: 0.05 }),
      Object.freeze({ test: "speed" as const, weight: 0.04 }),
      Object.freeze({ test: "recoil" as const, weight: 0.05 }),
      Object.freeze({ test: "ads" as const, weight: 0.03 }),
    ]),

    decisionMetricKeys: Object.freeze([
      ...V1.decisionMetricKeys,
      "reversalRecoveryTime",
      "peakSpeedTrackingError",
      "recoilDeviationVertical",
      "stabilityUnderRecoil",
    ]),

    displayScaling: V1.displayScaling,
    referenceDistributionVersion: "reference_dist_provisional_v2",
    gameWeightProfilesEnabled: false,
    defaultWeightProfile: V1.defaultWeightProfile,
  }),
});
