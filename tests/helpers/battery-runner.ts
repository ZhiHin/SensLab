import { deriveRng } from "@/core/random";
import { countsPer360 } from "@/core/types/brand";
import type { ScopeKey } from "@/core/types/vocabulary";
import type { RoundAggregate, SessionPlan, TestDefinition } from "@/test-engine/contracts";
import { createEngine } from "@/test-engine/engine";
import { createStandardCollector } from "@/test-engine/metrics";
import { createSingleTestPlan } from "@/test-engine/plan/single-test";
import { ALL_TESTS, getTestDefinition } from "@/test-engine/tests";
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
  /**
   * A skill multiplier per candidate index, so a synthetic session can have a real optimum:
   * the player's hand-speed cap and reaction are scaled by it. 1 is the baseline.
   */
  readonly skillByCandidate?: ReadonlyMap<number, number>;
  /**
   * Seed for the player's own noise, so a synthetic session is reproducible. A candidate with
   * skill below 1 places its first shot with a seeded error proportional to `1 − skill`, so
   * accuracy and overshoot carry the candidate signal as well as speed does.
   */
  readonly playerSeed?: string;
}

export interface BatteryRunOutcome {
  readonly aggregates: readonly RoundAggregate[];
  readonly measured: RoundAggregate;
  readonly frames: number;
}

/**
 * Runs a whole plan — every test it names — with the same synthetic player.
 *
 * The player reads the current round's definition from the engine's stage, so one plan can
 * mix acquisition, hold and comfort tests exactly as a calibration round does.
 */
export function runPlan(plan: SessionPlan, options: BatteryRunOptions = {}): BatteryRunOutcome {
  return runBattery(ALL_TESTS[1] as TestDefinition, { ...options, plan, allDefinitions: true });
}

export function runBattery(
  definition: TestDefinition,
  options: BatteryRunOptions & { readonly allDefinitions?: boolean } = {},
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
    definitions: options.allDefinitions === true ? ALL_TESTS : [definition],
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
  // First-shot placement error for the current target, drawn once per target and dropped
  // after the first shot — the player corrects, as a human does.
  const noise = deriveRng(options.playerSeed ?? "battery-player", "aim-noise");
  let placement = { yawDeg: 0, pitchDeg: 0 };
  let shotFired = false;
  let trackedTargetId: number | null = null;

  const frameBudget = options.allDefinitions === true ? 2_000_000 : 60_000;
  for (let frame = 0; frame < frameBudget && engine.state === "running"; frame += 1) {
    clock.tick(BATTERY_FRAME_MS);
    const now = clock.now();
    const drawn = renderer.lastFrame;
    if (drawn === null) continue;

    const camera = engine.camera;
    const perCount = camera.degreesPerCount;
    const active = engine.trialPhase === "active";
    const stage = engine.stage;
    const current =
      stage.kind === "round" ? (getTestDefinition(stage.round.testKey) ?? definition) : definition;

    // The free-aim warm-up has targets but no round; the player acquires them like any other.
    const candidateIndex = stage.kind === "round" ? stage.round.candidateIndex : null;
    const skill =
      candidateIndex === null ? 1 : (options.skillByCandidate?.get(candidateIndex) ?? 1);

    if (current.key === "reaction") {
      // Reaction: click as soon as the target appears; the camera is disabled anyway.
      if (active && drawn.targets.living().length > 0 && !holding) {
        input.click(now + 0.5);
        holding = true;
      }
      if (!active) holding = false;
      continue;
    }

    if (current.key === "comfort360") {
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
    // A new target — including one that replaces the previous without a gap, as a flick
    // target replaces its reset target — restarts the reaction queue. Otherwise a delayed
    // player aims at where the *old* target was, finds itself already there, and fires.
    if (target.id !== trackedTargetId) {
      trackedTargetId = target.id;
      seenPositions.length = 0;
    }
    if (seenPositions.length === 0) {
      // Relative to the target: a player at skill 0.4 misses about half of first shots, a
      // player at skill 1 never does.
      const error = Math.max(0, 1 - skill) * 1.6 * target.spec.angularRadiusDeg;
      const angle = noise.nextRange(0, 2 * Math.PI);
      placement = { yawDeg: Math.cos(angle) * error, pitchDeg: Math.sin(angle) * error };
      shotFired = false;
    }
    seenPositions.push(live);
    // A less skilled candidate reacts later as well as moving slower, so tracking tests see
    // the difference too — otherwise only the acquisition tests would carry the signal.
    const delay = reactionFrames + Math.round((1 - Math.min(1, skill)) * 24);
    const position =
      seenPositions.length > delay
        ? (seenPositions[seenPositions.length - 1 - delay] as typeof live)
        : live;

    // The camera the player sees includes any disturbance. A perfect compensator aims at the
    // target regardless; a partial one leaves a fraction of the push uncorrected — it pulls
    // against the disturbance by the compensation fraction, which is what the gain should read.
    const uncorrected = 1 - compensation;
    const aimYaw =
      position.yawDeg +
      camera.disturbance.yawDeg * uncorrected +
      (shotFired ? 0 : placement.yawDeg);
    const aimPitch =
      position.pitchDeg +
      camera.disturbance.pitchDeg * uncorrected +
      (shotFired ? 0 : placement.pitchDeg);
    let stepYaw = aimYaw - camera.yawDeg;
    let stepPitch = aimPitch - camera.pitchDeg;
    const stepLength = Math.hypot(stepYaw, stepPitch);
    // Quadratic in skill so that a clumsy candidate is clearly slow — the onset-adjusted
    // acquisition time has the reaction delay removed, so speed has to carry the signal.
    const cap = maxStepDeg * skill * skill;
    if (stepLength > cap) {
      stepYaw *= cap / stepLength;
      stepPitch *= cap / stepLength;
    }
    const dx = stepYaw / perCount;
    const dy = -stepPitch / perCount;
    if (dx !== 0 || dy !== 0) input.move(now, dx, dy);

    if (current.shootingModel === "hold") {
      if (active && !holding) {
        input.press(now + 0.25);
        holding = true;
      }
      continue;
    }

    // Only shoot once the step has landed the crosshair on the target; a competent player
    // does not fire mid-flick. Skill scales how tight "on" has to be.
    const remaining = Math.hypot(aimYaw - camera.yawDeg, aimPitch - camera.pitchDeg);
    if (remaining <= target.spec.angularRadiusDeg * Math.min(1, skill)) {
      input.click(now + 0.5);
      shotFired = true;
    }
  }

  const measured = aggregates.find((round) => !round.isPractice);
  if (measured === undefined) {
    throw new Error(`${definition.key} produced no measured round in the frame budget`);
  }

  return { aggregates, measured, frames: renderer.drawCount };
}
