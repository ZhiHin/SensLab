import type {
  DisturbancePattern,
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "../contracts";
import { RECOIL_FAMILIES, generateRecoil, type RecoilFamily } from "../targets/disturbance";

/**
 * The Recoil Control Simulation (doc 09 §9.12).
 *
 * The player holds fire on a static target while the engine pushes the camera along a
 * generated recoil curve; what is measured is how well they pull against it. It is weighted
 * for **Control** rather than treated as a skill benchmark, because a player experienced with
 * some game's real patterns may over- or under-compensate against a generated one — and that
 * is a fact about their habits, not about the sensitivity.
 *
 * ## Original patterns, by construction
 *
 * Every pattern is drawn from a parametric family seeded by the session (`targets/disturbance`).
 * No game's recoil is reproduced, sampled or approximated. The family label is recorded as the
 * trial variant so results are comparable across candidates without the pattern itself being
 * memorisable — the same family, a different draw.
 *
 * ## Trial shape
 *
 * ```
 *   stimulus ── player presses and holds ── burst (held time) ── burst over ── recovery ── end
 * ```
 *
 * The burst develops as a function of *held* time, so a late press simply shifts it. The trial
 * runs to a fixed duration from the stimulus, leaving a recovery window after the burst in
 * which `recoilRecoveryTime` is measured.
 */

export const RECOIL_TRIAL_MS = 2200;
/** doc 09 §9.12 — TUNABLE. */
export const RECOIL_BURST_MS = 1200;
export const RECOIL_SHOT_INTERVAL_MS = 90;
const RADIUS_DEG = { min: 1.6, max: 2.4 } as const;

/** The family for a trial index. Cycled so every candidate meets each family equally often. */
export function recoilFamilyFor(trialIndex: number): RecoilFamily {
  return RECOIL_FAMILIES[trialIndex % RECOIL_FAMILIES.length] as RecoilFamily;
}

export const recoilTest: TestDefinition = {
  key: "recoil",
  version: 1,
  category: "scored",
  instructionsKey: "test.recoil.instructions",
  displayNameKey: "test.recoil.name",

  trialCount: (mode) => (mode === "quick" ? 4 : mode === "advanced" ? 8 : 6),
  minValidTrials: (mode) => (mode === "quick" ? 4 : mode === "advanced" ? 8 : 6),
  practiceTrialCount: () => 3,

  timeoutMs: RECOIL_TRIAL_MS,
  interTrialIntervalMs: { min: 300, max: 700 },
  endCondition: "duration",
  shootingModel: "hold",
  // The player reacts, presses, and holds through the burst. Half the trial held is the floor
  // below which the burst cannot have completed.
  minHeldRatio: 0.5,
  minMovementCounts: 30,

  spawn(rng: TestRng): readonly TargetSpec[] {
    // Close to the crosshair: the task is holding on, not getting there.
    return [
      {
        yawDeg: rng.nextRange(-1.5, 1.5),
        pitchDeg: rng.nextRange(-1, 1),
        angularRadiusDeg: rng.nextRange(RADIUS_DEG.min, RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  disturbanceFor(rng: TestRng, context: TrialContext): DisturbancePattern {
    return generateRecoil(rng, {
      family: recoilFamilyFor(context.trialIndex),
      burstMs: RECOIL_BURST_MS,
      shotIntervalMs: RECOIL_SHOT_INTERVAL_MS,
    });
  },

  variantFor(_rng, context) {
    return recoilFamilyFor(context.trialIndex);
  },

  additionalInvalidReasons: ["button_held_ratio_low"],
  metricKeys: [
    "recoilDeviationVertical",
    "recoilDeviationHorizontal",
    "recoilCompensationGain",
    "recoilRecoveryTime",
    "stabilityUnderRecoil",
    "qualityScore",
  ],
  primaryMetricKey: "recoilDeviationVertical",
};
