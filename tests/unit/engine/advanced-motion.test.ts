import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import type { MotionSegment } from "@/test-engine/contracts";
import { evaluateMotion, evaluateSegments, segmentEnd } from "@/test-engine/targets/motion";
import {
  concatProfiles,
  segmentWindows,
  slideProfile,
  strafeProfile,
} from "@/test-engine/targets/profiles";
import {
  RECOIL_FAMILIES,
  evaluateDisturbance,
  generateRecoil,
} from "@/test-engine/targets/disturbance";
import { createCamera } from "@/test-engine/render/camera";

/**
 * The Phase 6 engine extensions, in isolation: piecewise motion, the profile generators, the
 * generated disturbance, and the camera's new view and disturbance controls.
 */

const ORIGIN = { yawDeg: 10, pitchDeg: -2 };

describe("piecewise constant-acceleration motion", () => {
  const segments: MotionSegment[] = [
    {
      startMs: 0,
      durationMs: 1000,
      startOffsetDeg: 0,
      startVelocityDegPerSec: 0,
      accelerationDegPerSec2: 100,
      label: "accelerate",
    },
    {
      startMs: 1000,
      durationMs: 500,
      startOffsetDeg: 50,
      startVelocityDegPerSec: 100,
      accelerationDegPerSec2: 0,
      label: "sustain",
    },
  ];

  it("evaluates each segment in closed form", () => {
    // ½·a·t² at t = 0.5 s with a = 100 is 12.5°.
    expect(evaluateSegments(segments, 500)).toEqual({ offset: 12.5, velocity: 50 });
    // Cruising at 100°/s from 50° for 0.25 s.
    expect(evaluateSegments(segments, 1250)).toEqual({ offset: 75, velocity: 100 });
  });

  it("holds the first position before the profile and the last after it", () => {
    expect(evaluateSegments(segments, -100)).toEqual({ offset: 0, velocity: 0 });
    expect(evaluateSegments(segments, 5000)).toEqual({ offset: 100, velocity: 0 });
    expect(evaluateSegments([], 10)).toEqual({ offset: 0, velocity: 0 });
  });

  it("is continuous across segment boundaries", () => {
    const before = evaluateSegments(segments, 999.999);
    const after = evaluateSegments(segments, 1000.001);
    expect(after.offset).toBeCloseTo(before.offset, 3);
    expect(after.velocity).toBeCloseTo(before.velocity, 3);
    expect(segmentEnd(segments[0] as MotionSegment)).toEqual({
      offsetDeg: 50,
      velocityDegPerSec: 100,
      endMs: 1000,
    });
  });

  it("applies to one axis and leaves the other at the origin", () => {
    const yaw = evaluateMotion({ kind: "segments", axis: "yaw", segments }, ORIGIN, 500);
    expect(yaw.position).toEqual({ yawDeg: 22.5, pitchDeg: -2 });
    expect(yaw.velocityDegPerSec).toEqual({ yaw: 50, pitch: 0 });

    const pitch = evaluateMotion({ kind: "segments", axis: "pitch", segments }, ORIGIN, 500);
    expect(pitch.position).toEqual({ yawDeg: 10, pitchDeg: 10.5 });
    expect(pitch.velocityDegPerSec).toEqual({ yaw: 0, pitch: 50 });
  });
});

describe("the strafe profile", () => {
  const options = {
    durationMs: 5000,
    speedDegPerSec: 80,
    meanReversalIntervalMs: 600,
    reversalAccelerationDegPerSec2: 700,
    maxExcursionDeg: 24,
  };

  it("covers the requested duration with contiguous segments", () => {
    const segments = strafeProfile(deriveRng("strafe", "profile"), options);
    expect(segments.length).toBeGreaterThan(3);
    for (let i = 1; i < segments.length; i += 1) {
      const previous = segmentEnd(segments[i - 1] as MotionSegment);
      const current = segments[i] as MotionSegment;
      expect(current.startMs).toBeCloseTo(previous.endMs, 9);
      expect(current.startOffsetDeg).toBeCloseTo(previous.offsetDeg, 9);
      expect(current.startVelocityDegPerSec).toBeCloseTo(previous.velocityDegPerSec, 9);
    }
    const last = segments[segments.length - 1] as MotionSegment;
    expect(last.startMs + last.durationMs).toBeGreaterThanOrEqual(options.durationMs);
  });

  it("never leaves the excursion bound and never exceeds the cruise speed", () => {
    const segments = strafeProfile(deriveRng("strafe", "bounds"), options);
    for (let t = 0; t <= options.durationMs; t += 5) {
      const { offset, velocity } = evaluateSegments(segments, t);
      expect(Math.abs(offset)).toBeLessThanOrEqual(options.maxExcursionDeg + 1e-6);
      expect(Math.abs(velocity)).toBeLessThanOrEqual(options.speedDegPerSec + 1e-6);
    }
  });

  it("reverses at intervals with no memory", () => {
    // The exponential's defining property: the intervals' mean and standard deviation agree.
    // A uniform or fixed schedule would have a far smaller spread relative to its mean.
    const intervals: number[] = [];
    for (let seed = 0; seed < 40; seed += 1) {
      const segments = strafeProfile(deriveRng("strafe-memory", "profile", seed), {
        ...options,
        maxExcursionDeg: 1e6,
        durationMs: 20_000,
      });
      for (const segment of segments)
        if (segment.label === "cruise") intervals.push(segment.durationMs);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
    expect(mean).toBeGreaterThan(options.meanReversalIntervalMs * 0.8);
    expect(mean).toBeLessThan(options.meanReversalIntervalMs * 1.25);
    expect(sd / mean).toBeGreaterThan(0.7);
  });

  it("is reproducible from its seed and differs across seeds", () => {
    const a = strafeProfile(deriveRng("s", "p", 1), options);
    const b = strafeProfile(deriveRng("s", "p", 1), options);
    const c = strafeProfile(deriveRng("s", "p", 2), options);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("rejects non-positive parameters", () => {
    expect(() => strafeProfile(deriveRng("s", "p"), { ...options, speedDegPerSec: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("the slide profile", () => {
  const options = {
    spanDeg: 80,
    peakSpeedDegPerSec: 160,
    accelerateFraction: 0.3,
    decelerateFraction: 0.25,
    leadInMs: 400,
  };

  it("reaches exactly the peak speed and exactly the span", () => {
    const segments = slideProfile(options);
    const labels = segments.map((segment) => segment.label);
    expect(labels).toEqual(["hold", "accelerate", "sustain", "decelerate"]);

    const sustain = segments[2] as MotionSegment;
    expect(sustain.startVelocityDegPerSec).toBeCloseTo(160, 9);
    const end = segmentEnd(segments[3] as MotionSegment);
    expect(end.offsetDeg).toBeCloseTo(80, 9);
    expect(end.velocityDegPerSec).toBeCloseTo(0, 9);
  });

  it("slides the other way for a negative span", () => {
    const end = segmentEnd(slideProfile({ ...options, spanDeg: -80 })[3] as MotionSegment);
    expect(end.offsetDeg).toBeCloseTo(-80, 9);
  });

  it("omits the sustain when the fractions fill the span", () => {
    const segments = slideProfile({ ...options, accelerateFraction: 0.5, decelerateFraction: 0.5 });
    expect(segments.map((segment) => segment.label)).toEqual(["hold", "accelerate", "decelerate"]);
  });

  it("rejects fractions that exceed the span", () => {
    expect(() =>
      slideProfile({ ...options, accelerateFraction: 0.6, decelerateFraction: 0.6 }),
    ).toThrow(/sum to at most 1/);
  });

  it("concatenates so the second slide starts where the first ended", () => {
    const out = slideProfile(options);
    const back = slideProfile({ ...options, spanDeg: -80 });
    const joined = concatProfiles(out, back);
    expect(joined).toHaveLength(out.length + back.length);
    const boundary = joined[out.length] as MotionSegment;
    expect(boundary.startOffsetDeg).toBeCloseTo(80, 9);
    expect(boundary.startMs).toBeCloseTo(segmentEnd(out[3] as MotionSegment).endMs, 9);
    expect(segmentEnd(joined[joined.length - 1] as MotionSegment).offsetDeg).toBeCloseTo(0, 9);
    expect(segmentWindows(joined, "sustain")).toHaveLength(2);
  });
});

describe("the generated recoil", () => {
  it("is a closed form of held time that freezes after the burst", () => {
    const pattern = generateRecoil(deriveRng("recoil", "a"), {
      family: "steep-vertical",
      burstMs: 1200,
      shotIntervalMs: 90,
    });
    expect(evaluateDisturbance(pattern, 0)).toEqual({ yawDeg: 0, pitchDeg: 0 });
    const mid = evaluateDisturbance(pattern, 600);
    const end = evaluateDisturbance(pattern, 1200);
    const after = evaluateDisturbance(pattern, 5000);
    expect(end.pitchDeg).toBeGreaterThan(mid.pitchDeg);
    expect(after).toEqual(end);
    expect(end.pitchDeg).toBeLessThanOrEqual(pattern.verticalRiseDeg + pattern.jitterDeg);
  });

  it("flips the horizontal drift on its seeded schedule", () => {
    const pattern = generateRecoil(deriveRng("recoil", "b"), {
      family: "wandering",
      burstMs: 1200,
      shotIntervalMs: 90,
    });
    expect(pattern.horizontalSignChangesMs).toHaveLength(3);
    const [first, second] = pattern.horizontalSignChangesMs as [number, number, number];
    expect(first).toBeLessThan(second);
    // Sampled at shot boundaries the jitter is constant, so the slope sign is the drift sign.
    const slopeBefore =
      evaluateDisturbance(pattern, first - 1).yawDeg -
      evaluateDisturbance(pattern, first - 30).yawDeg;
    const slopeAfter =
      evaluateDisturbance(pattern, first + 30).yawDeg -
      evaluateDisturbance(pattern, first + 1).yawDeg;
    expect(Math.sign(slopeBefore)).toBe(pattern.horizontalInitialSign);
    expect(Math.sign(slopeAfter)).toBe(-pattern.horizontalInitialSign);
  });

  it("draws every family with comparable uncompensated displacement", () => {
    const finals = RECOIL_FAMILIES.map((family) => {
      const pattern = generateRecoil(deriveRng("recoil", family), {
        family,
        burstMs: 1200,
        shotIntervalMs: 90,
      });
      const end = evaluateDisturbance(pattern, 1200);
      return Math.hypot(end.yawDeg, end.pitchDeg);
    });
    const max = Math.max(...finals);
    const min = Math.min(...finals);
    expect(min).toBeGreaterThan(3);
    expect(max / min).toBeLessThan(3);
  });

  it("is reproducible and family-labelled", () => {
    const a = generateRecoil(deriveRng("r", "x"), {
      family: "late-horizontal",
      burstMs: 1000,
      shotIntervalMs: 100,
    });
    const b = generateRecoil(deriveRng("r", "x"), {
      family: "late-horizontal",
      burstMs: 1000,
      shotIntervalMs: 100,
    });
    expect(b).toEqual(a);
    expect(a.family).toBe("late-horizontal");
    expect(a.jitter).toHaveLength(11);
  });
});

describe("the camera's disturbance and magnification", () => {
  const make = () =>
    createCamera({ horizontalHalfFovDeg: 51.5, aspectRatio: 16 / 9, degreesPerCount: 0.04 });

  it("adds the disturbance to what the player sees without touching their own movement", () => {
    const camera = make();
    camera.applyCounts(100, 0);
    expect(camera.yawDeg).toBeCloseTo(4, 9);
    camera.setDisturbance(1.5, -2);
    expect(camera.angles()).toEqual({ yawDeg: 5.5, pitchDeg: -2 });
    camera.setDisturbance(0, 0);
    expect(camera.angles()).toEqual({ yawDeg: 4, pitchDeg: 0 });
    expect(camera.accumulatedCounts).toEqual({ dx: 100, dy: 0 });
  });

  it("narrows the FOV in tangent space and restores it", () => {
    const camera = make();
    const base = camera.horizontalHalfFovDeg;
    camera.setMagnification(2);
    const zoomed = camera.horizontalHalfFovDeg;
    expect(Math.tan((zoomed * Math.PI) / 180)).toBeCloseTo(Math.tan((base * Math.PI) / 180) / 2, 9);
    expect(camera.magnification).toBe(2);

    // A fixed off-axis direction projects further from the centre when zoomed.
    const target = { yawDeg: 10, pitchDeg: 0 };
    const zoomedX = camera.project(target)?.ndcX ?? 0;
    camera.setMagnification(1);
    const baseX = camera.project(target)?.ndcX ?? 0;
    expect(Math.abs(zoomedX)).toBeGreaterThan(Math.abs(baseX));
    expect(camera.horizontalHalfFovDeg).toBeCloseTo(base, 9);
  });

  it("rejects a non-positive magnification", () => {
    expect(() => make().setMagnification(0)).toThrow(RangeError);
  });
});
