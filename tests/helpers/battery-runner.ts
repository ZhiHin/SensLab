import { countsPer360 } from "@/core/types/brand";
import type { ScopeKey } from "@/core/types/vocabulary";
import type { RoundAggregate, SessionPlan, TestDefinition } from "@/test-engine/contracts";
import { createEngine } from "@/test-engine/engine";
import { createStandardCollector } from "@/test-engine/metrics";
import { createSingleTestPlan } from "@/test-engine/plan/single-test";
import { createHarness } from "./engine-harness";

/**
 * Runs one test to completion with a synthetic, deliberately competent player.
 *
 * The player reads targets from the renderer, exactly as a human reads them from the screen.
 * Anything it could not see, it does not aim at. It is not a realistic human — the Phase 4
 * synthetic players are — but it proves that the lifecycle, the stimulus, the view changes,
 * the disturbance and the metric pipeline all connect for a given definition.
 *
 * Shared by the MVP battery (Phase 3) and the advanced battery (Phase 6).
 */

export const BATTERY_FRAME_MS = 1000 / 240;
export const BATTERY_COUNTS = countsPer360(9448.82);

export interface BatteryRunOptions {
  readonly seed?: string;
  readonly scopeKey?: ScopeKey;
  /** Player reach in counts, for the `pathTruncated` interaction (doc 09 §9.10). */
  readonly maxSingleSwipeCounts?: number;
  /**
   * How well the player compensates a disturbance, 0–1. 1 pulls against it exactly, 0 does
   * nothing. Only the recoil test reads this.
   */
  readonly compensation?: number;
  /** Extra delay, in frames, before the player reacts to a reversal or acceleration. */
  readonly reactionFrames?: number;
  /**
   * Largest angular step the player makes in one frame. Bounds hand speed so acquisition
   * traces have an onset, a ballistic phase and a stop rather than a single teleport.
   */
  readonly maxStepDeg?: number;
  readonly plan?: SessionPlan;
}

export interface BatteryRunOutcome {
  readonly aggregates: readonly RoundAggregate[];
  readonly measured: RoundAggregate;
  readonly frames: number;
}

export function runBattery(
  definition: TestDefinition,
  options: BatteryRunOptions = {},
): BatteryRunOutcome {
  const { clock, input, renderer } = createHarness(1000);
  const aggregates: RoundAggregate[] = [];
  const compensation = options.compensation ?? 1;
  const reactionFrames = options.reactionFrames ?? 0;
  const maxStepDeg = options.maxStepDeg ?? 2;

  const basePlan =
    options.plan ??
    createSingleTestPlan({
      sessionId: "00000000-0000-7000-8000-00000000test",
      seed: options.seed ?? "battery-seed",
      mode: "quick",
      definition,
      countsPer360: BATTERY_COUNTS,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      ...(options.scopeKey === undefined ? {} : { scopeKey: options.scopeKey }),
    });

  const plan: SessionPlan =
    options.maxSingleSwipeCounts === undefined
      ? basePlan
      : {
          ...basePlan,
          physicalConstraint: { maxSingleSwipeCounts: options.maxSingleSwipeCounts },
        };

  const engine = createEngine({
    plan,
    definitions: [definition],
    clock,
    input,
    renderer,
    collector: createStandardCollector(),
    frameBudgetMs: BATTERY_FRAME_MS,
    callbacks: { onRoundComplete: (aggregate) => aggregates.push(aggregate) },
  });

  engine.init();
  engine.startUnlocked();

  let holding = false;
  let sweepFrames = 0;
  // A short queue so the player can be given a reaction delay: it aims at where the target
  // *was* `reactionFrames` ago.
  const seenPositions: { yawDeg: number; pitchDeg: number }[] = [];

  for (let frame = 0; frame < 60_000 && engine.state === "running"; frame += 1) {
    clock.tick(BATTERY_FRAME_MS);
    const now = clock.now();
    const drawn = renderer.lastFrame;
    if (drawn === null) continue;

    const camera = engine.camera;
    const perCount = camera.degreesPerCount;
    const active = engine.trialPhase === "active";

    if (definition.key === "comfort360") {
      if (!active) {
        sweepFrames = 0;
        continue;
      }
      sweepFrames += 1;
      if (sweepFrames < 40) {
        input.move(now, 20 / perCount, 0);
      } else if (sweepFrames === 45) {
        input.click(now + 0.5);
      }
      continue;
    }

    const target = drawn.targets.living()[0];
    if (target === undefined) {
      if (holding) {
        input.release(now);
        holding = false;
      }
      seenPositions.length = 0;
      continue;
    }

    const live = drawn.targets.positionAt(target, now);
    seenPositions.push(live);
    const position =
      seenPositions.length > reactionFrames
        ? (seenPositions[seenPositions.length - 1 - reactionFrames] as typeof live)
        : live;

    // The camera the player sees includes any disturbance. A perfect compensator aims at the
    // target regardless; a partial one leaves a fraction of the push uncorrected — it pulls
    // against the disturbance by the compensation fraction, which is what the gain should read.
    const uncorrected = 1 - compensation;
    const aimYaw = position.yawDeg + camera.disturbance.yawDeg * uncorrected;
    const aimPitch = position.pitchDeg + camera.disturbance.pitchDeg * uncorrected;
    let stepYaw = aimYaw - camera.yawDeg;
    let stepPitch = aimPitch - camera.pitchDeg;
    const stepLength = Math.hypot(stepYaw, stepPitch);
    if (stepLength > maxStepDeg) {
      stepYaw *= maxStepDeg / stepLength;
      stepPitch *= maxStepDeg / stepLength;
    }
    const dx = stepYaw / perCount;
    const dy = -stepPitch / perCount;
    if (dx !== 0 || dy !== 0) input.move(now, dx, dy);

    if (definition.shootingModel === "hold") {
      if (active && !holding) {
        input.press(now + 0.25);
        holding = true;
      }
      continue;
    }

    input.click(now + 0.5);
  }

  const measured = aggregates.find((round) => !round.isPractice);
  if (measured === undefined) {
    throw new Error(`${definition.key} produced no measured round in the frame budget`);
  }

  return { aggregates, measured, frames: renderer.drawCount };
}
