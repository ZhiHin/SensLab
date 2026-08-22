import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import { angularDistance } from "@/core/geometry/angular";
import type { MotionPattern } from "@/test-engine/contracts";
import { evaluateMotion, isStatic } from "@/test-engine/targets/motion";
import {
  classifyDirection,
  MAX_TARGET_PITCH_DEG,
  placeTarget,
  placeTargets,
  rangeForDirectionClass,
} from "@/test-engine/targets/placement";
import { createTargetManager, isCrosshairOnTarget } from "@/test-engine/targets/target-manager";

/** Targets are declared as offsets; these suites anchor them at the origin. */
const ORIGINAL_ANCHOR = { yawDeg: 0, pitchDeg: 0 };

/**
 * Target motion, placement and hit resolution (doc 19 §19.6).
 *
 * The claim under test throughout this file is that a target's position is a *function of
 * time*, never an accumulation of frames. Everything else here — reproducibility from a seed,
 * identical hit decisions at 60 Hz and 240 Hz — follows from that one property.
 */

const ORIGIN = { yawDeg: 10, pitchDeg: -5 };

describe("analytic motion", () => {
  it("holds a static target exactly still, forever", () => {
    const pattern: MotionPattern = { kind: "static" };
    expect(isStatic(pattern)).toBe(true);
    for (const t of [0, 16.7, 1234.5, 1e6]) {
      expect(evaluateMotion(pattern, ORIGIN, t).position).toEqual(ORIGIN);
    }
    expect(evaluateMotion(pattern, ORIGIN, 500).velocityDegPerSec).toEqual({ yaw: 0, pitch: 0 });
  });

  it("gives the same position for the same t no matter how it was reached", () => {
    // The property that makes a dropped frame harmless: position depends on t alone, so a
    // renderer that misses ten frames resumes exactly where an unbroken one would be.
    const pattern: MotionPattern = {
      kind: "sinusoid",
      axis: "yaw",
      amplitudeDeg: 6,
      periodMs: 900,
      phase: 0.4,
    };

    const direct = evaluateMotion(pattern, ORIGIN, 733.3).position;

    // Walk to the same instant in irregular steps, as a stuttering display would.
    let stepped = evaluateMotion(pattern, ORIGIN, 0).position;
    for (const t of [11, 96, 140.5, 400, 733.3]) {
      stepped = evaluateMotion(pattern, ORIGIN, t).position;
    }

    expect(stepped.yawDeg).toBe(direct.yawDeg);
    expect(stepped.pitchDeg).toBe(direct.pitchDeg);
  });

  it("returns to its start after exactly one period", () => {
    const pattern: MotionPattern = {
      kind: "sinusoid",
      axis: "pitch",
      amplitudeDeg: 4,
      periodMs: 1000,
      phase: 1.1,
    };
    const start = evaluateMotion(pattern, ORIGIN, 0).position;
    const later = evaluateMotion(pattern, ORIGIN, 1000).position;
    expect(later.pitchDeg).toBeCloseTo(start.pitchDeg, 9);
  });

  it("reports a velocity that matches the numerical derivative", () => {
    // The closed-form derivative is what a future tracking metric will integrate against; if it
    // disagreed with the position function the metric would be quietly wrong.
    const patterns: MotionPattern[] = [
      { kind: "sinusoid", axis: "yaw", amplitudeDeg: 5, periodMs: 800, phase: 0.2 },
      { kind: "sinusoid", axis: "pitch", amplitudeDeg: 3, periodMs: 1300, phase: 2 },
      { kind: "sinusoid", axis: "both", amplitudeDeg: 4, periodMs: 700, phase: 0 },
      { kind: "circular", radiusDeg: 7, periodMs: 1500, phase: 0.9 },
      {
        kind: "random_smooth",
        components: [
          { amplitudeDeg: 3, angularFrequency: 0.004, phase: 0.3 },
          { amplitudeDeg: 2, angularFrequency: 0.0071, phase: 1.7 },
          { amplitudeDeg: 1.5, angularFrequency: 0.0113, phase: 2.9 },
        ],
      },
    ];

    const h = 0.001; // ms
    for (const pattern of patterns) {
      const t = 421;
      const before = evaluateMotion(pattern, ORIGIN, t - h).position;
      const after = evaluateMotion(pattern, ORIGIN, t + h).position;
      const state = evaluateMotion(pattern, ORIGIN, t);

      const numericYaw = ((after.yawDeg - before.yawDeg) / (2 * h)) * 1000;
      const numericPitch = ((after.pitchDeg - before.pitchDeg) / (2 * h)) * 1000;

      expect(state.velocityDegPerSec.yaw).toBeCloseTo(numericYaw, 3);
      expect(state.velocityDegPerSec.pitch).toBeCloseTo(numericPitch, 3);
    }
  });

  it("keeps a circular target at a constant radius from its origin", () => {
    const pattern: MotionPattern = { kind: "circular", radiusDeg: 5, periodMs: 1200, phase: 0 };
    for (const t of [0, 150, 600, 999]) {
      const { position } = evaluateMotion(pattern, ORIGIN, t);
      const radius = Math.hypot(
        position.yawDeg - ORIGIN.yawDeg,
        position.pitchDeg - ORIGIN.pitchDeg,
      );
      expect(radius).toBeCloseTo(5, 9);
    }
  });

  it("gives the two axes of a diagonal sweep a quarter-cycle offset", () => {
    // Without the offset the "diagonal" would be a straight line traversed twice, which is a
    // different tracking task from the one the definition asked for.
    const pattern: MotionPattern = {
      kind: "sinusoid",
      axis: "both",
      amplitudeDeg: 5,
      periodMs: 1000,
      phase: 0,
    };
    const atZero = evaluateMotion(pattern, ORIGIN, 0).position;
    expect(atZero.yawDeg - ORIGIN.yawDeg).toBeCloseTo(0, 9);
    expect(atZero.pitchDeg - ORIGIN.pitchDeg).toBeCloseTo(-5, 9);
  });

  it("splits random_smooth components across the two axes so they stay uncorrelated", () => {
    const oneAxisOnly: MotionPattern = {
      kind: "random_smooth",
      components: [{ amplitudeDeg: 3, angularFrequency: 0.005, phase: 0 }],
    };
    const state = evaluateMotion(oneAxisOnly, ORIGIN, 250);
    expect(state.position.pitchDeg).toBe(ORIGIN.pitchDeg);
    expect(state.position.yawDeg).not.toBe(ORIGIN.yawDeg);
  });
});

describe("seeded placement", () => {
  const constraints = { minDistanceDeg: 10, maxDistanceDeg: 25, minSeparationDeg: 6 };
  const reference = { yawDeg: 0, pitchDeg: 0 };

  it("reproduces the identical sequence from the identical seed — SENS-BR-031", () => {
    const first = placeTargets(
      deriveRng("seed-a", "target-placement", 0, 0),
      reference,
      4,
      constraints,
    );
    const second = placeTargets(
      deriveRng("seed-a", "target-placement", 0, 0),
      reference,
      4,
      constraints,
    );
    expect(second).toEqual(first);
  });

  it("produces a different sequence from a different seed", () => {
    const first = placeTargets(
      deriveRng("seed-a", "target-placement", 0, 0),
      reference,
      4,
      constraints,
    );
    const other = placeTargets(
      deriveRng("seed-b", "target-placement", 0, 0),
      reference,
      4,
      constraints,
    );
    expect(other).not.toEqual(first);
  });

  it("keeps every target inside the declared distance band", () => {
    const rng = deriveRng("distances", "target-placement", 0);
    for (let i = 0; i < 200; i += 1) {
      const result = placeTarget(rng, reference, constraints);
      expect(result.distanceDeg).toBeGreaterThanOrEqual(constraints.minDistanceDeg * 0.9);
      expect(result.distanceDeg).toBeLessThanOrEqual(constraints.maxDistanceDeg * 1.1);
    }
  });

  it("never places a target where the crosshair already is", () => {
    // A target under the crosshair is a free hit, and it would enter the acquisition-time
    // distribution as a value that measures nothing.
    const rng = deriveRng("no-freebies", "target-placement", 0);
    for (let i = 0; i < 200; i += 1) {
      const result = placeTarget(rng, reference, constraints);
      expect(angularDistance(reference, result.position)).toBeGreaterThan(1);
    }
  });

  it("holds pitch inside ±40°, where equal angles cost equal hand movement", () => {
    const rng = deriveRng("pitch-bound", "target-placement", 0);
    for (let i = 0; i < 300; i += 1) {
      const result = placeTarget(rng, { yawDeg: 0, pitchDeg: 35 }, constraints);
      expect(Math.abs(result.position.pitchDeg)).toBeLessThanOrEqual(MAX_TARGET_PITCH_DEG);
    }
  });

  it("separates simultaneous targets so one click cannot resolve two engagements", () => {
    const rng = deriveRng("separation", "target-placement", 0);
    const placed = placeTargets(rng, reference, 3, constraints);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (a === undefined || b === undefined) throw new Error("unreachable");
        if (a.relaxed || b.relaxed) continue;
        expect(angularDistance(a.position, b.position)).toBeGreaterThanOrEqual(
          constraints.minSeparationDeg,
        );
      }
    }
  });

  it("reports when it had to relax separation rather than silently overlapping", () => {
    // An impossible constraint set: five targets each 60° apart within a 12° band.
    const rng = deriveRng("impossible", "target-placement", 0);
    const placed = placeTargets(rng, reference, 5, {
      minDistanceDeg: 10,
      maxDistanceDeg: 12,
      minSeparationDeg: 60,
    });
    expect(placed.some((result) => result.relaxed)).toBe(true);
  });

  it("rejects an impossible distance range rather than guessing one", () => {
    const rng = deriveRng("bad-range", "target-placement", 0);
    expect(() =>
      placeTarget(rng, reference, { minDistanceDeg: 0, maxDistanceDeg: 5, minSeparationDeg: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      placeTarget(rng, reference, { minDistanceDeg: 20, maxDistanceDeg: 5, minSeparationDeg: 0 }),
    ).toThrow(RangeError);
  });

  it("honours a restricted direction range", () => {
    const rng = deriveRng("directions", "target-placement", 0);
    for (let i = 0; i < 50; i += 1) {
      const result = placeTarget(rng, reference, {
        ...constraints,
        directionRangeDeg: { from: 80, to: 100 },
      });
      expect(result.directionDeg).toBeGreaterThanOrEqual(80);
      expect(result.directionDeg).toBeLessThanOrEqual(100);
    }
  });

  it("classifies directions into the quota bins", () => {
    expect(classifyDirection(0)).toBe("horizontal");
    expect(classifyDirection(180)).toBe("horizontal");
    expect(classifyDirection(355)).toBe("horizontal");
    expect(classifyDirection(90)).toBe("vertical");
    expect(classifyDirection(270)).toBe("vertical");
    expect(classifyDirection(45)).toBe("diagonal");
    expect(classifyDirection(225)).toBe("diagonal");
    // Wraps rather than throwing, so a caller's accumulated angle is always classifiable.
    expect(classifyDirection(720)).toBe("horizontal");
    expect(classifyDirection(-90)).toBe("vertical");
  });

  it("draws a range that classifies back to the class it was asked for", () => {
    const rng = deriveRng("ranges", "target-placement", 0);
    for (const directionClass of ["horizontal", "vertical", "diagonal"] as const) {
      for (let i = 0; i < 20; i += 1) {
        const range = rangeForDirectionClass(rng, directionClass);
        const midpoint = (range.from + range.to) / 2;
        expect(classifyDirection(midpoint)).toBe(directionClass);
      }
    }
  });
});

describe("hit resolution", () => {
  const spec = (
    over: Partial<Parameters<ReturnType<typeof createTargetManager>["spawn"]>[0]> = {},
  ) => ({
    yawDeg: 20,
    pitchDeg: 0,
    angularRadiusDeg: 2,
    role: "scored" as const,
    ...over,
  });

  it("resolves a shot inside the radius and misses outside it", () => {
    const targets = createTargetManager();
    targets.spawn(spec(), { kind: "static" }, 0, ORIGINAL_ANCHOR);

    expect(targets.resolveShot({ yawDeg: 20, pitchDeg: 0 }, 100).target).not.toBeNull();
    expect(targets.resolveShot({ yawDeg: 21.9, pitchDeg: 0 }, 100).target).not.toBeNull();
    expect(targets.resolveShot({ yawDeg: 22.1, pitchDeg: 0 }, 100).target).toBeNull();
  });

  it("reports the near-miss distance, which is what a miss actually measures", () => {
    const targets = createTargetManager();
    targets.spawn(spec(), { kind: "static" }, 0, ORIGINAL_ANCHOR);

    const resolution = targets.resolveShot({ yawDeg: 25, pitchDeg: 0 }, 100);
    expect(resolution.target).toBeNull();
    expect(resolution.nearestDistanceDeg).toBeCloseTo(5, 6);
    // Normalised by radius: 2.5 target-radii out.
    expect(resolution.nearestNormalised).toBeCloseTo(2.5, 6);
  });

  it("reports NaN rather than a number when there is nothing to be near", () => {
    const targets = createTargetManager();
    const resolution = targets.resolveShot({ yawDeg: 0, pitchDeg: 0 }, 0);
    expect(resolution.target).toBeNull();
    expect(Number.isNaN(resolution.nearestDistanceDeg)).toBe(true);
    expect(Number.isNaN(resolution.nearestNormalised)).toBe(true);
  });

  it("never resolves a shot against a decoy", () => {
    const targets = createTargetManager();
    targets.spawn(spec({ role: "decoy" }), { kind: "static" }, 0, ORIGINAL_ANCHOR);
    const resolution = targets.resolveShot({ yawDeg: 20, pitchDeg: 0 }, 100);
    expect(resolution.target).toBeNull();
    // A decoy is not even the "nearest" thing, or a near-miss metric would count it.
    expect(Number.isNaN(resolution.nearestDistanceDeg)).toBe(true);
  });

  it("ignores destroyed targets", () => {
    const targets = createTargetManager();
    const target = targets.spawn(spec(), { kind: "static" }, 0, ORIGINAL_ANCHOR);
    targets.destroy(target, 50);

    expect(targets.resolveShot({ yawDeg: 20, pitchDeg: 0 }, 100).target).toBeNull();
    expect(targets.livingCount).toBe(0);
    // Destroyed, but retained for the record with the instant it died.
    expect(targets.all()).toHaveLength(1);
    expect(target.destroyedAt).toBe(50);
  });

  it("picks the target whose centre is closest when two overlap", () => {
    const targets = createTargetManager();
    const far = targets.spawn(
      spec({ yawDeg: 22, angularRadiusDeg: 4 }),
      { kind: "static" },
      0,
      ORIGINAL_ANCHOR,
    );
    const near = targets.spawn(
      spec({ yawDeg: 20, angularRadiusDeg: 4 }),
      { kind: "static" },
      0,
      ORIGINAL_ANCHOR,
    );

    const resolution = targets.resolveShot({ yawDeg: 20.2, pitchDeg: 0 }, 10);
    expect(resolution.target).toBe(near);
    expect(resolution.target).not.toBe(far);
  });

  it("decides a moving target's hit identically at 60 Hz and at 240 Hz — FR-055", () => {
    // The whole point of analytic motion. Two engines run the same trial at different frame
    // rates; the click lands at the same wall-clock instant in both. If position were
    // integrated per frame, the two would disagree — and the faster machine would be easier.
    const pattern: MotionPattern = {
      kind: "sinusoid",
      axis: "yaw",
      amplitudeDeg: 8,
      periodMs: 700,
      phase: 0.35,
    };
    const clickAt = 431.7; // deliberately between frames at both rates

    const run = (frameIntervalMs: number) => {
      const targets = createTargetManager();
      const target = targets.spawn(spec({ angularRadiusDeg: 1.5 }), pattern, 0, ORIGINAL_ANCHOR);
      // Drive frames the way the engine would; they must not affect the answer.
      for (let t = 0; t < clickAt; t += frameIntervalMs) targets.positionAt(target, t);
      return targets.resolveShot({ yawDeg: 24.4, pitchDeg: 0 }, clickAt);
    };

    const slow = run(1000 / 60);
    const fast = run(1000 / 240);
    const skipped = run(1000 / 7); // a machine dropping most of its frames

    expect(slow.nearestDistanceDeg).toBe(fast.nearestDistanceDeg);
    expect(slow.nearestDistanceDeg).toBe(skipped.nearestDistanceDeg);
    expect(slow.target === null).toBe(fast.target === null);
    expect(slow.target === null).toBe(skipped.target === null);
  });

  it("tracks whether the crosshair is on target without a shot being fired", () => {
    const targets = createTargetManager();
    const target = targets.spawn(
      spec({ angularRadiusDeg: 3 }),
      { kind: "static" },
      0,
      ORIGINAL_ANCHOR,
    );

    expect(isCrosshairOnTarget(targets, target, { yawDeg: 20, pitchDeg: 2 }, 100)).toBe(true);
    expect(isCrosshairOnTarget(targets, target, { yawDeg: 20, pitchDeg: 4 }, 100)).toBe(false);

    targets.destroy(target, 150);
    expect(isCrosshairOnTarget(targets, target, { yawDeg: 20, pitchDeg: 0 }, 200)).toBe(false);
  });

  it("clears every target on reset so trials cannot leak into each other", () => {
    const targets = createTargetManager();
    targets.spawn(spec(), { kind: "static" }, 0, ORIGINAL_ANCHOR);
    targets.reset();
    expect(targets.all()).toHaveLength(0);
    expect(targets.livingCount).toBe(0);
  });
});
