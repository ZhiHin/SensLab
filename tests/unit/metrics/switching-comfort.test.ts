import { describe, expect, it } from "vitest";
import {
  COMFORT_HALF_TURN,
  COMFORT_RETURN,
  COMFORT_SWIPE,
  liftCount180,
  maxSingleSwipeDeg,
  returnErrorDeg,
  time180,
} from "@/test-engine/metrics/comfort";
import { switchingTime, switchingTravelTime } from "@/test-engine/metrics/switching";
import { buildObservation, holdPath, joinPaths, straightPath } from "../../helpers/trial-fixture";

/**
 * The switching and comfort families (doc 10 §10.5).
 *
 * These two share a file because they share a shape: both produce several measurements inside
 * one trial, and both reduce them to a single trial-level value in a way that has to be
 * deliberate rather than incidental.
 */

const STIMULUS = 1000;

describe("switching", () => {
  /**
   * A sequence of three kills at known times, with the crosshair walking between them.
   *
   * Kill 1 at 20°, kill 2 at 40°, kill 3 at 60°, each reached by a straight sweep.
   */
  function sequence() {
    const path = joinPaths(
      straightPath({ to: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 200 }),
      holdPath({ at: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS + 200, durationMs: 50 }),
      straightPath({
        from: { yawDeg: 20, pitchDeg: 0 },
        to: { yawDeg: 40, pitchDeg: 0 },
        startAt: STIMULUS + 250,
        durationMs: 300,
      }),
      holdPath({ at: { yawDeg: 40, pitchDeg: 0 }, startAt: STIMULUS + 550, durationMs: 50 }),
      straightPath({
        from: { yawDeg: 40, pitchDeg: 0 },
        to: { yawDeg: 60, pitchDeg: 0 },
        startAt: STIMULUS + 600,
        durationMs: 200,
      }),
    );

    return buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      killAt: STIMULUS + 220,
      extraTargets: [
        {
          yawDeg: 40,
          pitchDeg: 0,
          radiusDeg: 2,
          spawnedAt: STIMULUS + 220,
          killAt: STIMULUS + 570,
        },
        {
          yawDeg: 60,
          pitchDeg: 0,
          radiusDeg: 2,
          spawnedAt: STIMULUS + 570,
          killAt: STIMULUS + 810,
        },
      ],
      path,
      presses: [STIMULUS + 220, STIMULUS + 570, STIMULUS + 810],
      shots: 3,
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 820,
    }).observation;
  }

  it("takes the median of the within-sequence intervals, not their sum", () => {
    // Three kills give two intervals: 350 ms and 240 ms. Their median is 295.
    expect(switchingTime.derive(sequence())).toBeCloseTo(295, 6);
  });

  it("measures travel separately from settling and trigger discipline", () => {
    // Travel stops when the crosshair first touches the next target, so it is always shorter
    // than the full switch — that difference is the settle-and-commit cost.
    const travel = switchingTravelTime.derive(sequence()) as number;
    const full = switchingTime.derive(sequence()) as number;

    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThan(full);
  });

  it("declines on a sequence with only one kill, which has no interval", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      killAt: STIMULUS + 220,
      path: straightPath({
        to: { yawDeg: 20, pitchDeg: 0 },
        startAt: STIMULUS,
        durationMs: 220,
      }),
      presses: [STIMULUS + 220],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 230,
    });

    expect(switchingTime.derive(observation)).toBeNull();
    expect(switchingTravelTime.derive(observation)).toBeNull();
  });

  it("never counts an entry from before the target existed", () => {
    // A respawn appears where the crosshair already is. The crosshair cannot have travelled to
    // a target that had not yet spawned, and counting that as instant travel would report a
    // switching time of zero for a switch that never happened.
    const { observation } = buildObservation({
      target: { yawDeg: 20, pitchDeg: 0 },
      radiusDeg: 2,
      killAt: STIMULUS + 200,
      extraTargets: [
        // Spawns exactly where the crosshair is sitting, well after the crosshair got there.
        {
          yawDeg: 20,
          pitchDeg: 0,
          radiusDeg: 2,
          spawnedAt: STIMULUS + 300,
          killAt: STIMULUS + 400,
        },
      ],
      path: joinPaths(
        straightPath({ to: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 200 }),
        holdPath({ at: { yawDeg: 20, pitchDeg: 0 }, startAt: STIMULUS + 200, durationMs: 200 }),
      ),
      presses: [STIMULUS + 200, STIMULUS + 400],
      shots: 2,
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 410,
    });

    // Travel is measured from the previous kill to the first entry *after the spawn*, so it is
    // 100 ms, not 0.
    expect(switchingTravelTime.derive(observation)).toBeCloseTo(100, 0);
  });
});

describe("comfort", () => {
  const swipePath = joinPaths(
    straightPath({ to: { yawDeg: 180, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 600 }),
    holdPath({ at: { yawDeg: 180, pitchDeg: 0 }, startAt: STIMULUS + 600, durationMs: 300 }),
  );

  it("measures the furthest turn reached in one motion", () => {
    const { observation } = buildObservation({
      variant: COMFORT_SWIPE,
      path: swipePath,
      presses: [STIMULUS + 850],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 900,
    });

    expect(maxSingleSwipeDeg.derive(observation)).toBeCloseTo(180, 0);
  });

  it("stops measuring at the lift, because what follows is a second motion", () => {
    // Sweep to 120°, pick the mouse up and re-place it, then sweep on to 200°. The reach the
    // player actually has in one motion is 120°, and reporting 200° would recommend a
    // sensitivity they cannot execute.
    const lifted = joinPaths(
      straightPath({ to: { yawDeg: 120, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 400 }),
      holdPath({ at: { yawDeg: 120, pitchDeg: 0 }, startAt: STIMULUS + 400, durationMs: 300 }),
      straightPath({
        from: { yawDeg: 120, pitchDeg: 0 },
        to: { yawDeg: 200, pitchDeg: 0 },
        startAt: STIMULUS + 700,
        durationMs: 300,
      }),
    );

    const { observation } = buildObservation({
      variant: COMFORT_SWIPE,
      path: lifted,
      presses: [STIMULUS + 1050],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 1100,
    });

    expect(maxSingleSwipeDeg.derive(observation)).toBeCloseTo(120, 0);
  });

  it("counts the lifts a half-turn needed, and how long it took", () => {
    const halfTurn = joinPaths(
      straightPath({ to: { yawDeg: 90, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 300 }),
      holdPath({ at: { yawDeg: 90, pitchDeg: 0 }, startAt: STIMULUS + 300, durationMs: 200 }),
      straightPath({
        from: { yawDeg: 90, pitchDeg: 0 },
        to: { yawDeg: 180, pitchDeg: 0 },
        startAt: STIMULUS + 500,
        durationMs: 300,
      }),
    );

    const { observation } = buildObservation({
      variant: COMFORT_HALF_TURN,
      path: halfTurn,
      presses: [STIMULUS + 840],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 900,
    });

    expect(liftCount180.derive(observation)).toBe(1);
    expect(time180.derive(observation)).toBeCloseTo(840, 6);
  });

  it("measures the return error at the confirming click, not at the trial's end", () => {
    // The player declares when they believe they are back on the marked heading; that
    // declaration is the measurement, and drifting afterwards must not change it.
    const returning = joinPaths(
      straightPath({ to: { yawDeg: 180, pitchDeg: 0 }, startAt: STIMULUS, durationMs: 300 }),
      straightPath({
        from: { yawDeg: 180, pitchDeg: 0 },
        to: { yawDeg: 6, pitchDeg: 0 },
        startAt: STIMULUS + 300,
        durationMs: 300,
      }),
      // Drift after the click.
      straightPath({
        from: { yawDeg: 6, pitchDeg: 0 },
        to: { yawDeg: 40, pitchDeg: 0 },
        startAt: STIMULUS + 620,
        durationMs: 200,
      }),
    );

    const { observation } = buildObservation({
      variant: COMFORT_RETURN,
      path: returning,
      presses: [STIMULUS + 610],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 830,
    });

    expect(returnErrorDeg.derive(observation)).toBeCloseTo(6, 0);
  });

  it("wraps the return error, so going the long way round is not reported as 350° out", () => {
    const wrapped = straightPath({
      to: { yawDeg: 355, pitchDeg: 0 },
      startAt: STIMULUS,
      durationMs: 600,
    });

    const { observation } = buildObservation({
      variant: COMFORT_RETURN,
      path: wrapped,
      presses: [STIMULUS + 600],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 650,
    });

    expect(returnErrorDeg.derive(observation)).toBeCloseTo(5, 0);
  });

  it("declines on a sub-task it does not measure", () => {
    // Each comfort metric belongs to exactly one sub-task. Averaging a swipe distance against
    // a return error would produce a number describing neither.
    const { observation } = buildObservation({
      variant: COMFORT_RETURN,
      path: swipePath,
      presses: [STIMULUS + 850],
      stimulusAt: STIMULUS,
    });

    expect(maxSingleSwipeDeg.derive(observation)).toBeNull();
    expect(liftCount180.derive(observation)).toBeNull();
    expect(time180.derive(observation)).toBeNull();
    expect(returnErrorDeg.derive(observation)).not.toBeNull();
  });
});
