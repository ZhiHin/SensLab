import { deriveRng } from "../core/random";
import { degreesPerCount } from "../core/sensitivity/canonical";
import type { InvalidReason } from "../core/types/vocabulary";
import type { PlannedRound, RoundAggregate, SessionPlan, TestDefinition } from "./contracts";
import { createRoundRunner, type RoundProgress, type RoundRunner } from "./round-runner";
import { placeTarget } from "./targets/placement";
import type { MetricCollector } from "./telemetry/metric-collector";
import type { TrialDependencies } from "./trial-manager";

/**
 * Stage sequencing, sensitivity switching, and pause/resume/abort (doc 19 §19.2–§19.3).
 *
 * ## The invariant this file exists to hold
 *
 * **The active sensitivity changes only at a round boundary, never inside a trial**
 * (`SENS-NFR-008`). Changing it mid-trial would measure the player's adaptation cost rather
 * than their performance, and the resulting number would look perfectly reasonable. The
 * controller is the only thing that calls `camera.setDegreesPerCount`, and it refuses while a
 * round is open — enforced here rather than trusted to callers.
 *
 * ## Pause
 *
 * Entering `paused` always closes the open trial as invalid with the causing reason, and
 * resuming always requires re-acquiring pointer lock and a countdown, so the first trial after
 * a pause is not measured against a cold start (doc 19 §19.3).
 */

export type SessionStage =
  | { readonly kind: "idle" }
  | { readonly kind: "free_aim"; readonly acquisitions: number }
  | { readonly kind: "round"; readonly round: PlannedRound; readonly progress: RoundProgress }
  | { readonly kind: "interstitial"; readonly untilMs: number }
  | { readonly kind: "countdown"; readonly remainingMs: number }
  | { readonly kind: "paused"; readonly reason: PauseReason }
  | { readonly kind: "finished" }
  | { readonly kind: "aborted" };

export type PauseReason =
  "user" | "pointer_lock_lost" | "focus_lost" | "surface_changed" | "quality_warning";

/** doc 13 §13.6 — a neutral gap between blocks, with no score and no feedback. */
export const INTERSTITIAL_MS = 3000;
/** doc 19 §19.3 — 3-2-1 before the first trial after a pause. */
export const RESUME_COUNTDOWN_MS = 3000;

export interface SessionCallbacks {
  onStageChange?(stage: SessionStage): void;
  onRoundComplete?(aggregate: RoundAggregate): void;
  onPaused?(reason: PauseReason): void;
  onFinished?(): void;
  onAborted?(): void;
}

export interface SessionControllerOptions {
  readonly plan: SessionPlan;
  readonly definitions: ReadonlyMap<string, TestDefinition>;
  readonly deps: TrialDependencies;
  readonly callbacks?: SessionCallbacks;
  /** Metric derivations to run after each trial. Empty in Phase 2 by design. */
  readonly collector?: MetricCollector;
}

export interface SessionController {
  readonly stage: SessionStage;
  /** Rounds completed, for the HUD. */
  readonly completedRounds: number;
  readonly totalRounds: number;

  start(now: number): void;
  tick(now: number): void;
  onMove(t: number, dx: number, dy: number): void;
  onButton(t: number, phase: "down" | "up", button: number): void;

  pause(now: number, reason: PauseReason): void;
  /** Resumes into a countdown. The caller must have re-acquired pointer lock first. */
  resume(now: number): void;
  /** Discards the open round and re-runs it with a fresh seed offset. */
  restartRound(now: number): void;
  abort(now: number): void;

  /** Free-aim only: the player has cleared the minimum and may continue. */
  readonly freeAimSatisfied: boolean;
  completeFreeAim(now: number): void;

  /** Aggregates emitted so far, in presentation order. */
  readonly aggregates: readonly RoundAggregate[];
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  const { plan, definitions, deps, callbacks } = options;

  const ordered = [...plan.rounds].sort((a, b) => a.presentationOrder - b.presentationOrder);
  const emitted: RoundAggregate[] = [];

  let stage: SessionStage = { kind: "idle" };
  let roundCursor = 0;
  let runner: RoundRunner | null = null;
  let roundStartedWall = "";
  let stageDeadline = 0;
  let freeAimAcquisitions = 0;
  let restartOffset = 0;

  /**
   * Updates the stage, notifying only when it is a *different* stage.
   *
   * The stage object is rebuilt every frame so the canvas HUD can read live progress, but the
   * callback is what React is wired to. Firing it per frame would put a React render inside
   * every measured window, which is precisely what `SENS-NFR-004` forbids — so the identity
   * comparison below is load-bearing, not an optimisation.
   */
  const setStage = (next: SessionStage): void => {
    const changed = stageIdentity(stage) !== stageIdentity(next);
    stage = next;
    if (changed) callbacks?.onStageChange?.(next);
  };

  const sensitivityFor = (round: PlannedRound): number => {
    if (round.candidateIndex === null) return degreesPerCount(plan.baselineCountsPer360);
    const candidate = plan.candidates.find((c) => c.candidateIndex === round.candidateIndex);
    if (candidate === undefined) {
      throw new Error(
        `round ${round.presentationOrder} references candidate ${round.candidateIndex}, ` +
          `which the plan does not define`,
      );
    }
    return degreesPerCount(candidate.countsPer360);
  };

  /**
   * Places the next free-aim target.
   *
   * Free-aim is unscored, so placement uses its own RNG stream keyed by acquisition count —
   * it must never draw from the stimulus stream, or warming up would consume the very draws a
   * later measured round depends on and break the paired-stimulus design (doc 19 §19.8).
   */
  const spawnFreeAimTarget = (now: number): void => {
    const freeAim = plan.freeAim;
    if (freeAim === undefined) return;

    const rng = deriveRng(plan.seed, "free-aim", freeAimAcquisitions);
    const placement = placeTarget(rng, deps.camera.angles(), {
      minDistanceDeg: freeAim.minDistanceDeg,
      maxDistanceDeg: freeAim.maxDistanceDeg,
      minSeparationDeg: 0,
    });

    deps.targets.spawn(
      {
        yawDeg: placement.position.yawDeg,
        pitchDeg: placement.position.pitchDeg,
        angularRadiusDeg: freeAim.targetAngularRadiusDeg,
        role: "scored",
      },
      { kind: "static" },
      now,
    );
  };

  const beginRound = (now: number): void => {
    const round = ordered[roundCursor];
    if (round === undefined) {
      setStage({ kind: "finished" });
      callbacks?.onFinished?.();
      return;
    }

    const definition = definitions.get(round.testKey);
    if (definition === undefined) {
      throw new Error(`no test definition registered for "${round.testKey}"`);
    }

    // The one place sensitivity changes, and only between rounds (`SENS-NFR-008`).
    deps.camera.setDegreesPerCount(sensitivityFor(round));
    deps.camera.setAngles(0, 0);

    roundStartedWall = new Date().toISOString();

    runner = createRoundRunner({
      round:
        restartOffset === 0
          ? round
          : { ...round, stimulusSeed: `${round.stimulusSeed}#restart${restartOffset}` },
      definition,
      deps,
      sessionSeed: plan.seed,
      scopeKey: round.scopeKey,
      mode: plan.mode,
      startedAt: now,
      startedAtWallClock: roundStartedWall,
      ...(options.collector === undefined ? {} : { collector: options.collector }),
    });

    setStage({ kind: "round", round, progress: runner.progress() });
  };

  const finishRound = (aggregate: RoundAggregate, now: number): void => {
    emitted.push(aggregate);
    callbacks?.onRoundComplete?.(aggregate);
    runner = null;
    restartOffset = 0;
    roundCursor += 1;

    if (roundCursor >= ordered.length) {
      setStage({ kind: "finished" });
      callbacks?.onFinished?.();
      return;
    }

    stageDeadline = now + INTERSTITIAL_MS;
    setStage({ kind: "interstitial", untilMs: stageDeadline });
  };

  return {
    get stage() {
      return stage;
    },
    get completedRounds() {
      return emitted.length;
    },
    get totalRounds() {
      return ordered.length;
    },
    get aggregates() {
      return emitted;
    },
    get freeAimSatisfied() {
      return plan.freeAim === undefined || freeAimAcquisitions >= plan.freeAim.minAcquisitions;
    },

    start(now: number): void {
      if (plan.freeAim !== undefined) {
        deps.camera.setDegreesPerCount(degreesPerCount(plan.freeAim.countsPer360));
        deps.camera.setAngles(0, 0);
        freeAimAcquisitions = 0;
        deps.targets.reset();
        spawnFreeAimTarget(now);
        setStage({ kind: "free_aim", acquisitions: 0 });
        return;
      }
      beginRound(now);
    },

    completeFreeAim(now: number): void {
      if (stage.kind !== "free_aim") return;
      beginRound(now);
    },

    tick(now: number): void {
      switch (stage.kind) {
        case "idle":
        case "finished":
        case "aborted":
        case "paused":
        case "free_aim":
          return;

        case "interstitial":
          if (now >= stageDeadline) beginRound(now);
          return;

        case "countdown": {
          const remaining = stageDeadline - now;
          if (remaining <= 0) {
            // Paused before the round had started — begin it now rather than entering a round
            // stage with nothing to run.
            if (runner === null) {
              beginRound(now);
              return;
            }
            const round = ordered[roundCursor];
            if (round === undefined) {
              setStage({ kind: "finished" });
              callbacks?.onFinished?.();
              return;
            }
            setStage({ kind: "round", round, progress: runner.progress() });
            return;
          }
          setStage({ kind: "countdown", remainingMs: remaining });
          return;
        }

        case "round": {
          if (runner === null) return;
          const aggregate = runner.tick(now);
          if (aggregate !== null) {
            finishRound(aggregate, now);
            return;
          }
          setStage({ kind: "round", round: stage.round, progress: runner.progress() });
          return;
        }
      }
    },

    onMove(t, dx, dy): void {
      if (stage.kind === "free_aim") {
        deps.camera.applyCounts(dx, dy);
        deps.quality.observeMovement(t, dx, dy);
        return;
      }
      if (stage.kind !== "round") return;
      runner?.onMove(t, dx, dy);
    },

    onButton(t, phase, button): void {
      if (stage.kind === "free_aim") {
        if (phase === "down" && button === 0) {
          const resolution = deps.targets.resolveShot(deps.camera.angles(), t);
          if (resolution.target !== null) {
            deps.targets.destroy(resolution.target, t);
            freeAimAcquisitions += 1;
            deps.targets.reset();
            spawnFreeAimTarget(t);
            setStage({ kind: "free_aim", acquisitions: freeAimAcquisitions });
          }
        }
        return;
      }
      if (stage.kind !== "round") return;
      runner?.onButton(t, phase, button);
    },

    pause(now: number, reason: PauseReason): void {
      if (stage.kind === "paused" || stage.kind === "finished" || stage.kind === "aborted") return;

      // Pausing always closes the open *trial* as invalid: whatever the player was doing when
      // the tab lost focus is not a measurement of anything. The round survives, so a player
      // who alt-tabs three trials in returns to that round rather than losing it (doc 19 §19.3).
      if (runner !== null && stage.kind === "round") {
        runner.invalidateOpenTrial(now, pauseToInvalidReason(reason));
      }

      setStage({ kind: "paused", reason });
      callbacks?.onPaused?.(reason);
    },

    resume(now: number): void {
      if (stage.kind !== "paused") return;
      stageDeadline = now + RESUME_COUNTDOWN_MS;
      setStage({ kind: "countdown", remainingMs: RESUME_COUNTDOWN_MS });
    },

    restartRound(now: number): void {
      if (runner !== null) {
        // The discarded trials are not emitted: a restarted round is not a round that happened.
        runner = null;
      }
      restartOffset += 1;
      beginRound(now);
    },

    abort(now: number): void {
      if (runner !== null) {
        const aggregate = runner.abort(now, "focus_lost");
        emitted.push(aggregate);
        callbacks?.onRoundComplete?.(aggregate);
        runner = null;
      }
      setStage({ kind: "aborted" });
      callbacks?.onAborted?.();
    },
  };
}

function pauseToInvalidReason(reason: PauseReason): InvalidReason {
  switch (reason) {
    case "pointer_lock_lost":
      return "pointer_lock_lost";
    case "focus_lost":
      return "focus_lost";
    case "surface_changed":
    case "quality_warning":
    case "user":
      // A deliberate pause is still a break in the measured window. `focus_lost` is the
      // honest procedural description: attention left the task.
      return "focus_lost";
  }
}

/**
 * A stable identity for a stage, for change detection.
 *
 * Deliberately excludes progress and countdown remainder: those change every frame and are
 * read from the canvas HUD, not pushed to React.
 */
function stageIdentity(stage: SessionStage): string {
  switch (stage.kind) {
    case "round":
      return `round:${stage.round.presentationOrder}`;
    case "paused":
      return `paused:${stage.reason}`;
    case "free_aim":
      return `free_aim:${stage.acquisitions}`;
    default:
      return stage.kind;
  }
}
