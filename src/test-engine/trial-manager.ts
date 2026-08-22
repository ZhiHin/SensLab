import type { Angles } from "../core/geometry/angular";
import type { InvalidReason, TrialValidity } from "../core/types/vocabulary";
import type { MotionPattern, TargetSpec, TestDefinition, TestRng, TrialContext } from "./contracts";
import type { Camera } from "./render/camera";
import type { QualityMonitor } from "./quality/quality-monitor";
import type { FrameMonitor, FrameWindowStats } from "./timing/frame-monitor";
import { isDegraded } from "./timing/frame-monitor";
import type { TargetManager, LiveTarget } from "./targets/target-manager";
import type { TelemetryBuffers } from "./telemetry/ring-buffer";

/**
 * Trial lifecycle, validity classification and replacement (doc 19 §19.2, §19.3).
 *
 * One implementation, driven entirely by a `TestDefinition`. **No lifecycle logic lives in a
 * definition** (doc 19 §19.9) — spawning, timing, validity and buffering are all here, which is
 * what makes "adding a test is a new declaration, never an edit to the engine" a testable claim
 * rather than an aspiration.
 *
 * ## The measured window
 *
 * A trial has three phases:
 *
 * ```
 *   ARMED  ── inter-trial interval, input recorded but not scored
 *     │
 *     ▼      stimulus presented; the measured window opens here
 *   ACTIVE ── the player engages
 *     │
 *     ▼
 *   RESOLVED
 * ```
 *
 * When a definition spawns a **reset target**, the measured window opens only once that target
 * is cleared. That guarantees every trial starts from a known, identical camera orientation and
 * stops drift accumulating across a round — and it is generic lifecycle behaviour, not
 * knowledge of any particular test.
 */

export type TrialPhase = "armed" | "active" | "resolved";

export interface TrialOutcome {
  readonly validity: TrialValidity;
  readonly invalidReason: InvalidReason | null;
  readonly hit: boolean | null;
  readonly shots: number;
  readonly firstShotHit: boolean | null;
  readonly stimulusAt: number;
  readonly resolvedAt: number;
  readonly originAngles: Angles;
  readonly targets: readonly LiveTarget[];
  readonly primaryTarget: LiveTarget | null;
  readonly frameStats: FrameWindowStats;
  readonly qualityFlags: readonly string[];
  /** Total mouse counts moved during the measured window. */
  readonly totalCounts: number;
  /** Fraction of the measured window with the fire button held (`hold` tests). */
  readonly heldRatio: number;
}

export interface TrialDependencies {
  readonly camera: Camera;
  readonly targets: TargetManager;
  readonly buffers: TelemetryBuffers;
  readonly frames: FrameMonitor;
  readonly quality: QualityMonitor;
}

export interface TrialRunner {
  readonly phase: TrialPhase;
  readonly trialIndex: number;
  /** Engine time the trial was armed. */
  readonly armedAt: number;
  /** Engine time the stimulus was presented, or null while armed. */
  readonly stimulusAt: number | null;

  /** Advances the trial. Returns the outcome once resolved, else null. */
  tick(now: number): TrialOutcome | null;
  onMove(t: number, dx: number, dy: number): void;
  onButton(t: number, phase: "down" | "up", button: number): void;
  /** Forces resolution — used when the environment faults or the session is paused. */
  abort(now: number, reason: InvalidReason): TrialOutcome;
  readonly outcome: TrialOutcome | null;
}

export interface TrialRunnerOptions {
  readonly definition: TestDefinition;
  readonly context: TrialContext;
  readonly rng: TestRng;
  readonly deps: TrialDependencies;
  readonly startedAt: number;
  /** Pre-computed inter-trial interval, drawn from the timing-jitter stream. */
  readonly interTrialIntervalMs: number;
}

const DEFAULT_MIN_MOVEMENT_COUNTS = 40;

export function createTrialRunner(options: TrialRunnerOptions): TrialRunner {
  const { definition, context, rng, deps, startedAt } = options;
  const { camera, targets, buffers, frames, quality } = deps;

  let phase: TrialPhase = "armed";
  let stimulusAt: number | null = null;
  let resolvedOutcome: TrialOutcome | null = null;

  let shots = 0;
  let firstShotHit: boolean | null = null;
  let hit: boolean | null = null;
  let lastShotAt: number | null = null;
  let kills = 0;
  let prematureShot = false;
  let extraShot = false;

  let buttonDown = false;
  let buttonDownSince: number | null = null;
  let heldMs = 0;

  let totalCounts = 0;
  let originAngles: Angles = camera.angles();
  let primaryTarget: LiveTarget | null = null;
  let resetTargetsRemaining = 0;

  const spawned: TargetSpec[] = [];
  let motion: MotionPattern = { kind: "static" };

  const killTarget = definition.killTarget ?? 1;
  const minMovementCounts = definition.minMovementCounts ?? DEFAULT_MIN_MOVEMENT_COUNTS;
  const minHeldRatio = definition.minHeldRatio ?? 0.7;

  const presentStimulus = (now: number): void => {
    phase = "active";
    stimulusAt = now;
    originAngles = camera.angles();

    camera.resetCounts();
    buffers.reset();
    frames.openWindow();
    quality.openTrial();
    totalCounts = 0;

    motion = definition.motionFor(rng, context);
    const specs = definition.spawn(rng, context);

    for (const spec of specs) {
      spawned.push(spec);
      const target = targets.spawn(spec, spec.role === "reset" ? { kind: "static" } : motion, now);
      if (spec.role === "reset") resetTargetsRemaining += 1;
      else if (primaryTarget === null && spec.role === "scored") primaryTarget = target;
    }

    // A reset target gates the measured window: until it is cleared, the trial is positioning,
    // not measuring.
    if (resetTargetsRemaining > 0) {
      stimulusAt = null;
    }
  };

  const openMeasuredWindow = (now: number): void => {
    stimulusAt = now;
    originAngles = camera.angles();
    camera.resetCounts();
    buffers.reset();
    frames.openWindow();
    quality.openTrial();
    totalCounts = 0;
    heldMs = 0;
    shots = 0;
    firstShotHit = null;
  };

  const resolve = (now: number, forced: InvalidReason | null): TrialOutcome => {
    if (buttonDown && buttonDownSince !== null) {
      heldMs += now - buttonDownSince;
      buttonDownSince = now;
    }

    const frameStats = frames.closeWindow();
    const measuredStart = stimulusAt ?? startedAt;
    const measuredMs = Math.max(1, now - measuredStart);
    const heldRatio = heldMs / measuredMs;

    const environmental = quality.trialInvalidReason();
    const reason = forced ?? environmental ?? procedural(now, heldRatio);

    const validity: TrialValidity =
      reason !== null ? "invalid" : isDegraded(frameStats) ? "degraded" : "valid";

    if (buffers.overflowed) quality.noteBufferOverflow();
    const qualityFlags = quality.trialFlags();

    const outcome: TrialOutcome = {
      validity,
      invalidReason: reason,
      hit,
      shots,
      firstShotHit,
      stimulusAt: measuredStart,
      resolvedAt: now,
      originAngles,
      targets: targets.all(),
      primaryTarget,
      frameStats,
      qualityFlags,
      totalCounts,
      heldRatio,
    };

    phase = "resolved";
    resolvedOutcome = outcome;
    quality.closeTrial();
    return outcome;
  };

  /**
   * Procedural faults the trial itself observed.
   *
   * Every one describes what the *procedure* did, never how well the player performed
   * (`SENS-BR-009`). A slow trial is not invalid; a trial the player never engaged with is.
   */
  const procedural = (now: number, heldRatio: number): InvalidReason | null => {
    if (prematureShot) return "premature_click";
    if (extraShot) return "extra_shot";

    if (definition.shootingModel === "hold" && heldRatio < minHeldRatio) {
      return "button_held_ratio_low";
    }

    const measuredStart = stimulusAt;
    if (measuredStart === null) return "timeout";

    const elapsed = now - measuredStart;
    const timedOut = elapsed >= definition.timeoutMs;

    if (definition.endCondition === "duration") {
      // A duration trial's clock running out is its success condition, not a fault.
      return null;
    }

    if (timedOut && !isSatisfied()) {
      return totalCounts < minMovementCounts ? "no_input" : "timeout";
    }

    return null;
  };

  const isSatisfied = (): boolean => {
    switch (definition.endCondition) {
      case "first_hit":
        return hit === true;
      case "single_shot":
        return shots >= 1;
      case "kill_count":
        return kills >= killTarget;
      case "duration":
        // A duration trial is ended by its clock, never by anything the player does. Callers
        // handle that case before asking, so answering "satisfied" here would end every
        // tracking trial on its first tick.
        return false;
    }
  };

  return {
    get phase() {
      return phase;
    },
    get trialIndex() {
      return context.trialIndex;
    },
    get armedAt() {
      return startedAt;
    },
    get stimulusAt() {
      return stimulusAt;
    },
    get outcome() {
      return resolvedOutcome;
    },

    tick(now: number): TrialOutcome | null {
      if (phase === "resolved") return resolvedOutcome;

      if (phase === "armed") {
        // Input during the inter-trial interval is recorded but not scored (doc 09 §9.0.3);
        // it gives the metrics a clean baseline segment for detecting pre-movement.
        if (now - startedAt >= options.interTrialIntervalMs) presentStimulus(now);
        return null;
      }

      // Positioning phase: the reset target is up and the measured window has not opened.
      if (stimulusAt === null) {
        if (now - startedAt >= definition.timeoutMs * 2) {
          return resolve(now, "timeout");
        }
        return null;
      }

      const environmental = quality.trialInvalidReason();
      if (environmental !== null) return resolve(now, environmental);
      if (frames.windowHasHitch()) return resolve(now, "frame_hitch");

      const elapsed = now - stimulusAt;
      if (definition.endCondition === "duration") {
        // The clock is the success condition, so nothing the player does resolves it early.
        return elapsed >= definition.timeoutMs ? resolve(now, null) : null;
      }
      if (isSatisfied()) return resolve(now, null);
      if (elapsed >= definition.timeoutMs) return resolve(now, null);

      return null;
    },

    onMove(t: number, dx: number, dy: number): void {
      quality.observeMovement(t, dx, dy);
      camera.applyCounts(dx, dy);

      const angles = camera.angles();
      buffers.recordInput(t, angles.yawDeg, angles.pitchDeg);

      if (phase === "active" && stimulusAt !== null) {
        totalCounts += Math.hypot(dx, dy);
      }
    },

    onButton(t: number, buttonPhase: "down" | "up", button: number): void {
      // Only the primary button is a shot. Others are ignored entirely rather than recorded,
      // so a middle-click cannot appear in the event stream as an engagement.
      if (button !== 0) return;

      buffers.recordEvent(t, buttonPhase === "down" ? 0 : 1, button);

      if (buttonPhase === "up") {
        if (buttonDown && buttonDownSince !== null) heldMs += t - buttonDownSince;
        buttonDown = false;
        buttonDownSince = null;
        return;
      }

      buttonDown = true;
      buttonDownSince = t;

      if (phase === "armed") {
        prematureShot = true;
        return;
      }

      // Clearing a reset target opens the measured window.
      if (stimulusAt === null) {
        const resolution = targets.resolveShot(camera.angles(), t);
        if (resolution.target !== null && resolution.target.spec.role === "reset") {
          targets.destroy(resolution.target, t);
          resetTargetsRemaining -= 1;
          if (resetTargetsRemaining <= 0) openMeasuredWindow(t);
        }
        return;
      }

      if (definition.shootingModel !== "click") return;

      if (definition.endCondition === "single_shot" && shots >= 1) {
        extraShot = true;
        return;
      }

      const cooldown = definition.shotCooldownMs ?? 0;
      if (cooldown > 0 && lastShotAt !== null && t - lastShotAt < cooldown) return;

      lastShotAt = t;
      shots += 1;

      const resolution = targets.resolveShot(camera.angles(), t);
      const struck = resolution.target !== null && resolution.target.spec.role === "scored";

      if (firstShotHit === null) firstShotHit = struck;
      if (struck && resolution.target !== null) {
        hit = true;
        kills += 1;
        targets.destroy(resolution.target, t);
      } else if (hit === null) {
        hit = false;
      }
    },

    abort(now: number, reason: InvalidReason): TrialOutcome {
      if (resolvedOutcome !== null) return resolvedOutcome;
      return resolve(now, reason);
    },
  };
}
