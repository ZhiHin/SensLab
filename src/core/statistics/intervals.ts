import { el, quantile } from "./descriptive";

/**
 * Interval estimation.
 *
 * Every aggregate SensLab reports carries an uncertainty estimate — a value without one
 * is not storable (doc 10 §10.10). Proportions use Wilson rather than the normal
 * approximation because our sample sizes are small enough that the normal approximation
 * misbehaves near 0 and 1, which is exactly where accuracy rates live.
 */

export interface Interval {
  readonly low: number;
  readonly point: number;
  readonly high: number;
  /** Two-sided coverage level, e.g. 0.90. */
  readonly level: number;
}

/* Acklam's rational approximation to the inverse standard normal CDF.
 * Relative accuracy ~1.15e-9 across the full range, which is far beyond what any
 * confidence figure in this product needs. */
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
] as const;
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
] as const;
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
] as const;
const D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
] as const;

const P_LOW = 0.02425;
const P_HIGH = 1 - P_LOW;

/** Inverse CDF of the standard normal distribution. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`normalQuantile() requires 0 < p < 1, received ${p}`);
  }

  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }

  if (p > P_HIGH) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/** Two-sided critical z value for a coverage level, e.g. 0.90 → 1.6449. */
export function zForLevel(level: number): number {
  if (!(level > 0 && level < 1)) {
    throw new RangeError(`zForLevel() requires 0 < level < 1, received ${level}`);
  }
  return normalQuantile(1 - (1 - level) / 2);
}

/**
 * Wilson score interval for a binomial proportion (doc 10 §10.7).
 *
 * The point estimate returned is the raw proportion, not the Wilson centre: the reported
 * accuracy should be the accuracy that was observed. The interval carries the uncertainty.
 */
export function wilsonInterval(successes: number, trials: number, level = 0.9): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new RangeError("wilsonInterval() requires integer counts");
  }
  if (trials <= 0) throw new RangeError("wilsonInterval() requires at least one trial");
  if (successes < 0 || successes > trials) {
    throw new RangeError(`wilsonInterval() received ${successes} successes in ${trials} trials`);
  }

  const z = zForLevel(level);
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  return {
    low: Math.max(0, centre - margin),
    point: p,
    high: Math.min(1, centre + margin),
    level,
  };
}

/**
 * Percentile interval over a set of resampled statistics (doc 13 §13.9).
 * `point` is supplied separately because the bootstrap point estimate is the statistic of
 * the original sample, not the mean of the resamples.
 */
export function percentileInterval(
  samples: readonly number[],
  point: number,
  level = 0.9,
): Interval {
  if (samples.length === 0) throw new RangeError("percentileInterval() requires samples");
  if (!(level > 0 && level < 1)) {
    throw new RangeError(`percentileInterval() requires 0 < level < 1, received ${level}`);
  }
  const tail = (1 - level) / 2;
  return {
    low: quantile(samples, tail),
    point,
    high: quantile(samples, 1 - tail),
    level,
  };
}

/** Does an interval exclude zero? The test behind `SENS-BR-016`. */
export function excludesZero(interval: Interval): boolean {
  return (interval.low > 0 && interval.high > 0) || (interval.low < 0 && interval.high < 0);
}

/** Do two intervals overlap? The conservative comparability test in doc 17 §17.9. */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.low <= b.high && b.low <= a.high;
}

/** Standard error of a set of resampled statistics. */
export function bootstrapStandardError(samples: readonly number[]): number {
  if (samples.length < 2) {
    throw new RangeError("bootstrapStandardError() requires at least two resamples");
  }
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) total += el(samples, i);
  const m = total / samples.length;
  let acc = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const d = el(samples, i) - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (samples.length - 1));
}
