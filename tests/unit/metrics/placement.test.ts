import { describe, expect, it } from "vitest";
import {
  correctionCount,
  flickError,
  flickErrorNorm,
  jitterRMS,
  microAdjustmentError,
  overshootMagnitudeNorm,
  overshootRate,
  pathEfficiency,
  settleTime,
  undershootRate,
} from "@/test-engine/metrics/placement";
import { buildObservation, holdPath, joinPaths, straightPath } from "../../helpers/trial-fixture";

/**
 * The placement and error family against known traces (doc 10 §10.3).
 *
 * The two that matter most are `overshootRate` and `undershootRate`. They are the two-sided
 * signature that gives the response curve a peak at all: too-high sensitivity overshoots,
 * too-low undershoots, and the optimum minimises their sum. A monotone metric could never
 * locate an optimum, only a direction.
 */

const STIMULUS = 1000;
const TARGET = { yawDeg: 20, pitchDeg: 0 };

describe("pathEfficiency", () => {
  it("scores a perfectly straight flick at 1.0", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: straightPath({ to: TARGET, startAt: STIMULUS, durationMs: 200 }),
      stimulusAt: STIMULUS,
    });
    expect(pathEfficiency.derive(observation)).toBeCloseTo(1, 3);
  });

  it("punishes a detour in proportion to how far it wandered", () => {
    // Out to 20° via a 10° excursion in pitch: the straight-line distance is unchanged but the
    // path travelled is much longer.
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 10, pitchDeg: 10 }, startAt: STIMULUS, durationMs: 120 }),
      straightPath({
        from: { yawDeg: 10, pitchDeg: 10 },
        to: TARGET,
        startAt: STIMULUS + 120,
        durationMs: 120,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });

    const efficiency = pathEfficiency.derive(observation) as number;
    expect(efficiency).toBeLessThan(0.85);
    expect(efficiency).toBeGreaterThan(0);
  });

  it("never exceeds 1, even when the geometry conspires", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 6,
      path: straightPath({ to: { yawDeg: 15, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 50 }),
      stimulusAt: STIMULUS,
    });
    const efficiency = pathEfficiency.derive(observation);
    expect(efficiency).not.toBeNull();
    expect(efficiency as number).toBeLessThanOrEqual(1);
  });

  it("declines when the crosshair never reached the target", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: straightPath({ to: { yawDeg: 8, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      stimulusAt: STIMULUS,
    });
    expect(pathEfficiency.derive(observation)).toBeNull();
  });
});

describe("overshoot — the signature of too much sensitivity", () => {
  it("flags a trial that sailed past the target before entering it", () => {
    // Out to 26° — past the far edge at 22° — then back onto the target.
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 26, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 150 }),
      straightPath({
        from: { yawDeg: 26, pitchDeg: 0 },
        to: TARGET,
        startAt: STIMULUS + 150,
        durationMs: 120,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });

    expect(overshootRate.derive(observation)).toBe(1);
    // (26 − (20 + 2)) / 2 = 2 target radii past the far edge.
    expect(overshootMagnitudeNorm.derive(observation)).toBeCloseTo(2, 2);
  });

  it("does not flag a clean approach that stopped inside the target", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: straightPath({ to: { yawDeg: 20.4, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 180 }),
      stimulusAt: STIMULUS,
    });

    expect(overshootRate.derive(observation)).toBe(0);
    expect(overshootMagnitudeNorm.derive(observation)).toBe(0);
  });

  it("stops looking once the target is dead, so a later engagement cannot be blamed on it", () => {
    // A switching sequence keeps moving after the kill. Counting that travel against the target
    // that has already been destroyed would report an overshoot rate near 1 for every switching
    // round — which is why the window is bounded at the kill (doc 10 §10.3, corrected).
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 19.5, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 150 }),
      straightPath({
        from: { yawDeg: 19.5, pitchDeg: 0 },
        to: { yawDeg: 45, pitchDeg: 0 },
        startAt: STIMULUS + 150,
        durationMs: 200,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      killAt: STIMULUS + 150,
      stimulusAt: STIMULUS,
    });
    expect(overshootRate.derive(observation)).toBe(0);
  });
});

describe("undershoot — the signature of too little sensitivity", () => {
  it("flags a ballistic movement that stopped short and needed a second one", () => {
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 12, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 120 }),
      // Stopped well short of the near edge at 18°, for far longer than the dwell threshold.
      holdPath({ at: { yawDeg: 12, pitchDeg: 0 }, startAt: STIMULUS + 120, durationMs: 120 }),
      straightPath({
        from: { yawDeg: 12, pitchDeg: 0 },
        to: TARGET,
        startAt: STIMULUS + 240,
        durationMs: 120,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });
    expect(undershootRate.derive(observation)).toBe(1);
  });

  it("does not flag a single continuous movement onto the target", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: straightPath({ to: TARGET, startAt: STIMULUS, durationMs: 200 }),
      stimulusAt: STIMULUS,
    });
    expect(undershootRate.derive(observation)).toBe(0);
  });

  it("does not flag a brief hesitation shorter than the dwell threshold", () => {
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 12, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 120 }),
      holdPath({ at: { yawDeg: 12, pitchDeg: 0 }, startAt: STIMULUS + 120, durationMs: 20 }),
      straightPath({
        from: { yawDeg: 12, pitchDeg: 0 },
        to: TARGET,
        startAt: STIMULUS + 140,
        durationMs: 120,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });
    expect(undershootRate.derive(observation)).toBe(0);
  });
});

describe("flickError", () => {
  it("measures the error where the ballistic movement stopped", () => {
    // Lands at 23° and stops: 3° from the centre of a 2°-radius target.
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 23, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 150 }),
      holdPath({ at: { yawDeg: 23, pitchDeg: 0 }, startAt: STIMULUS + 150, durationMs: 100 }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });

    expect(flickError.derive(observation)).toBeCloseTo(3, 1);
    // Normalised by radius: 1.5 target-radii out. Above 1 means the ballistic movement alone
    // would not have hit.
    expect(flickErrorNorm.derive(observation)).toBeCloseTo(1.5, 1);
  });

  it("uses the press when the player fired before the movement settled", () => {
    const trace = straightPath({
      to: { yawDeg: 30, pitchDeg: 0 },
      startAt: STIMULUS,
      durationMs: 300,
    });

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      // Fired at 200 ms, when the crosshair was at 20° — right on the centre.
      presses: [STIMULUS + 200],
      stimulusAt: STIMULUS,
    });

    expect(flickError.derive(observation)).toBeCloseTo(0, 1);
  });

  it("carries the same value under the micro key, which weights it differently", () => {
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 2.4, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 90 }),
      holdPath({ at: { yawDeg: 2.4, pitchDeg: 0 }, startAt: STIMULUS + 90, durationMs: 60 }),
    );

    const { observation } = buildObservation({
      target: { yawDeg: 2, pitchDeg: 0 },
      radiusDeg: 0.5,
      path: trace,
      stimulusAt: STIMULUS,
    });

    expect(microAdjustmentError.derive(observation)).toBe(flickErrorNorm.derive(observation));
  });
});

describe("correctionCount", () => {
  it("counts genuine reversals after the ballistic phase", () => {
    // Flick out and stop — the pause is what makes the end of the ballistic phase
    // unambiguous — then correct back, pause, and correct forward again.
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 23, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 120 }),
      holdPath({ at: { yawDeg: 23, pitchDeg: 0 }, startAt: STIMULUS + 120, durationMs: 60 }),
      straightPath({
        from: { yawDeg: 23, pitchDeg: 0 },
        to: { yawDeg: 17, pitchDeg: 0 },
        startAt: STIMULUS + 180,
        durationMs: 60,
      }),
      holdPath({ at: { yawDeg: 17, pitchDeg: 0 }, startAt: STIMULUS + 240, durationMs: 60 }),
      straightPath({
        from: { yawDeg: 17, pitchDeg: 0 },
        to: { yawDeg: 20, pitchDeg: 0 },
        startAt: STIMULUS + 300,
        durationMs: 60,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });

    // The backward leg establishes a direction; the forward leg reverses it. One correction.
    expect(correctionCount.derive(observation)).toBe(1);
  });

  it("counts nothing for sensor noise, which is what the hysteresis is for", () => {
    // Without hysteresis and a refractory period, this trace would report dozens of phantom
    // corrections and the metric would be worthless on real hardware.
    const trace = joinPaths(
      straightPath({ to: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 150 }),
      holdPath({
        at: { yawDeg: 20, pitchDeg: 0 },
        startAt: STIMULUS + 150,
        durationMs: 200,
        jitterDeg: 0.004,
      }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      stimulusAt: STIMULUS,
    });

    expect(correctionCount.derive(observation)).toBe(0);
  });
});

describe("settleTime and jitterRMS", () => {
  it("measures the cost of stabilising once on target", () => {
    const trace = joinPaths(
      straightPath({ to: TARGET, startAt: STIMULUS, durationMs: 150 }),
      holdPath({ at: TARGET, startAt: STIMULUS + 150, durationMs: 120 }),
    );

    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: trace,
      presses: [STIMULUS + 240],
      stimulusAt: STIMULUS,
    });

    // Entry happens at 135 ms (the near edge at 18° on a 20°-in-150 ms approach); the shot is
    // at 240 ms.
    const settle = settleTime.derive(observation) as number;
    expect(settle).toBeGreaterThan(100);
    expect(settle).toBeLessThan(112);
  });

  it("separates a shaky hover from a smooth one", () => {
    const build = (jitterDeg: number) =>
      buildObservation({
        target: TARGET,
        radiusDeg: 2,
        path: joinPaths(
          straightPath({ to: TARGET, startAt: STIMULUS, durationMs: 100 }),
          holdPath({ at: TARGET, startAt: STIMULUS + 100, durationMs: 200, jitterDeg }),
        ),
        presses: [STIMULUS + 300],
        stimulusAt: STIMULUS,
      }).observation;

    // The settling window opens at first *entry*, which doc 10 §10.3 defines and which is a few
    // milliseconds before the approach finishes. So even a perfectly steady hover carries the
    // tail of the approach through the filter, and for a fast approach that transient is the
    // larger term. The claim worth asserting is therefore not a ratio but **monotonicity**: more
    // tremor always reads as more jitter.
    const levels = [0, 0.05, 0.15, 0.4].map((jitter) => jitterRMS.derive(build(jitter)) as number);

    for (const value of levels) expect(Number.isFinite(value)).toBe(true);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] as number).toBeGreaterThan(levels[i - 1] as number);
    }
  });

  it("declines when the crosshair never reached the target", () => {
    const { observation } = buildObservation({
      target: TARGET,
      radiusDeg: 2,
      path: straightPath({ to: { yawDeg: 8, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 100 }),
      presses: [STIMULUS + 90],
      stimulusAt: STIMULUS,
    });

    expect(settleTime.derive(observation)).toBeNull();
    expect(jitterRMS.derive(observation)).toBeNull();
  });
});
