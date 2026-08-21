import type { Rng } from "../random";
import { el } from "./descriptive";
import { bootstrapStandardError, percentileInterval, type Interval } from "./intervals";

/**
 * Seeded non-parametric bootstrap.
 *
 * doc 13 §13.9 requires that the *entire* estimation pipeline be re-run on each resample,
 * not just a summary statistic, so that every source of estimation uncertainty propagates
 * into the interval on the fitted optimum. This module therefore takes an arbitrary
 * statistic function rather than assuming a mean.
 *
 * Resampling is seeded (`SENS-BR-031`): the same session must always produce the same
 * interval, or the "recompute and get the identical answer" guarantee (`SENS-BR-030`) fails.
 */

export interface BootstrapOptions {
  readonly resamples: number;
  readonly rng: Rng;
  readonly level?: number;
}

export interface BootstrapOutcome {
  /** The statistic computed on the original sample. */
  readonly point: number;
  readonly standardError: number;
  readonly interval: Interval;
  /** Resample statistics, ascending. Retained so callers can draw a distribution. */
  readonly estimates: readonly number[];
  /** Resamples on which the statistic could not be computed (returned null). */
  readonly discarded: number;
}

export const DEFAULT_RESAMPLES = 2000;

/** Draws one resample of indices, with replacement. */
export function resampleIndices(size: number, rng: Rng): number[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`resampleIndices() requires a positive size, received ${size}`);
  }
  const indices = new Array<number>(size);
  for (let i = 0; i < size; i += 1) indices[i] = rng.nextInt(size);
  return indices;
}

/**
 * Bootstraps `statistic` over `samples`.
 *
 * `statistic` may return `null` to signal "not computable for this resample" — for example
 * a quadratic fit that came out convex. Those resamples are counted in `discarded` rather
 * than silently coerced, because the *proportion* of non-computable resamples is itself
 * evidence about how well-identified the estimate is.
 */
export function bootstrap<T>(
  samples: readonly T[],
  statistic: (resample: readonly T[]) => number | null,
  options: BootstrapOptions,
): BootstrapOutcome {
  const { resamples, rng, level = 0.9 } = options;
  if (samples.length === 0) throw new RangeError("bootstrap() requires a non-empty sample");
  if (!Number.isInteger(resamples) || resamples < 2) {
    throw new RangeError(`bootstrap() requires at least 2 resamples, received ${resamples}`);
  }

  const point = statistic(samples);
  if (point === null) {
    throw new RangeError("bootstrap() statistic returned null for the original sample");
  }

  const estimates: number[] = [];
  let discarded = 0;
  const buffer = new Array<T>(samples.length);

  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < samples.length; i += 1) {
      const index = rng.nextInt(samples.length);
      buffer[i] = samples[index] as T;
    }
    const value = statistic(buffer);
    if (value === null || !Number.isFinite(value)) discarded += 1;
    else estimates.push(value);
  }

  if (estimates.length < 2) {
    throw new RangeError(
      `bootstrap() produced only ${estimates.length} usable resamples out of ${resamples}`,
    );
  }

  estimates.sort((a, b) => a - b);

  return {
    point,
    standardError: bootstrapStandardError(estimates),
    interval: percentileInterval(estimates, point, level),
    estimates,
    discarded,
  };
}

/**
 * Paired bootstrap over matched observations — the analysis behind the validation test
 * (doc 17 §17.3). Pairs are resampled as units so the pairing is preserved.
 */
export interface MatchedPair {
  /** Value measured under the baseline condition (arm A). */
  readonly baseline: number;
  /** Value measured under the candidate condition (arm B). */
  readonly candidate: number;
}

export function pairedBootstrap(
  pairs: readonly MatchedPair[],
  options: BootstrapOptions,
): BootstrapOutcome {
  return bootstrap(
    pairs,
    (resample) => {
      if (resample.length === 0) return null;
      const deltas = resample.map((pair) => pair.candidate - pair.baseline);
      deltas.sort((a, b) => a - b);
      const mid = Math.floor(deltas.length / 2);
      return deltas.length % 2 === 1
        ? el(deltas, mid)
        : (el(deltas, mid - 1) + el(deltas, mid)) / 2;
    },
    options,
  );
}
