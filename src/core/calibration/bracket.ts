import type { CalibrationParams } from "../params";
import { countsPer360FromCm } from "../sensitivity/canonical";
import { logSensitivity, type LogSensitivity } from "../types/brand";
import type { ConstraintSource } from "../types/vocabulary";
import type { ParameterConstraint, SearchBracket } from "./contracts";

/**
 * The search domain, the physical constraint and the initial bracket (doc 13 §13.2–§13.4).
 *
 * ## Why log space
 *
 * The search variable is `x = log2(counts_per_360)`. Sensitivity is perceived and used
 * multiplicatively: the difference between 20 and 25 cm/360 is large, between 80 and 85
 * negligible. A linear search would waste evaluations at the slow end and skip resolution at the
 * fast end. In log space a fixed step is a fixed *percentage*, which is the psychophysically
 * meaningful unit — and it makes the response surface far closer to symmetric, which is exactly
 * what the quadratic fit assumes.
 *
 * Counts rather than centimetres, so the search does not move when a user corrects their DPI
 * (doc 11 §11.1).
 */

/** `x = log2(counts_per_360)`. */
export function toLogSensitivity(counts: number): LogSensitivity {
  if (!(counts > 0)) {
    throw new RangeError(`counts per 360° must be positive, received ${counts}`);
  }
  return logSensitivity(Math.log2(counts));
}

/** The inverse: `counts = 2^x`. */
export function toCountsPer360(x: LogSensitivity | number): number {
  return 2 ** (x as number);
}

/**
 * Domain bounds in log space.
 *
 * Counts and centimetres are **proportional**, not inverted: `cm/360 = 2.54 × counts / DPI`.
 * More counts means more hand travel, which is a *slower* sensitivity. So the domain's minimum
 * centimetres is its minimum x, and its maximum centimetres its maximum x.
 */
export function domainBounds(
  params: CalibrationParams,
  deviceDpi: number,
): { readonly low: LogSensitivity; readonly high: LogSensitivity } {
  const { min, max } = params.domainCmPer360;
  return {
    low: toLogSensitivity(countsPer360FromCm(min, deviceDpi)),
    high: toLogSensitivity(countsPer360FromCm(max, deviceDpi)),
  };
}

export interface ConstraintInput {
  /** Self-reported usable pad width, if the player gave one. */
  readonly padWidthCm: number | null;
  /** Median of three attempts from the 360 Comfort Test, in centimetres. */
  readonly comfortableSwipeCm: number | null;
}

/**
 * The physical constraint on the slow end (doc 13 §13.4).
 *
 * ```
 * usableSwipeCm = min( padWidthCm ?? ∞ , comfortableSwipeCm × κ )
 * maxCm360      = usableSwipeCm / ρ
 * ```
 *
 * `ρ = 0.55` encodes that a player does not need to execute a full 360° in one motion to be
 * comfortable — the common demand is a fast ~180° turn plus margin.
 *
 * **There is no constraint on the fast end**, because there is no physical barrier to a high
 * sensitivity — only a performance one, which the measurement itself detects.
 */
export function resolveConstraint(
  input: ConstraintInput,
  params: CalibrationParams,
): ParameterConstraint {
  const { rho, kappa } = params.constraint;
  const measured = input.comfortableSwipeCm === null ? null : input.comfortableSwipeCm * kappa;
  const declared = input.padWidthCm;

  if (measured === null && declared === null) {
    return { maxCmPer360: null, source: "none", conflict: false };
  }

  // A measured swipe that exceeds the declared pad by more than 20% is a disagreement, and the
  // *measured* value wins: a player may have desk space beyond the pad, or may have mismeasured.
  // The reverse — a pad much wider than the comfortable swipe — is not a conflict at all, since
  // the swipe is the binding limit either way.
  const conflict = measured !== null && declared !== null && measured > declared * 1.2;

  const usableSwipeCm =
    conflict || declared === null
      ? (measured ?? Infinity)
      : Math.min(declared, measured ?? Infinity);

  const source: ConstraintSource = conflict || measured !== null ? "measured" : "pad_width";

  return {
    maxCmPer360: usableSwipeCm / rho,
    source: Number.isFinite(usableSwipeCm) ? source : "none",
    conflict,
  };
}

/**
 * The constraint expressed as an **upper** bound on x, or null when unbounded.
 *
 * doc 13 §13.4 bounds the *low-sensitivity* end — the one that needs the most desk. A slower
 * sensitivity is more centimetres, which is more counts, which is a larger x. Getting this
 * direction wrong would cap the fast end instead and recommend the opposite of what the player
 * can physically execute.
 */
export function constraintHighBound(
  constraint: ParameterConstraint,
  deviceDpi: number,
): LogSensitivity | null {
  if (constraint.maxCmPer360 === null || !Number.isFinite(constraint.maxCmPer360)) return null;
  return toLogSensitivity(countsPer360FromCm(constraint.maxCmPer360, deviceDpi));
}

export interface BracketInput {
  readonly centre: LogSensitivity;
  readonly halfWidth: number;
  readonly domainLow: LogSensitivity;
  readonly domainHigh: LogSensitivity;
  /** Physical upper bound on x, if any — the slowest sensitivity the player can execute. */
  readonly constraintHigh: LogSensitivity | null;
}

/**
 * Clips a bracket to the admissible domain and the physical constraint.
 *
 * **Clipping re-centres rather than shrinks below the floor.** A bracket squeezed to nothing by
 * a bound would leave the search no room to move, so when clipping would make it narrower than
 * the floor the bracket slides inside the bounds at full width instead (doc 13 §13.3).
 */
export function clipBracket(input: BracketInput, minHalfWidth: number): SearchBracket {
  const hardLow = input.domainLow as number;
  const hardHigh = Math.min(
    input.domainHigh as number,
    input.constraintHigh === null ? Infinity : (input.constraintHigh as number),
  );

  // A constraint that swallows the whole domain leaves nothing to search; the caller decides
  // what to report, so the bracket collapses to the single admissible point.
  if (hardLow >= hardHigh) {
    const point = logSensitivity(hardLow);
    return { centre: point, halfWidth: 0, low: point, high: point };
  }

  const requested = Math.max(input.halfWidth, 0);
  const available = (hardHigh - hardLow) / 2;
  const halfWidth = Math.min(requested, available);

  // Slide the centre so the full-width bracket fits inside the bounds, rather than truncating
  // one side and leaving an asymmetric bracket the quadratic fit would read as biased.
  const centre = Math.min(
    Math.max(input.centre as number, hardLow + halfWidth),
    hardHigh - halfWidth,
  );

  const finalHalfWidth = Math.max(halfWidth, Math.min(minHalfWidth, available));
  const finalCentre = Math.min(
    Math.max(centre, hardLow + finalHalfWidth),
    hardHigh - finalHalfWidth,
  );

  return {
    centre: logSensitivity(finalCentre),
    halfWidth: finalHalfWidth,
    low: logSensitivity(finalCentre - finalHalfWidth),
    high: logSensitivity(finalCentre + finalHalfWidth),
  };
}

export type BracketAnchor =
  | { readonly kind: "current_sensitivity"; readonly countsPer360: number }
  | { readonly kind: "prior_recommendation"; readonly countsPer360: number }
  | { readonly kind: "cold_start" };

/**
 * The initial bracket (doc 13 §13.3).
 *
 * The half-width encodes how much is already known. A cold start gets the widest bracket
 * because the first round's job is localisation rather than refinement; a prior SensLab
 * recommendation gets the narrowest, because the search is resuming rather than starting.
 */
export function initialBracket(
  anchor: BracketAnchor,
  params: CalibrationParams,
  deviceDpi: number,
  constraint: ParameterConstraint,
): SearchBracket {
  const bounds = domainBounds(params, deviceDpi);
  const widths = params.initialHalfWidth;

  const centre =
    anchor.kind === "cold_start"
      ? toLogSensitivity(countsPer360FromCm(params.coldStartCentreCmPer360, deviceDpi))
      : toLogSensitivity(anchor.countsPer360);

  const halfWidth =
    anchor.kind === "cold_start"
      ? widths.coldStart
      : anchor.kind === "prior_recommendation"
        ? widths.priorRecommendation
        : widths.knownCurrentSensitivity;

  return clipBracket(
    {
      centre,
      halfWidth,
      domainLow: bounds.low,
      domainHigh: bounds.high,
      constraintHigh: constraintHighBound(constraint, deviceDpi),
    },
    params.narrowing.minHalfWidth,
  );
}

/** Builds a bracket from a centre and half-width without clipping. */
export function bracketOf(centre: number, halfWidth: number): SearchBracket {
  return {
    centre: logSensitivity(centre),
    halfWidth,
    low: logSensitivity(centre - halfWidth),
    high: logSensitivity(centre + halfWidth),
  };
}
