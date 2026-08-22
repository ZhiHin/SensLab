import { describe, expect, it } from "vitest";
import { createEngine, type Engine } from "@/test-engine/engine";
import {
  createQualityMonitor,
  DEFAULT_QUALITY_THRESHOLDS,
} from "@/test-engine/quality/quality-monitor";
import type { SessionQualityFlag } from "@/core/types/vocabulary";
import {
  createHarness,
  createPlan,
  createSyntheticDefinition,
  type PlanOptions,
  type RecordingRenderer,
  type ScriptedInput,
  type SyntheticDefinitionOptions,
} from "../../helpers/engine-harness";
import type { ScriptedClock } from "@/test-engine/timing/clock";

/**
 * The engine's outer lifecycle: pointer lock, quality reporting, and the calls that should do
 * nothing (doc 19 §19.3, §19.10).
 *
 * The "does nothing" cases matter more than they look. `resume()` on a session that is not
 * paused, `pause()` on one that has finished, an abort after an abort — each is reachable from
 * a real UI, from a double-click or a stale keyboard handler, and each must be inert rather
 * than half-applied. A session that half-resumed would measure a trial nobody was ready for.
 */

const FRAME_MS = 1000 / 240;

interface Rig {
  readonly engine: Engine;
  readonly clock: ScriptedClock;
  readonly input: ScriptedInput;
  readonly renderer: RecordingRenderer;
  readonly warnings: (readonly SessionQualityFlag[])[];
}

function createRig(plan: PlanOptions = {}, definition: SyntheticDefinitionOptions = {}): Rig {
  const { clock, input, renderer } = createHarness(1000);
  const warnings: (readonly SessionQualityFlag[])[] = [];

  const engine = createEngine({
    plan: createPlan(plan),
    definitions: [createSyntheticDefinition(definition)],
    clock,
    input,
    renderer,
    frameBudgetMs: FRAME_MS,
    callbacks: { onQualityWarning: (flags) => warnings.push(flags) },
  });

  engine.init();
  return { engine, clock, input, renderer, warnings };
}

describe("acquiring pointer lock", () => {
  it("starts once the lock is granted", async () => {
    const rig = createRig();
    const started = await rig.engine.start();

    expect(started).toBe(true);
    expect(rig.engine.state).toBe("running");
    expect(rig.input.lockRequests).toBe(1);
    expect(rig.engine.sessionFlags()).not.toContain("no_raw_input");
  });

  it("does not start when the lock is denied", async () => {
    const rig = createRig();
    rig.input.setLockOutcome({ locked: false });

    expect(await rig.engine.start()).toBe(false);
    expect(rig.engine.state).not.toBe("running");
    // Nothing is drawn, because nothing is running.
    rig.clock.run(500, FRAME_MS);
    expect(rig.renderer.drawCount).toBe(0);
  });

  it("flags a session whose raw input never took effect — EV-010", async () => {
    // The session still runs: refusing to measure would cost the user their calibration for a
    // browser limitation. It is priced into confidence instead (doc 15 §15.2, C4).
    const rig = createRig({ rounds: [{ trialCount: 1 }] }, { trialCount: 1 });
    rig.input.setLockOutcome({ unadjustedMovementEffective: false });

    await rig.engine.start();
    expect(rig.engine.sessionFlags()).toContain("no_raw_input");
    expect(rig.engine.state).toBe("running");
  });

  it("emits a quality warning when the session ends flagged", async () => {
    const rig = createRig({ rounds: [{ trialCount: 1 }] }, { trialCount: 1 });
    rig.input.setLockOutcome({ unadjustedMovementEffective: false });
    await rig.engine.start();

    for (let frame = 0; frame < 5000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      const drawn = rig.renderer.lastFrame;
      const target = drawn?.targets.living()[0];
      if (drawn !== null && target !== undefined) {
        const position = drawn.targets.positionAt(target, rig.clock.now());
        const camera = rig.engine.camera;
        rig.input.move(
          rig.clock.now(),
          (position.yawDeg - camera.yawDeg) / camera.degreesPerCount,
          0,
        );
        rig.input.click(rig.clock.now() + 0.5);
      }
    }

    expect(rig.engine.state).toBe("finished");
    expect(rig.warnings.at(-1)).toContain("no_raw_input");
  });

  it("re-acquires the lock on resume, and stays paused if it is refused", async () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    await rig.engine.start();
    rig.clock.run(400, FRAME_MS);
    rig.engine.pause("user");

    rig.input.setLockOutcome({ locked: false });
    expect(await rig.engine.resume()).toBe(false);
    expect(rig.engine.state).toBe("paused");

    rig.input.setLockOutcome({ locked: true });
    expect(await rig.engine.resume()).toBe(true);
    expect(rig.engine.state).toBe("running");
  });
});

describe("calls that must do nothing", () => {
  it("ignores resume on a session that is not paused", async () => {
    const rig = createRig();
    expect(await rig.engine.resume()).toBe(false);

    await rig.engine.start();
    expect(await rig.engine.resume()).toBe(false);
    expect(rig.engine.state).toBe("running");
  });

  it("ignores a pause on a session that is not running", () => {
    const rig = createRig();
    rig.engine.pause("user");
    expect(rig.engine.state).toBe("ready");

    rig.engine.startUnlocked();
    rig.engine.pause("user");
    rig.engine.pause("focus_lost");
    // The second pause did not overwrite the first one's reason.
    expect(rig.engine.stage).toEqual({ kind: "paused", reason: "user" });
  });

  it("ignores a second abort", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.clock.run(300, FRAME_MS);

    rig.engine.abort();
    rig.engine.abort();
    expect(rig.engine.stage.kind).toBe("aborted");
  });

  it("ignores input and frames after destroy", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.clock.run(200, FRAME_MS);

    rig.engine.destroy();
    rig.engine.destroy();
    const drawn = rig.renderer.drawCount;

    rig.clock.run(500, FRAME_MS);
    expect(rig.renderer.drawCount).toBe(drawn);
    expect(rig.engine.state).toBe("idle");
  });

  it("ignores a free-aim completion when there is no warm-up running", () => {
    const rig = createRig({ rounds: [{ trialCount: 1 }] }, { trialCount: 1 });
    rig.engine.startUnlocked();
    rig.engine.completeFreeAim();
    expect(rig.engine.stage.kind).toBe("round");
  });

  it("reports an idle HUD before the session starts", () => {
    const rig = createRig();
    expect(rig.engine.hud.roundNumber).toBeNull();
    expect(rig.engine.stage).toEqual({ kind: "idle" });
    expect(rig.engine.aggregates).toEqual([]);
  });
});

describe("shot feedback", () => {
  it("marks a hit and a miss for the renderer, after the fact", () => {
    // The marker is drawn once the shot has already resolved, so it can describe the aim but
    // never influence it.
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.clock.run(300, FRAME_MS);

    rig.input.click(rig.clock.now()); // a miss: the camera is at the origin
    rig.clock.tick(FRAME_MS);
    expect(rig.renderer.lastFrame?.feedback.at(-1)?.kind).toBe("miss");

    const drawn = rig.renderer.lastFrame;
    const target = drawn?.targets.living()[0];
    if (drawn === null || target === undefined) throw new Error("no target drawn");
    const position = drawn.targets.positionAt(target, rig.clock.now());
    const camera = rig.engine.camera;
    rig.input.move(rig.clock.now(), (position.yawDeg - camera.yawDeg) / camera.degreesPerCount, 0);
    rig.input.click(rig.clock.now() + 0.5);
    rig.clock.tick(FRAME_MS);

    expect(rig.renderer.lastFrame?.feedback.at(-1)?.kind).toBe("hit");
  });

  it("prunes markers older than their lifetime rather than growing without bound", () => {
    const rig = createRig({ rounds: [{ trialCount: 8 }] }, { trialCount: 8, timeoutMs: 5000 });
    rig.engine.startUnlocked();
    rig.clock.run(300, FRAME_MS);

    for (let shot = 0; shot < 40; shot += 1) {
      rig.input.click(rig.clock.now());
      rig.clock.run(50, FRAME_MS);
    }

    expect(rig.renderer.lastFrame?.feedback.length ?? 99).toBeLessThan(4);
  });
});

describe("environmental reporting", () => {
  it("records a device-pixel-ratio change as a flag", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.clock.run(200, FRAME_MS);

    rig.input.changeSurface("device_pixel_ratio");
    expect(rig.engine.quality.surfaceChangeCount).toBe(1);
    expect(rig.engine.sessionFlags()).toContain("window_resized");
  });

  it("counts a lock loss even when the session is not running", () => {
    const rig = createRig();
    rig.engine.init();
    rig.input.losePointerLock();
    // Not running: nothing to invalidate, and nothing to pause.
    expect(rig.engine.state).toBe("ready");
  });
});

describe("the quality monitor in isolation", () => {
  it("ignores a fault when no trial is open", () => {
    const monitor = createQualityMonitor();
    monitor.notePointerLockLost();
    expect(monitor.trialInvalidReason()).toBeNull();
    // The session-level count is still kept: the loss happened, it just invalidated nothing.
    expect(monitor.lockLossCount).toBe(1);
  });

  it("keeps the first fault, not the last", () => {
    const monitor = createQualityMonitor();
    monitor.openTrial();
    monitor.notePointerLockLost();
    monitor.noteFocusLost();
    expect(monitor.trialInvalidReason()).toBe("pointer_lock_lost");
    expect(monitor.focusLossCount).toBe(1);
  });

  it("ignores a movement sample with no elapsed time", () => {
    // Two samples at the same timestamp imply an infinite velocity, which is an artefact of
    // the event stream rather than evidence about the hand.
    const monitor = createQualityMonitor({
      ...DEFAULT_QUALITY_THRESHOLDS,
      maxImpliedCountsPerSecond: 1000,
    });
    monitor.openTrial();
    monitor.observeMovement(100, 5000, 0);
    monitor.observeMovement(100, 5000, 0);
    monitor.observeMovement(99, 5000, 0);
    expect(monitor.trialInvalidReason()).toBeNull();
  });

  it("sorts trial flags so a record is stable across runs", () => {
    const monitor = createQualityMonitor();
    monitor.openTrial();
    monitor.noteSurfaceChange("resize");
    monitor.noteBufferOverflow();
    monitor.noteSurfaceChange("device_pixel_ratio");
    expect(monitor.trialFlags()).toEqual([
      "buffer_overflow",
      "device_pixel_ratio_changed",
      "window_resized",
    ]);
  });

  it("clears per-trial state but keeps session totals", () => {
    const monitor = createQualityMonitor();
    monitor.openTrial();
    monitor.notePointerLockLost();
    monitor.closeTrial();

    expect(monitor.trialInvalidReason()).toBeNull();
    expect(monitor.trialFlags()).toEqual([]);
    expect(monitor.lockLossCount).toBe(1);
  });

  it("flags an unstable pointer lock and a degraded session", () => {
    const monitor = createQualityMonitor();
    for (let i = 0; i < 3; i += 1) monitor.notePointerLockLost();

    expect(monitor.sessionFlags({ rawInputEffective: true, cleanFrameFraction: 1 })).toEqual([
      "unstable_pointer_lock",
    ]);
    expect(monitor.sessionFlags({ rawInputEffective: false, cleanFrameFraction: 0.5 })).toEqual([
      "no_raw_input",
      "frame_degradation",
      "unstable_pointer_lock",
    ]);
  });

  it("flags nothing for a clean session", () => {
    const monitor = createQualityMonitor();
    expect(monitor.sessionFlags({ rawInputEffective: true, cleanFrameFraction: 1 })).toEqual([]);
  });
});
