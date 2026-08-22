import type { RoundAggregate, SessionPlan, TestDefinition } from "./contracts";
import type { InputSink, InputSource, SurfaceChangeReason } from "./input/types";
import { buildHudModel, type HudModel } from "./render/hud";
import { createCamera, type Camera } from "./render/camera";
import type { Renderer, RenderFeedback } from "./render/renderer";
import { FEEDBACK_LIFETIME_MS } from "./render/renderer";
import {
  createQualityMonitor,
  DEFAULT_QUALITY_THRESHOLDS,
  type QualityMonitor,
} from "./quality/quality-monitor";
import {
  createSessionController,
  type PauseReason,
  type SessionCallbacks,
  type SessionController,
  type SessionStage,
} from "./session-controller";
import { createTargetManager } from "./targets/target-manager";
import { createTelemetryBuffers, sizeBuffers } from "./telemetry/ring-buffer";
import type { MetricCollector } from "./telemetry/metric-collector";
import type { Clock } from "./timing/clock";
import { createFrameMonitor, type FrameMonitor } from "./timing/frame-monitor";
import { degreesPerCount } from "../core/sensitivity/canonical";
import type { SessionQualityFlag } from "../core/types/vocabulary";

/**
 * The engine (doc 19 §19.1–§19.3).
 *
 * Owns the frame loop and wires the modules together. Three properties matter more than
 * anything else in this file:
 *
 * 1. **Input integrates on the sample, not on the frame.** `onMove` runs synchronously in the
 *    same task as the event, so an 8000 Hz mouse contributes 8000 integration steps per second
 *    while the renderer still runs at display rate (`SENS-NFR-001`).
 * 2. **React learns nothing between stage boundaries.** Callbacks fire on round completion,
 *    pause, finish and abort — never per frame and never per trial (`SENS-NFR-004`).
 * 3. **Time is injected.** The clock and the input source are constructor parameters, which is
 *    what lets the headless harness run this exact code with a scripted trace and assert the
 *    exact resulting trial record (doc 19 §19.12).
 */

export type EngineState = "idle" | "ready" | "running" | "paused" | "finished" | "aborted";

export interface EngineCallbacks extends SessionCallbacks {
  onQualityWarning?(flags: readonly SessionQualityFlag[]): void;
}

export interface EngineOptions {
  readonly plan: SessionPlan;
  readonly definitions: readonly TestDefinition[];
  readonly clock: Clock;
  readonly input: InputSource;
  /** Null for a headless run: the loop still runs and nothing is drawn. */
  readonly renderer: Renderer | null;
  readonly collector?: MetricCollector;
  readonly callbacks?: EngineCallbacks;
  /** Buffer sizing inputs. Defaults suit a 1000 Hz mouse on a 240 Hz display. */
  readonly maxPollingRateHz?: number;
  readonly maxRefreshHz?: number;
  /** Measured display interval from the environment check. */
  readonly frameBudgetMs?: number;
}

export interface Engine {
  readonly state: EngineState;
  readonly stage: SessionStage;
  readonly camera: Camera;
  readonly hud: HudModel;
  readonly aggregates: readonly RoundAggregate[];
  readonly frames: FrameMonitor;
  readonly quality: QualityMonitor;

  /** Attaches to the input source. Does not acquire pointer lock. */
  init(): void;
  /** Requests pointer lock and begins. Must be called from a user gesture. */
  start(): Promise<boolean>;
  /** Begins without acquiring a lock — for the headless harness. */
  startUnlocked(): void;
  pause(reason: PauseReason): void;
  resume(): Promise<boolean>;
  restartRound(): void;
  abort(): void;
  destroy(): void;

  /** Free-aim warm-up: whether the player has cleared the minimum acquisitions (SCR-014). */
  readonly freeAimSatisfied: boolean;
  /** Leaves the warm-up and begins the first measured round. */
  completeFreeAim(): void;

  /** Session-level quality flags for `session_quality_flags` (doc 20 §20.7). */
  sessionFlags(): readonly SessionQualityFlag[];
}

export function createEngine(options: EngineOptions): Engine {
  const { plan, clock, input, renderer, callbacks } = options;

  const definitions = new Map<string, TestDefinition>(
    options.definitions.map((definition) => [definition.key, definition]),
  );

  const worstTimeout = options.definitions.reduce(
    (longest, definition) => Math.max(longest, definition.timeoutMs),
    2000,
  );

  const camera = createCamera({
    horizontalHalfFovDeg: plan.fovHorizontalHalfDeg,
    aspectRatio: plan.aspectRatio,
    degreesPerCount: degreesPerCount(plan.baselineCountsPer360),
  });

  const targets = createTargetManager();
  const buffers = createTelemetryBuffers(
    sizeBuffers({
      timeoutMs: worstTimeout,
      maxPollingRateHz: options.maxPollingRateHz ?? 1000,
      maxRefreshHz: options.maxRefreshHz ?? 240,
    }),
  );
  const frames = createFrameMonitor(
    options.frameBudgetMs === undefined ? {} : { frameBudgetMs: options.frameBudgetMs },
  );
  const quality = createQualityMonitor({
    ...DEFAULT_QUALITY_THRESHOLDS,
    maxImpliedCountsPerSecond: plan.maxImpliedCountsPerSecond,
  });

  const deps = { camera, targets, buffers, frames, quality };

  let state: EngineState = "idle";
  let frameHandle: number | null = null;
  let rawInputEffective = false;
  let feedback: RenderFeedback[] = [];

  const emitQualityWarning = (): void => {
    const flags = quality.sessionFlags({
      rawInputEffective,
      cleanFrameFraction: frames.sessionStats().cleanFrameFraction,
    });
    if (flags.length > 0) callbacks?.onQualityWarning?.(flags);
  };

  const controller: SessionController = createSessionController({
    plan,
    definitions,
    deps,
    ...(options.collector === undefined ? {} : { collector: options.collector }),
    callbacks: {
      ...(callbacks?.onStageChange === undefined ? {} : { onStageChange: callbacks.onStageChange }),
      ...(callbacks?.onRoundComplete === undefined
        ? {}
        : { onRoundComplete: callbacks.onRoundComplete }),
      ...(callbacks?.onPaused === undefined ? {} : { onPaused: callbacks.onPaused }),
      onFinished: () => {
        state = "finished";
        stopLoop();
        input.releaseLock();
        emitQualityWarning();
        callbacks?.onFinished?.();
      },
      onAborted: () => {
        state = "aborted";
        stopLoop();
        input.releaseLock();
        callbacks?.onAborted?.();
      },
    },
  });

  const sink: InputSink = {
    onMove(sample) {
      if (state !== "running") return;
      controller.onMove(sample.t, sample.dx, sample.dy);
    },

    onButton(event) {
      if (state !== "running") return;
      // Feedback is resolved *before* the controller sees the button, and the order is not
      // incidental: a successful shot destroys its target, so asking afterwards would find
      // nothing there and draw every hit as a miss.
      if (event.phase === "down" && event.button === 0) recordFeedback(event.t);
      controller.onButton(event.t, event.phase, event.button);
    },

    onLockChange(locked) {
      if (locked) return;
      // Losing the lock mid-measurement is an environmental fault, not a player action: the
      // open trial is invalidated and the session pauses (doc 19 §19.10).
      if (state === "running") {
        quality.notePointerLockLost();
        pauseInternal("pointer_lock_lost");
      }
    },

    onFocusChange(focused) {
      if (focused || state !== "running") return;
      quality.noteFocusLost();
      pauseInternal("focus_lost");
    },

    onSurfaceChange(reason: SurfaceChangeReason) {
      quality.noteSurfaceChange(reason === "resize" ? "resize" : "device_pixel_ratio");
      if (state === "running") pauseInternal("surface_changed");
    },

    onKey(key) {
      if (key === "Escape" && state === "running") pauseInternal("user");
    },
  };

  /**
   * Marks a resolved shot for the renderer.
   *
   * Drawn after the fact and lasting 120 ms, so it can only ever describe what happened — it
   * cannot influence the aim it is reporting on.
   */
  function recordFeedback(t: number): void {
    if (renderer === null) return;
    const resolution = targets.resolveShot(camera.angles(), t);
    const projected =
      resolution.target === null
        ? camera.project(camera.angles())
        : camera.project(targets.positionAt(resolution.target, t));
    if (projected === null) return;

    feedback = feedback
      .filter((marker) => t - marker.startedAt <= FEEDBACK_LIFETIME_MS)
      .concat({
        kind: resolution.target === null ? "miss" : "hit",
        ndcX: projected.ndcX,
        ndcY: projected.ndcY,
        startedAt: t,
      });
  }

  function pauseInternal(reason: PauseReason): void {
    if (state !== "running") return;
    controller.pause(clock.now(), reason);
    state = "paused";
    stopLoop();
    input.releaseLock();
  }

  function stopLoop(): void {
    if (frameHandle !== null) {
      clock.cancelFrame(frameHandle);
      frameHandle = null;
    }
  }

  function loop(timestamp: number): void {
    frameHandle = null;
    if (state !== "running") return;

    frames.record(timestamp);
    controller.tick(timestamp);

    const angles = camera.angles();
    buffers.recordFrame(timestamp, angles.yawDeg, angles.pitchDeg);

    renderer?.draw({
      now: timestamp,
      camera,
      targets,
      hud: buildHudModel(
        controller.stage,
        { completedRounds: controller.completedRounds, totalRounds: controller.totalRounds },
        plan.freeAim?.minAcquisitions ?? 0,
      ),
      feedback,
    });

    if (state === "running") frameHandle = clock.scheduleFrame(loop);
  }

  function startLoop(): void {
    if (frameHandle === null) frameHandle = clock.scheduleFrame(loop);
  }

  return {
    get state() {
      return state;
    },
    get stage() {
      return controller.stage;
    },
    get camera() {
      return camera;
    },
    get aggregates() {
      return controller.aggregates;
    },
    get frames() {
      return frames;
    },
    get quality() {
      return quality;
    },
    get hud() {
      return buildHudModel(
        controller.stage,
        { completedRounds: controller.completedRounds, totalRounds: controller.totalRounds },
        plan.freeAim?.minAcquisitions ?? 0,
      );
    },

    init(): void {
      input.attach(sink);
      state = "ready";
    },

    async start(): Promise<boolean> {
      const outcome = await input.requestLock();
      rawInputEffective = outcome.unadjustedMovementEffective;
      if (!outcome.locked) return false;

      state = "running";
      controller.start(clock.now());
      startLoop();
      return true;
    },

    startUnlocked(): void {
      state = "running";
      controller.start(clock.now());
      startLoop();
    },

    pause(reason: PauseReason): void {
      pauseInternal(reason);
    },

    async resume(): Promise<boolean> {
      if (state !== "paused") return false;
      const outcome = await input.requestLock();
      if (!outcome.locked) return false;
      rawInputEffective = outcome.unadjustedMovementEffective;
      state = "running";
      // Always through a countdown, so the first trial after a pause is not measured against a
      // cold start (doc 19 §19.3).
      controller.resume(clock.now());
      startLoop();
      return true;
    },

    get freeAimSatisfied() {
      return controller.freeAimSatisfied;
    },

    completeFreeAim(): void {
      controller.completeFreeAim(clock.now());
    },

    restartRound(): void {
      controller.restartRound(clock.now());
      if (state === "paused") {
        state = "running";
        startLoop();
      }
    },

    abort(): void {
      controller.abort(clock.now());
    },

    destroy(): void {
      stopLoop();
      input.detach();
      input.releaseLock();
      state = "idle";
    },

    sessionFlags(): readonly SessionQualityFlag[] {
      return quality.sessionFlags({
        rawInputEffective,
        cleanFrameFraction: frames.sessionStats().cleanFrameFraction,
      });
    },
  };
}
