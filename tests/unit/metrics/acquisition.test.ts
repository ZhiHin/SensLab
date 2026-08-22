import { describe, expect, it } from "vitest";
import {
  adjustedAcquisitionTime,
  firstShotAccuracy,
  hitAccuracy,
  movementOnsetTime,
  prematureClickRate,
  qualityScore,
  reactionTime,
  targetAcquisitionTime,
  timeToTarget,
} from "@/test-engine/metrics/acquisition";
import { buildObservation, holdPath, joinPaths, straightPath } from "../../helpers/trial-fixture";

/**
 * The acquisition family against known traces (doc 10 §10.2).
 *
 * Every case here has an answer computable by hand. That is the point: a metric bug does not
 * crash and does not produce an out-of-range value — it produces a plausible number for the
 * wrong quantity, and only a known-answer test catches that.
 */

const STIMULUS = 1000;

describe("reactionTime", () => {
  it("measures from the presentation frame to the first press", () => {
    const { observation } = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 400 }),
      presses: [STIMULUS + 237.5],
      stimulusAt: STIMULUS,
    });

    // Sub-millisecond resolution is preserved: performance.now() gives it and doc 10 §10.10
    // requires it not be truncated.
    expect(reactionTime.derive(observation)).toBeCloseTo(237.5, 9);
  });

  it("declines when the player never pressed", () => {
    const { observation } = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 1200 }),
      stimulusAt: STIMULUS,
    });
    expect(reactionTime.derive(observation)).toBeNull();
  });

  it("uses the FIRST press, not the last", () => {
    const { observation } = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 600 }),
      presses: [STIMULUS + 210, STIMULUS + 400],
      stimulusAt: STIMULUS,
    });
    expect(reactionTime.derive(observation)).toBeCloseTo(210, 9);
  });
});

describe("prematureClickRate", () => {
  it("flags a press below the human simple-reaction floor", () => {
    const early = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 200 }),
      presses: [STIMULUS + 40],
      stimulusAt: STIMULUS,
    });
    expect(prematureClickRate.derive(early.observation)).toBe(1);

    const genuine = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 400 }),
      presses: [STIMULUS + 190],
      stimulusAt: STIMULUS,
    });
    expect(prematureClickRate.derive(genuine.observation)).toBe(0);
  });
});

describe("timeToTarget", () => {
  it("is the moment the crosshair first touches the target, whatever the trigger did", () => {
    // Travels 20° in 200 ms at a constant 100°/s; the 2°-radius target's near edge is at 18°,
    // which is reached at 180 ms.
    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      path: straightPath({
        to: { yawDeg: 20, pitchDeg: 0 },
        startAt: STIMULUS,
        durationMs: 200,
      }),
      stimulusAt: STIMULUS,
    });

    // The edge is crossed at exactly 180 ms, and entry is detected on an input sample — so the
    // answer is the first sample at or after the crossing. Asserting a one-sample window is not
    // slack: detection genuinely cannot be finer than the polling rate, and a test that
    // demanded more would be asserting a precision the measurement does not have.
    const entry = timeToTarget.derive(observation) as number;
    expect(entry).toBeGreaterThanOrEqual(180);
    expect(entry).toBeLessThanOrEqual(181);
  });

  it("declines when the crosshair never reached the target", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 200 }),
      stimulusAt: STIMULUS,
    });
    expect(timeToTarget.derive(observation)).toBeNull();
  });
});

describe("movementOnsetTime", () => {
  it("ignores the reaction delay before the hand starts moving", () => {
    const trace = joinPaths(
      holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 150 }),
      straightPath({
        to: { yawDeg: 20, pitchDeg: 0 },
        startAt: STIMULUS + 150,
        durationMs: 200,
      }),
    );

    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      path: trace,
      stimulusAt: STIMULUS,
    });

    // Movement starts at +150 ms; the sustain requirement pushes detection no further than a
    // few samples past the true start.
    const onset = movementOnsetTime.derive(observation);
    expect(onset).not.toBeNull();
    expect(onset as number).toBeGreaterThanOrEqual(150);
    expect(onset as number).toBeLessThan(165);
  });

  it("is not fooled by a single noisy sample", () => {
    // One 0.5° twitch then stillness: fast enough to cross the speed threshold for one sample,
    // but nowhere near sustained.
    const trace = [
      { t: STIMULUS, yawDeg: 0, pitchDeg: 0 },
      { t: STIMULUS + 1, yawDeg: 0.5, pitchDeg: 0 },
      ...holdPath({ at: { yawDeg: 0.5, pitchDeg: 0 }, startAt: STIMULUS + 2, durationMs: 300 }),
    ];

    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      path: trace,
      stimulusAt: STIMULUS,
    });
    expect(movementOnsetTime.derive(observation)).toBeNull();
  });
});

describe("targetAcquisitionTime and its onset-adjusted form", () => {
  const trace = joinPaths(
    holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 200 }),
    straightPath({ to: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS + 200, durationMs: 200 }),
    holdPath({ at: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS + 400, durationMs: 60 }),
  );

  const fixture = () =>
    buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      path: trace,
      presses: [STIMULUS + 430],
      killAt: STIMULUS + 430,
      hit: true,
      firstShotHit: true,
      shots: 1,
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 460,
    });

  it("ends at the kill, not at the trial's close", () => {
    expect(targetAcquisitionTime.derive(fixture().observation)).toBeCloseTo(430, 6);
  });

  it("strips the sensitivity-independent onset term", () => {
    // The whole reason this metric exists: a player whose acquisition is slow because their
    // reaction is slow is telling us nothing about the sensitivity.
    const raw = targetAcquisitionTime.derive(fixture().observation) as number;
    const onset = movementOnsetTime.derive(fixture().observation) as number;
    const adjusted = adjustedAcquisitionTime.derive(fixture().observation) as number;

    expect(adjusted).toBeCloseTo(raw - onset, 6);
    expect(adjusted).toBeLessThan(raw);
  });

  it("declines on a trial that never hit", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 6, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 300 }),
      stimulusAt: STIMULUS,
      hit: false,
    });

    // A miss has no moment of acquisition. Substituting the timeout would report the clock
    // rather than the player.
    expect(targetAcquisitionTime.derive(observation)).toBeNull();
    expect(adjustedAcquisitionTime.derive(observation)).toBeNull();
  });
});

describe("shot accuracy", () => {
  it("records first-shot success as an indicator, and absence as absence", () => {
    const hitFixture = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      firstShotHit: true,
    });
    expect(firstShotAccuracy.derive(hitFixture.observation)).toBe(1);

    const missFixture = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      firstShotHit: false,
    });
    expect(firstShotAccuracy.derive(missFixture.observation)).toBe(0);

    // "Did not shoot" is not "shot and missed"; counting it as a miss would punish a timeout
    // twice, once as invalid and once as inaccurate.
    const noShot = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      firstShotHit: null,
    });
    expect(firstShotAccuracy.derive(noShot.observation)).toBeNull();
  });

  it("reports hits over shots for the trial", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      presses: [STIMULUS + 40, STIMULUS + 70, STIMULUS + 95],
      killAt: STIMULUS + 95,
      shots: 3,
    });
    expect(hitAccuracy.derive(observation)).toBeCloseTo(1 / 3, 9);
  });

  it("declines rather than dividing by zero when nothing was fired", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      path: straightPath({ to: { yawDeg: 5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      shots: 0,
    });
    expect(hitAccuracy.derive(observation)).toBeNull();
  });
});

describe("qualityScore", () => {
  it("reports the fraction of frames that met the budget", () => {
    const { observation } = buildObservation({
      path: holdPath({ at: { yawDeg: 0, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      quality: { cleanFrameFraction: 0.82 },
    });
    expect(qualityScore.derive(observation)).toBeCloseTo(0.82, 9);
  });
});
