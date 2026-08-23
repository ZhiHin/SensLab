import type { Angles } from "../../core/geometry/angular";
import type { MotionPattern, MotionSegment } from "../contracts";

/**
 * Analytic target motion (doc 19 §19.1 principle 4, §19.6).
 *
 * A target's position is a closed-form function of elapsed time. It is never integrated frame
 * by frame, and that single decision buys three things at once:
 *
 *  - **A dropped frame causes no drift.** An integrator that misses a frame is permanently
 *    wrong; a closed form is right at every `t` regardless of what was drawn.
 *  - **Hit tests can evaluate any instant exactly** — including the timestamp of a mouse press
 *    that fell between two frames, which is what makes hit detection frame-rate independent.
 *  - **The harness can step time arbitrarily** and reproduce positions exactly.
 *
 * Every amplitude, period and phase is drawn from the session seed, so a pattern is
 * unpredictable to the player and perfectly reproducible to us (`SENS-BR-031`).
 */

export interface MotionState {
  /** Absolute angular position of the target at the requested time. */
  readonly position: Angles;
  /** Angular velocity in degrees per second, for diagnostics and future tracking metrics. */
  readonly velocityDegPerSec: { readonly yaw: number; readonly pitch: number };
}

/**
 * Evaluates a motion pattern at `elapsedMs` after the target spawned.
 *
 * `origin` is the spawn position; every pattern is expressed as an offset from it, so the same
 * pattern can be reused at any point in the angular world.
 */
export function evaluateMotion(
  pattern: MotionPattern,
  origin: Angles,
  elapsedMs: number,
): MotionState {
  switch (pattern.kind) {
    case "static":
      return { position: origin, velocityDegPerSec: { yaw: 0, pitch: 0 } };

    case "sinusoid": {
      const omega = (2 * Math.PI) / pattern.periodMs;
      const phase = omega * elapsedMs + pattern.phase;
      const offset = pattern.amplitudeDeg * Math.sin(phase);
      // d/dt of A·sin(ωt + φ) is A·ω·cos(ωt + φ); ×1000 converts per-ms to per-second.
      const rate = pattern.amplitudeDeg * omega * Math.cos(phase) * 1000;

      if (pattern.axis === "yaw") {
        return {
          position: { yawDeg: origin.yawDeg + offset, pitchDeg: origin.pitchDeg },
          velocityDegPerSec: { yaw: rate, pitch: 0 },
        };
      }
      if (pattern.axis === "pitch") {
        return {
          position: { yawDeg: origin.yawDeg, pitchDeg: origin.pitchDeg + offset },
          velocityDegPerSec: { yaw: 0, pitch: rate },
        };
      }
      // Diagonal: the pitch component runs a quarter-cycle behind, so the path is a diagonal
      // sweep rather than a straight line traversed twice.
      const pitchPhase = phase - Math.PI / 2;
      return {
        position: {
          yawDeg: origin.yawDeg + offset,
          pitchDeg: origin.pitchDeg + pattern.amplitudeDeg * Math.sin(pitchPhase),
        },
        velocityDegPerSec: {
          yaw: rate,
          pitch: pattern.amplitudeDeg * omega * Math.cos(pitchPhase) * 1000,
        },
      };
    }

    case "circular": {
      const omega = (2 * Math.PI) / pattern.periodMs;
      const phase = omega * elapsedMs + pattern.phase;
      return {
        position: {
          yawDeg: origin.yawDeg + pattern.radiusDeg * Math.cos(phase),
          pitchDeg: origin.pitchDeg + pattern.radiusDeg * Math.sin(phase),
        },
        velocityDegPerSec: {
          yaw: -pattern.radiusDeg * omega * Math.sin(phase) * 1000,
          pitch: pattern.radiusDeg * omega * Math.cos(phase) * 1000,
        },
      };
    }

    case "segments": {
      const { offset, velocity } = evaluateSegments(pattern.segments, elapsedMs);
      if (pattern.axis === "yaw") {
        return {
          position: { yawDeg: origin.yawDeg + offset, pitchDeg: origin.pitchDeg },
          velocityDegPerSec: { yaw: velocity, pitch: 0 },
        };
      }
      return {
        position: { yawDeg: origin.yawDeg, pitchDeg: origin.pitchDeg + offset },
        velocityDegPerSec: { yaw: 0, pitch: velocity },
      };
    }

    case "random_smooth": {
      // A sum of sinusoids at incommensurate frequencies: continuous, differentiable, and
      // with no repeating period a player could learn within a trial.
      let yawOffset = 0;
      let yawRate = 0;
      let pitchOffset = 0;
      let pitchRate = 0;

      pattern.components.forEach((component, index) => {
        const phase = component.angularFrequency * elapsedMs + component.phase;
        const value = component.amplitudeDeg * Math.sin(phase);
        const rate = component.amplitudeDeg * component.angularFrequency * Math.cos(phase) * 1000;
        // Alternating assignment gives the two axes independent, uncorrelated motion from one
        // component list.
        if (index % 2 === 0) {
          yawOffset += value;
          yawRate += rate;
        } else {
          pitchOffset += value;
          pitchRate += rate;
        }
      });

      return {
        position: {
          yawDeg: origin.yawDeg + yawOffset,
          pitchDeg: origin.pitchDeg + pitchOffset,
        },
        velocityDegPerSec: { yaw: yawRate, pitch: pitchRate },
      };
    }
  }
}

/**
 * Evaluates a piecewise constant-acceleration profile.
 *
 * Before the first segment the target sits at the first segment's start; after the last it
 * holds that segment's end with zero velocity. Each segment is `s₀ + v₀·t + ½·a·t²`, so the
 * result is exact at any instant — including one that falls between two rendered frames.
 */
export function evaluateSegments(
  segments: readonly MotionSegment[],
  elapsedMs: number,
): { readonly offset: number; readonly velocity: number } {
  const first = segments[0];
  if (first === undefined) return { offset: 0, velocity: 0 };
  if (elapsedMs <= first.startMs) return { offset: first.startOffsetDeg, velocity: 0 };

  // Segments are few (tens at most) and evaluated thousands of times per trial; a linear scan
  // beats a binary search here because the list is short and the branch is predictable.
  for (const segment of segments) {
    const localMs = elapsedMs - segment.startMs;
    if (localMs < 0) break;
    if (localMs <= segment.durationMs) return evaluateSegment(segment, localMs);
  }

  const last = segments[segments.length - 1] as MotionSegment;
  return { offset: evaluateSegment(last, last.durationMs).offset, velocity: 0 };
}

function evaluateSegment(
  segment: MotionSegment,
  localMs: number,
): { readonly offset: number; readonly velocity: number } {
  const t = localMs / 1000;
  const v0 = segment.startVelocityDegPerSec;
  const a = segment.accelerationDegPerSec2;
  return {
    offset: segment.startOffsetDeg + v0 * t + 0.5 * a * t * t,
    velocity: v0 + a * t,
  };
}

/** The offset and velocity at the end of a segment — where the next one must begin. */
export function segmentEnd(segment: MotionSegment): {
  readonly offsetDeg: number;
  readonly velocityDegPerSec: number;
  readonly endMs: number;
} {
  const end = evaluateSegment(segment, segment.durationMs);
  return {
    offsetDeg: end.offset,
    velocityDegPerSec: end.velocity,
    endMs: segment.startMs + segment.durationMs,
  };
}

/** True when a pattern never moves — lets the target manager skip re-evaluation. */
export function isStatic(pattern: MotionPattern): boolean {
  return pattern.kind === "static";
}
