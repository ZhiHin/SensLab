import type { MotionPattern, TargetSpec, TestDefinition } from "../contracts";

/**
 * The Reaction Test (doc 09 §9.1).
 *
 * ## It never influences the recommendation
 *
 * `SENS-BR-006`. Reaction time is a property of the *player*, not of the sensitivity, so
 * letting it into the candidate comparison would add variance without adding signal — and
 * would let a tired player's slow round look like a bad sensitivity. Its category is
 * `baseline`, it runs once per session rather than once per candidate, and `reactionTime` is
 * marked `isDecisionMetric: false` in the registry.
 *
 * What it is *for* is decomposition. `targetAcquisitionTime` contains a reaction term, and
 * knowing a player's floor is what makes the onset-adjusted acquisition metric interpretable
 * (doc 10 §10.2).
 *
 * ## The correctness trap
 *
 * The onset timestamp must be the presentation frame's time — the `requestAnimationFrame`
 * callback that painted the target — not the moment the trial decided to show it. The engine
 * presents the stimulus inside the frame callback, so `stimulusAt` *is* that timestamp. Getting
 * this wrong would add the scheduling delay to every reaction time, and the error would look
 * entirely plausible.
 *
 * Display latency is unknown and uncorrected. It is a roughly constant offset that cancels in
 * every comparison SensLab makes, and is documented rather than guessed at.
 */

/** Wide enough that the interval cannot be anticipated (doc 09 §9.1, TUNABLE). */
const BLANK_INTERVAL_MS = { min: 800, max: 2600 } as const;
const TARGET_RADIUS_DEG = 3.0;

export const reactionTest: TestDefinition = {
  key: "reaction",
  version: 1,
  category: "baseline",
  instructionsKey: "test.reaction.instructions",
  displayNameKey: "test.reaction.name",

  trialCount: () => 8,
  minValidTrials: () => 8,
  practiceTrialCount: () => 3,

  timeoutMs: 1200,
  // The blank interval *is* the inter-trial interval: input during it is recorded but not
  // scored, which is exactly what makes a premature click detectable.
  interTrialIntervalMs: BLANK_INTERVAL_MS,
  endCondition: "single_shot",
  shootingModel: "click",
  // Movement is ignored: with a live camera the player could pre-aim, and the test would
  // measure aiming rather than reaction.
  cameraEnabled: false,
  minMovementCounts: 0,

  spawn(): readonly TargetSpec[] {
    // At the crosshair, so there is nothing to aim at — only something to respond to.
    return [{ yawDeg: 0, pitchDeg: 0, angularRadiusDeg: TARGET_RADIUS_DEG, role: "scored" }];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  additionalInvalidReasons: ["premature_click"],
  metricKeys: ["reactionTime", "prematureClickRate", "qualityScore"],
  primaryMetricKey: "reactionTime",
};
