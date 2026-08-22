import { describe, expect, it } from "vitest";
import type { TrialRecord } from "@/test-engine/contracts";
import { createEngine } from "@/test-engine/engine";
import { buildHudModel, PAUSE_HINT_KEY, type HudModel } from "@/test-engine/render/hud";
import type { SessionStage } from "@/test-engine/session-controller";
import { createHarness, createPlan, createSyntheticDefinition } from "../../helpers/engine-harness";

/**
 * What the player is shown, and what two machines agree on.
 *
 * These two subjects share a file because they share a purpose: both are about the session
 * measuring the *player*, rather than the player's screen or the player's expectations.
 */

/* ------------------------------------------------------------------ HUD */

const ROUND_STAGE: SessionStage = {
  kind: "round",
  round: {
    presentationOrder: 3,
    blockIndex: 1,
    roundIndex: 2,
    candidateIndex: 1,
    testKey: "flick",
    scopeKey: "hipfire",
    isPractice: false,
    trialCount: 12,
    stimulusSeed: "seed",
  },
  progress: {
    completedTrials: 5,
    targetTrials: 12,
    validTrials: 4,
    invalidTrials: 1,
    replacementsUsed: 1,
    replacementsRemaining: 2,
  },
};

describe("the HUD — SENS-BR-007", () => {
  it("has no field for score, accuracy, streak or elapsed time", () => {
    // Asserted on the model's shape rather than on drawn pixels, because a structural
    // guarantee is far stronger than grepping a canvas: a visible score turns a measurement
    // into a performance, and the player starts optimising for the number instead of aiming.
    const hud = buildHudModel(ROUND_STAGE, { completedRounds: 3, totalRounds: 12 }, 0);
    const keys = Object.keys(hud);

    for (const forbidden of [
      "score",
      "accuracy",
      "hits",
      "misses",
      "streak",
      "elapsedMs",
      "remainingMs",
      "reactionMs",
      "best",
      "rank",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys.sort()).toEqual(
      [
        "countdownSeconds",
        "freeAim",
        "hintKey",
        "roundNumber",
        "testLabelKey",
        "totalRounds",
        "trialsDone",
        "trialsTarget",
      ].sort(),
    );
  });

  it("never carries the candidate's identity or its sensitivity", () => {
    // The round knows which candidate it is running; the HUD must not, or the player's
    // expectations decide which sensitivity "felt better" (`SENS-BR-007`).
    const hud = buildHudModel(ROUND_STAGE, { completedRounds: 3, totalRounds: 12 }, 0);
    const serialised = JSON.stringify(hud);

    expect(serialised).not.toContain("candidate");
    expect(serialised).not.toContain("countsPer360");
    expect(serialised).not.toContain("blindLabel");
  });

  it("shows a 1-based round number and honest trial progress", () => {
    const hud = buildHudModel(ROUND_STAGE, { completedRounds: 3, totalRounds: 12 }, 0);

    expect(hud.roundNumber).toBe(3); // roundIndex 2
    expect(hud.totalRounds).toBe(12);
    expect(hud.trialsDone).toBe(5);
    expect(hud.trialsTarget).toBe(12);
    expect(hud.testLabelKey).toBe("test.flick.name");
    expect(hud.hintKey).toBe(PAUSE_HINT_KEY);
  });

  it("carries message keys, never literal copy", () => {
    // Anything the HUD names must be translatable; a literal string here would be a string the
    // Chinese build cannot show (doc 25).
    const stages: SessionStage[] = [
      ROUND_STAGE,
      { kind: "free_aim", acquisitions: 2 },
      { kind: "countdown", remainingMs: 2400 },
      { kind: "interstitial", untilMs: 0 },
      { kind: "paused", reason: "user" },
      { kind: "idle" },
      { kind: "finished" },
      { kind: "aborted" },
    ];

    for (const stage of stages) {
      const hud: HudModel = buildHudModel(stage, { completedRounds: 0, totalRounds: 4 }, 5);
      if (hud.hintKey.length > 0) expect(hud.hintKey).toMatch(/^[a-z]+\.[A-Za-z]+$/);
      if (hud.testLabelKey !== null) expect(hud.testLabelKey).toMatch(/^test\./);
    }
  });

  it("rounds the countdown up, so the last second is shown as 1 rather than 0", () => {
    expect(
      buildHudModel({ kind: "countdown", remainingMs: 2400 }, totals(), 0).countdownSeconds,
    ).toBe(3);
    expect(
      buildHudModel({ kind: "countdown", remainingMs: 1001 }, totals(), 0).countdownSeconds,
    ).toBe(2);
    expect(
      buildHudModel({ kind: "countdown", remainingMs: 200 }, totals(), 0).countdownSeconds,
    ).toBe(1);
    expect(buildHudModel({ kind: "countdown", remainingMs: 0 }, totals(), 0).countdownSeconds).toBe(
      1,
    );
  });

  it("shows free-aim progress against its requirement, and nothing else", () => {
    const hud = buildHudModel({ kind: "free_aim", acquisitions: 2 }, totals(), 5);
    expect(hud.freeAim).toEqual({ acquisitions: 2, required: 5 });
    expect(hud.roundNumber).toBeNull();
    expect(hud.trialsTarget).toBe(0);
  });

  it("shows nothing at all when there is nothing to show", () => {
    for (const kind of ["idle", "finished", "aborted"] as const) {
      const hud = buildHudModel({ kind }, totals(), 0);
      expect(hud.roundNumber).toBeNull();
      expect(hud.hintKey).toBe("");
      expect(hud.countdownSeconds).toBeNull();
      expect(hud.freeAim).toBeNull();
    }
  });
});

function totals() {
  return { completedRounds: 0, totalRounds: 4 };
}

/* ------------------------------------------------------------------ determinism */

type TimelineEvent =
  | { readonly t: number; readonly kind: "move"; readonly dx: number; readonly dy: number }
  | { readonly t: number; readonly kind: "press" }
  | { readonly t: number; readonly kind: "release" };

/**
 * Runs one session against a fixed wall-clock input timeline at a given frame rate.
 *
 * Input is delivered at its own absolute timestamp rather than on a frame boundary, which is
 * what a real browser does — a mouse event does not wait for the compositor.
 */
function runTimeline(events: readonly TimelineEvent[], frameMs: number, endMs: number) {
  const { clock, input, renderer } = createHarness(1000);
  const trials: TrialRecord[] = [];

  const engine = createEngine({
    plan: createPlan({ rounds: [{ trialCount: 2 }], seed: "determinism" }),
    definitions: [
      createSyntheticDefinition({ trialCount: 2, targetDistanceDeg: 20, targetRadiusDeg: 2 }),
    ],
    clock,
    input,
    renderer,
    frameBudgetMs: frameMs,
    callbacks: {
      onRoundComplete: (aggregate) => trials.push(...aggregate.trials),
    },
  });

  engine.init();
  engine.startUnlocked();

  let cursor = 0;
  while (clock.now() < endMs && engine.state === "running") {
    const next = clock.now() + frameMs;
    while (cursor < events.length && (events[cursor]?.t ?? Infinity) <= next) {
      const event = events[cursor];
      cursor += 1;
      if (event === undefined) break;
      if (event.kind === "move") input.move(event.t, event.dx, event.dy);
      else if (event.kind === "press") input.press(event.t);
      else input.release(event.t);
    }
    clock.tick(frameMs);
  }

  return { trials, engine, frames: renderer.drawCount };
}

/** Counts needed for `degrees` at the harness plan's baseline of 9448.82 counts/360°. */
const countsFor = (degrees: number): number => degrees / (360 / 9448.82);

describe("frame-rate independence — FR-055", () => {
  const timeline: readonly TimelineEvent[] = [
    { t: 1300, kind: "move", dx: countsFor(20), dy: 0 },
    { t: 1400, kind: "press" },
    { t: 1408, kind: "release" },
    // Second trial: the same movement again, from the position the first left the camera in.
    { t: 2600, kind: "press" },
    { t: 2608, kind: "release" },
  ];

  it("reaches the same hit decisions at 60 Hz, 144 Hz and 240 Hz", () => {
    const decisions = [1000 / 60, 1000 / 144, 1000 / 240].map((frameMs) => {
      const { trials, frames } = runTimeline(timeline, frameMs, 6000);
      return {
        frames,
        outcomes: trials.map((trial) => ({
          hit: trial.hit,
          shots: trial.shots,
          validity: trial.validity,
          invalidReason: trial.invalidReason,
        })),
      };
    });

    // The machines genuinely rendered different numbers of frames…
    const frameCounts = decisions.map((decision) => decision.frames);
    expect(new Set(frameCounts).size).toBe(3);

    // …and reached identical conclusions about what the player did.
    expect(decisions[1]?.outcomes).toEqual(decisions[0]?.outcomes);
    expect(decisions[2]?.outcomes).toEqual(decisions[0]?.outcomes);
    expect(decisions[0]?.outcomes[0]?.hit).toBe(true);
  });

  it("agrees on a near miss, where a frame-quantised decision would diverge", () => {
    // 2.4° from a 2° target: outside, and close enough that integrating position per frame
    // rather than evaluating it at the click instant could flip the answer.
    const nearMiss: readonly TimelineEvent[] = [
      { t: 1300, kind: "move", dx: countsFor(22.4), dy: 0 },
      { t: 1400, kind: "press" },
      { t: 1408, kind: "release" },
    ];

    const slow = runTimeline(nearMiss, 1000 / 60, 6000);
    const fast = runTimeline(nearMiss, 1000 / 240, 6000);

    expect(slow.trials[0]?.hit).toBe(false);
    expect(fast.trials[0]?.hit).toBe(false);
    expect(fast.trials[0]?.shots).toBe(slow.trials[0]?.shots);
  });

  it("records different frame quality without changing the measurement", () => {
    // The slower machine's frame statistics differ — that is the point of recording them — but
    // its trial outcomes do not.
    const slow = runTimeline(timeline, 1000 / 30, 6000);
    const fast = runTimeline(timeline, 1000 / 240, 6000);

    expect(slow.frames).toBeLessThan(fast.frames);
    expect(slow.trials.map((trial) => trial.hit)).toEqual(fast.trials.map((trial) => trial.hit));
  });
});

describe("reproducibility — SENS-BR-031", () => {
  it("produces byte-identical trial records from the same seed and the same input", () => {
    const timeline: readonly TimelineEvent[] = [
      { t: 1300, kind: "move", dx: countsFor(20), dy: 0 },
      { t: 1400, kind: "press" },
      { t: 1408, kind: "release" },
      { t: 2600, kind: "press" },
      { t: 2608, kind: "release" },
    ];

    const first = runTimeline(timeline, 1000 / 240, 6000);
    const second = runTimeline(timeline, 1000 / 240, 6000);

    expect(second.trials).toEqual(first.trials);
    expect(second.trials.length).toBeGreaterThan(0);
  });
});
