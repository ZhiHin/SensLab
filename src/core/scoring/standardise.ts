import { getMetricDefinition } from "../metrics";
import { median, medianAbsoluteDeviation, MAD_TO_SD } from "../statistics";
import type { ScopeKey, TestKey, TrialValidity } from "../types/vocabulary";

/**
 * Direction alignment, robust standardisation and bounded influence (doc 14 §14.2–§14.3).
 *
 * ## Why within-session
 *
 * Metrics are standardised against **the player's own session-wide distribution**, pooling every
 * candidate and round. Standardising within a candidate would remove exactly the
 * between-candidate differences the whole product exists to measure. This normalisation never
 * touches the cross-player reference distribution, which is why the calibration decision is
 * fully valid on day one even though the display scores are provisional (doc 14 §14.4).
 *
 * ## Why robust, and why clipping is not trimming
 *
 * Aiming data has genuine heavy tails, and `SENS-BR-009` forbids deleting a trial for its
 * result. Median and MAD tolerate outliers without removing them. The soft clip
 * `k·tanh(z/k)` then bounds any single trial's leverage while remaining smooth, monotone and
 * invertible: **no trial is removed and every trial still moves the estimate.** That is what
 * reconciles "never delete a bad trial" with "one catastrophic trial must not decide the
 * recommendation".
 */

/** One trial as the scoring pipeline sees it. */
export interface ObservedTrial {
  readonly testKey: TestKey;
  readonly candidateIndex: number;
  readonly roundIndex: number;
  /** Global block index — the time axis the drift model is fitted against. */
  readonly blockIndex: number;
  readonly trialIndex: number;
  readonly validity: TrialValidity;
  readonly isPractice: boolean;
  /**
   * The scope state the round ran under (doc 09 §9.13).
   *
   * A scoring track is per scope: a trial measured through a 4× view says nothing about the
   * hipfire sensitivity, and the two must never be pooled. Defaults to hipfire for callers
   * predating Phase 6.
   */
  readonly scopeKey?: ScopeKey;
  /** What the trial presented, where the test has more than one kind of trial. */
  readonly variant?: string | null;
  readonly metrics: Readonly<Record<string, number>>;
}

/** Robust centre and scale for one (test, metric) pair across the session. */
export interface MetricScale {
  readonly testKey: TestKey;
  readonly metricKey: string;
  readonly centre: number;
  readonly scale: number;
  readonly sampleCount: number;
  /** True when the scale came from the floor rather than from the data. */
  readonly flooredScale: boolean;
  /** True when the binomial scale was used instead of the MAD. */
  readonly binary: boolean;
}

export interface StandardiseOptions {
  /** Per-metric minimum scale, preventing an unusually consistent player exploding their z. */
  readonly robustScaleFloors: Readonly<Record<string, number>>;
  /** Soft-clip constant for `k·tanh(z/k)`. */
  readonly clipConstant: number;
}

/** Default floor for a metric with no declared one. Small, but never zero. */
const FALLBACK_SCALE_FLOOR = 1e-6;
/** Minimum binomial variance, so a metric that never varied does not divide by zero. */
const MIN_BINOMIAL_VARIANCE = 0.02;

/**
 * Turns a metric into a goodness orientation (doc 14 §14.2).
 *
 * After this point higher is better everywhere, without exception — which removes an entire
 * class of sign bug, because no later stage has to remember a metric's direction.
 */
export function alignDirection(metricKey: string, value: number): number {
  const definition = getMetricDefinition(metricKey);
  // An unknown metric cannot be aligned. It also cannot be stored, so this is unreachable in
  // practice; leaving it unflipped rather than guessing keeps the failure visible.
  if (definition === undefined) return value;
  return definition.direction === "lower_better" ? -value : value;
}

/** True for metrics that are per-trial indicators rather than continuous quantities. */
function isBinaryMetric(metricKey: string): boolean {
  // Aggregated as a proportion *and* observed per trial as 0 or 1: hit, first-shot hit,
  // overshoot, undershoot. Their spread is binomial, not a MAD (doc 14 §14.3).
  return getMetricDefinition(metricKey)?.aggregation === "proportion";
}

/**
 * Trials that may enter the estimator: measured, not practice, not procedurally invalid.
 *
 * Two Phase 6 exclusions, both documented interactions rather than performance filters:
 *
 *  - A slide whose required travel exceeded the player's measured reach (`pathTruncated`) is
 *    excluded from tracking scoring and retained as evidence for the constraint model
 *    (doc 09 §9.10). The trial is stored; it simply is not a measurement of tracking.
 *  - A hipfire *control* trial inside a scoped round measures the hipfire state, not the
 *    scope. It exists for the transition metric and is excluded from the scope's track.
 */
export function scorableTrials(
  trials: readonly ObservedTrial[],
  scopeKey: ScopeKey = "hipfire",
): readonly ObservedTrial[] {
  return trials.filter((trial) => {
    if (trial.isPractice || trial.validity === "invalid") return false;
    if ((trial.scopeKey ?? "hipfire") !== scopeKey) return false;
    if (scopeKey !== "hipfire" && trial.variant === "hipfire") return false;
    if ((trial.metrics.pathTruncated ?? 0) >= 1) return false;
    return true;
  });
}

/**
 * Computes the robust scale for every (test, metric) pair present in the session.
 *
 * Scales are per *test* as well as per metric because the same metric means different things at
 * different target sizes: a flick trial's `pathEfficiency` and a micro trial's are not drawn
 * from the same distribution, and pooling them would flatten both.
 */
export function computeScales(
  trials: readonly ObservedTrial[],
  options: StandardiseOptions,
  scopeKey: ScopeKey = "hipfire",
): readonly MetricScale[] {
  const grouped = new Map<string, { testKey: TestKey; metricKey: string; values: number[] }>();

  for (const trial of scorableTrials(trials, scopeKey)) {
    for (const [metricKey, raw] of Object.entries(trial.metrics)) {
      if (!Number.isFinite(raw)) continue;
      const key = `${trial.testKey}::${metricKey}`;
      const entry = grouped.get(key) ?? { testKey: trial.testKey, metricKey, values: [] };
      entry.values.push(alignDirection(metricKey, raw));
      grouped.set(key, entry);
    }
  }

  const scales: MetricScale[] = [];
  for (const entry of grouped.values()) {
    const floor = options.robustScaleFloors[entry.metricKey] ?? FALLBACK_SCALE_FLOOR;

    if (isBinaryMetric(entry.metricKey)) {
      // Direction alignment may have negated the indicator, so the proportion is taken of the
      // aligned values' distance from their own mean — which is the same binomial scale.
      const mean = entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length;
      const variance = Math.max(Math.abs(mean) * (1 - Math.abs(mean)), MIN_BINOMIAL_VARIANCE);
      scales.push({
        testKey: entry.testKey,
        metricKey: entry.metricKey,
        centre: mean,
        scale: Math.sqrt(variance),
        sampleCount: entry.values.length,
        flooredScale: false,
        binary: true,
      });
      continue;
    }

    const centre = median(entry.values);
    const robust = MAD_TO_SD * medianAbsoluteDeviation(entry.values);
    const scale = Math.max(robust, floor);

    scales.push({
      testKey: entry.testKey,
      metricKey: entry.metricKey,
      centre,
      scale,
      sampleCount: entry.values.length,
      flooredScale: scale > robust,
      binary: false,
    });
  }

  return scales;
}

/** Indexes scales for lookup by (test, metric). */
export function indexScales(scales: readonly MetricScale[]): ReadonlyMap<string, MetricScale> {
  return new Map(scales.map((scale) => [`${scale.testKey}::${scale.metricKey}`, scale]));
}

/**
 * The bounded-influence soft clip: `k · tanh(z / k)`.
 *
 * Smooth, monotone and invertible. It limits leverage to ±k without removing anything, which
 * is the whole point — a trimmed trial is a deleted trial by another name.
 */
export function softClip(z: number, k: number): number {
  if (!(k > 0)) throw new RangeError(`clip constant must be positive, received ${k}`);
  return k * Math.tanh(z / k);
}

/** Standardises one metric observation against the session scale, and clips it. */
export function standardiseValue(
  scale: MetricScale,
  rawValue: number,
  clipConstant: number,
): number {
  const aligned = alignDirection(scale.metricKey, rawValue);
  return softClip((aligned - scale.centre) / scale.scale, clipConstant);
}
