import type { MotionPattern, TargetSpec, TestDefinition, TrialContext } from "../contracts";
import { COMFORT_HALF_TURN, COMFORT_RETURN, COMFORT_SWIPE } from "../metrics/comfort";

/**
 * The 360 Comfort Test (doc 09 §9.7).
 *
 * ## Not a performance test
 *
 * This measures a **workspace**, not a capability: desk depth, pad width, grip, reach. It
 * produces a hard physical constraint on the search range so SensLab cannot recommend a
 * sensitivity the player is physically unable to use — a recommendation that requires 45 cm of
 * pad to a player with 25 cm is not a stretch goal, it is unusable.
 *
 * Copy must stay neutral for the same reason. "As far as you comfortably can" is not a
 * challenge, and users may enter a pad width instead of performing the test at all — a path
 * doc 09 requires to be equally prominent.
 *
 * ## Three sub-tasks, three trials each
 *
 * | Variant           | Task                                     | What it yields          |
 * |-------------------|------------------------------------------|-------------------------|
 * | `swipe`           | Turn as far as comfortable in one motion | `maxSingleSwipeDeg`     |
 * | `half_turn`       | Turn to face exactly behind you          | `time180`, `liftCount180` |
 * | `return`          | Return to the marked heading             | `returnErrorDeg`        |
 *
 * The sub-task is declared through `variantFor` rather than inferred from the trial index, so
 * a metric derivation never has to guess which quantity it is looking at — and the three are
 * genuinely different quantities, not three samples of one.
 *
 * ## No targets
 *
 * There is nothing to hit. A click confirms the end of an attempt, which is why the end
 * condition is `single_shot` with no scored target: the player declares when they are done,
 * and that declaration is the measurement.
 */

export const COMFORT_VARIANTS = [COMFORT_SWIPE, COMFORT_HALF_TURN, COMFORT_RETURN] as const;
/** Three attempts per sub-task; the median of three is what survives an unlucky attempt. */
export const ATTEMPTS_PER_VARIANT = 3;

export function comfortVariantFor(trialIndex: number): string {
  // Grouped rather than interleaved: switching task every trial would make the instructions
  // the dominant cost of the test.
  const index = Math.floor(trialIndex / ATTEMPTS_PER_VARIANT) % COMFORT_VARIANTS.length;
  return COMFORT_VARIANTS[index] as string;
}

export const comfort360Test: TestDefinition = {
  key: "comfort360",
  version: 1,
  category: "constraint",
  instructionsKey: "test.comfort360.instructions",
  displayNameKey: "test.comfort360.name",

  trialCount: () => COMFORT_VARIANTS.length * ATTEMPTS_PER_VARIANT,
  minValidTrials: () => COMFORT_VARIANTS.length,
  // One guided attempt, heavily instructed — this is the test users most often misunderstand.
  practiceTrialCount: () => 1,

  timeoutMs: 15_000,
  interTrialIntervalMs: { min: 600, max: 900 },
  endCondition: "single_shot",
  shootingModel: "click",
  minMovementCounts: 0,

  spawn(): readonly TargetSpec[] {
    // Nothing to hit. The horizon reference and marked heading are drawn by the surface, not
    // spawned as targets, because they are not engageable.
    return [];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  variantFor(_rng, context: TrialContext): string {
    return comfortVariantFor(context.trialIndex);
  },

  additionalInvalidReasons: [],
  metricKeys: ["maxSingleSwipeDeg", "liftCount180", "time180", "returnErrorDeg", "qualityScore"],
  // No primary metric: the three sub-tasks measure different quantities, so a single
  // "consistency" figure across them would be meaningless.
};
