import { angularDistance, type Angles } from "../../core/geometry/angular";
import type { MotionPattern, TargetSpec } from "../contracts";
import { evaluateMotion } from "./motion";

/**
 * Live targets within a trial (doc 19 §19.6).
 *
 * The manager answers one question that matters more than any other: **where was this target
 * at time `t`, and was the crosshair inside it?** Because motion is analytic, that question has
 * an exact answer at any instant — including the timestamp of a mouse press that landed between
 * two rendered frames. A player on 60 Hz and a player on 240 Hz therefore get the same hit
 * decision for the same physical input.
 *
 * ## On pooling
 *
 * doc 19 §19.13 lists "object pools for targets" among the no-allocation safeguards. Targets
 * are *not* pooled here, deliberately: a trial spawns a handful of them (a switching sequence
 * is the worst case at roughly eight over twelve seconds), and they are created at trial and
 * kill boundaries rather than inside the frame loop. Pooling that many objects buys nothing
 * measurable while adding a real hazard — a recycled target carrying stale motion or spawn
 * time would corrupt every position it reports.
 *
 * The allocation that genuinely matters is per-sample telemetry, which runs thousands of times
 * per trial inside the measured window. That *is* pooled, in `telemetry/ring-buffer.ts`.
 */

export interface LiveTarget {
  readonly id: number;
  readonly spec: TargetSpec;
  readonly motion: MotionPattern;
  /** Engine time at which this target appeared. */
  readonly spawnedAt: number;
  /** True once destroyed or expired; kept for the record until the trial ends. */
  alive: boolean;
  /** Engine time at which it was destroyed, or null while alive. */
  destroyedAt: number | null;
}

export interface HitResolution {
  readonly target: LiveTarget | null;
  /** Angular distance from the crosshair to the nearest target centre, in degrees. */
  readonly nearestDistanceDeg: number;
  /** Normalised distance: 1.0 sits exactly on the target's edge. */
  readonly nearestNormalised: number;
}

export interface TargetManager {
  spawn(spec: TargetSpec, motion: MotionPattern, atTime: number): LiveTarget;
  /** Position of a target at an exact instant. */
  positionAt(target: LiveTarget, atTime: number): Angles;
  /** Every target still alive, in spawn order. */
  living(): readonly LiveTarget[];
  /** Every target spawned this trial, alive or not. */
  all(): readonly LiveTarget[];
  /**
   * Resolves a shot at an exact instant against the camera's angular position at that instant.
   * Returns the closest target that contains the crosshair, or null for a miss.
   */
  resolveShot(crosshair: Angles, atTime: number): HitResolution;
  destroy(target: LiveTarget, atTime: number): void;
  /** Clears all targets for the next trial. */
  reset(): void;
  readonly livingCount: number;
}

export function createTargetManager(): TargetManager {
  const active: LiveTarget[] = [];
  let nextId = 1;

  const manager: TargetManager = {
    get livingCount() {
      let count = 0;
      for (const target of active) if (target.alive) count += 1;
      return count;
    },

    spawn(spec, motion, atTime) {
      const target: LiveTarget = {
        id: nextId,
        spec,
        motion,
        spawnedAt: atTime,
        alive: true,
        destroyedAt: null,
      };
      nextId += 1;
      active.push(target);
      return target;
    },

    positionAt(target, atTime) {
      const origin: Angles = { yawDeg: target.spec.yawDeg, pitchDeg: target.spec.pitchDeg };
      return evaluateMotion(target.motion, origin, atTime - target.spawnedAt).position;
    },

    living() {
      return active.filter((target) => target.alive);
    },

    all() {
      return active;
    },

    resolveShot(crosshair, atTime) {
      let hit: LiveTarget | null = null;
      let hitDistance = Infinity;
      let nearestDistance = Infinity;
      let nearestNormalised = Infinity;

      for (const target of active) {
        if (!target.alive) continue;
        // Decoys are drawn but never resolve a shot; they exist to add visual load.
        if (target.spec.role === "decoy") continue;

        const position = manager.positionAt(target, atTime);
        const distance = angularDistance(crosshair, position);
        const normalised = distance / target.spec.angularRadiusDeg;

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestNormalised = normalised;
        }

        // Inside the target, and closer to its centre than any previous candidate. Overlapping
        // targets are prevented at placement time, so this only arbitrates the rare edge case.
        if (distance <= target.spec.angularRadiusDeg && distance < hitDistance) {
          hit = target;
          hitDistance = distance;
        }
      }

      return {
        target: hit,
        nearestDistanceDeg: nearestDistance === Infinity ? Number.NaN : nearestDistance,
        nearestNormalised: nearestNormalised === Infinity ? Number.NaN : nearestNormalised,
      };
    },

    destroy(target, atTime) {
      if (!target.alive) return;
      target.alive = false;
      target.destroyedAt = atTime;
    },

    reset() {
      active.length = 0;
    },
  };

  return manager;
}

/**
 * Whether the crosshair is currently inside a target — the tracking tests' core question.
 * Separate from {@link TargetManager.resolveShot} because tracking accumulates time on target
 * without any shot being fired.
 */
export function isCrosshairOnTarget(
  manager: TargetManager,
  target: LiveTarget,
  crosshair: Angles,
  atTime: number,
): boolean {
  if (!target.alive) return false;
  const position = manager.positionAt(target, atTime);
  return angularDistance(crosshair, position) <= target.spec.angularRadiusDeg;
}
