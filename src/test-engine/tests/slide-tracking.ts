import type { MotionPattern, TargetSpec, TestDefinition, TestRng } from "../contracts";
import { concatProfiles, slideProfile } from "../targets/profiles";

/**
 * The Slide Tracking Test (doc 09 §9.10).
 *
 * High-speed lateral movement with acceleration and deceleration: does the sensitivity support
 * fast, movement-heavy engagements without losing control? At very high sensitivities this
 * test flatters; at very low ones the required physical travel may exceed the player's desk,
 * which is why `pathTruncated` exists and why it is a *recorded fact* rather than an exclusion
 * rule applied silently.
 *
 * ## Two slides per trial
 *
 * A single slide at 120–220°/s across a wide span is over in well under a second, and a four
 * second trial with one of them is mostly waiting. Each trial therefore runs a slide out and a
 * slide back, with independently drawn profiles, so the player tracks acceleration in both
 * directions and the trial's time is spent measuring.
 */

export const SLIDE_DURATION_MS = 4000;
/** doc 09 §9.10 — TUNABLE. */
export const SLIDE_PEAK_SPEED_DEG_PER_SEC = { min: 120, max: 220 } as const;
export const SLIDE_SPAN_DEG = { min: 55, max: 95 } as const;
const RADIUS_DEG = { min: 2.0, max: 3.0 } as const;

/** Draws one slide's profile parameters. The shape varies so the timing is not learnable. */
function drawSlide(rng: TestRng, spanSign: 1 | -1, leadInMs: number) {
  return {
    spanDeg: spanSign * rng.nextRange(SLIDE_SPAN_DEG.min, SLIDE_SPAN_DEG.max),
    peakSpeedDegPerSec: rng.nextRange(
      SLIDE_PEAK_SPEED_DEG_PER_SEC.min,
      SLIDE_PEAK_SPEED_DEG_PER_SEC.max,
    ),
    accelerateFraction: rng.nextRange(0.2, 0.38),
    decelerateFraction: rng.nextRange(0.2, 0.38),
    leadInMs,
  };
}

/**
 * Which way the first slide runs, from the trial index.
 *
 * Alternated rather than drawn so the spawn hook and the motion hook agree without sharing a
 * random draw, and so every candidate sees the same left/right mix (doc 09 §9.8's balance
 * argument applies here too).
 */
export function slideDirectionFor(trialIndex: number): 1 | -1 {
  return trialIndex % 2 === 0 ? 1 : -1;
}

/** Total angular travel a profile demands of the player, degrees. */
export function slideTravelDeg(pattern: MotionPattern): number {
  if (pattern.kind !== "segments") return 0;
  let travel = 0;
  for (const segment of pattern.segments) {
    if (segment.label === "hold") continue;
    const t = segment.durationMs / 1000;
    // Distance covered by a constant-acceleration segment: |v₀·t + ½·a·t²|. No segment here
    // changes sign mid-way, so the magnitude of the displacement is the distance.
    travel += Math.abs(
      segment.startVelocityDegPerSec * t + 0.5 * segment.accelerationDegPerSec2 * t * t,
    );
  }
  return travel;
}

export const slideTrackingTest: TestDefinition = {
  key: "slide-tracking",
  version: 1,
  category: "scored",
  instructionsKey: "test.slide-tracking.instructions",
  displayNameKey: "test.slide-tracking.name",

  trialCount: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 6 : 4),
  minValidTrials: (mode) => (mode === "quick" ? 3 : mode === "advanced" ? 6 : 4),
  practiceTrialCount: () => 2,

  timeoutMs: SLIDE_DURATION_MS,
  interTrialIntervalMs: { min: 300, max: 700 },
  endCondition: "duration",
  shootingModel: "hold",
  minHeldRatio: 0.7,
  minMovementCounts: 120,

  spawn(rng: TestRng, context): readonly TargetSpec[] {
    // The slide starts to one side so the span crosses the player's forward direction rather
    // than running away from it.
    const direction = slideDirectionFor(context.trialIndex);
    return [
      {
        yawDeg: -direction * rng.nextRange(20, 30),
        pitchDeg: rng.nextRange(-3, 3),
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(rng: TestRng, context): MotionPattern {
    // The spawn placed the target on the far side; the slide runs towards and past the centre.
    const direction = slideDirectionFor(context.trialIndex);
    const out = slideProfile(drawSlide(rng, direction, rng.nextRange(350, 550)));
    const back = slideProfile(drawSlide(rng, direction === 1 ? -1 : 1, rng.nextRange(250, 450)));
    return { kind: "segments", axis: "yaw", segments: concatProfiles(out, back) };
  },

  additionalInvalidReasons: ["button_held_ratio_low"],
  metricKeys: [
    "trackingAccuracy",
    "trackingError",
    "peakSpeedTrackingError",
    "accelerationLagMs",
    "trackingStability",
    "pathTruncated",
    "qualityScore",
  ],
  primaryMetricKey: "peakSpeedTrackingError",
};
