import type { MotionPattern, TargetSpec, TestDefinition, TestRng } from "../contracts";

/**
 * The Tracking Test (doc 09 §9.4).
 *
 * ## Why it earns its place in a short battery
 *
 * The tracking optimum frequently sits at a **different sensitivity** than the flicking
 * optimum. Measuring both is what lets the recommendation express a genuine trade-off instead
 * of quietly optimising one skill and calling it "your sensitivity". A battery with only click
 * tests would produce a confident number that is wrong for half of what the player does.
 *
 * ## Trials are long, so there are few of them
 *
 * Five trials, not twelve. Each trial contains ~5 s of continuous error sampling at the mouse's
 * polling rate — statistically that is many samples, not one — and long trials fatigue players
 * faster than short ones (doc 09 §9.4).
 *
 * ## Pattern selection
 *
 * The mix is fixed per trial index rather than sampled, so every candidate faces the same
 * patterns in the same order. `random_smooth` exists specifically to defeat memorisation: a sum
 * of sinusoids at incommensurate frequencies has no repeating period a player can learn within
 * a trial, while remaining continuous and differentiable.
 */

/** doc 09 §9.4 — bounded so the task stays trackable at every candidate sensitivity. */
export const SPEED_DEG_PER_SEC = { min: 20, max: 90 } as const;
const RADIUS_DEG = { min: 1.2, max: 2.0 } as const;
/** TUNABLE — long enough to measure, short enough not to fatigue. */
export const TRACKING_DURATION_MS = 5000;

export type TrackingPattern = "horizontal" | "vertical" | "diagonal" | "circular" | "random-smooth";

const PATTERN_CYCLE: readonly TrackingPattern[] = [
  "horizontal",
  "random-smooth",
  "circular",
  "vertical",
  "diagonal",
];

export function patternFor(trialIndex: number): TrackingPattern {
  return PATTERN_CYCLE[trialIndex % PATTERN_CYCLE.length] as TrackingPattern;
}

/**
 * Amplitude and period for a sweep, chosen so peak angular speed lands inside the bound.
 *
 * For `A·sin(ωt)` the peak speed is `A·ω`, so picking the speed first and solving for the
 * amplitude is what keeps a slow, wide sweep and a fast, narrow one both inside the envelope —
 * rather than drawing both freely and hoping.
 */
function sweep(rng: TestRng): { amplitudeDeg: number; periodMs: number } {
  const peakSpeed = rng.nextRange(SPEED_DEG_PER_SEC.min, SPEED_DEG_PER_SEC.max);
  const periodMs = rng.nextRange(1400, 2800);
  const omega = (2 * Math.PI) / (periodMs / 1000);
  return { amplitudeDeg: peakSpeed / omega, periodMs };
}

export const trackingTest: TestDefinition = {
  key: "tracking",
  version: 1,
  category: "scored",
  instructionsKey: "test.tracking.instructions",
  displayNameKey: "test.tracking.name",

  trialCount: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 8 : 5),
  minValidTrials: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 8 : 5),
  practiceTrialCount: () => 2,

  // For a `duration` end condition this is the measured duration, not a timeout: the trial
  // ends when its time is up, and that is its success condition.
  timeoutMs: TRACKING_DURATION_MS,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "duration",
  shootingModel: "hold",
  minHeldRatio: 0.7,
  minMovementCounts: 60,

  spawn(rng: TestRng): readonly TargetSpec[] {
    // Offset from the crosshair so the trial starts with a small acquisition rather than the
    // target already under the crosshair, which would give away free time-on-target.
    const startDistanceDeg = rng.nextRange(4, 9);
    const directionDeg = rng.nextRange(0, 360);
    const radians = (directionDeg * Math.PI) / 180;

    return [
      {
        yawDeg: startDistanceDeg * Math.cos(radians),
        pitchDeg: startDistanceDeg * Math.sin(radians),
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(rng: TestRng, context): MotionPattern {
    const pattern = patternFor(context.trialIndex);
    const phase = rng.nextRange(0, 2 * Math.PI);

    switch (pattern) {
      case "horizontal": {
        const { amplitudeDeg, periodMs } = sweep(rng);
        return { kind: "sinusoid", axis: "yaw", amplitudeDeg, periodMs, phase };
      }
      case "vertical": {
        const { amplitudeDeg, periodMs } = sweep(rng);
        // Pitch is bounded to the ±40° band by the engine, and these amplitudes sit far inside
        // it, so the sweep is never silently clipped.
        return { kind: "sinusoid", axis: "pitch", amplitudeDeg, periodMs, phase };
      }
      case "diagonal": {
        const { amplitudeDeg, periodMs } = sweep(rng);
        return { kind: "sinusoid", axis: "both", amplitudeDeg, periodMs, phase };
      }
      case "circular": {
        const { amplitudeDeg, periodMs } = sweep(rng);
        return { kind: "circular", radiusDeg: amplitudeDeg, periodMs, phase };
      }
      case "random-smooth": {
        // Three incommensurate frequencies: continuous, differentiable, and with no period a
        // player could learn inside a five-second trial.
        const base = rng.nextRange(0.0025, 0.0045);
        return {
          kind: "random_smooth",
          components: [
            { amplitudeDeg: rng.nextRange(3, 6), angularFrequency: base, phase },
            {
              amplitudeDeg: rng.nextRange(2, 4),
              angularFrequency: base * Math.SQRT2,
              phase: rng.nextRange(0, 2 * Math.PI),
            },
            {
              amplitudeDeg: rng.nextRange(1, 3),
              angularFrequency: base * Math.PI,
              phase: rng.nextRange(0, 2 * Math.PI),
            },
          ],
        };
      }
    }
  },

  variantFor(_rng, context) {
    return patternFor(context.trialIndex);
  },

  additionalInvalidReasons: ["button_held_ratio_low"],
  metricKeys: [
    "trackingAccuracy",
    "trackingError",
    "trackingStability",
    "correctionFrequency",
    "trackingBias",
    "qualityScore",
  ],
  primaryMetricKey: "trackingError",
};
