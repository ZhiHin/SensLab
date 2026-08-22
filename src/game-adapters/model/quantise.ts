import { CM_PER_INCH } from "../../core/sensitivity/canonical";

/**
 * Setting quantisation (doc 11 §11.4).
 *
 * A game exposes sensitivity on a finite grid. The ideal setting almost never lands on it,
 * so the number the player can actually type produces a slightly different cm/360 than the
 * one they were recommended. Doc 11 calls skipping that recomputation "a common and
 * avoidable dishonesty in existing converters", and it is: the difference is usually
 * negligible, but on a coarse slider it is not, and only the converter knows.
 *
 * So every conversion reports the **achieved** value, recomputed from the quantised setting
 * through the same model — never the ideal one dressed up as an outcome.
 */

export interface SettingRangeSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
}

export function assertSettingRange(range: SettingRangeSpec): void {
  const { min, max, step, decimals } = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) {
    throw new RangeError(`setting range must satisfy 0 < min < max, received [${min}, ${max}]`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError(`setting step must be positive, received ${step}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new RangeError(`setting decimals must be an integer in [0, 10], received ${decimals}`);
  }
}

/**
 * Rounds onto the game's grid.
 *
 * The `toFixed` pass is not cosmetic: `Math.round(1.15 / 0.01) * 0.01` is
 * 1.1500000000000001, and a value the user copies must be one the game's own parser accepts
 * at the declared precision.
 */
export function quantiseToStep(value: number, range: SettingRangeSpec): number {
  return Number((Math.round(value / range.step) * range.step).toFixed(range.decimals));
}

/** True when a user-entered value already sits on the grid. */
export function isOnStep(value: number, range: SettingRangeSpec): boolean {
  const steps = value / range.step;
  return Math.abs(steps - Math.round(steps)) <= 1e-9;
}

export interface QuantisedSetting {
  /** The unclamped, unquantised value. Diagnostics only; never displayed on its own. */
  readonly idealValue: number;
  /** What the player types in. */
  readonly value: number;
  /**
   * True when the ideal fell outside the game's range. It means the recommendation is not
   * achievable at this DPI, which is a fact about their hardware, not a rounding detail —
   * so it is reported rather than folded into the quantisation error.
   */
  readonly clamped: boolean;
}

export function quantiseSetting(idealValue: number, range: SettingRangeSpec): QuantisedSetting {
  const bounded = Math.min(Math.max(idealValue, range.min), range.max);
  const clamped = bounded !== idealValue;
  // Rounding can push a value one step past the boundary; clamp again on the grid so the
  // emitted number is always one the game will accept.
  const quantised = Math.min(Math.max(quantiseToStep(bounded, range), range.min), range.max);
  return { idealValue, value: quantised, clamped };
}

/** Signed percentage by which the achieved sensitivity differs from the requested one. */
export function quantisationErrorPct(achievedCounts: number, requestedCounts: number): number {
  if (!Number.isFinite(requestedCounts) || requestedCounts <= 0) {
    throw new RangeError(`requested counts/360 must be positive, received ${requestedCounts}`);
  }
  return ((achievedCounts - requestedCounts) / requestedCounts) * 100;
}

/**
 * Above this, the grid is coarse enough that the user deserves a suggestion rather than a
 * footnote (doc 11 §11.4 step 5). `TUNABLE`.
 */
export const DEFAULT_QUANTISATION_WARNING_PCT = 1.5;

export interface DpiSuggestion {
  /** A DPI at which one of the game's achievable settings hits the target exactly. */
  readonly dpi: number;
  /** The setting that becomes exact at that DPI. */
  readonly settingValue: number;
}

/**
 * Suggests a DPI that lands on the grid.
 *
 * The algebra is one line: a setting `s` produces `C(s)` counts per 360, and
 * `cm/360 = 2.54 × C(s) / DPI`, so the DPI that makes `s` exactly right for a target cm/360
 * is `2.54 × C(s) / cm_target`. Evaluating that for the achievable settings on either side of
 * the ideal gives real candidates, and the one nearest the user's current DPI is the smallest
 * change that removes the error entirely.
 *
 * Returns `null` when no candidate is closer than `maxRelativeDpiChange` — a suggestion that
 * asks someone to halve their DPI is not a suggestion, it is a different recommendation.
 */
export function suggestDpiForGrid(input: {
  readonly targetCmPer360: number;
  readonly currentDpi: number;
  /** Achievable settings and the counts/360 each produces, from the adapter's own model. */
  readonly candidates: readonly { readonly settingValue: number; readonly counts: number }[];
  readonly maxRelativeDpiChange?: number;
}): DpiSuggestion | null {
  const limit = input.maxRelativeDpiChange ?? 0.25;
  if (!Number.isFinite(input.targetCmPer360) || input.targetCmPer360 <= 0) return null;
  if (!Number.isFinite(input.currentDpi) || input.currentDpi <= 0) return null;

  let best: DpiSuggestion | null = null;
  let bestDistance = Infinity;

  for (const candidate of input.candidates) {
    if (!Number.isFinite(candidate.counts) || candidate.counts <= 0) continue;
    const dpi = Math.round((CM_PER_INCH * candidate.counts) / input.targetCmPer360);
    if (dpi <= 0) continue;
    const relative = Math.abs(dpi - input.currentDpi) / input.currentDpi;
    if (relative > limit || relative === 0) continue;
    if (relative < bestDistance) {
      bestDistance = relative;
      best = { dpi, settingValue: candidate.settingValue };
    }
  }

  return best;
}
