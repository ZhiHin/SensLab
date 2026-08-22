import { angularDistance } from "../../core/geometry/angular";
import type {
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "../contracts";

/**
 * The Target Switching Test (doc 09 §9.5).
 *
 * The closest analogue in the battery to a multi-opponent engagement, and a strong
 * discriminator between sensitivities that are *fast but unstable* and *slow but reliable* —
 * a distinction single-target tests struggle to make, because a single target gives a player
 * time to settle.
 *
 * ## A trial is a sequence, not a shot
 *
 * Five targets are visible at once. Each kill immediately respawns a target elsewhere, so the
 * player is never waiting. The trial ends after eight kills or twelve seconds, and each kill
 * after the first contributes a switching measurement.
 *
 * ## Why respawns are re-seeded rather than fixed
 *
 * Route optimisation is a real skill and is not removed. But a *memorised* route is not — so
 * every respawn is drawn fresh, and placed relative to where the crosshair actually is at that
 * moment rather than where the trial began. Two candidates get the same seed for the same round
 * index, so they face equivalent spatial problems (doc 13 §13.6).
 */

const SIMULTANEOUS_TARGETS = 5;
export const KILL_TARGET = 8;
/** Procedural floor, far below any plausible genuine attempt (doc 09 §9.5). */
export const MIN_KILLS = 4;

const DISTANCE_DEG = { min: 8, max: 35 } as const;
const RADIUS_DEG = { min: 1.5, max: 2.5 } as const;
/** Minimum separation between two live targets, so one click cannot resolve two engagements. */
const SEPARATION_DEG = 10;
/** No target spawns closer than this to the crosshair: that would be a free hit, not a switch. */
const MIN_FROM_CROSSHAIR_DEG = 8;

/**
 * Draws one target offset, respecting separation from targets already placed this call.
 *
 * Bounded rejection sampling: on exhaustion it returns the best candidate found rather than
 * looping, because a trial that never starts is worse than one whose targets are slightly
 * closer together than ideal.
 */
function drawOffset(
  rng: TestRng,
  placed: readonly { yawDeg: number; pitchDeg: number }[],
): { yawDeg: number; pitchDeg: number } {
  let best: { yawDeg: number; pitchDeg: number } | null = null;
  let bestSeparation = -Infinity;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const distanceDeg = rng.nextRange(DISTANCE_DEG.min, DISTANCE_DEG.max);
    const directionDeg = rng.nextRange(0, 360);
    const radians = (directionDeg * Math.PI) / 180;
    const candidate = {
      yawDeg: distanceDeg * Math.cos(radians),
      pitchDeg: distanceDeg * Math.sin(radians),
    };

    if (distanceDeg < MIN_FROM_CROSSHAIR_DEG) continue;

    const separation = placed.reduce(
      (smallest, other) =>
        Math.min(
          smallest,
          angularDistance(
            { yawDeg: candidate.yawDeg, pitchDeg: candidate.pitchDeg },
            { yawDeg: other.yawDeg, pitchDeg: other.pitchDeg },
          ),
        ),
      Infinity,
    );

    if (separation >= SEPARATION_DEG) return candidate;
    if (separation > bestSeparation) {
      bestSeparation = separation;
      best = candidate;
    }
  }

  return best ?? { yawDeg: DISTANCE_DEG.min, pitchDeg: 0 };
}

export const switchingTest: TestDefinition = {
  key: "switching",
  version: 1,
  category: "scored",
  instructionsKey: "test.switching.instructions",
  displayNameKey: "test.switching.name",

  // A "trial" here is a whole sequence, which is why the counts are so much smaller: two
  // sequences yield fourteen switching measurements (doc 09 §9.5).
  trialCount: (mode) => (mode === "quick" ? 1 : mode === "advanced" ? 3 : 2),
  minValidTrials: (mode) => (mode === "quick" ? 1 : mode === "advanced" ? 3 : 2),
  practiceTrialCount: () => 1,

  timeoutMs: 12_000,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "kill_count",
  shootingModel: "click",
  killTarget: KILL_TARGET,
  minKills: MIN_KILLS,
  minMovementCounts: 120,

  spawn(rng: TestRng): readonly TargetSpec[] {
    const placed: { yawDeg: number; pitchDeg: number }[] = [];
    const specs: TargetSpec[] = [];

    for (let i = 0; i < SIMULTANEOUS_TARGETS; i += 1) {
      const offset = drawOffset(rng, placed);
      placed.push(offset);
      specs.push({
        yawDeg: offset.yawDeg,
        pitchDeg: offset.pitchDeg,
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      });
    }

    return specs;
  },

  respawn(rng: TestRng, _context: TrialContext): readonly TargetSpec[] {
    // Placed relative to the live crosshair, which the engine supplies on the context — a
    // respawn measured from the trial's origin would sometimes land under the player's
    // current aim and hand them a free kill.
    const offset = drawOffset(rng, []);
    return [
      {
        yawDeg: offset.yawDeg,
        pitchDeg: offset.pitchDeg,
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  additionalInvalidReasons: ["insufficient_kills"],
  metricKeys: [
    "switchingTime",
    "switchingTravelTime",
    "targetAcquisitionTime",
    "hitAccuracy",
    "firstShotAccuracy",
    "overshootRate",
    "pathEfficiency",
    "qualityScore",
  ],
  primaryMetricKey: "switchingTravelTime",
};
