import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import { adsFirstShotAccuracy, adsTransitionTime } from "@/test-engine/metrics/ads";
import { LIFT_PAUSE_MS, liftDetected } from "@/test-engine/metrics/lift";
import {
  pathTruncated,
  peakSpeedTrackingError,
  reversalRecoveryTime,
} from "@/test-engine/metrics/motion-tracking";
import {
  recoilCompensationGain,
  recoilDeviationVertical,
  recoilRecoveryTime,
} from "@/test-engine/metrics/recoil";
import { evaluateDisturbance, generateRecoil } from "@/test-engine/targets/disturbance";
import { slideProfile, strafeProfile } from "@/test-engine/targets/profiles";
import { evaluateSegments } from "@/test-engine/targets/motion";
import type { MotionPattern } from "@/test-engine/contracts";
import { buildObservation, type TracePoint } from "@tests/helpers/trial-fixture";

/**
 * The Phase 6 derivations against hand-built traces, where the expected value is known to
 * the millisecond. The battery tests prove the pipeline connects; these prove each metric
 * computes what doc 09/10 say it computes.
 */

/* ------------------------------------------------------------------ lift */

describe("liftDetected", () => {
  /** A 90° flick that pauses for `gapMs` at 40% of the distance. */
  const flickWithGap = (gapMs: number): TracePoint[] => {
    const path: TracePoint[] = [];
    let t = 1000;
    for (let yaw = 0; yaw <= 36; yaw += 4) {
      path.push({ t, yawDeg: yaw, pitchDeg: 0 });
      t += 4;
    }
    t += gapMs;
    for (let yaw = 40; yaw <= 90; yaw += 4) {
      path.push({ t, yawDeg: yaw, pitchDeg: 0 });
      t += 4;
    }
    return path;
  };

  it("sees a lift as a gap in the sample stream mid-flight", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path: flickWithGap(150),
    });
    expect(liftDetected.derive(observation)).toBe(1);
  });

  it("ignores a gap shorter than the pause threshold", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path: flickWithGap(LIFT_PAUSE_MS / 2),
    });
    expect(liftDetected.derive(observation)).toBe(0);
  });

  it("ignores a pause at the very start, which is reaction rather than a lift", () => {
    const path: TracePoint[] = [
      { t: 1000, yawDeg: 0, pitchDeg: 0 },
      { t: 1400, yawDeg: 2, pitchDeg: 0 },
    ];
    for (let yaw = 6; yaw <= 90; yaw += 4) path.push({ t: 1400 + yaw, yawDeg: yaw, pitchDeg: 0 });
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path,
    });
    expect(liftDetected.derive(observation)).toBe(0);
  });

  it("reports nothing without a target", () => {
    const { observation } = buildObservation({ path: flickWithGap(150) });
    expect(liftDetected.derive(observation)).toBeNull();
  });
});

/* ------------------------------------------------------------------ strafe */

describe("reversalRecoveryTime", () => {
  const rng = deriveRng("metrics", "strafe");
  const segments = strafeProfile(rng, {
    durationMs: 3000,
    speedDegPerSec: 60,
    meanReversalIntervalMs: 500,
    reversalAccelerationDegPerSec2: 700,
    maxExcursionDeg: 20,
  });
  const motion: MotionPattern = { kind: "segments", axis: "yaw", segments };

  /** A tracker that is exactly on target except for `lagMs` after each reversal. */
  const tracker = (lagMs: number): TracePoint[] => {
    const reversals = segments
      .filter((s) => s.label === "reverse")
      .map((s) => s.startMs + s.durationMs / 2);
    const path: TracePoint[] = [];
    for (let elapsed = 0; elapsed <= 3000; elapsed += 5) {
      const lagging = reversals.some((r) => elapsed >= r && elapsed < r + lagMs);
      const at = evaluateSegments(segments, lagging ? elapsed - lagMs - 50 : elapsed).offset;
      path.push({ t: 1000 + elapsed, yawDeg: 5 + at, pitchDeg: 0 });
    }
    return path;
  };

  it("measures the time to re-enter the target after each reversal", () => {
    const prompt = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      radiusDeg: 2,
      motion,
      path: tracker(0),
      presses: [1000],
      resolvedAt: 4000,
    });
    const slow = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      radiusDeg: 2,
      motion,
      path: tracker(200),
      presses: [1000],
      resolvedAt: 4000,
    });
    const promptValue = reversalRecoveryTime.derive(prompt.observation) as number;
    const slowValue = reversalRecoveryTime.derive(slow.observation) as number;
    expect(promptValue).toBeLessThan(20);
    expect(slowValue).toBeGreaterThan(150);
  });

  it("is null for motion with no reversals", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 5, pitchDeg: 0 },
      motion: { kind: "static" },
      path: [
        { t: 1000, yawDeg: 5, pitchDeg: 0 },
        { t: 2000, yawDeg: 5, pitchDeg: 0 },
      ],
      presses: [1000],
      resolvedAt: 2000,
    });
    expect(reversalRecoveryTime.derive(observation)).toBeNull();
  });
});

/* ------------------------------------------------------------------ slide */

describe("peakSpeedTrackingError and pathTruncated", () => {
  const segments = slideProfile({
    spanDeg: 80,
    peakSpeedDegPerSec: 160,
    accelerateFraction: 0.3,
    decelerateFraction: 0.3,
    leadInMs: 200,
  });
  const motion: MotionPattern = { kind: "segments", axis: "yaw", segments };
  const sustain = segments.find((s) => s.label === "sustain");
  if (sustain === undefined) throw new Error("fixture needs a sustain segment");

  /** On target everywhere except during the sustain, where it trails by `errorDeg`. */
  const tracker = (errorDeg: number): TracePoint[] => {
    const path: TracePoint[] = [];
    for (let elapsed = 0; elapsed <= 1500; elapsed += 5) {
      const inSustain =
        elapsed >= sustain.startMs && elapsed <= sustain.startMs + sustain.durationMs;
      const at = evaluateSegments(segments, elapsed).offset;
      path.push({ t: 1000 + elapsed, yawDeg: -20 + at - (inSustain ? errorDeg : 0), pitchDeg: 0 });
    }
    return path;
  };

  it("restricts the error to the sustained-peak segment", () => {
    const build = (errorDeg: number) =>
      buildObservation({
        target: { yawDeg: -20, pitchDeg: 0 },
        radiusDeg: 2,
        motion,
        path: tracker(errorDeg),
        presses: [1000],
        resolvedAt: 2500,
      }).observation;
    const clean = peakSpeedTrackingError.derive(build(0)) as number;
    const behind = peakSpeedTrackingError.derive(build(3)) as number;
    expect(clean).toBeCloseTo(0, 6);
    // 3° of error on a 2° radius is 1.5 normalised, held for the whole sustain.
    expect(behind).toBeCloseTo(1.5, 1);
  });

  it("marks the path truncated only against a known reach", () => {
    const build = (reach: number | null) =>
      buildObservation({
        target: { yawDeg: -20, pitchDeg: 0 },
        motion,
        path: tracker(0),
        presses: [1000],
        degreesPerCount: 0.04,
        maxSingleSwipeCounts: reach,
      }).observation;
    // 80° at 0.04°/count is 2000 counts.
    expect(pathTruncated.derive(build(1999))).toBe(1);
    expect(pathTruncated.derive(build(2001))).toBe(0);
    expect(pathTruncated.derive(build(null))).toBeNull();
  });
});

/* ------------------------------------------------------------------ recoil */

describe("the recoil family", () => {
  const pattern = generateRecoil(deriveRng("metrics", "recoil"), {
    family: "steep-vertical",
    burstMs: 1000,
    shotIntervalMs: 100,
  });

  /**
   * A player who presses at t = 1100 and pulls against a fraction `gain` of the recoil. The
   * recorded crosshair is the target plus the uncompensated remainder of the disturbance.
   */
  const compensator = (gain: number): TracePoint[] => {
    const path: TracePoint[] = [{ t: 1000, yawDeg: 0, pitchDeg: 0 }];
    for (let t = 1100; t <= 2600; t += 10) {
      const offset = evaluateDisturbance(pattern, t - 1100);
      path.push({
        t,
        yawDeg: offset.yawDeg * (1 - gain),
        pitchDeg: offset.pitchDeg * (1 - gain),
      });
    }
    return path;
  };

  const build = (gain: number) =>
    buildObservation({
      target: { yawDeg: 0, pitchDeg: 0 },
      radiusDeg: 2,
      path: compensator(gain),
      presses: [1100],
      resolvedAt: 2600,
      disturbance: pattern,
    }).observation;

  it("reads the compensation gain as the fraction pulled against", () => {
    expect(recoilCompensationGain.derive(build(1)) as number).toBeCloseTo(1, 1);
    expect(recoilCompensationGain.derive(build(0.5)) as number).toBeCloseTo(0.5, 1);
    expect(recoilCompensationGain.derive(build(0)) as number).toBeCloseTo(0, 1);
  });

  it("grows the vertical deviation as compensation falls", () => {
    const full = recoilDeviationVertical.derive(build(1)) as number;
    const half = recoilDeviationVertical.derive(build(0.5)) as number;
    const none = recoilDeviationVertical.derive(build(0)) as number;
    expect(full).toBeLessThan(half);
    expect(half).toBeLessThan(none);
    expect(full).toBeLessThan(0.1);
  });

  it("reports an immediate recovery for a player already on target when the burst ends", () => {
    expect(recoilRecoveryTime.derive(build(1)) as number).toBeLessThan(20);
  });

  it("reports the full window for a player who never recovers", () => {
    // Burst ends 1000 ms of held time after the press at 1100 — observed at the first sample
    // past it, 2110 on this 10 ms trace — and the trial ends at 2600.
    const value = recoilRecoveryTime.derive(build(0)) as number;
    expect(value).toBeGreaterThanOrEqual(480);
    expect(value).toBeLessThanOrEqual(500);
  });

  it("is null on an undisturbed trial", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 0, pitchDeg: 0 },
      path: compensator(1),
      presses: [1100],
    });
    expect(recoilCompensationGain.derive(observation)).toBeNull();
    expect(recoilDeviationVertical.derive(observation)).toBeNull();
  });
});

/* ------------------------------------------------------------------ ADS */

describe("the ADS tags", () => {
  const path: TracePoint[] = [
    { t: 1000, yawDeg: 0, pitchDeg: 0 },
    { t: 1180, yawDeg: 0.1, pitchDeg: 0 },
    { t: 1200, yawDeg: 3, pitchDeg: 0 },
    { t: 1220, yawDeg: 6, pitchDeg: 0 },
    { t: 1240, yawDeg: 8, pitchDeg: 0 },
  ];
  const view = { magnification: 2, positioningCountsPer360: 9000, measuredCountsPer360: 12000 };

  it("reports the transition as onset from the zoom on a scoped trial", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 8, pitchDeg: 0 },
      path,
      presses: [1240],
      firstShotHit: true,
      view,
    });
    // Onset is the first sustained movement above 15°/s: the 0.1° → 3° step at t = 1200.
    expect(adsTransitionTime.derive(observation)).toBe(200);
    expect(adsFirstShotAccuracy.derive(observation)).toBe(1);
  });

  it("is absent on a hipfire control", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 8, pitchDeg: 0 },
      path,
      presses: [1240],
      firstShotHit: true,
      view: null,
    });
    expect(adsTransitionTime.derive(observation)).toBeNull();
    expect(adsFirstShotAccuracy.derive(observation)).toBeNull();
  });
});
