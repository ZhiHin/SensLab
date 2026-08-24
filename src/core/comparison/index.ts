import { zForLevel } from "../statistics";
import type { DimensionKey } from "../types/vocabulary";

/**
 * Session comparison (doc 17 §17.9, FR-093, FR-095, `SENS-BR-019`).
 *
 * ## Two numbers from different setups are not a trend
 *
 * Before anything is compared, the two sessions are checked for **comparability**: hardware
 * profile, DPI, environment class, session mode and every algorithm version must match. Any
 * mismatch produces a flagged comparison that names specifically what differed — not a refusal
 * to show the numbers, but a refusal to let them read as a change in the player.
 *
 * ## The conservative rule
 *
 * A change is called **meaningful** only when the two high-performance ranges do not overlap:
 *
 * ```
 *   meaningful  ⟺  a.high < b.low  or  b.high < a.low
 * ```
 *
 * Non-overlap of two 90% intervals is a *stricter* criterion than a formal test of the
 * difference — roughly, it demands about a 99% separation. That is deliberate. The failure
 * mode this guards against is a fabricated progress narrative: telling a player they have
 * improved when the measurement cannot support it would be the single most tempting dishonesty
 * in the product, so the rule errs toward saying nothing changed.
 *
 * ## Dimension deltas
 *
 * Doc 17 requires each dimension delta to be labelled meaningful or within-noise but does not
 * give the rule. The dimension score is `centre + perSigma · z̄` over `n` contributing trials
 * (doc 14 §14.4), so the standard error of the displayed score is `perSigma / √n` **provided
 * the standardised per-trial score has unit spread** — which is what the z-scale is
 * constructed to give. The difference of two independent sessions' scores therefore has
 * standard error `√(SEa² + SEb²)`, and a delta is meaningful when its interval at the
 * session's own level excludes zero.
 *
 * `ASSUMPTION` — the unit-spread premise is a property of the reference scale, not something
 * measured per session. It is stated here rather than buried, and it makes the threshold an
 * approximation. It errs toward *not* calling a change, because the dimension score pools
 * several metrics and pooling reduces spread below the nominal unit.
 */

export type ComparabilityDifference =
  | "hardware_profile"
  | "dpi"
  | "environment_class"
  | "mode"
  | "scoring_version"
  | "calibration_version"
  | "confidence_version";

export interface ComparabilityInput {
  readonly hardwareProfileId: string | null;
  readonly dpi: number;
  readonly environmentClass: string;
  readonly mode: string;
  readonly scoringVersion: string;
  readonly calibrationVersion: string;
  readonly confidenceVersion: string;
}

export interface Comparability {
  readonly comparable: boolean;
  /** What differed, in the order doc 17 §17.9 lists it. Empty when comparable. */
  readonly differences: readonly ComparabilityDifference[];
}

export function comparability(a: ComparabilityInput, b: ComparabilityInput): Comparability {
  const differences: ComparabilityDifference[] = [];
  // A null profile is an ad-hoc snapshot, and two ad-hoc snapshots are not known to be the
  // same hardware — "unknown" is a difference, not a match.
  if (a.hardwareProfileId === null || b.hardwareProfileId === null) {
    if (a.hardwareProfileId !== b.hardwareProfileId || a.hardwareProfileId === null) {
      differences.push("hardware_profile");
    }
  } else if (a.hardwareProfileId !== b.hardwareProfileId) {
    differences.push("hardware_profile");
  }
  if (a.dpi !== b.dpi) differences.push("dpi");
  if (a.environmentClass !== b.environmentClass) differences.push("environment_class");
  if (a.mode !== b.mode) differences.push("mode");
  if (a.scoringVersion !== b.scoringVersion) differences.push("scoring_version");
  if (a.calibrationVersion !== b.calibrationVersion) differences.push("calibration_version");
  if (a.confidenceVersion !== b.confidenceVersion) differences.push("confidence_version");
  return { comparable: differences.length === 0, differences };
}

/* ------------------------------------------------------------------ the headline change */

export type ChangeVerdict =
  | "meaningful"
  | "within_noise"
  /** One side has no point recommendation, so there is no change to speak of. */
  | "not_available";

export interface Range {
  readonly low: number;
  readonly high: number;
}

export interface RecommendationChange {
  readonly verdict: ChangeVerdict;
  readonly fromCm360: number | null;
  readonly toCm360: number | null;
  /** Signed relative change, in percent. Null when either side has no point value. */
  readonly percent: number | null;
  readonly direction: "slower" | "faster" | "unchanged" | null;
}

export function recommendationChange(
  a: { readonly cm360: number | null; readonly range: Range | null },
  b: { readonly cm360: number | null; readonly range: Range | null },
): RecommendationChange {
  if (a.cm360 === null || b.cm360 === null) {
    return {
      verdict: "not_available",
      fromCm360: a.cm360,
      toCm360: b.cm360,
      percent: null,
      direction: null,
    };
  }

  const percent = ((b.cm360 - a.cm360) / a.cm360) * 100;
  const direction = percent > 0 ? "slower" : percent < 0 ? "faster" : "unchanged";
  const verdict: ChangeVerdict =
    a.range !== null && b.range !== null && !rangesOverlap(a.range, b.range)
      ? "meaningful"
      : "within_noise";

  return { verdict, fromCm360: a.cm360, toCm360: b.cm360, percent, direction };
}

/** Closed-interval overlap: touching ranges overlap, which keeps the rule conservative. */
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.low <= b.high && b.low <= a.high;
}

/* ------------------------------------------------------------------ dimensions */

export interface DimensionSample {
  readonly dimension: DimensionKey;
  /** Null when the session did not score the dimension. */
  readonly score: number | null;
  readonly n: number;
  readonly provisional: boolean;
}

export interface DimensionChange {
  readonly dimension: DimensionKey;
  readonly from: number | null;
  readonly to: number | null;
  readonly delta: number | null;
  /** Half-width of the interval on the delta, at the given level. */
  readonly tolerance: number | null;
  readonly meaningful: boolean;
  /** Either side was scored against a provisional reference. */
  readonly provisional: boolean;
}

export interface DimensionChangeOptions {
  /** Display scale of the dimension score (doc 14 §14.4). */
  readonly perSigma: number;
  /** Two-sided level for the delta's interval. */
  readonly level: number;
}

export function dimensionChanges(
  a: readonly DimensionSample[],
  b: readonly DimensionSample[],
  options: DimensionChangeOptions,
): readonly DimensionChange[] {
  const byKey = new Map(b.map((sample) => [sample.dimension, sample]));
  const z = zForLevel(options.level);

  return a.map((from) => {
    const to = byKey.get(from.dimension);
    const provisional = from.provisional || (to?.provisional ?? false);
    if (from.score === null || to === undefined || to.score === null) {
      return {
        dimension: from.dimension,
        from: from.score,
        to: to?.score ?? null,
        delta: null,
        tolerance: null,
        meaningful: false,
        provisional,
      };
    }

    const standardError = (count: number): number =>
      count > 0 ? options.perSigma / Math.sqrt(count) : Number.POSITIVE_INFINITY;
    const tolerance = z * Math.hypot(standardError(from.n), standardError(to.n));
    const delta = to.score - from.score;

    return {
      dimension: from.dimension,
      from: from.score,
      to: to.score,
      delta,
      tolerance: Number.isFinite(tolerance) ? tolerance : null,
      meaningful: Number.isFinite(tolerance) && Math.abs(delta) > tolerance,
      provisional,
    };
  });
}
