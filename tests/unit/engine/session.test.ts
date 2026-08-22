import { describe, expect, it } from "vitest";
import { countsPer360 } from "@/core/types/brand";
import { degreesPerCount } from "@/core/sensitivity/canonical";
import type { RoundAggregate } from "@/test-engine/contracts";
import { createEngine, type Engine } from "@/test-engine/engine";
import {
  INTERSTITIAL_MS,
  RESUME_COUNTDOWN_MS,
  type SessionStage,
} from "@/test-engine/session-controller";
import type { ScriptedClock } from "@/test-engine/timing/clock";
import {
  createHarness,
  createPlan,
  createSyntheticDefinition,
  type PlanOptions,
  type RecordingRenderer,
  type ScriptedInput,
  type SyntheticDefinitionOptions,
} from "../../helpers/engine-harness";

/**
 * The session, driven end to end through the headless harness (doc 19 §19.2–§19.3, §19.12).
 *
 * Every test here runs the *real* engine — real trial state machine, real camera, real target
 * manager, real quality monitor — against a scripted clock and a scripted input source. Nothing
 * is stubbed; the only things replaced are the two sources of non-determinism a browser would
 * otherwise supply, plus a renderer that records instead of painting.
 *
 * The driver aims at whatever the renderer was last handed, which is what the player would see.
 * That is deliberate: a driver that reached into the engine for target positions could pass
 * against an engine nobody could actually play.
 */

const FRAME_MS = 1000 / 240;

interface Rig {
  readonly engine: Engine;
  readonly clock: ScriptedClock;
  readonly input: ScriptedInput;
  readonly renderer: RecordingRenderer;
  readonly aggregates: RoundAggregate[];
  readonly stages: SessionStage[];
  readonly paused: string[];
  finished: boolean;
  aborted: boolean;
  /** Aims at the drawn target and clicks it. Returns false when nothing is on screen. */
  engage(): boolean;
  /** Advances the session by `ms` of frames. */
  advance(ms: number, frameMs?: number): void;
}

function createRig(plan: PlanOptions = {}, definition: SyntheticDefinitionOptions = {}): Rig {
  const { clock, input, renderer } = createHarness(1000);
  const aggregates: RoundAggregate[] = [];
  const stages: SessionStage[] = [];
  const paused: string[] = [];

  const rig: Rig = {
    aggregates,
    stages,
    paused,
    finished: false,
    aborted: false,
    clock,
    input,
    renderer,

    engine: createEngine({
      plan: createPlan(plan),
      definitions: [createSyntheticDefinition(definition)],
      clock,
      input,
      renderer,
      frameBudgetMs: FRAME_MS,
      callbacks: {
        onStageChange: (stage) => stages.push(stage),
        onRoundComplete: (aggregate) => aggregates.push(aggregate),
        onPaused: (reason) => paused.push(reason),
        onFinished: () => {
          rig.finished = true;
        },
        onAborted: () => {
          rig.aborted = true;
        },
      },
    }),

    engage(): boolean {
      const frame = renderer.lastFrame;
      if (frame === null) return false;

      const target = frame.targets.living().find((live) => live.spec.role !== "decoy");
      if (target === undefined) return false;

      const now = clock.now();
      const position = frame.targets.positionAt(target, now);
      const camera = rig.engine.camera;
      const perCount = camera.degreesPerCount;

      input.move(
        now,
        (position.yawDeg - camera.yawDeg) / perCount,
        -(position.pitchDeg - camera.pitchDeg) / perCount,
      );
      input.click(now + 0.5);
      return true;
    },

    advance(ms: number, frameMs = FRAME_MS): void {
      clock.run(ms, frameMs);
    },
  };

  rig.engine.init();
  return rig;
}

/** Runs frames until the session leaves `running`, engaging whenever a target is drawn. */
function playThrough(rig: Rig, maxFrames = 40_000): void {
  rig.engine.startUnlocked();
  for (let frame = 0; frame < maxFrames && rig.engine.state === "running"; frame += 1) {
    rig.clock.tick(FRAME_MS);
    rig.engage();
  }
}

describe("a synthetic session, end to end", () => {
  it("runs a definition the engine has never seen, without an engine change — FR-058", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    playThrough(rig);

    expect(rig.finished).toBe(true);
    expect(rig.engine.state).toBe("finished");
    expect(rig.aggregates).toHaveLength(1);

    const round = rig.aggregates[0];
    expect(round?.trials).toHaveLength(3);
    expect(round?.trials.every((trial) => trial.validity === "valid")).toBe(true);
    expect(round?.trials.every((trial) => trial.hit === true)).toBe(true);
  });

  it("stamps each trial with its own reproducible stimulus seed", () => {
    const rig = createRig(
      { rounds: [{ trialCount: 3, stimulusSeed: "block-a" }] },
      { trialCount: 3 },
    );
    playThrough(rig);

    expect(rig.aggregates[0]?.trials.map((trial) => trial.stimulusSeed)).toEqual([
      "block-a:0",
      "block-a:1",
      "block-a:2",
    ]);
  });

  it("records offsets relative to the round, not to the epoch", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    playThrough(rig);

    const offsets = rig.aggregates[0]?.trials.map((trial) => trial.startOffsetMs) ?? [];
    expect(offsets).toHaveLength(2);
    expect(offsets[0]).toBeGreaterThanOrEqual(0);
    expect(offsets[0]).toBeLessThan(1000);
    expect(offsets[1] ?? 0).toBeGreaterThan(offsets[0] ?? 0);
  });

  it("gives every trial a duration measured from its own stimulus", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    playThrough(rig);

    for (const trial of rig.aggregates[0]?.trials ?? []) {
      expect(trial.durationMs).toBeGreaterThan(0);
      expect(trial.durationMs).toBeLessThan(2000);
    }
  });

  it("sequences rounds through a neutral interstitial", () => {
    const rig = createRig(
      {
        rounds: [
          { presentationOrder: 0, trialCount: 1 },
          { presentationOrder: 1, trialCount: 1 },
        ],
      },
      { trialCount: 1 },
    );
    rig.engine.startUnlocked();

    for (let frame = 0; frame < 5000 && rig.aggregates.length === 0; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }

    expect(rig.engine.stage.kind).toBe("interstitial");
    const enteredAt = rig.clock.now();

    // Still interstitial a second later: the gap between blocks is real, and carries no score.
    rig.advance(1000);
    expect(rig.engine.stage.kind).toBe("interstitial");
    expect(rig.engine.hud.roundNumber).toBeNull();

    rig.advance(INTERSTITIAL_MS);
    expect(rig.engine.stage.kind).toBe("round");
    expect(rig.clock.now() - enteredAt).toBeGreaterThanOrEqual(INTERSTITIAL_MS);
  });

  it("presents rounds in presentation order, not plan order", () => {
    const rig = createRig(
      {
        rounds: [
          { presentationOrder: 2, roundIndex: 2, stimulusSeed: "third", trialCount: 1 },
          { presentationOrder: 0, roundIndex: 0, stimulusSeed: "first", trialCount: 1 },
          { presentationOrder: 1, roundIndex: 1, stimulusSeed: "second", trialCount: 1 },
        ],
      },
      { trialCount: 1 },
    );
    playThrough(rig);

    expect(rig.aggregates.map((round) => round.presentationOrder)).toEqual([0, 1, 2]);
    expect(rig.aggregates.map((round) => round.trials[0]?.stimulusSeed)).toEqual([
      "first:0",
      "second:0",
      "third:0",
    ]);
  });

  it("carries a quality summary on every round", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    playThrough(rig);

    const summary = rig.aggregates[0]?.qualitySummary;
    expect(summary?.lateFrameRatio).toBeGreaterThanOrEqual(0);
    expect(summary?.hitchCount).toBe(0);
    expect(summary?.lockLossCount).toBe(0);
  });

  it("derives no metrics in Phase 2, by design", () => {
    // The framework runs; the derivations are Phase 3. An empty object is the honest answer,
    // and it is very different from a zero.
    const rig = createRig(
      { rounds: [{ trialCount: 1 }] },
      { trialCount: 1, metricKeys: ["flick.acquisitionMs"] },
    );
    playThrough(rig);

    expect(rig.aggregates[0]?.trials[0]?.metrics).toEqual({});
    expect(rig.aggregates[0]?.roundMetrics).toEqual({});
  });
});

describe("sensitivity switching — SENS-NFR-008", () => {
  const SLOW = 6000;
  const FAST = 12_000;

  it("uses the candidate's sensitivity for its round", () => {
    const rig = createRig(
      {
        candidateCounts: [SLOW, FAST],
        rounds: [
          { presentationOrder: 0, candidateIndex: 0, trialCount: 1 },
          { presentationOrder: 1, candidateIndex: 1, trialCount: 1 },
        ],
      },
      { trialCount: 1 },
    );

    const perRound = new Map<number, Set<number>>();
    rig.engine.startUnlocked();
    for (let frame = 0; frame < 20_000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      const stage = rig.engine.stage;
      if (stage.kind === "round") {
        const seen = perRound.get(stage.round.presentationOrder) ?? new Set<number>();
        seen.add(rig.engine.camera.degreesPerCount);
        perRound.set(stage.round.presentationOrder, seen);
      }
      rig.engage();
    }

    expect([...(perRound.get(0) ?? [])]).toEqual([degreesPerCount(countsPer360(SLOW))]);
    expect([...(perRound.get(1) ?? [])]).toEqual([degreesPerCount(countsPer360(FAST))]);
  });

  it("never changes sensitivity inside a round, across every frame of every trial", () => {
    const rig = createRig(
      {
        candidateCounts: [SLOW, FAST],
        rounds: [
          { presentationOrder: 0, candidateIndex: 0, trialCount: 3 },
          { presentationOrder: 1, candidateIndex: 1, trialCount: 3 },
        ],
      },
      { trialCount: 3 },
    );

    const perRound = new Map<number, Set<number>>();
    rig.engine.startUnlocked();
    for (let frame = 0; frame < 40_000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      const stage = rig.engine.stage;
      if (stage.kind === "round") {
        const seen = perRound.get(stage.round.presentationOrder) ?? new Set<number>();
        seen.add(rig.engine.camera.degreesPerCount);
        perRound.set(stage.round.presentationOrder, seen);
      }
      rig.engage();
    }

    expect(perRound.size).toBe(2);
    for (const seen of perRound.values()) expect(seen.size).toBe(1);
  });

  it("uses the baseline for a round with no candidate", () => {
    const rig = createRig(
      {
        baselineCountsPer360: 8000,
        candidateCounts: [SLOW],
        rounds: [{ presentationOrder: 0, candidateIndex: null, trialCount: 1 }],
      },
      { trialCount: 1 },
    );
    rig.engine.startUnlocked();
    rig.clock.tick(FRAME_MS);

    expect(rig.engine.camera.degreesPerCount).toBe(degreesPerCount(countsPer360(8000)));
  });

  it("re-centres the view at the start of every round", () => {
    const rig = createRig(
      {
        rounds: [
          { presentationOrder: 0, trialCount: 1 },
          { presentationOrder: 1, trialCount: 1 },
        ],
      },
      { trialCount: 1 },
    );
    rig.engine.startUnlocked();
    rig.clock.tick(FRAME_MS);
    expect(rig.engine.camera.angles()).toEqual({ yawDeg: 0, pitchDeg: 0 });

    for (let frame = 0; frame < 5000 && rig.aggregates.length === 0; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }
    expect(rig.engine.camera.yawDeg).not.toBe(0);

    rig.advance(INTERSTITIAL_MS + 100);
    expect(rig.engine.camera.angles()).toEqual({ yawDeg: 0, pitchDeg: 0 });
  });

  it("refuses a plan that names a candidate it does not define", () => {
    const rig = createRig({ candidateCounts: [SLOW], rounds: [{ candidateIndex: 3 }] });
    expect(() => {
      rig.engine.startUnlocked();
    }).toThrow(/candidate 3/);
  });

  it("refuses a plan that names a test with no definition", () => {
    const rig = createRig({ rounds: [{ testKey: "tracking" }] });
    expect(() => {
      rig.engine.startUnlocked();
    }).toThrow(/tracking/);
  });
});

describe("pause, resume, restart and abort", () => {
  it("pauses on Escape and closes the open trial without ending the round", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(500);

    rig.input.key("Escape", rig.clock.now());

    expect(rig.engine.state).toBe("paused");
    expect(rig.paused).toEqual(["user"]);
    // The round is not over: nothing has been emitted.
    expect(rig.aggregates).toHaveLength(0);
  });

  it("stops the frame loop while paused, so nothing is measured", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(500);
    const drawn = rig.renderer.drawCount;

    rig.input.key("Escape", rig.clock.now());
    expect(rig.clock.pendingFrames).toBe(0);

    rig.advance(5000);
    expect(rig.engine.state).toBe("paused");
    expect(rig.renderer.drawCount).toBe(drawn);
  });

  it("releases pointer lock on pause and re-acquires it on resume", async () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(400);

    rig.input.key("Escape", rig.clock.now());
    expect(rig.input.state.locked).toBe(false);

    await rig.engine.resume();
    expect(rig.input.lockRequests).toBeGreaterThan(0);
  });

  it("resumes through a countdown, never straight into a measured trial", async () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(500);
    rig.input.key("Escape", rig.clock.now());

    await rig.engine.resume();
    rig.clock.tick(FRAME_MS);
    expect(rig.engine.stage.kind).toBe("countdown");
    expect(rig.engine.hud.countdownSeconds).toBeGreaterThan(0);

    rig.advance(RESUME_COUNTDOWN_MS - 500);
    expect(rig.engine.stage.kind).toBe("countdown");

    rig.advance(1000);
    expect(rig.engine.stage.kind).toBe("round");
    expect(rig.engine.state).toBe("running");
  });

  it("returns to the same round after a pause, and still reaches its sample target", async () => {
    // Eight trials, so the round carries a replacement allowance of two (25%, floored).
    const rig = createRig({ rounds: [{ trialCount: 8 }] }, { trialCount: 8 });
    rig.engine.startUnlocked();
    rig.advance(400);
    rig.engage();
    rig.advance(200);

    rig.input.key("Escape", rig.clock.now());
    await rig.engine.resume();

    for (let frame = 0; frame < 20_000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }

    expect(rig.finished).toBe(true);
    expect(rig.aggregates).toHaveLength(1);
    expect(rig.aggregates[0]?.trials.filter((trial) => trial.validity !== "invalid")).toHaveLength(
      8,
    );
  });

  it("marks the interrupted trial invalid with its cause, and replaces it", async () => {
    const rig = createRig({ rounds: [{ trialCount: 8 }] }, { trialCount: 8 });
    rig.engine.startUnlocked();
    // Past the inter-trial interval, so a measured window is genuinely open.
    rig.advance(400);
    rig.input.losePointerLock();

    await rig.engine.resume();
    for (let frame = 0; frame < 20_000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }

    const trials = rig.aggregates[0]?.trials ?? [];
    const invalid = trials.filter((trial) => trial.validity === "invalid");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.invalidReason).toBe("pointer_lock_lost");
    // Kept alongside the replacement, never instead of it (`SENS-BR-009`).
    expect(trials.some((trial) => trial.isReplacement)).toBe(true);
    expect(trials).toHaveLength(9);
  });

  it("ends a round short rather than asking forever once the allowance is spent", async () => {
    // A machine that faults every few seconds would otherwise extend a round indefinitely, and
    // the data would be flagged either way. Three trials floor to a zero allowance.
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(400);
    rig.input.key("Escape", rig.clock.now());

    await rig.engine.resume();
    for (let frame = 0; frame < 20_000 && rig.engine.state !== "finished"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }

    const trials = rig.aggregates[0]?.trials ?? [];
    expect(trials).toHaveLength(3);
    expect(trials.filter((trial) => trial.validity === "invalid")).toHaveLength(1);
    expect(trials.some((trial) => trial.isReplacement)).toBe(false);
  });

  it("pauses on focus loss and on a surface change", () => {
    const onBlur = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    onBlur.engine.startUnlocked();
    onBlur.advance(300);
    onBlur.input.loseFocus();
    expect(onBlur.engine.state).toBe("paused");
    expect(onBlur.paused).toEqual(["focus_lost"]);

    const onResize = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    onResize.engine.startUnlocked();
    onResize.advance(300);
    onResize.input.changeSurface("resize");
    expect(onResize.engine.state).toBe("paused");
    expect(onResize.paused).toEqual(["surface_changed"]);
    expect(onResize.engine.sessionFlags()).toContain("window_resized");
  });

  it("discards a restarted round rather than reporting it as a round that happened", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.advance(400);
    rig.engage();
    rig.advance(300);

    rig.engine.restartRound();
    expect(rig.aggregates).toHaveLength(0);

    for (let frame = 0; frame < 20_000 && rig.engine.state === "running"; frame += 1) {
      rig.clock.tick(FRAME_MS);
      rig.engage();
    }

    expect(rig.aggregates).toHaveLength(1);
    expect(rig.aggregates[0]?.trials).toHaveLength(2);
    // A restart re-seeds the stimulus stream, so a player cannot farm a favourable draw.
    expect(rig.aggregates[0]?.trials[0]?.stimulusSeed).toContain("restart1");
  });

  it("emits everything collected so far when aborted", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    rig.engine.startUnlocked();
    rig.advance(400);
    rig.engage();
    rig.advance(200);

    rig.engine.abort();

    expect(rig.aborted).toBe(true);
    expect(rig.engine.state).toBe("aborted");
    expect(rig.aggregates).toHaveLength(1);
    expect(rig.engine.stage.kind).toBe("aborted");
    // An aborted session measures nothing further.
    expect(rig.clock.pendingFrames).toBe(0);
  });

  it("ignores input once the session has finished", () => {
    const rig = createRig({ rounds: [{ trialCount: 1 }] }, { trialCount: 1 });
    playThrough(rig);
    const before = rig.engine.camera.yawDeg;

    rig.input.move(rig.clock.now(), 5000, 5000);
    expect(rig.engine.camera.yawDeg).toBe(before);
  });

  it("detaches from the input source on destroy", () => {
    const rig = createRig({ rounds: [{ trialCount: 2 }] }, { trialCount: 2 });
    rig.engine.startUnlocked();
    rig.advance(300);

    rig.engine.destroy();
    const before = rig.engine.camera.yawDeg;
    rig.input.move(rig.clock.now(), 1000, 0);

    expect(rig.engine.state).toBe("idle");
    expect(rig.engine.camera.yawDeg).toBe(before);
    expect(rig.clock.pendingFrames).toBe(0);
  });
});

describe("React learns nothing per frame — SENS-NFR-004", () => {
  it("fires no stage callback for the hundreds of frames inside a round", () => {
    const rig = createRig({ rounds: [{ trialCount: 3 }] }, { trialCount: 3 });
    playThrough(rig);

    expect(rig.renderer.drawCount).toBeGreaterThan(50);
    // One "round" stage and one "finished" stage. Progress inside the round is pulled from the
    // canvas HUD each frame, never pushed into React.
    expect(rig.stages.map((stage) => stage.kind)).toEqual(["round", "finished"]);
  });

  it("fires one round callback per round, not one per trial", () => {
    const rig = createRig(
      {
        rounds: [
          { presentationOrder: 0, trialCount: 4 },
          { presentationOrder: 1, trialCount: 4 },
        ],
      },
      { trialCount: 4 },
    );
    playThrough(rig);

    expect(rig.aggregates).toHaveLength(2);
    expect(rig.aggregates[0]?.trials).toHaveLength(4);
    expect(rig.stages.map((stage) => stage.kind)).toEqual([
      "round",
      "interstitial",
      "round",
      "finished",
    ]);
  });
});

describe("free aim", () => {
  const freeAim = {
    minAcquisitions: 3,
    targetAngularRadiusDeg: 3,
    minDistanceDeg: 10,
    maxDistanceDeg: 20,
    countsPer360: countsPer360(9000),
  };

  it("warms up at a sensitivity that is never one of the candidates", () => {
    // Practising on a candidate would advantage it before a single trial had been measured
    // (doc 09 §9.0.6).
    const rig = createRig({
      freeAim,
      candidateCounts: [6000, 12_000],
      rounds: [{ trialCount: 1 }],
    });
    rig.engine.startUnlocked();

    expect(rig.engine.stage.kind).toBe("free_aim");
    expect(rig.engine.camera.degreesPerCount).toBe(degreesPerCount(freeAim.countsPer360));
    expect(rig.engine.camera.degreesPerCount).not.toBe(degreesPerCount(countsPer360(6000)));
    expect(rig.engine.camera.degreesPerCount).not.toBe(degreesPerCount(countsPer360(12_000)));
  });

  it("does not start a measured round until free aim is completed", () => {
    const rig = createRig({ freeAim, rounds: [{ trialCount: 1 }] });
    rig.engine.startUnlocked();
    rig.advance(10_000);

    expect(rig.engine.stage.kind).toBe("free_aim");
    expect(rig.aggregates).toHaveLength(0);
    expect(rig.engine.freeAimSatisfied).toBe(false);
  });

  it("counts acquisitions and unlocks the continue control at the minimum", () => {
    const rig = createRig({ freeAim, rounds: [{ trialCount: 1 }] });
    rig.engine.startUnlocked();
    rig.clock.tick(FRAME_MS);

    for (let i = 0; i < freeAim.minAcquisitions; i += 1) {
      expect(rig.engine.hud.freeAim?.acquisitions).toBe(i);
      expect(rig.engage()).toBe(true);
      rig.clock.tick(FRAME_MS);
    }

    expect(rig.engine.hud.freeAim?.acquisitions).toBe(freeAim.minAcquisitions);
    expect(rig.engine.freeAimSatisfied).toBe(true);
  });

  it("spawns a fresh target after each acquisition", () => {
    const rig = createRig({ freeAim, rounds: [{ trialCount: 1 }] });
    rig.engine.startUnlocked();
    rig.clock.tick(FRAME_MS);

    const first = rig.renderer.lastFrame?.targets.living()[0];
    rig.engage();
    rig.clock.tick(FRAME_MS);
    const second = rig.renderer.lastFrame?.targets.living()[0];

    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first?.id);
  });
});
