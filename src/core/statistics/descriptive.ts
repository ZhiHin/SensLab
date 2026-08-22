/**
 * Robust descriptive statistics.
 *
 * SensLab aggregates aiming data with medians and MAD rather than means and standard
 * deviations. This is not a stylistic preference: aiming distributions are right-skewed
 * with genuine heavy tails, and `SENS-BR-009` forbids deleting the outlying trials.
 * Robust *estimators* are what let us keep every trial and still get a stable estimate
 * (doc 10 §10.7, §10.8).
 */

/** Consistency factor making MAD an unbiased estimator of σ for normally distributed data. */
export const MAD_TO_SD = 1.4826;

/**
 * Bounds-checked element access. Cheap, and it turns an indexing bug into a loud failure.
 *
 * Accepts any indexable series so the same reducers work on a plain array and on the typed
 * arrays the engine's telemetry buffers hold, without copying a trial's worth of samples.
 */
export function el(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is out of range (length ${values.length})`);
  }
  return value;
}

function assertNonEmpty(values: ArrayLike<number>, fn: string): void {
  if (values.length === 0) throw new RangeError(`${fn}() requires at least one value`);
}

function assertAllFinite(values: ArrayLike<number>, fn: string): void {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(el(values, i))) {
      throw new RangeError(`${fn}() received a non-finite value at index ${i}`);
    }
  }
}

export function mean(values: ArrayLike<number>): number {
  assertNonEmpty(values, "mean");
  assertAllFinite(values, "mean");
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += el(values, i);
  return total / values.length;
}

export function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += el(values, i);
  return total;
}

/** Sample variance (Bessel-corrected). Returns 0 for a single observation. */
export function variance(values: ArrayLike<number>): number {
  assertNonEmpty(values, "variance");
  if (values.length === 1) return 0;
  const m = mean(values);
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = el(values, i) - m;
    acc += d * d;
  }
  return acc / (values.length - 1);
}

export function standardDeviation(values: ArrayLike<number>): number {
  return Math.sqrt(variance(values));
}

export function rootMeanSquare(values: ArrayLike<number>): number {
  assertNonEmpty(values, "rootMeanSquare");
  assertAllFinite(values, "rootMeanSquare");
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = el(values, i);
    acc += v * v;
  }
  return Math.sqrt(acc / values.length);
}

/**
 * Type-7 quantile (the R / NumPy default): linear interpolation between order statistics.
 * `p` is a probability in [0, 1].
 */
export function quantile(values: readonly number[], p: number): number {
  assertNonEmpty(values, "quantile");
  assertAllFinite(values, "quantile");
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile() requires 0 <= p <= 1, received ${p}`);

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return el(sorted, 0);

  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return el(sorted, lower);
  const weight = position - lower;
  return el(sorted, lower) * (1 - weight) + el(sorted, upper) * weight;
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/** Median absolute deviation from the median. */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  assertNonEmpty(values, "medianAbsoluteDeviation");
  const centre = median(values);
  const deviations = values.map((v) => Math.abs(v - centre));
  return median(deviations);
}

/** MAD scaled to be comparable with a standard deviation. */
export function robustStandardDeviation(values: readonly number[]): number {
  return MAD_TO_SD * medianAbsoluteDeviation(values);
}

/**
 * Robust coefficient of variation: robust SD divided by |median|.
 *
 * `medianFloor` guards the degenerate case where the median is at or near zero — without it,
 * a player whose median error happens to be ~0 would produce an unbounded CV.
 */
export function robustCoefficientOfVariation(
  values: readonly number[],
  medianFloor = 1e-9,
): number {
  assertNonEmpty(values, "robustCoefficientOfVariation");
  const centre = Math.abs(median(values));
  return robustStandardDeviation(values) / Math.max(centre, medianFloor);
}

/**
 * doc 10 §10.6 — consistency as a bounded 0..1 score, higher is better.
 * A perfectly repeatable player scores 1; variability drives it smoothly toward 0.
 */
export function consistencyScore(values: readonly number[], medianFloor = 1e-9): number {
  return 1 / (1 + robustCoefficientOfVariation(values, medianFloor));
}

export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  assertNonEmpty(values, "weightedMean");
  if (values.length !== weights.length) {
    throw new RangeError(
      `weightedMean() length mismatch: ${values.length} values, ${weights.length} weights`,
    );
  }
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = el(weights, i);
    if (w < 0) throw new RangeError(`weightedMean() received a negative weight at index ${i}`);
    numerator += el(values, i) * w;
    denominator += w;
  }
  if (denominator === 0) throw new RangeError("weightedMean() requires a non-zero total weight");
  return numerator / denominator;
}

/**
 * Time-weighted mean over samples that each represent an interval — used for tracking
 * metrics so that a frame hitch does not silently reweight the average (doc 10 §10.1).
 */
export function timeWeightedMean(values: readonly number[], durations: readonly number[]): number {
  return weightedMean(values, durations);
}
