import { describe, expect, it } from "vitest";
import { crossCorrelationLag, resampleUniform } from "@/core/signal";
import { SESSION_MODES } from "@/core/types/vocabulary";
import { LIFT_PAUSE_MS, liftDetected } from "@/test-engine/metrics/lift";
import {
  recoilCompensationGain,
  recoilDeviationHorizontal,
  recoilRecoveryTime,
  stabilityUnderRecoil,
} from "@/test-engine/metrics/recoil";
import { evaluateDisturbance, generateRecoil } from "@/test-engine/targets/disturbance";
import { ADVANCED_TESTS } from "@/test-engine/tests";
import { deriveRng } from "@/core/random";
import { buildObservation, type TracePoint } from "@tests/helpers/trial-fixture";

/**
 * Edge behaviour of the Phase 6 derivations and helpers: the branches a competent synthetic
 * player never exercises, and which are exactly where a real trace will land.
 */

describe("liftDetected — the slow-sample signature", () => {
  /** A flick that crawls (below the stop speed) for `pauseMs` at 40% of the distance. */
  const crawlingFlick = (pauseMs: number, resumeTowards = true): TracePoint[] => {
    const path: TracePoint[] = [];
    let t = 1000;
    for (let yaw = 0; yaw <= 36; yaw += 4) {
      path.push({ t, yawDeg: yaw, pitchDeg: 0 });
      t += 4;
    }
    // Crawl: 0.01° every 4 ms is 2.5°/s, far below the 20°/s stop threshold.
    let yaw = 36;
    for (let elapsed = 0; elapsed < pauseMs; elapsed += 4) {
      yaw += 0.01;
      path.push({ t, yawDeg: yaw, pitchDeg: 0 });
      t += 4;
    }
    const direction = resumeTowards ? 1 : -1;
    for (let step = 4; step <= 54; step += 4) {
      path.push({ t, yawDeg: yaw + direction * step, pitchDeg: 0 });
      t += 4;
    }
    return path;
  };

  it("detects a lift expressed as a run of near-stationary samples", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path: crawlingFlick(LIFT_PAUSE_MS * 2),
    });
    expect(liftDetected.derive(observation)).toBe(1);
  });

  it("does not count a crawl shorter than the pause threshold", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path: crawlingFlick(LIFT_PAUSE_MS / 4),
    });
    expect(liftDetected.derive(observation)).toBe(0);
  });

  it("does not count a pause followed by movement *away* from the target", () => {
    // That is a correction or an abandonment, not a re-grip on the way there.
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path: crawlingFlick(LIFT_PAUSE_MS * 2, false),
    });
    expect(liftDetected.derive(observation)).toBe(0);
  });

  it("stops looking once the crosshair has entered the target", () => {
    const path: TracePoint[] = [];
    for (let yaw = 0; yaw <= 90; yaw += 3) path.push({ t: 1000 + yaw, yawDeg: yaw, pitchDeg: 0 });
    // A long gap *after* arrival is settling, not a lift.
    path.push({ t: 1500, yawDeg: 90, pitchDeg: 0 });
    path.push({ t: 1504, yawDeg: 90.5, pitchDeg: 0 });
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      radiusDeg: 3,
      path,
    });
    expect(liftDetected.derive(observation)).toBe(0);
  });

  it("is null on a one-sample trace", () => {
    const { observation } = buildObservation({
      target: { yawDeg: 90, pitchDeg: 0 },
      path: [{ t: 1000, yawDeg: 0, pitchDeg: 0 }],
    });
    expect(liftDetected.derive(observation)).toBeNull();
  });
});

describe("the recoil family — held time across releases", () => {
  const pattern = generateRecoil(deriveRng("edges", "recoil"), {
    family: "gradual-vertical",
    burstMs: 600,
    shotIntervalMs: 100,
  });

  it("freezes the disturbance while the button is up and resumes on the next press", () => {
    // Held 1100–1300, released, held again 1500–1900: 600 ms of held time in total, so the
    // burst completes exactly at 1900. A perfect compensator is on target throughout.
    const path: TracePoint[] = [{ t: 1000, yawDeg: 0, pitchDeg: 0 }];
    const heldAt = (t: number): number => {
      if (t < 1100) return 0;
      if (t <= 1300) return t - 1100;
      if (t < 1500) return 200;
      return Math.min(600, 200 + (t - 1500));
    };
    for (let t = 1100; t <= 2100; t += 10) {
      path.push({ t, yawDeg: 0, pitchDeg: 0 });
      void evaluateDisturbance(pattern, heldAt(t));
    }
    const { observation } = buildObservation({
      target: { yawDeg: 0, pitchDeg: 0 },
      radiusDeg: 2,
      path,
      presses: [1100, 1500],
      releases: [1300],
      resolvedAt: 2100,
      disturbance: pattern,
    });
    // On target for the whole trial: zero deviation, immediate recovery, a stability of 1.
    expect(recoilDeviationHorizontal.derive(observation)).toBeCloseTo(0, 9);
    expect(recoilRecoveryTime.derive(observation)).toBeLessThan(20);
    expect(stabilityUnderRecoil.derive(observation)).toBeCloseTo(1, 6);
    // A perfectly compensating crosshair has no counter-movement to regress on; the gain is
    // defined by the *applied* offset and the recorded crosshair, and here reads 1.
    expect(recoilCompensationGain.derive(observation)).toBeCloseTo(1, 1);
  });

  it("reports no recovery time when the trial ends before the burst does", () => {
    const path: TracePoint[] = [];
    for (let t = 1000; t <= 1400; t += 10) path.push({ t, yawDeg: 0, pitchDeg: 0 });
    const { observation } = buildObservation({
      target: { yawDeg: 0, pitchDeg: 0 },
      path,
      presses: [1100],
      resolvedAt: 1400,
      disturbance: pattern,
    });
    expect(recoilRecoveryTime.derive(observation)).toBeNull();
    expect(recoilDeviationHorizontal.derive(observation)).not.toBeNull();
  });

  it("is null when the button was never pressed", () => {
    const path: TracePoint[] = [];
    for (let t = 1000; t <= 2000; t += 10) path.push({ t, yawDeg: 0, pitchDeg: 0 });
    const { observation } = buildObservation({
      target: { yawDeg: 0, pitchDeg: 0 },
      path,
      resolvedAt: 2000,
      disturbance: pattern,
    });
    expect(recoilCompensationGain.derive(observation)).toBeNull();
    expect(stabilityUnderRecoil.derive(observation)).toBeNull();
  });
});

describe("resampling and lag estimation", () => {
  it("interpolates onto a uniform grid and holds the ends", () => {
    const out = resampleUniform([0, 10, 20], [0, 10, 0], -5, 25, 5);
    expect([...out]).toEqual([0, 0, 5, 10, 5, 0, 0]);
    expect([...resampleUniform([], [], 0, 10, 5)]).toEqual([0, 0, 0]);
    expect(() => resampleUniform([0], [0], 0, 10, 0)).toThrow(RangeError);
  });

  it("finds a known delay and reports leading signals as zero lag", () => {
    const n = 200;
    const reference = new Float64Array(n);
    const delayed = new Float64Array(n);
    const leading = new Float64Array(n);
    // A single pulse rather than a sinusoid: a periodic signal that leads by 7 also trails by
    // a period minus 7, and the estimator would be right to say so.
    const pulse = (i: number): number => Math.exp(-((i - 80) ** 2) / 200);
    for (let i = 0; i < n; i += 1) {
      reference[i] = pulse(i);
      delayed[i] = pulse(i - 7);
      leading[i] = pulse(i + 7);
    }
    expect(crossCorrelationLag(reference, delayed, 50)).toBe(7);
    expect(crossCorrelationLag(reference, leading, 50)).toBe(0);
  });

  it("returns null for a flat or too-short signal", () => {
    expect(crossCorrelationLag([1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6], 2)).toBeNull();
    expect(crossCorrelationLag([1, 2], [1, 2], 1)).toBeNull();
  });
});

describe("the advanced definitions across every session mode", () => {
  it("declare positive, non-decreasing budgets in every mode", () => {
    for (const definition of ADVANCED_TESTS) {
      for (const mode of SESSION_MODES) {
        expect(definition.trialCount(mode), `${definition.key}/${mode}`).toBeGreaterThan(0);
        expect(definition.minValidTrials(mode)).toBeLessThanOrEqual(definition.trialCount(mode));
        expect(definition.practiceTrialCount(mode)).toBeGreaterThanOrEqual(0);
      }
      expect(definition.trialCount("advanced")).toBeGreaterThanOrEqual(
        definition.trialCount("standard"),
      );
      expect(definition.trialCount("standard")).toBeGreaterThanOrEqual(
        definition.trialCount("quick"),
      );
    }
  });
});
