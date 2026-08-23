import type { MotionSegment, TestRng } from "../contracts";
import { segmentEnd } from "./motion";

/**
 * Generators for piecewise constant-acceleration motion (doc 09 §9.9, §9.10).
 *
 * Both produce a list of `MotionSegment`s that the analytic evaluator can sample exactly at
 * any instant. The generators are pure functions of the RNG, so the same seed always yields
 * the same path and two candidates can be given matched stimuli (doc 13 §13.6).
 *
 * Neither models any game's movement. A strafe is "a thing that moves sideways and reverses
 * at unpredictable moments"; a slide is "a thing that speeds up, holds, and slows down". Those
 * are descriptions of kinematics, not of any product.
 */

/* ------------------------------------------------------------------ building */

/** Appends a segment that begins where the previous one ended. */
function append(
  segments: MotionSegment[],
  durationMs: number,
  accelerationDegPerSec2: number,
  label: MotionSegment["label"],
  initial?: {
    readonly offsetDeg: number;
    readonly velocityDegPerSec: number;
    readonly startMs: number;
  },
): MotionSegment {
  const previous = segments[segments.length - 1];
  const from =
    previous === undefined
      ? (initial ?? { offsetDeg: 0, velocityDegPerSec: 0, startMs: 0 })
      : (() => {
          const end = segmentEnd(previous);
          return {
            offsetDeg: end.offsetDeg,
            velocityDegPerSec: end.velocityDegPerSec,
            startMs: end.endMs,
          };
        })();

  const segment: MotionSegment = {
    startMs: from.startMs,
    durationMs,
    startOffsetDeg: from.offsetDeg,
    startVelocityDegPerSec: from.velocityDegPerSec,
    accelerationDegPerSec2,
    label,
  };
  segments.push(segment);
  return segment;
}

/* ------------------------------------------------------------------ strafe */

export interface StrafeOptions {
  /** Total duration the profile must cover, milliseconds. */
  readonly durationMs: number;
  /** Cruise speed, degrees per second. */
  readonly speedDegPerSec: number;
  /** Mean of the memoryless interval between reversals, milliseconds. */
  readonly meanReversalIntervalMs: number;
  /** Magnitude of the acceleration used to reverse, degrees per second squared. */
  readonly reversalAccelerationDegPerSec2: number;
  /** The target never strays further than this from its spawn point. */
  readonly maxExcursionDeg: number;
  /** Shortest admissible cruise, so reversals cannot pile up into a shudder. */
  readonly minReversalIntervalMs?: number;
}

/**
 * A horizontal strafe with memoryless reversals.
 *
 * Intervals between reversals are drawn from an **exponential** distribution, which is the
 * one distribution with no memory: however long the target has been going one way, the chance
 * it reverses in the next instant is unchanged. A uniform draw would let a player learn that
 * "it has not reversed for a while, so it is about to" — which is exactly the anticipation the
 * test exists to defeat (doc 09 §9.9).
 *
 * Reversals are bounded-acceleration, so velocity is continuous and the motion stays
 * physically plausible. The one concession to predictability is the excursion bound: a cruise
 * that would leave the reachable band is cut short, because a target the player cannot follow
 * measures nothing.
 */
export function strafeProfile(rng: TestRng, options: StrafeOptions): readonly MotionSegment[] {
  const {
    durationMs,
    speedDegPerSec: v,
    meanReversalIntervalMs,
    reversalAccelerationDegPerSec2: a,
    maxExcursionDeg,
  } = options;
  const minInterval = options.minReversalIntervalMs ?? 150;

  if (!(v > 0) || !(a > 0) || !(maxExcursionDeg > 0) || !(meanReversalIntervalMs > 0)) {
    throw new RangeError("strafe profile parameters must be positive");
  }

  const segments: MotionSegment[] = [];
  let direction: 1 | -1 = rng.next() < 0.5 ? -1 : 1;

  // Reversing from +v to −v at acceleration a takes 2v/a seconds and covers no net distance.
  const reversalMs = ((2 * v) / a) * 1000;
  // The target must be able to reverse before the bound; leave room for the half-reversal.
  const brakingDistance = (v * v) / (2 * a);

  // Get moving: accelerate from rest to cruise speed in the initial direction.
  append(segments, (v / a) * 1000, direction * a, "accelerate");

  let elapsed = segmentEnd(segments[segments.length - 1] as MotionSegment).endMs;

  while (elapsed < durationMs) {
    // Memoryless draw, floored so two reversals cannot land on top of each other.
    const drawn = -Math.log(1 - rng.next()) * meanReversalIntervalMs;
    let cruiseMs = Math.max(minInterval, drawn);

    const here = segmentEnd(segments[segments.length - 1] as MotionSegment).offsetDeg;
    const room = maxExcursionDeg - brakingDistance - direction * here;
    // Distance the cruise would cover, against the room left before the bound.
    const maxCruiseMs = Math.max(0, (room / v) * 1000);
    cruiseMs = Math.min(cruiseMs, maxCruiseMs);

    if (cruiseMs > 0) append(segments, cruiseMs, 0, "cruise");
    append(segments, reversalMs, -direction * a, "reverse");
    direction = direction === 1 ? -1 : 1;

    elapsed = segmentEnd(segments[segments.length - 1] as MotionSegment).endMs;
  }

  return segments;
}

/* ------------------------------------------------------------------ slide */

export interface SlideOptions {
  /** Angular distance the slide covers, degrees. Signed: negative slides left. */
  readonly spanDeg: number;
  readonly peakSpeedDegPerSec: number;
  /** Fraction of the span spent accelerating. */
  readonly accelerateFraction: number;
  /** Fraction of the span spent decelerating. */
  readonly decelerateFraction: number;
  /** Time to hold still before the slide begins, milliseconds. */
  readonly leadInMs: number;
}

/**
 * One accelerate → sustain → decelerate slide.
 *
 * Given the span and the fractions, the accelerations follow from `v² = 2·a·d`: the profile
 * reaches exactly `peakSpeed` at the end of the acceleration distance and exactly zero at the
 * end of the span, with no numerical fitting.
 */
export function slideProfile(
  options: SlideOptions,
  initial?: { readonly offsetDeg: number; readonly startMs: number },
): readonly MotionSegment[] {
  const {
    spanDeg,
    peakSpeedDegPerSec: v,
    accelerateFraction,
    decelerateFraction,
    leadInMs,
  } = options;
  if (!(v > 0) || spanDeg === 0) throw new RangeError("a slide needs a span and a peak speed");
  if (accelerateFraction <= 0 || decelerateFraction <= 0) {
    throw new RangeError("acceleration and deceleration fractions must be positive");
  }
  if (accelerateFraction + decelerateFraction > 1) {
    throw new RangeError("acceleration and deceleration fractions must sum to at most 1");
  }

  const direction = Math.sign(spanDeg);
  const span = Math.abs(spanDeg);
  const accelDistance = span * accelerateFraction;
  const decelDistance = span * decelerateFraction;
  const sustainDistance = span - accelDistance - decelDistance;

  const accel = (v * v) / (2 * accelDistance);
  const decel = (v * v) / (2 * decelDistance);

  const segments: MotionSegment[] = [];
  const start = initial ?? { offsetDeg: 0, startMs: 0 };

  append(segments, leadInMs, 0, "hold", {
    offsetDeg: start.offsetDeg,
    velocityDegPerSec: 0,
    startMs: start.startMs,
  });
  append(segments, (v / accel) * 1000, direction * accel, "accelerate");
  if (sustainDistance > 0) append(segments, (sustainDistance / v) * 1000, 0, "sustain");
  append(segments, (v / decel) * 1000, -direction * decel, "decelerate");

  return segments;
}

/** Concatenates profiles so each begins where the previous ended. */
export function concatProfiles(
  ...profiles: readonly (readonly MotionSegment[])[]
): readonly MotionSegment[] {
  const out: MotionSegment[] = [];
  for (const profile of profiles) {
    const previous = out[out.length - 1];
    const shift =
      previous === undefined
        ? { offsetDeg: 0, startMs: 0 }
        : { offsetDeg: segmentEnd(previous).offsetDeg, startMs: segmentEnd(previous).endMs };
    const first = profile[0];
    if (first === undefined) continue;
    const offsetDelta = shift.offsetDeg - first.startOffsetDeg;
    const timeDelta = shift.startMs - first.startMs;
    for (const segment of profile) {
      out.push({
        ...segment,
        startMs: segment.startMs + timeDelta,
        startOffsetDeg: segment.startOffsetDeg + offsetDelta,
      });
    }
  }
  return out;
}

/** Elapsed-time windows of every segment with a given label. */
export function segmentWindows(
  segments: readonly MotionSegment[],
  label: MotionSegment["label"],
): readonly { readonly fromMs: number; readonly toMs: number }[] {
  return segments
    .filter((segment) => segment.label === label)
    .map((segment) => ({ fromMs: segment.startMs, toMs: segment.startMs + segment.durationMs }));
}
