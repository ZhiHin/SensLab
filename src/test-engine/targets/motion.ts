import type { Angles } from "../../core/geometry/angular";
import type { MotionPattern } from "../contracts";

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

/** True when a pattern never moves — lets the target manager skip re-evaluation. */
export function isStatic(pattern: MotionPattern): boolean {
  return pattern.kind === "static";
}
