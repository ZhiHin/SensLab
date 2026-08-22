import type {
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "../contracts";
import {
  classifyDirection,
  rangeForDirectionClass,
  type DirectionClass,
} from "../targets/placement";

/**
 * The Flick Test (doc 09 §9.2).
 *
 * The primary measure of ballistic target acquisition, and the single most
 * sensitivity-dependent skill in the battery. It produces the bulk of the Speed and Precision
 * signal.
 *
 * ## Why a reset target
 *
 * Every trial begins with a target at the crosshair. Clicking it guarantees a known, identical
 * starting orientation, which does two things: it makes the flick distance the distance the
 * definition asked for rather than "whatever was left over from last trial", and it stops
 * orientation drift accumulating across a round. The reset click is excluded from every metric
 * — the measured window opens only once it is cleared (doc 19 §19.3).
 *
 * ## Why quotas rather than uniform sampling
 *
 * Distance and direction are both quota-balanced rather than drawn freely. Most players are
 * measurably better flicking one way than the other, and a candidate that happened to draw more
 * of a player's good direction would score better for a reason that has nothing to do with
 * sensitivity. Fixing the quotas per round means every candidate faces the same mix.
 */

/** doc 09 §9.2 — distance classes and their share of the trials. */
export const FLICK_DISTANCE_CLASSES = [
  { key: "small", minDeg: 5, maxDeg: 12, share: 0.35 },
  { key: "medium", minDeg: 12, maxDeg: 28, share: 0.4 },
  { key: "large", minDeg: 28, maxDeg: 50, share: 0.25 },
] as const;

export type FlickDistanceClass = (typeof FLICK_DISTANCE_CLASSES)[number]["key"];

const TARGET_RADIUS_DEG = { min: 1.2, max: 2.2 } as const;
const RESET_RADIUS_DEG = 3;

/**
 * The distance class for a trial index, from a fixed repeating pattern.
 *
 * Deterministic rather than sampled, so the mix is exactly the declared one for every candidate
 * — a random draw would give one candidate more large flicks than another purely by chance,
 * and large flicks are where sensitivity differences are widest.
 */
export function distanceClassFor(trialIndex: number): FlickDistanceClass {
  // A 20-trial cycle reproduces 35/40/25 exactly, and any prefix of it stays close.
  const cycle: FlickDistanceClass[] = [
    "medium",
    "small",
    "large",
    "medium",
    "small",
    "medium",
    "large",
    "small",
    "medium",
    "large",
    "small",
    "medium",
    "medium",
    "small",
    "large",
    "medium",
    "small",
    "large",
    "medium",
    "small",
  ];
  return cycle[trialIndex % cycle.length] as FlickDistanceClass;
}

/** The direction class for a trial index, cycling so every class is evenly sampled. */
export function directionClassFor(trialIndex: number): DirectionClass {
  const cycle: DirectionClass[] = ["horizontal", "diagonal", "vertical", "diagonal"];
  return cycle[trialIndex % cycle.length] as DirectionClass;
}

/** Places one flick target as an offset, given its distance and direction classes. */
export function flickOffset(
  rng: TestRng,
  distanceClass: FlickDistanceClass,
  directionClass: DirectionClass,
): { yawDeg: number; pitchDeg: number; distanceDeg: number; directionDeg: number } {
  const band = FLICK_DISTANCE_CLASSES.find((entry) => entry.key === distanceClass);
  if (band === undefined) throw new Error(`unknown flick distance class "${distanceClass}"`);

  const distanceDeg = rng.nextRange(band.minDeg, band.maxDeg);
  const range = rangeForDirectionClass(rng, directionClass);
  const directionDeg = rng.nextRange(range.from, range.to);
  const radians = (directionDeg * Math.PI) / 180;

  return {
    yawDeg: distanceDeg * Math.cos(radians),
    pitchDeg: distanceDeg * Math.sin(radians),
    distanceDeg,
    directionDeg,
  };
}

export const flickTest: TestDefinition = {
  key: "flick",
  version: 1,
  category: "scored",
  instructionsKey: "test.flick.instructions",
  displayNameKey: "test.flick.name",

  trialCount: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 18 : 12),
  minValidTrials: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 18 : 12),
  practiceTrialCount: () => 6,

  timeoutMs: 5000,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "first_hit",
  shootingModel: "click",
  // 1500 ms of stillness after the stimulus means the player never engaged; below this many
  // counts the trial is `no_input` rather than `timeout` (doc 09 §9.2).
  minMovementCounts: 60,

  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[] {
    const offset = flickOffset(
      rng,
      distanceClassFor(context.trialIndex),
      directionClassFor(context.trialIndex),
    );
    const radius = rng.nextRange(TARGET_RADIUS_DEG.min, TARGET_RADIUS_DEG.max);

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: RESET_RADIUS_DEG, role: "reset" },
      {
        yawDeg: offset.yawDeg,
        pitchDeg: offset.pitchDeg,
        angularRadiusDeg: radius,
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  variantFor(_rng, context) {
    // Recorded so a per-distance-class breakdown needs no inference: a sensitivity that is good
    // for small flicks and bad for large ones is a real and diagnostic pattern (doc 09 §9.2).
    return distanceClassFor(context.trialIndex);
  },

  additionalInvalidReasons: ["premature_movement"],
  metricKeys: [
    "targetAcquisitionTime",
    "adjustedAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "firstShotAccuracy",
    "hitAccuracy",
    "flickError",
    "flickErrorNorm",
    "overshootRate",
    "overshootMagnitudeNorm",
    "undershootRate",
    "correctionCount",
    "pathEfficiency",
    "qualityScore",
  ],
  primaryMetricKey: "adjustedAcquisitionTime",
};

/** Re-exported so the UI can describe the direction mix without importing placement. */
export { classifyDirection };
