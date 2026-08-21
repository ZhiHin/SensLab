import { countsPer360, type CountsPer360, type Degrees } from "../types/brand";
import type { ConversionMethod } from "../types/vocabulary";

/**
 * Field-of-view geometry and the family of FOV-matching criteria (doc 11 §11.5–§11.6).
 *
 * Everything here is derived from first principles rather than copied from a third-party
 * calculator, so the maths stands on its own. What is *not* settled is the naming: what
 * widely-used calculators mean by labels like "0% monitor distance" is an open verification
 * item (EV-011), which is why the criteria below are named for what they do rather than for
 * a percentage.
 *
 * The construction: in a perspective projection with horizontal half-FOV `h`, a point at
 * yaw θ from the camera axis sits at a fraction `k = tan(θ) / tan(h)` of the half screen
 * width. Matching two FOV states at a chosen `k` therefore requires
 *
 *     cm360₂ / cm360₁ = atan(k · tan h₁) / atan(k · tan h₂)
 *
 * with two informative limits:
 *   k → 0  ⇒  tan h₁ / tan h₂   (matched at the exact screen centre — focal length scaling)
 *   k = 1  ⇒  h₁ / h₂           (matched at the horizontal screen edge)
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export const toRadians = (value: number): number => value * DEG_TO_RAD;
export const toDegrees = (value: number): number => value * RAD_TO_DEG;

function assertHalfFov(halfFovDegrees: number, name: string): void {
  if (!Number.isFinite(halfFovDegrees) || halfFovDegrees <= 0 || halfFovDegrees >= 90) {
    throw new RangeError(
      `${name} must be a half-FOV in (0, 90) degrees, received ${halfFovDegrees}`,
    );
  }
}

/** Vertical half-FOV implied by a horizontal half-FOV at a given aspect ratio (width / height). */
export function verticalHalfFovFromHorizontal(
  horizontalHalfFovDegrees: number,
  aspectRatio: number,
): number {
  assertHalfFov(horizontalHalfFovDegrees, "horizontal half-FOV");
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError(`aspect ratio must be positive, received ${aspectRatio}`);
  }
  return toDegrees(Math.atan(Math.tan(toRadians(horizontalHalfFovDegrees)) / aspectRatio));
}

export function horizontalHalfFovFromVertical(
  verticalHalfFovDegrees: number,
  aspectRatio: number,
): number {
  assertHalfFov(verticalHalfFovDegrees, "vertical half-FOV");
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError(`aspect ratio must be positive, received ${aspectRatio}`);
  }
  return toDegrees(Math.atan(Math.tan(toRadians(verticalHalfFovDegrees)) * aspectRatio));
}

/** Fraction of the half screen width at which a target `angle` off-axis appears. */
export function screenFractionForAngle(angle: Degrees | number, halfFovDegrees: number): number {
  assertHalfFov(halfFovDegrees, "half-FOV");
  return Math.tan(toRadians(angle)) / Math.tan(toRadians(halfFovDegrees));
}

/** Inverse of {@link screenFractionForAngle}. */
export function angleForScreenFraction(fraction: number, halfFovDegrees: number): number {
  assertHalfFov(halfFovDegrees, "half-FOV");
  return toDegrees(Math.atan(fraction * Math.tan(toRadians(halfFovDegrees))));
}

/**
 * A criterion for deciding what "the same feel" means across two FOV states.
 *
 * There is no single correct answer — the criteria genuinely disagree — so SensLab names
 * the criterion, explains it, and lets the user choose (FR-085).
 */
export type MatchCriterion =
  | { readonly kind: "distance_360" }
  | { readonly kind: "focal_length" }
  | { readonly kind: "monitor_distance"; readonly coefficient: number };

export function criterionToConversionMethod(criterion: MatchCriterion): ConversionMethod {
  switch (criterion.kind) {
    case "distance_360":
      return "distance_360";
    case "focal_length":
      return "focal_length";
    case "monitor_distance":
      return "monitor_distance";
  }
}

/**
 * Ratio by which cm/360 (equivalently counts/360) must change when moving from a source
 * FOV state to a target FOV state under the given criterion.
 *
 * A ratio above 1 means the target state is *slower* in physical terms, which is what
 * every zoomed-in criterion produces.
 */
export function matchRatio(
  criterion: MatchCriterion,
  sourceHalfFovDegrees: number,
  targetHalfFovDegrees: number,
): number {
  assertHalfFov(sourceHalfFovDegrees, "source half-FOV");
  assertHalfFov(targetHalfFovDegrees, "target half-FOV");

  const tanSource = Math.tan(toRadians(sourceHalfFovDegrees));
  const tanTarget = Math.tan(toRadians(targetHalfFovDegrees));

  switch (criterion.kind) {
    case "distance_360":
      // Physical distance for a full turn is held identical; FOV is irrelevant by definition.
      return 1;

    case "focal_length":
      // The k → 0 limit of monitor-distance matching.
      return tanSource / tanTarget;

    case "monitor_distance": {
      const k = criterion.coefficient;
      if (!Number.isFinite(k) || k <= 0 || k > 1) {
        throw new RangeError(
          `monitor distance coefficient must be in (0, 1], received ${k}. Use the focal_length criterion for the k → 0 limit.`,
        );
      }
      return Math.atan(k * tanSource) / Math.atan(k * tanTarget);
    }
  }
}

/** Applies {@link matchRatio} to a canonical sensitivity. */
export function convertCountsPer360ForFovChange(
  counts: CountsPer360 | number,
  sourceHalfFovDegrees: number,
  targetHalfFovDegrees: number,
  criterion: MatchCriterion,
): CountsPer360 {
  if (!Number.isFinite(counts) || counts <= 0) {
    throw new RangeError(`counts/360 must be positive, received ${counts}`);
  }
  return countsPer360(counts * matchRatio(criterion, sourceHalfFovDegrees, targetHalfFovDegrees));
}
