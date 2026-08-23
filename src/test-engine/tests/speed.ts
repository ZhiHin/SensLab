import type {
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "../contracts";
import { rangeForDirectionClass } from "../targets/placement";
import { directionClassFor } from "./flick";

/**
 * The Speed Test (doc 09 §9.11).
 *
 * As Flick, but with generous targets and a short timeout: accuracy demands are minimised so
 * that what remains is pure speed. It is the counterweight to Precision — the pairing is what
 * makes the Speed/Precision trade-off measurable rather than conflated, and it is why this test
 * is weighted for Speed and for almost nothing else.
 *
 * The "go as fast as you can" instruction encourages reckless movement. That is intended.
 */

/** doc 09 §9.11 — large targets, moderate distances. */
export const SPEED_TARGET_RADIUS_DEG = { min: 3, max: 5 } as const;
export const SPEED_DISTANCE_DEG = { min: 10, max: 35 } as const;
const RESET_RADIUS_DEG = 3;

export const speedTest: TestDefinition = {
  key: "speed",
  version: 1,
  category: "scored",
  instructionsKey: "test.speed.instructions",
  displayNameKey: "test.speed.name",

  trialCount: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 16 : 12),
  minValidTrials: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 16 : 12),
  practiceTrialCount: () => 4,

  timeoutMs: 2500,
  interTrialIntervalMs: { min: 200, max: 500 },
  endCondition: "first_hit",
  shootingModel: "click",
  minMovementCounts: 40,

  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[] {
    const distanceDeg = rng.nextRange(SPEED_DISTANCE_DEG.min, SPEED_DISTANCE_DEG.max);
    const range = rangeForDirectionClass(rng, directionClassFor(context.trialIndex));
    const directionDeg = rng.nextRange(range.from, range.to);
    const radians = (directionDeg * Math.PI) / 180;

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: RESET_RADIUS_DEG, role: "reset" },
      {
        yawDeg: distanceDeg * Math.cos(radians),
        pitchDeg: distanceDeg * Math.sin(radians),
        angularRadiusDeg: rng.nextRange(SPEED_TARGET_RADIUS_DEG.min, SPEED_TARGET_RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  additionalInvalidReasons: ["premature_movement"],
  metricKeys: [
    "targetAcquisitionTime",
    "adjustedAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "hitAccuracy",
    "overshootRate",
    "qualityScore",
  ],
  primaryMetricKey: "adjustedAcquisitionTime",
};
