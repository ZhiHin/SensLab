import { angularDistance, type Angles } from "../../core/geometry/angular";
import type { TestRng } from "../contracts";

/**
 * Seeded angular target placement (doc 19 §19.6).
 *
 * Three constraints, each for a stated reason:
 *
 *  - **Minimum separation from the crosshair.** A target that spawns under the crosshair is
 *    not an acquisition, it is a free hit, and it would contaminate the acquisition-time
 *    distribution with a value that measures nothing.
 *  - **Minimum separation between targets.** Overlapping targets make the hit test ambiguous
 *    and let a single click resolve two engagements.
 *  - **Pitch limited to ±40°.** Near the pole a fixed yaw change produces a much smaller
 *    angular movement, so a target placed there would demand a different physical effort than
 *    the same angular distance near the horizon — a confound with the very quantity under test.
 *
 * Placement is rejection-sampled with a bounded attempt count. Bounded because a badly
 * specified test could otherwise spin forever; on exhaustion it returns the best candidate
 * found rather than failing, and flags that it relaxed the constraint.
 */

export const MAX_TARGET_PITCH_DEG = 40;

export interface PlacementConstraints {
  /** Angular distance from the crosshair, in degrees. */
  readonly minDistanceDeg: number;
  readonly maxDistanceDeg: number;
  /** Minimum angular separation between two simultaneously visible targets. */
  readonly minSeparationDeg: number;
  readonly maxPitchDeg?: number;
  /** Restricts the spawn direction, in degrees clockwise from screen-right. */
  readonly directionRangeDeg?: { readonly from: number; readonly to: number };
}

export interface PlacementResult {
  readonly position: Angles;
  /** Angular distance from the reference direction, in degrees. */
  readonly distanceDeg: number;
  /** Direction from the reference, in degrees clockwise from screen-right. */
  readonly directionDeg: number;
  /** True when the attempt budget was exhausted and separation had to be relaxed. */
  readonly relaxed: boolean;
}

const MAX_ATTEMPTS = 64;

/**
 * Places one target relative to a reference direction (normally the crosshair).
 *
 * The offset is applied in the *tangent plane* at the reference — a small-angle approximation
 * that is exact enough for the distances SensLab uses (≤ 50°) and keeps the distance and
 * direction the test declared directly interpretable in the trial record.
 */
export function placeTarget(
  rng: TestRng,
  reference: Angles,
  constraints: PlacementConstraints,
  existing: readonly Angles[] = [],
): PlacementResult {
  const maxPitch = constraints.maxPitchDeg ?? MAX_TARGET_PITCH_DEG;
  const range = constraints.directionRangeDeg ?? { from: 0, to: 360 };

  if (constraints.minDistanceDeg <= 0 || constraints.maxDistanceDeg < constraints.minDistanceDeg) {
    throw new RangeError(
      `invalid distance range: [${constraints.minDistanceDeg}, ${constraints.maxDistanceDeg}]`,
    );
  }

  let best: PlacementResult | null = null;
  let bestSeparation = -Infinity;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const distanceDeg = rng.nextRange(constraints.minDistanceDeg, constraints.maxDistanceDeg);
    const directionDeg = rng.nextRange(range.from, range.to);
    const direction = (directionDeg * Math.PI) / 180;

    const yawDeg = reference.yawDeg + distanceDeg * Math.cos(direction);
    const rawPitch = reference.pitchDeg + distanceDeg * Math.sin(direction);
    const pitchDeg = Math.min(maxPitch, Math.max(-maxPitch, rawPitch));

    const position: Angles = { yawDeg, pitchDeg };

    // Clamping the pitch changes the true angular distance, so it is recomputed rather than
    // trusted from the polar parameters.
    const actualDistance = angularDistance(reference, position);
    if (
      actualDistance < constraints.minDistanceDeg * 0.9 ||
      actualDistance > constraints.maxDistanceDeg * 1.1
    ) {
      continue;
    }

    const separation = minimumSeparation(position, existing);
    const candidate: PlacementResult = {
      position,
      distanceDeg: actualDistance,
      directionDeg,
      relaxed: false,
    };

    if (separation >= constraints.minSeparationDeg) return candidate;

    if (separation > bestSeparation) {
      bestSeparation = separation;
      best = { ...candidate, relaxed: true };
    }
  }

  if (best !== null) return best;

  // Every attempt fell outside the distance band — only reachable with a constraint set that
  // the pitch clamp makes unsatisfiable. Place on the horizon at the midpoint distance so the
  // trial can still run, and report it as relaxed.
  const distanceDeg = (constraints.minDistanceDeg + constraints.maxDistanceDeg) / 2;
  const position: Angles = { yawDeg: reference.yawDeg + distanceDeg, pitchDeg: 0 };
  return {
    position,
    distanceDeg: angularDistance(reference, position),
    directionDeg: 0,
    relaxed: true,
  };
}

/** Places several targets at once, each respecting separation from those already placed. */
export function placeTargets(
  rng: TestRng,
  reference: Angles,
  count: number,
  constraints: PlacementConstraints,
): readonly PlacementResult[] {
  const results: PlacementResult[] = [];
  const placed: Angles[] = [];

  for (let index = 0; index < count; index += 1) {
    const result = placeTarget(rng, reference, constraints, placed);
    results.push(result);
    placed.push(result.position);
  }

  return results;
}

function minimumSeparation(candidate: Angles, existing: readonly Angles[]): number {
  if (existing.length === 0) return Infinity;
  let smallest = Infinity;
  for (const other of existing) {
    const separation = angularDistance(candidate, other);
    if (separation < smallest) smallest = separation;
  }
  return smallest;
}

/** Quota-balanced direction bins, so no direction class is under-sampled by chance (doc 09 §9.2). */
export type DirectionClass = "horizontal" | "vertical" | "diagonal";

const HORIZONTAL_HALF_WIDTH_DEG = 20;

export function classifyDirection(directionDeg: number): DirectionClass {
  const normalised = ((directionDeg % 360) + 360) % 360;
  const fromHorizontal = Math.min(
    Math.abs(normalised - 0),
    Math.abs(normalised - 180),
    Math.abs(normalised - 360),
  );
  const fromVertical = Math.min(Math.abs(normalised - 90), Math.abs(normalised - 270));

  if (fromHorizontal <= HORIZONTAL_HALF_WIDTH_DEG) return "horizontal";
  if (fromVertical <= HORIZONTAL_HALF_WIDTH_DEG) return "vertical";
  return "diagonal";
}

/** The direction range for a class, used when a test declares a quota. */
export function rangeForDirectionClass(
  rng: TestRng,
  directionClass: DirectionClass,
): { readonly from: number; readonly to: number } {
  const sign = rng.next() < 0.5 ? 0 : 180;
  switch (directionClass) {
    case "horizontal":
      return { from: sign - HORIZONTAL_HALF_WIDTH_DEG, to: sign + HORIZONTAL_HALF_WIDTH_DEG };
    case "vertical":
      return {
        from: 90 + sign - HORIZONTAL_HALF_WIDTH_DEG,
        to: 90 + sign + HORIZONTAL_HALF_WIDTH_DEG,
      };
    case "diagonal":
      return { from: 25 + sign, to: 65 + sign };
  }
}
