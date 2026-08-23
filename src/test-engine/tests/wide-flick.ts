import type {
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "../contracts";

/**
 * The Wide Flick Test (doc 09 §9.8).
 *
 * Large-angle acquisition, where physical travel limits and arm mechanics dominate. It
 * separates a sensitivity that works for duels from one that works for repositioning — and it
 * is the one scored test whose result feeds the **physical-constraint** model, because a
 * sensitivity at which a 180° turn reliably needs a lift is a fact about the player's desk,
 * not about their aim.
 *
 * ## Exact balance, not randomisation
 *
 * Direction asymmetry is strong at large angles: turning across the body differs from turning
 * away. Left and right are therefore **exactly** balanced within every angle class, by a fixed
 * cycle, rather than merely randomised. A candidate that happened to draw more of a player's
 * good direction would score better for a reason that has nothing to do with sensitivity.
 *
 * The jitter (±5°) exists so the exact angle is not learnable; the class is.
 */

/** doc 09 §9.8 — the four angle classes. */
export const WIDE_FLICK_ANGLES_DEG = [45, 90, 135, 180] as const;
export type WideFlickAngle = (typeof WIDE_FLICK_ANGLES_DEG)[number];

export const WIDE_FLICK_JITTER_DEG = 5;
const TARGET_RADIUS_DEG = { min: 2.5, max: 3.5 } as const;
const RESET_RADIUS_DEG = 3;

/**
 * Angle class and direction for a trial index.
 *
 * An eight-trial cycle covers every (class, direction) pair exactly once — which is why the
 * per-round minimum is eight (doc 09 §9.8) — and any multiple of eight stays perfectly balanced.
 */
export function wideFlickClassFor(trialIndex: number): {
  readonly angleDeg: WideFlickAngle;
  readonly direction: "left" | "right";
} {
  const cycle = [
    { angleDeg: 90, direction: "right" },
    { angleDeg: 45, direction: "left" },
    { angleDeg: 180, direction: "right" },
    { angleDeg: 135, direction: "left" },
    { angleDeg: 90, direction: "left" },
    { angleDeg: 45, direction: "right" },
    { angleDeg: 180, direction: "left" },
    { angleDeg: 135, direction: "right" },
  ] as const;
  return cycle[trialIndex % cycle.length] as (typeof cycle)[number];
}

export const wideFlickTest: TestDefinition = {
  key: "wide-flick",
  version: 1,
  category: "scored",
  instructionsKey: "test.wide-flick.instructions",
  displayNameKey: "test.wide-flick.name",

  trialCount: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 16 : 8),
  minValidTrials: (mode) => (mode === "quick" ? 8 : mode === "advanced" ? 16 : 8),
  practiceTrialCount: () => 4,

  timeoutMs: 6000,
  interTrialIntervalMs: { min: 400, max: 800 },
  endCondition: "first_hit",
  shootingModel: "click",
  // A 45° turn at any admissible sensitivity is far more than this.
  minMovementCounts: 80,

  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[] {
    const { angleDeg, direction } = wideFlickClassFor(context.trialIndex);
    const jitter = rng.nextRange(-WIDE_FLICK_JITTER_DEG, WIDE_FLICK_JITTER_DEG);
    const yawDeg = (direction === "right" ? 1 : -1) * (angleDeg + jitter);
    // A little pitch, so the target is not always on the horizon line — relative to the
    // *horizon*, not to the camera. Offsets are normally camera-relative (doc 09 §9.0.1), but
    // a large yaw offset from a camera that has drifted towards the ±40° band is geometrically
    // far shorter than the angle class claims: 180° of yaw at 40° of pitch is a 94° turn.
    // Anchoring pitch to the horizon keeps "180°" meaning 180°.
    const pitchDeg = rng.nextRange(-6, 6) - context.cameraAngles.pitchDeg;

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: RESET_RADIUS_DEG, role: "reset" },
      {
        yawDeg,
        pitchDeg,
        angularRadiusDeg: rng.nextRange(TARGET_RADIUS_DEG.min, TARGET_RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  variantFor(_rng, context) {
    // The per-angle-class breakdown is the point of the test; the class is recorded so it
    // never has to be inferred from the measured distance.
    return `deg${wideFlickClassFor(context.trialIndex).angleDeg}`;
  },

  additionalInvalidReasons: ["premature_movement"],
  metricKeys: [
    "targetAcquisitionTime",
    "adjustedAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "firstShotAccuracy",
    "flickError",
    "flickErrorNorm",
    "overshootRate",
    "correctionCount",
    "liftDetected",
    "qualityScore",
  ],
  primaryMetricKey: "adjustedAcquisitionTime",
};
