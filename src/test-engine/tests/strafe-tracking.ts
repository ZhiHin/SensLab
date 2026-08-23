import type { MotionPattern, TargetSpec, TestDefinition, TestRng } from "../contracts";
import { strafeProfile } from "../targets/profiles";

/**
 * The Strafe Tracking Test (doc 09 §9.9).
 *
 * Tracking against unpredictable direction reversals — closer to real duel behaviour than a
 * smooth sinusoid. The Tracking dimension was single-sourced at MVP (doc 09 §9.15); this is
 * the first of the two tests that fixes that.
 *
 * ## Why the interval distribution is the whole design
 *
 * Reversal timing is drawn from a memoryless (exponential) distribution with a documented
 * mean. Anticipation is therefore impossible *by construction*: however long the target has
 * been going one way, the chance it reverses in the next instant is the same. A uniform or
 * rhythmic schedule would let a player learn it inside a five-second trial, and the test would
 * then measure pattern recognition rather than tracking.
 */

export const STRAFE_DURATION_MS = 5000;
/** TUNABLE — documented mean of the memoryless reversal interval (doc 09 §9.9). */
export const STRAFE_MEAN_REVERSAL_INTERVAL_MS = 650;
export const STRAFE_SPEED_DEG_PER_SEC = { min: 40, max: 110 } as const;
/** Bounded so reversals stay C⁰-continuous and physically plausible. */
export const STRAFE_REVERSAL_ACCELERATION = 700;
export const STRAFE_MAX_EXCURSION_DEG = 24;
const RADIUS_DEG = { min: 1.4, max: 2.2 } as const;

export const strafeTrackingTest: TestDefinition = {
  key: "strafe-tracking",
  version: 1,
  category: "scored",
  instructionsKey: "test.strafe-tracking.instructions",
  displayNameKey: "test.strafe-tracking.name",

  trialCount: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 8 : 5),
  minValidTrials: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 8 : 5),
  practiceTrialCount: () => 2,

  timeoutMs: STRAFE_DURATION_MS,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "duration",
  shootingModel: "hold",
  minHeldRatio: 0.7,
  minMovementCounts: 60,

  spawn(rng: TestRng): readonly TargetSpec[] {
    // A small offset so the trial opens with an acquisition rather than free time-on-target.
    const side = rng.next() < 0.5 ? -1 : 1;
    return [
      {
        yawDeg: side * rng.nextRange(3, 6),
        pitchDeg: rng.nextRange(-2, 2),
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(rng: TestRng): MotionPattern {
    return {
      kind: "segments",
      axis: "yaw",
      segments: strafeProfile(rng, {
        durationMs: STRAFE_DURATION_MS + 500,
        speedDegPerSec: rng.nextRange(STRAFE_SPEED_DEG_PER_SEC.min, STRAFE_SPEED_DEG_PER_SEC.max),
        meanReversalIntervalMs: STRAFE_MEAN_REVERSAL_INTERVAL_MS,
        reversalAccelerationDegPerSec2: STRAFE_REVERSAL_ACCELERATION,
        maxExcursionDeg: STRAFE_MAX_EXCURSION_DEG,
      }),
    };
  },

  additionalInvalidReasons: ["button_held_ratio_low"],
  metricKeys: [
    "trackingAccuracy",
    "trackingError",
    "trackingStability",
    "reversalRecoveryTime",
    "correctionFrequency",
    "qualityScore",
  ],
  primaryMetricKey: "trackingError",
};
