import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import { countsPer360FromCm, degreesPerCount } from "@/core/sensitivity/canonical";
import { INVALID_REASONS } from "@/core/types/vocabulary";
import type { TrialContext } from "@/test-engine/contracts";
import {
  createQualityMonitor,
  DEFAULT_QUALITY_THRESHOLDS,
} from "@/test-engine/quality/quality-monitor";
import { createCamera } from "@/test-engine/render/camera";
import { createTargetManager } from "@/test-engine/targets/target-manager";
import { createTelemetryBuffers, sizeBuffers } from "@/test-engine/telemetry/ring-buffer";
import { createFrameMonitor } from "@/test-engine/timing/frame-monitor";
import { createTrialRunner, type TrialDependencies } from "@/test-engine/trial-manager";
import { createSyntheticDefinition } from "../../helpers/engine-harness";

/**
 * The trial state machine (doc 19 §19.2–§19.3).
 *
 * Two things are being pinned down here.
 *
 * **The measured window.** A trial is armed before it is measured, and where a definition asks
 * for a reset target the window opens only once that target is cleared. Everything before that
 * is positioning, and counting it would mix a player's starting posture into their reaction.
 *
 * **`SENS-BR-009`.** Every invalid reason this file can produce describes what the *procedure*
 * did — a lost lock, a hitch, a click before the stimulus. None of them describes how well the
 * player aimed. The last test in this file asserts that at the level of the vocabulary itself.
 */

const DEG_PER_COUNT = degreesPerCount(countsPer360FromCm(30, 800));

interface Rig extends TrialDependencies {
  readonly context: TrialContext;
}

function createRig(): Rig {
  return {
    camera: createCamera({
      horizontalHalfFovDeg: 51.5,
      aspectRatio: 16 / 9,
      degreesPerCount: DEG_PER_COUNT,
    }),
    targets: createTargetManager(),
    buffers: createTelemetryBuffers(
      sizeBuffers({ timeoutMs: 3000, maxPollingRateHz: 1000, maxRefreshHz: 240 }),
    ),
    frames: createFrameMonitor({ frameBudgetMs: 1000 / 60 }),
    quality: createQualityMonitor(DEFAULT_QUALITY_THRESHOLDS),
    context: { trialIndex: 0, isPractice: false, scopeKey: "hipfire", mode: "standard" },
  };
}

/** Counts needed to turn `degrees` horizontally at the rig's sensitivity. */
const countsFor = (degrees: number): number => degrees / DEG_PER_COUNT;

function runner(
  rig: Rig,
  options: Parameters<typeof createSyntheticDefinition>[0] = {},
  startedAt = 1000,
  interTrialIntervalMs = 100,
) {
  return createTrialRunner({
    definition: createSyntheticDefinition(options),
    context: rig.context,
    rng: deriveRng("trial-seed", "target-placement", 0, 0),
    deps: rig,
    startedAt,
    interTrialIntervalMs,
  });
}

describe("the measured window", () => {
  it("stays armed through the inter-trial interval, then presents the stimulus", () => {
    const rig = createRig();
    const trial = runner(rig);

    expect(trial.phase).toBe("armed");
    expect(trial.stimulusAt).toBeNull();

    trial.tick(1050);
    expect(trial.phase).toBe("armed");
    expect(rig.targets.livingCount).toBe(0);

    trial.tick(1100);
    expect(trial.phase).toBe("active");
    expect(trial.stimulusAt).toBe(1100);
    expect(rig.targets.livingCount).toBe(1);
  });

  it("records movement during the interval but does not measure it", () => {
    const rig = createRig();
    const trial = runner(rig);

    trial.onMove(1020, 500, 0);
    trial.tick(1100); // stimulus
    const outcome = trial.abort(1200, "timeout");

    // The camera did move — the player's hand was not frozen — but none of those counts are
    // attributed to the measured window.
    expect(outcome.totalCounts).toBe(0);
  });

  it("opens the window only once a reset target is cleared", () => {
    const rig = createRig();
    const trial = runner(rig, { includeResetTarget: true });

    trial.tick(1100);
    expect(trial.phase).toBe("active");
    // Positioning, not measuring: the stimulus clock has not started.
    expect(trial.stimulusAt).toBeNull();
    expect(rig.targets.livingCount).toBe(2);

    // The reset target sits at the origin, so clearing it also guarantees a known orientation.
    trial.onButton(1150, "down", 0);
    trial.onButton(1158, "up", 0);

    expect(trial.stimulusAt).toBe(1150);
    expect(rig.targets.livingCount).toBe(1);
  });

  it("treats a click on the reset target as positioning, not as a shot", () => {
    const rig = createRig();
    const trial = runner(rig, { includeResetTarget: true });
    trial.tick(1100);
    trial.onButton(1150, "down", 0);

    trial.onMove(1200, countsFor(20), 0);
    trial.onButton(1250, "down", 0);
    const outcome = trial.tick(1260) ?? trial.abort(1260, "timeout");

    // One shot: the one fired at the scored target.
    expect(outcome.shots).toBe(1);
    expect(outcome.hit).toBe(true);
  });

  it("gives up on a reset target that is never cleared", () => {
    const rig = createRig();
    const trial = runner(rig, { includeResetTarget: true, timeoutMs: 500 });
    trial.tick(1100);

    expect(trial.tick(1900)).toBeNull();
    const outcome = trial.tick(2200);
    expect(outcome?.invalidReason).toBe("timeout");
  });
});

describe("resolution", () => {
  it("resolves a first_hit trial the moment the target is struck", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    trial.onMove(1200, countsFor(20), 0);
    trial.onButton(1250, "down", 0);

    const outcome = trial.tick(1251);
    expect(outcome).not.toBeNull();
    expect(outcome?.validity).toBe("valid");
    expect(outcome?.hit).toBe(true);
    expect(outcome?.firstShotHit).toBe(true);
    expect(outcome?.shots).toBe(1);
    expect(outcome?.resolvedAt).toBe(1251);
  });

  it("keeps a missed trial valid — a bad trial is not an invalid one (SENS-BR-009)", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    // Aims nowhere near, fires, misses, then finds the target late.
    trial.onMove(1200, countsFor(3), 0);
    trial.onButton(1250, "down", 0);
    trial.onMove(1300, countsFor(17), 0);
    trial.onButton(1400, "down", 0);

    const outcome = trial.tick(1401);
    expect(outcome?.validity).toBe("valid");
    expect(outcome?.invalidReason).toBeNull();
    expect(outcome?.firstShotHit).toBe(false);
    expect(outcome?.hit).toBe(true);
    expect(outcome?.shots).toBe(2);
  });

  it("distinguishes a player who tried and ran out of time from one who did not engage", () => {
    const engaged = createRig();
    const tried = runner(engaged, { timeoutMs: 500 });
    tried.tick(1100);
    tried.onMove(1200, 300, 40);
    expect(tried.tick(1600)?.invalidReason).toBe("timeout");

    const idle = createRig();
    const absent = runner(idle, { timeoutMs: 500 });
    absent.tick(1100);
    absent.onMove(1200, 3, 1); // a twitch, well under the movement floor
    expect(absent.tick(1600)?.invalidReason).toBe("no_input");
  });

  it("treats a duration trial's clock running out as success, not as a timeout", () => {
    const rig = createRig();
    const trial = runner(rig, {
      endCondition: "duration",
      shootingModel: "none",
      timeoutMs: 600,
    });
    trial.tick(1100);
    trial.onMove(1300, 400, 0);

    expect(trial.tick(1500)).toBeNull();
    const outcome = trial.tick(1700);
    expect(outcome?.validity).toBe("valid");
    expect(outcome?.invalidReason).toBeNull();
  });

  it("resolves a single_shot trial on the shot, hit or miss", () => {
    const rig = createRig();
    const trial = runner(rig, { endCondition: "single_shot" });
    trial.tick(1100);
    trial.onButton(1200, "down", 0);

    const outcome = trial.tick(1201);
    expect(outcome?.validity).toBe("valid");
    expect(outcome?.shots).toBe(1);
    expect(outcome?.hit).toBe(false);
  });

  it("requires every kill before a kill_count trial resolves", () => {
    const rig = createRig();
    const trial = runner(rig, {
      endCondition: "kill_count",
      killTarget: 2,
      targetCount: 2,
      timeoutMs: 3000,
    });
    trial.tick(1100);

    // First target sits 20° right, second a further 8°.
    trial.onMove(1150, countsFor(20), 0);
    trial.onButton(1200, "down", 0);
    expect(trial.tick(1210)).toBeNull();

    trial.onMove(1250, countsFor(8), 0);
    trial.onButton(1300, "down", 0);
    const outcome = trial.tick(1310);

    expect(outcome?.validity).toBe("valid");
    expect(outcome?.shots).toBe(2);
  });
});

describe("procedural faults", () => {
  it("invalidates a click fired before the stimulus appeared", () => {
    const rig = createRig();
    const trial = runner(rig);

    trial.onButton(1050, "down", 0);
    trial.tick(1100);
    trial.onMove(1200, countsFor(20), 0);
    trial.onButton(1250, "down", 0);

    const outcome = trial.tick(1251);
    // The player did hit — and the trial is still invalid, because the pre-emptive click means
    // the reaction component measured nothing.
    expect(outcome?.hit).toBe(true);
    expect(outcome?.validity).toBe("invalid");
    expect(outcome?.invalidReason).toBe("premature_click");
  });

  it("invalidates an extra shot in a single_shot trial", () => {
    const rig = createRig();
    const trial = runner(rig, { endCondition: "single_shot" });
    trial.tick(1100);

    trial.onButton(1200, "down", 0);
    trial.onButton(1260, "down", 0);

    const outcome = trial.tick(1261);
    expect(outcome?.invalidReason).toBe("extra_shot");
    expect(outcome?.shots).toBe(1);
  });

  it("invalidates a hold trial the player barely held", () => {
    const rig = createRig();
    const trial = runner(rig, {
      endCondition: "duration",
      shootingModel: "hold",
      timeoutMs: 1000,
      minHeldRatio: 0.7,
    });
    trial.tick(1100);

    trial.onButton(1100, "down", 0);
    trial.onButton(1300, "up", 0); // held 200 ms of 1000

    const outcome = trial.tick(2100);
    expect(outcome?.invalidReason).toBe("button_held_ratio_low");
    expect(outcome?.heldRatio).toBeCloseTo(0.2, 6);
  });

  it("accepts a hold trial the player held throughout", () => {
    const rig = createRig();
    const trial = runner(rig, {
      endCondition: "duration",
      shootingModel: "hold",
      timeoutMs: 1000,
      minHeldRatio: 0.7,
    });
    trial.tick(1100);
    trial.onButton(1100, "down", 0); // never released

    const outcome = trial.tick(2100);
    expect(outcome?.validity).toBe("valid");
    expect(outcome?.heldRatio).toBeCloseTo(1, 3);
  });

  it("invalidates on an environmental fault the moment it is observed", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    rig.quality.notePointerLockLost();
    const outcome = trial.tick(1150);
    expect(outcome?.invalidReason).toBe("pointer_lock_lost");
  });

  it("invalidates on a frame hitch inside the measured window", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    rig.frames.record(1100);
    rig.frames.record(1350); // a 250 ms gap

    const outcome = trial.tick(1360);
    expect(outcome?.invalidReason).toBe("frame_hitch");
  });

  it("marks a stuttering but unbroken trial degraded, not invalid", () => {
    // Degraded data is still data. Discarding it would bias the session toward whichever
    // candidate happened to be presented while the machine behaved.
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    let t = 1100;
    rig.frames.record(t);
    for (let i = 0; i < 40; i += 1) {
      // Every fourth frame is late, but none is a hitch.
      t += i % 4 === 0 ? 40 : 16.7;
      rig.frames.record(t);
    }

    trial.onMove(t, countsFor(20), 0);
    trial.onButton(t + 10, "down", 0);
    const outcome = trial.tick(t + 11);

    expect(outcome?.invalidReason).toBeNull();
    expect(outcome?.validity).toBe("degraded");
    expect(outcome?.hit).toBe(true);
  });

  it("carries a surface change as a flag without invalidating the trial", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    rig.quality.noteSurfaceChange("resize");
    trial.onMove(1200, countsFor(20), 0);
    trial.onButton(1250, "down", 0);
    const outcome = trial.tick(1251);

    expect(outcome?.qualityFlags).toContain("window_resized");
    expect(outcome?.validity).toBe("valid");
  });

  it("rejects input no hand could have produced", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    trial.onMove(1200, 10, 0);
    trial.onMove(1201, 900_000, 0); // 9×10^8 counts/s

    const outcome = trial.tick(1210);
    expect(outcome?.invalidReason).toBe("impossible_velocity");
  });

  it("forces resolution when the session aborts, keeping the first outcome", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    const outcome = trial.abort(1200, "focus_lost");
    expect(outcome.invalidReason).toBe("focus_lost");
    expect(trial.phase).toBe("resolved");

    // Aborting again cannot rewrite what was already recorded.
    expect(trial.abort(1300, "timeout")).toBe(outcome);
  });
});

describe("what the trial counts", () => {
  it("counts movement only inside the measured window", () => {
    const rig = createRig();
    const trial = runner(rig);

    trial.onMove(1050, 1000, 0); // during the interval
    trial.tick(1100);
    trial.onMove(1200, 300, 400); // 500 counts

    const outcome = trial.abort(1300, "timeout");
    expect(outcome.totalCounts).toBeCloseTo(500, 6);
  });

  it("ignores buttons other than the primary one entirely", () => {
    const rig = createRig();
    const trial = runner(rig);
    trial.tick(1100);

    trial.onMove(1200, countsFor(20), 0);
    trial.onButton(1220, "down", 2); // middle click, on target
    const stillOpen = trial.tick(1230);

    expect(stillOpen).toBeNull();
    // Not recorded as an engagement at all, so it cannot appear in the event stream.
    expect(rig.buffers.events().count).toBe(0);
  });

  it("honours a shot cooldown so one physical click cannot register twice", () => {
    const rig = createRig();
    const definition = createSyntheticDefinition({ endCondition: "kill_count", killTarget: 5 });
    const trial = createTrialRunner({
      definition: { ...definition, shotCooldownMs: 60 },
      context: rig.context,
      rng: deriveRng("cooldown", "target-placement", 0, 0),
      deps: rig,
      startedAt: 1000,
      interTrialIntervalMs: 100,
    });
    trial.tick(1100);

    trial.onButton(1200, "down", 0);
    trial.onButton(1220, "down", 0); // inside the cooldown
    trial.onButton(1300, "down", 0);

    const outcome = trial.abort(1400, "timeout");
    expect(outcome.shots).toBe(2);
  });

  it("records the camera orientation the trial started from", () => {
    const rig = createRig();
    const trial = runner(rig);

    rig.camera.setAngles(12, -3);
    trial.tick(1100);
    const outcome = trial.abort(1200, "timeout");

    expect(outcome.originAngles.yawDeg).toBeCloseTo(12, 9);
    expect(outcome.originAngles.pitchDeg).toBeCloseTo(-3, 9);
  });
});

describe("SENS-BR-009", () => {
  it("has no invalid reason that describes how well the player performed", () => {
    // The reason vocabulary is the enforcement point. If a performance-derived reason were ever
    // added here, the engine could invalidate a trial for being a bad trial — and a session
    // that quietly drops its worst trials manufactures a flattering, false recommendation.
    const performanceWords = [
      "miss",
      "accuracy",
      "score",
      "slow",
      "bad",
      "poor",
      "fail",
      "low_hit",
    ];
    for (const reason of INVALID_REASONS) {
      for (const word of performanceWords) {
        expect(reason.includes(word)).toBe(false);
      }
    }
  });
});
