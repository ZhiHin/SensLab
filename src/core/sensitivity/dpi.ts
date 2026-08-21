import { dpi as makeDpi, type CmPer360, type Dpi } from "../types/brand";
import type { DpiSource } from "../types/vocabulary";
import { CM_PER_INCH } from "./canonical";
import { DEFAULT_SENSITIVITY_DOMAIN, type SensitivityDomain } from "./domain";

/**
 * DPI estimation and plausibility checking (doc 11 §11.9).
 *
 * DPI is the weakest link in the chain: it is self-reported, frequently wrong, and every
 * converted game number scales linearly with it. SensLab cannot verify it from a browser.
 * What it *can* do is offer a measurement, cross-check the answer for internal consistency,
 * and be explicit about what a wrong DPI does and does not affect (`SENS-BR-005`).
 */

/** The most commonly configured value, offered as an explicit assumption — never a silent default. */
export const ASSUMED_DEFAULT_DPI = 800;

/**
 * Method A — in-browser ruler measurement.
 *
 * The user drags the mouse along a known physical distance while SensLab counts raw
 * counts. Requires raw (unadjusted) pointer movement to be in effect; with OS acceleration
 * in the path the count total is meaningless.
 *
 * Realistic accuracy is ±5–10%, which is enough to catch a *wrong* DPI (400 vs 1600) even
 * though it is not precise enough to replace a known value.
 */
export function dpiFromRulerSwipe(totalCounts: number, distanceCm: number): Dpi {
  if (!Number.isFinite(totalCounts) || totalCounts <= 0) {
    throw new RangeError(`counts must be positive, received ${totalCounts}`);
  }
  if (!Number.isFinite(distanceCm) || distanceCm <= 0) {
    throw new RangeError(`distance must be positive, received ${distanceCm}`);
  }
  return makeDpi((CM_PER_INCH * totalCounts) / distanceCm);
}

/** Median of repeated ruler swipes — three attempts is the specified protocol. */
export function dpiFromRulerSwipes(
  measurements: readonly { readonly counts: number; readonly distanceCm: number }[],
): Dpi {
  if (measurements.length === 0) {
    throw new RangeError("dpiFromRulerSwipes() requires at least one measurement");
  }
  const values = measurements
    .map((m) => dpiFromRulerSwipe(m.counts, m.distanceCm) as number)
    .sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return makeDpi(values[mid] as number);
  return makeDpi(((values[mid - 1] as number) + (values[mid] as number)) / 2);
}

/**
 * Method B — solve for DPI from a measured in-game 360 distance.
 *
 * Only usable when the game's model is verified; the caller supplies the counts/360 the
 * adapter computed for the user's stated setting. This function deliberately takes counts
 * rather than a game sensitivity so that it cannot become a back door into unverified
 * game constants.
 */
export function dpiFromMeasured360(countsPer360Value: number, measuredDistanceCm: number): Dpi {
  if (!Number.isFinite(countsPer360Value) || countsPer360Value <= 0) {
    throw new RangeError(`counts/360 must be positive, received ${countsPer360Value}`);
  }
  if (!Number.isFinite(measuredDistanceCm) || measuredDistanceCm <= 0) {
    throw new RangeError(`measured distance must be positive, received ${measuredDistanceCm}`);
  }
  return makeDpi((CM_PER_INCH * countsPer360Value) / measuredDistanceCm);
}

/* --------------------------------------------------------------- plausibility (Method C) */

export type DpiPlausibilityVerdict =
  | { readonly kind: "consistent" }
  | { readonly kind: "no_evidence" }
  | {
      readonly kind: "implausible_sensitivity";
      readonly impliedCmPer360: number;
      readonly domain: SensitivityDomain;
    }
  | {
      readonly kind: "exceeds_pad";
      readonly impliedCmPer360: number;
      readonly padWidthCm: number;
    }
  | {
      readonly kind: "conflicts_with_measured_swipe";
      readonly impliedCmPer360: number;
      readonly measuredSwipeCm: number;
      readonly ratio: number;
    };

export interface DpiPlausibilityInput {
  /**
   * cm/360 implied by the user's stated current sensitivity under their stated DPI.
   * Available only when the current game's adapter is verified.
   */
  readonly impliedCmPer360?: CmPer360 | number;
  readonly padWidthCm?: number;
  readonly measuredComfortableSwipeCm?: number;
  readonly domain?: SensitivityDomain;
}

/**
 * Warns; never blocks (FR-033).
 *
 * A DPI that is wrong by a factor of two produces an implied cm/360 that is wrong by a
 * factor of two, which usually lands outside the human-usable band or contradicts the
 * player's own measured reach. That is the signal this looks for.
 */
export function assessDpiPlausibility(input: DpiPlausibilityInput): DpiPlausibilityVerdict {
  const domain = input.domain ?? DEFAULT_SENSITIVITY_DOMAIN;
  const implied = input.impliedCmPer360;

  if (implied === undefined) return { kind: "no_evidence" };
  if (!Number.isFinite(implied) || implied <= 0) return { kind: "no_evidence" };

  if (implied < domain.minCmPer360 || implied > domain.maxCmPer360) {
    return { kind: "implausible_sensitivity", impliedCmPer360: implied, domain };
  }

  if (input.padWidthCm !== undefined && input.padWidthCm > 0 && implied > input.padWidthCm * 2) {
    return { kind: "exceeds_pad", impliedCmPer360: implied, padWidthCm: input.padWidthCm };
  }

  const swipe = input.measuredComfortableSwipeCm;
  if (swipe !== undefined && swipe > 0) {
    // A player's comfortable swipe should be within a reasonable factor of the distance
    // their own current sensitivity demands. A large mismatch is strong evidence of a
    // wrong DPI, and it is available before the recommendation is generated.
    const ratio = implied / swipe;
    if (ratio > 4 || ratio < 0.25) {
      return {
        kind: "conflicts_with_measured_swipe",
        impliedCmPer360: implied,
        measuredSwipeCm: swipe,
        ratio,
      };
    }
  }

  return { kind: "consistent" };
}

/**
 * doc 15 §15.5 — what a non-`known` DPI actually costs.
 *
 * Deliberately *not* folded into the confidence index: the measurement is in counts/360 and
 * is unaffected by DPI. Only the derived game numbers are affected, and a user with an
 * unknown DPI deserves to be told that their physical result is still fully trustworthy.
 */
export function settingsReliabilityForDpiSource(
  source: DpiSource,
): "normal" | "estimated_dpi" | "assumed_dpi" {
  switch (source) {
    case "known":
      return "normal";
    case "estimated":
      return "estimated_dpi";
    case "assumed":
      return "assumed_dpi";
  }
}
