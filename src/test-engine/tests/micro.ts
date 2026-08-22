import type { MotionPattern, TargetSpec, TestDefinition, TestRng } from "../contracts";

/**
 * The Micro Adjustment Test (doc 09 §9.3).
 *
 * ## Why this test exists
 *
 * It is the **primary detector of "too high"**. Excessive sensitivity shows up here — as
 * overshoot, repeated correction and instability — long before it shows up in large flicks,
 * where a player's ballistic movement is coarse enough to absorb it. Without a small-angle
 * test the response curve's upper arm would be nearly flat, and the search would have no
 * evidence to push back with.
 *
 * ## The details that make it measure what it claims
 *
 * - **No click-through grace.** The shot counts only if the crosshair is inside the target at
 *   the press moment. A grace radius would let an imprecise player score as a precise one.
 * - **A 120 ms shot cooldown.** Without it a player can hold the crosshair roughly in the area
 *   and spam-click through the task, which measures their mouse button rather than their aim.
 * - **Small targets, generous outline.** The small hit radius is the point of the test; the
 *   outline and centre dot keep it locatable for low-acuity users without changing that radius.
 */

const DISTANCE_DEG = { min: 0.8, max: 4.0 } as const;
/** TUNABLE — small enough to expose fine-control cost, large enough to stay clickable. */
const RADIUS_DEG = { min: 0.35, max: 0.7 } as const;
const RESET_RADIUS_DEG = 3;

export const microTest: TestDefinition = {
  key: "micro",
  version: 1,
  category: "scored",
  instructionsKey: "test.micro.instructions",
  displayNameKey: "test.micro.name",

  trialCount: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 18 : 12),
  minValidTrials: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 18 : 12),
  practiceTrialCount: () => 6,

  timeoutMs: 4000,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "first_hit",
  shootingModel: "click",
  shotCooldownMs: 120,
  // The angles are tiny, so the movement floor is correspondingly small — a player genuinely
  // attempting a 2° adjustment moves far fewer counts than one attempting a 30° flick.
  minMovementCounts: 15,

  spawn(rng: TestRng): readonly TargetSpec[] {
    const distanceDeg = rng.nextRange(DISTANCE_DEG.min, DISTANCE_DEG.max);
    // Full-circle direction: at these angles there is no meaningful direction-class quota to
    // balance, and constraining it would make the target's position guessable.
    const directionDeg = rng.nextRange(0, 360);
    const radians = (directionDeg * Math.PI) / 180;

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: RESET_RADIUS_DEG, role: "reset" },
      {
        yawDeg: distanceDeg * Math.cos(radians),
        pitchDeg: distanceDeg * Math.sin(radians),
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  additionalInvalidReasons: [],
  metricKeys: [
    "microAdjustmentError",
    "targetAcquisitionTime",
    "adjustedAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "correctionCount",
    "overshootRate",
    "overshootMagnitudeNorm",
    "undershootRate",
    "firstShotAccuracy",
    "settleTime",
    "jitterRMS",
    "pathEfficiency",
    "qualityScore",
  ],
  primaryMetricKey: "microAdjustmentError",
};
