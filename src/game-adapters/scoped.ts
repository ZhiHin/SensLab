import { matchRatio, toDegrees, toRadians, type MatchCriterion } from "../core/sensitivity/fov";
import { err, ok, type Result } from "../core/types/result";
import type { AdsModel, ConversionMethod } from "../core/types/vocabulary";

/**
 * Scoped and ADS targets (doc 11 §11.6).
 *
 * The maths lives in `core/sensitivity/fov` and is game-independent. What lives here is the
 * part that depends on a *game*: whether the game already scales its own ADS sensitivity by
 * FOV, what optics it offers, and which matching criterion to start from.
 *
 * ## The one that goes wrong
 *
 * doc 11 §11.6.4 calls `ads_model` "the single most common source of error in sensitivity
 * conversion", and the failure mode is nasty: applying a monitor-distance conversion on top
 * of a game that already applies its own leaves hipfire perfectly correct and every scoped
 * value wrong by exactly the factor the game applied. Nothing about the output looks
 * suspicious. So the declaration is mandatory per scope, `unknown` is a real value, and
 * `unknown` emits nothing at all.
 */

/**
 * How a scope's field of view is known.
 *
 * The distinction is not pedantry. A measured half-FOV is evidence. A magnification number is
 * evidence *plus* an assumption — that the game implements the optic as a tangent-space zoom
 * — and that assumption belongs to the game, so it has to be recorded as part of what
 * verification established rather than applied silently by the conversion layer.
 */
export type ScopeOptics =
  | { readonly kind: "measured_half_fov"; readonly halfFovDegrees: number }
  | { readonly kind: "tangent_magnification"; readonly magnification: number };

export interface ScopedTargetInput {
  readonly hipfireCounts: number;
  readonly adsModel: AdsModel;
  readonly optics: ScopeOptics | null;
  /** The player's own hipfire half-FOV. Required for any FOV-matched criterion. */
  readonly hipfireHalfFovDegrees?: number;
  readonly criterion: MatchCriterion;
}

export interface ScopedTarget {
  readonly countsPer360: number;
  readonly conversionMethod: ConversionMethod;
  /** The monitor-distance coefficient actually used, when the criterion has one. */
  readonly conversionCoefficient: number | null;
  readonly criterion: MatchCriterion | null;
  /** The scope half-FOV the conversion resolved to, for display and diagnostics. */
  readonly scopeHalfFovDegrees: number | null;
}

export type ScopedRefusal =
  | { readonly kind: "ads_model_unknown" }
  | { readonly kind: "missing_fov_context"; readonly detail: string };

/**
 * Half-FOV of a scope that magnifies in tangent space.
 *
 * `tan(h_scope) = tan(h_hipfire) / magnification` is the definition of linear magnification
 * for a perspective projection. Whether a given game's "4×" actually behaves that way is a
 * property of the game, which is why this is only reachable from a scope that declared
 * `tangent_magnification` under a closed register entry.
 */
export function halfFovForMagnification(
  hipfireHalfFovDegrees: number,
  magnification: number,
): number {
  if (!Number.isFinite(magnification) || magnification <= 0) {
    throw new RangeError(`magnification must be positive, received ${magnification}`);
  }
  return toDegrees(Math.atan(Math.tan(toRadians(hipfireHalfFovDegrees)) / magnification));
}

/**
 * Default matching criteria (doc 11 §11.6.3).
 *
 * These are `ASSUMPTION` and `TUNABLE`, they are labelled as opinions in the UI, and they
 * are user-overridable (FR-085) — because the criteria genuinely disagree and there is no
 * correct answer. At high magnification, edge-matching produces scoped aim most players find
 * unusably fast, which is the whole reason the ladder changes at 6×.
 */
export const DEFAULT_LOW_ZOOM_CRITERION: MatchCriterion = {
  kind: "monitor_distance",
  coefficient: 0.5,
};
export const DEFAULT_HIGH_ZOOM_CRITERION: MatchCriterion = { kind: "focal_length" };
export const HIGH_ZOOM_MAGNIFICATION_THRESHOLD = 6;

export function defaultCriterionForMagnification(
  magnification: number | undefined,
): MatchCriterion {
  if (magnification !== undefined && magnification >= HIGH_ZOOM_MAGNIFICATION_THRESHOLD) {
    return DEFAULT_HIGH_ZOOM_CRITERION;
  }
  return DEFAULT_LOW_ZOOM_CRITERION;
}

/**
 * The canonical target for a scope state, given the hipfire target.
 *
 * Returns counts/360 for the scope — not a game setting. Turning that into a setting is the
 * adapter's job, through the scope's own model, so that quantisation and range clamping
 * happen against the scope's own grid rather than the hipfire one.
 */
export function scopedTargetCounts(input: ScopedTargetInput): Result<ScopedTarget, ScopedRefusal> {
  if (!Number.isFinite(input.hipfireCounts) || input.hipfireCounts <= 0) {
    throw new RangeError(`hipfire counts/360 must be positive, received ${input.hipfireCounts}`);
  }

  if (input.adsModel === "unknown") {
    return err({ kind: "ads_model_unknown" });
  }

  if (input.adsModel === "internally_fov_scaled") {
    // The game performs its own FOV compensation. Applying the monitor-distance family on
    // top would double-count it, so the target is simply expressed in the game's own terms
    // (doc 11 §11.6.4) and the criterion is not consulted.
    return ok({
      countsPer360: input.hipfireCounts,
      conversionMethod: "direct",
      conversionCoefficient: null,
      criterion: null,
      scopeHalfFovDegrees: null,
    });
  }

  if (input.criterion.kind === "distance_360") {
    // Not a member of the monitor-distance family: physical distance for a full turn is held
    // identical, so no FOV information is needed and none is required of the caller.
    return ok({
      countsPer360: input.hipfireCounts,
      conversionMethod: "distance_360",
      conversionCoefficient: null,
      criterion: input.criterion,
      scopeHalfFovDegrees: null,
    });
  }

  const hipfireHalfFov = input.hipfireHalfFovDegrees;
  if (hipfireHalfFov === undefined) {
    return err({
      kind: "missing_fov_context",
      detail: "a FOV-matched criterion needs the player's hipfire half-FOV",
    });
  }
  if (input.optics === null) {
    return err({
      kind: "missing_fov_context",
      detail: "this scope has no verified optics description, so its FOV is unknown",
    });
  }

  const scopeHalfFov =
    input.optics.kind === "measured_half_fov"
      ? input.optics.halfFovDegrees
      : halfFovForMagnification(hipfireHalfFov, input.optics.magnification);

  const ratio = matchRatio(input.criterion, hipfireHalfFov, scopeHalfFov);

  return ok({
    countsPer360: input.hipfireCounts * ratio,
    conversionMethod: input.criterion.kind === "focal_length" ? "focal_length" : "monitor_distance",
    conversionCoefficient:
      input.criterion.kind === "monitor_distance" ? input.criterion.coefficient : null,
    criterion: input.criterion,
    scopeHalfFovDegrees: scopeHalfFov,
  });
}
