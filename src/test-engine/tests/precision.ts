import type { MotionPattern, TargetSpec, TestDefinition, TestRng } from "../contracts";

/**
 * The Precision Test (doc 09 §9.6).
 *
 * ## Why one shot
 *
 * Flick rewards speed; this test deliberately does not. The single-shot rule is what isolates
 * *placement* from *trigger discipline*: with unlimited shots a player converges on the target
 * and every trial eventually hits, so first-shot placement disappears into the average. One
 * shot makes `firstShotAccuracy` the headline metric it is supposed to be.
 *
 * The cost is variance — one-shot trials are noisier per trial, and some players tense up. That
 * is accepted and compensated with sample size, because the alternative measures something
 * else (doc 09 §9.6).
 *
 * ## The instruction is part of the measurement
 *
 * Players are told to prioritise accuracy over speed. Some will rush anyway, so `settleTime`
 * and `targetAcquisitionTime` are recorded — not to penalise them, but so the session quality
 * report can say the instruction was not honoured rather than silently reporting their rushed
 * placement as their precision.
 */

const DISTANCE_DEG = { min: 6, max: 20 } as const;
const RADIUS_DEG = { min: 0.4, max: 0.6 } as const;
const RESET_RADIUS_DEG = 3;

export const precisionTest: TestDefinition = {
  key: "precision",
  version: 1,
  category: "scored",
  instructionsKey: "test.precision.instructions",
  displayNameKey: "test.precision.name",

  trialCount: (mode) => (mode === "quick" ? 6 : mode === "advanced" ? 14 : 10),
  minValidTrials: (mode) => (mode === "quick" ? 6 : mode === "advanced" ? 14 : 10),
  practiceTrialCount: () => 4,

  timeoutMs: 6000,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "single_shot",
  shootingModel: "click",
  minMovementCounts: 40,

  spawn(rng: TestRng): readonly TargetSpec[] {
    const distanceDeg = rng.nextRange(DISTANCE_DEG.min, DISTANCE_DEG.max);
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

  // `extra_shot` is procedural: the one-shot rule is stated explicitly in the UI before the
  // test, so a second press is a departure from the procedure, not a bad shot.
  additionalInvalidReasons: ["extra_shot"],
  metricKeys: [
    "firstShotAccuracy",
    "flickError",
    "flickErrorNorm",
    "targetAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "settleTime",
    "correctionCount",
    "jitterRMS",
    "pathEfficiency",
    "qualityScore",
  ],
  primaryMetricKey: "flickErrorNorm",
};
