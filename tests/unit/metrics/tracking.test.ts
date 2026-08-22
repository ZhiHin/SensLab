import { describe, expect, it } from "vitest";
import type { MotionPattern } from "@/test-engine/contracts";
import { evaluateMotion } from "@/test-engine/targets/motion";
import {
  correctionFrequency,
  trackingAccuracy,
  trackingBias,
  trackingError,
  trackingStability,
} from "@/test-engine/metrics/tracking";
import { buildObservation, type TracePoint } from "../../helpers/trial-fixture";

/**
 * The tracking family against known traces (doc 10 §10.4).
 *
 * Tracking metrics are the easiest in the product to get subtly wrong, because a plausible
 * implementation of any of them produces plausible numbers. So each case here has a synthetic
 * player whose behaviour is known exactly: a perfect follower, a follower with a fixed lag, a
 * hand that shakes, a player who let go halfway.
 */

const STIMULUS = 1000;
const DURATION_MS = 1000;
const ORIGIN = { yawDeg: 8, pitchDeg: 0 };

const SWEEP: MotionPattern = {
  kind: "sinusoid",
  axis: "yaw",
  amplitudeDeg: 10,
  periodMs: 800,
  phase: 0,
};

/**
 * A synthetic player following the target, optionally offset along the motion axis.
 *
 * `offsetDeg` is applied to yaw: positive is ahead of the target's position, which for a
 * rightward-moving target is leading it.
 *
 * `jitterDeg` oscillates the crosshair between the offset position and `jitter` beyond it —
 * **one-sided, not symmetric**. That is deliberate. `trackingStability` high-passes ε̂(t), and
 * ε is an unsigned distance, so a crosshair swinging symmetrically through the exact target
 * centre produces a *constant* error magnitude and no high-frequency content at all. Real
 * instability moves the distance from the centre around, which is what this models.
 */
function followPath(options: {
  readonly motion: MotionPattern;
  readonly offsetDeg?: number;
  readonly jitterDeg?: number;
  readonly stepMs?: number;
  readonly durationMs?: number;
}): TracePoint[] {
  const step = options.stepMs ?? 2;
  const duration = options.durationMs ?? DURATION_MS;
  const offset = options.offsetDeg ?? 0;
  const jitter = options.jitterDeg ?? 0;
  const points: TracePoint[] = [];

  for (let elapsed = 0, i = 0; elapsed <= duration; elapsed += step, i += 1) {
    const { position } = evaluateMotion(options.motion, ORIGIN, elapsed);
    points.push({
      t: STIMULUS + elapsed,
      yawDeg: position.yawDeg + offset + (i % 2 === 0 ? jitter : 0),
      pitchDeg: position.pitchDeg,
    });
  }

  return points;
}

function trackingFixture(options: {
  readonly offsetDeg?: number;
  readonly jitterDeg?: number;
  readonly releaseAt?: number;
  readonly radiusDeg?: number;
}) {
  return buildObservation({
    target: ORIGIN,
    radiusDeg: options.radiusDeg ?? 1.5,
    motion: SWEEP,
    path: followPath({
      motion: SWEEP,
      ...(options.offsetDeg === undefined ? {} : { offsetDeg: options.offsetDeg }),
      ...(options.jitterDeg === undefined ? {} : { jitterDeg: options.jitterDeg }),
    }),
    presses: [STIMULUS],
    releases: options.releaseAt === undefined ? [] : [options.releaseAt],
    stimulusAt: STIMULUS,
    resolvedAt: STIMULUS + DURATION_MS,
  }).observation;
}

describe("trackingAccuracy", () => {
  it("scores a perfect follower at 1.0", () => {
    expect(trackingAccuracy.derive(trackingFixture({}))).toBeCloseTo(1, 6);
  });

  it("scores a follower held just outside the target at 0", () => {
    // 2° off a 1.5° target: never on it, for the whole trial.
    expect(trackingAccuracy.derive(trackingFixture({ offsetDeg: 2 }))).toBeCloseTo(0, 6);
  });

  it("falls between the two for a follower sitting on the edge", () => {
    const partial = trackingAccuracy.derive(trackingFixture({ offsetDeg: 1.5, jitterDeg: 0.3 }));
    expect(partial as number).toBeGreaterThan(0);
    expect(partial as number).toBeLessThan(1);
  });

  it("measures only the held portion of the trial", () => {
    // Perfect for the first half, then the button is released and the crosshair is abandoned.
    // Time after the release is not the player failing at the task — they stopped performing it.
    const abandoned = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: [
        ...followPath({ motion: SWEEP, durationMs: 500 }),
        ...followPath({ motion: SWEEP, offsetDeg: 30, durationMs: DURATION_MS }).filter(
          (point) => point.t > STIMULUS + 500,
        ),
      ],
      presses: [STIMULUS],
      releases: [STIMULUS + 500],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + DURATION_MS,
    }).observation;

    expect(trackingAccuracy.derive(abandoned)).toBeCloseTo(1, 6);
  });

  it("declines when the button was never held", () => {
    const noHold = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: followPath({ motion: SWEEP }),
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + DURATION_MS,
    }).observation;

    expect(trackingAccuracy.derive(noHold)).toBeNull();
  });
});

describe("trackingError", () => {
  it("is zero for a perfect follower", () => {
    expect(trackingError.derive(trackingFixture({}))).toBeCloseTo(0, 6);
  });

  it("grows with the offset, normalised by target radius", () => {
    // A constant 1.5° offset on a 1.5° target is exactly one target radius of error.
    expect(trackingError.derive(trackingFixture({ offsetDeg: 1.5 }))).toBeCloseTo(1, 3);
    expect(trackingError.derive(trackingFixture({ offsetDeg: 3 }))).toBeCloseTo(2, 3);
  });

  it("keeps discriminating where accuracy has saturated", () => {
    // Both of these are fully on target, so accuracy cannot tell them apart. This is exactly
    // why both metrics are kept: they fail in different regimes.
    const tight = trackingFixture({ offsetDeg: 0.2 });
    const loose = trackingFixture({ offsetDeg: 1.0 });

    expect(trackingAccuracy.derive(tight)).toBeCloseTo(1, 6);
    expect(trackingAccuracy.derive(loose)).toBeCloseTo(1, 6);
    expect(trackingError.derive(loose) as number).toBeGreaterThan(
      trackingError.derive(tight) as number,
    );
  });
});

describe("trackingStability", () => {
  it("catches correction activity that accuracy and error both miss", () => {
    // A shaky hand that stays on target: time-on-target is unchanged and the mean error barely
    // moves, but the correction activity lives in the high-frequency band. This is the metric
    // that catches "too sensitive" in tracking, and nothing else does.
    const steady = trackingFixture({});
    const shaky = trackingFixture({ jitterDeg: 0.4 });

    expect(trackingAccuracy.derive(steady)).toBeCloseTo(1, 6);
    expect(trackingAccuracy.derive(shaky)).toBeCloseTo(1, 6);

    expect(trackingStability.derive(shaky) as number).toBeLessThan(
      trackingStability.derive(steady) as number,
    );
  });

  it("cannot see a swing that is perfectly symmetric about the target centre", () => {
    // A documented property of doc 10's definition rather than a defect: ε is an unsigned
    // distance, so a crosshair oscillating evenly through the exact centre holds a constant
    // error magnitude. Real hands do not do this, but the limitation is worth stating.
    const symmetric = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: (() => {
        const points: TracePoint[] = [];
        for (let elapsed = 0, i = 0; elapsed <= DURATION_MS; elapsed += 2, i += 1) {
          const { position } = evaluateMotion(SWEEP, ORIGIN, elapsed);
          points.push({
            t: STIMULUS + elapsed,
            yawDeg: position.yawDeg + (i % 2 === 0 ? 0.4 : -0.4),
            pitchDeg: position.pitchDeg,
          });
        }
        return points;
      })(),
      presses: [STIMULUS],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + DURATION_MS,
    }).observation;

    expect(trackingStability.derive(symmetric)).toBeCloseTo(1, 6);
  });

  it("is bounded in (0, 1], with 1 meaning no correction activity at all", () => {
    const steady = trackingStability.derive(trackingFixture({})) as number;
    expect(steady).toBeGreaterThan(0);
    expect(steady).toBeLessThanOrEqual(1);
    expect(steady).toBeCloseTo(1, 6);

    const shaky = trackingStability.derive(trackingFixture({ jitterDeg: 0.6 })) as number;
    expect(shaky).toBeGreaterThan(0);
    expect(shaky).toBeLessThan(1);
  });

  it("decreases monotonically as the hand gets shakier", () => {
    const values = [0, 0.1, 0.3, 0.6].map(
      (jitterDeg) => trackingStability.derive(trackingFixture({ jitterDeg })) as number,
    );
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i] as number).toBeLessThan(values[i - 1] as number);
    }
  });
});

describe("trackingBias", () => {
  it("reports a lead as positive and a lag as negative", () => {
    // Bias is signed along the target's own direction of travel, so the sign is a description
    // of style rather than a penalty: leading slightly is a legitimate way to track.
    const leading = trackingBias.derive(trackingFixture({ offsetDeg: 0.75 })) as number;
    const lagging = trackingBias.derive(trackingFixture({ offsetDeg: -0.75 })) as number;

    expect(leading).toBeGreaterThan(0);
    expect(lagging).toBeLessThan(0);
    expect(leading).toBeCloseTo(-lagging, 6);
  });

  it("is near zero for a follower centred on the target", () => {
    expect(trackingBias.derive(trackingFixture({}))).toBeCloseTo(0, 6);
  });
});

describe("what tracking metrics decline to answer", () => {
  const noTarget = () =>
    buildObservation({
      path: [
        { t: STIMULUS, yawDeg: 0, pitchDeg: 0 },
        { t: STIMULUS + 10, yawDeg: 1, pitchDeg: 0 },
      ],
      presses: [STIMULUS],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 10,
    }).observation;

  it("declines every metric when there was no target to track", () => {
    // A trial with nothing to follow has no tracking performance. Returning zero would enter
    // the aggregate as a perfect score for a trial that never happened.
    for (const derivation of [
      trackingAccuracy,
      trackingError,
      trackingStability,
      correctionFrequency,
      trackingBias,
    ]) {
      expect(derivation.derive(noTarget()), derivation.key).toBeNull();
    }
  });

  it("declines when the button was never held", () => {
    const released = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: followPath({ motion: SWEEP }),
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + DURATION_MS,
    }).observation;

    for (const derivation of [trackingError, trackingStability, trackingBias]) {
      expect(derivation.derive(released), derivation.key).toBeNull();
    }
  });

  it("declines stability on a held window too short to filter", () => {
    const brief = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: followPath({ motion: SWEEP, durationMs: 0, stepMs: 2 }),
      presses: [STIMULUS],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 2,
    }).observation;

    expect(trackingStability.derive(brief)).toBeNull();
  });

  it("declines bias when the target never moved, because there is no 'ahead'", () => {
    const still = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: { kind: "static" },
      path: Array.from({ length: 50 }, (_, i) => ({
        t: STIMULUS + i * 2,
        yawDeg: ORIGIN.yawDeg + 0.5,
        pitchDeg: ORIGIN.pitchDeg,
      })),
      presses: [STIMULUS],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 100,
    }).observation;

    // A stationary target has no direction of travel, so a signed lead/lag is undefined.
    // Reporting 0 would claim the player was perfectly centred when they were half a degree off.
    expect(trackingBias.derive(still)).toBeNull();
    // Accuracy and error are still perfectly well defined.
    expect(trackingAccuracy.derive(still)).toBeCloseTo(1, 6);
  });

  it("measures a held window that runs to the end of the trial", () => {
    // A press with no matching release is held until the trial ends — the trial ending is what
    // released it, and discarding that segment would throw away the tail of every completed
    // tracking trial.
    const heldToEnd = trackingFixture({});
    const releasedEarly = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: followPath({ motion: SWEEP }),
      presses: [STIMULUS],
      releases: [STIMULUS + 200],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + DURATION_MS,
    }).observation;

    expect(trackingAccuracy.derive(heldToEnd)).toBeCloseTo(1, 6);
    expect(trackingAccuracy.derive(releasedEarly)).toBeCloseTo(1, 6);
  });
});

describe("correctionFrequency", () => {
  it("rises with correction activity", () => {
    const smooth = correctionFrequency.derive(trackingFixture({})) as number;
    const busy = correctionFrequency.derive(trackingFixture({ jitterDeg: 0.4 })) as number;

    expect(smooth).toBeGreaterThanOrEqual(0);
    expect(busy).toBeGreaterThan(smooth);
  });

  it("declines on a trial too short to have a frequency", () => {
    const brief = buildObservation({
      target: ORIGIN,
      radiusDeg: 1.5,
      motion: SWEEP,
      path: followPath({ motion: SWEEP, durationMs: 2, stepMs: 2 }),
      presses: [STIMULUS],
      stimulusAt: STIMULUS,
      resolvedAt: STIMULUS + 2,
    }).observation;

    expect(correctionFrequency.derive(brief)).toBeNull();
  });
});
