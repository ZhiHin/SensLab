import { getMetricDefinition } from "../../core/metrics";
import { deriveRng } from "../../core/random";
import {
  bootstrap,
  consistencyScore,
  DEFAULT_RESAMPLES,
  median,
  mean,
  robustStandardDeviation,
  rootMeanSquare,
  weightedMean,
  wilsonInterval,
} from "../../core/statistics";
import type { RoundAggregate, TrialRecord } from "../contracts";

/**
 * Trial → round aggregation (doc 10 §10.7).
 *
 * ## Median, not mean, for times and errors
 *
 * These distributions are right-skewed with occasional large values that are *genuine
 * performance events*, not measurement errors. Under a mean, one wild flick moves a candidate's
 * score more than ten good ones do. The median is the honest central estimator here — and
 * choosing it is what removes any temptation to trim, which matters because trimming is where
 * measurement products quietly become dishonest (doc 10 §10.8).
 *
 * ## Every value carries its sample count
 *
 * A metric value without `n_valid` is not storable — the schema enforces it, and this is where
 * the counts come from. An aggregate with no sample count cannot be weighted, compared or
 * doubted, which makes it worse than no aggregate at all.
 *
 * ## Uncertainty
 *
 * Rates get a Wilson interval, which stays correct at the small *n* a round actually has;
 * the normal approximation does not. Everything else gets a seeded bootstrap, so the interval
 * is reproducible from the session seed (`SENS-BR-031`).
 */

export type RoundMetricSummary = RoundAggregate["roundMetrics"][string];

export interface AggregationOptions {
  /** Seeds the bootstrap so an interval is reproducible from the session (`SENS-BR-031`). */
  readonly seed: string;
  readonly roundIndex: number;
  /**
   * The test's primary metric. `consistency` is computed from its trial values, because
   * "consistent" is only meaningful with respect to a specific quantity.
   */
  readonly primaryMetricKey?: string;
  readonly resamples?: number;
}

interface Entry {
  readonly value: number;
  /**
   * Weight for pooled aggregations. `hitAccuracy` is defined as total hits over total *shots*,
   * so a trial with five shots must count five times as much as a trial with one — otherwise
   * the round value is a mean of ratios, which is a different and wrong number.
   */
  readonly weight: number;
}

/**
 * Aggregates one round's trials into round-level metric summaries.
 *
 * Only `valid` and `degraded` trials contribute a value. Invalid trials are counted and
 * reported but never scored — they are procedurally unusable, which is a different thing from
 * being bad (`SENS-BR-009`).
 */
export function aggregateRound(
  trials: readonly TrialRecord[],
  options: AggregationOptions,
): Readonly<Record<string, RoundMetricSummary>> {
  const scored = trials.filter((trial) => !trial.isPractice && trial.validity !== "invalid");
  const validTrials = trials.filter(
    (trial) => trial.validity === "valid" && !trial.isPractice,
  ).length;
  const degradedTrials = trials.filter(
    (trial) => trial.validity === "degraded" && !trial.isPractice,
  ).length;
  const invalidTrials = trials.filter(
    (trial) => trial.validity === "invalid" && !trial.isPractice,
  ).length;

  const counts = { validTrials, invalidTrials, degradedTrials };
  const out: Record<string, RoundMetricSummary> = {};

  const byMetric = new Map<string, Entry[]>();
  for (const trial of scored) {
    for (const [key, value] of Object.entries(trial.metrics)) {
      if (!Number.isFinite(value)) continue;
      const entries = byMetric.get(key) ?? [];
      entries.push({ value, weight: key === "hitAccuracy" ? Math.max(1, trial.shots) : 1 });
      byMetric.set(key, entries);
    }
  }

  for (const [key, entries] of byMetric) {
    const summary = summarise(key, entries, counts, options);
    if (summary !== null) out[key] = summary;
  }

  const consistency = consistencyFor(byMetric, options.primaryMetricKey);
  if (consistency !== null) out["consistency"] = { ...consistency, ...counts };

  return out;
}

function summarise(
  key: string,
  entries: readonly Entry[],
  counts: { validTrials: number; invalidTrials: number; degradedTrials: number },
  options: AggregationOptions,
): RoundMetricSummary | null {
  if (entries.length === 0) return null;

  const values = entries.map((entry) => entry.value);
  const weights = entries.map((entry) => entry.weight);
  const aggregation = getMetricDefinition(key)?.aggregation ?? "median";

  const value = combine(aggregation, values, weights);
  if (!Number.isFinite(value)) return null;

  if (aggregation === "proportion") {
    // A proportion's uncertainty is binomial, and the Wilson interval is correct at the small
    // n a round actually has — the normal approximation is not, and would report intervals
    // that extend past 0 or 1.
    const successes = values.reduce((total, entry) => total + (entry >= 0.5 ? 1 : 0), 0);
    const interval = wilsonInterval(successes, values.length);
    return {
      value,
      ...counts,
      robustStandardDeviation: robustStandardDeviation(values),
      intervalLow: interval.low,
      intervalHigh: interval.high,
    };
  }

  const rng = deriveRng(options.seed, "bootstrap", options.roundIndex);
  const outcome =
    values.length >= 3
      ? bootstrap(values, (sample) => combine(aggregation, sample, undefined), {
          rng,
          resamples: options.resamples ?? DEFAULT_RESAMPLES,
        })
      : null;

  return {
    value,
    ...counts,
    robustStandardDeviation: robustStandardDeviation(values),
    // Below three trials a resampled interval would be a fiction: the bootstrap can only
    // resample the values it has, and with two of them it has nothing to say about spread.
    intervalLow: outcome?.interval.low ?? null,
    intervalHigh: outcome?.interval.high ?? null,
  };
}

function combine(
  aggregation: string,
  values: readonly number[],
  weights: readonly number[] | undefined,
): number {
  switch (aggregation) {
    case "median":
      return median(values);
    case "proportion":
    case "time_weighted_mean":
    case "mean":
      return weights === undefined ? mean(values) : weightedMean(values, weights);
    case "rms":
      return rootMeanSquare(values);
    default:
      return median(values);
  }
}

/**
 * Consistency, computed from the trial values of the test's primary metric.
 *
 * Robust by construction: a single wild trial would dominate a plain standard deviation, and
 * wild trials in aiming data are both common and legitimate. Since they must not be deleted
 * (`SENS-BR-009`), the statistic has to tolerate them instead.
 */
function consistencyFor(
  byMetric: ReadonlyMap<string, readonly Entry[]>,
  primaryMetricKey: string | undefined,
): Omit<RoundMetricSummary, "validTrials" | "invalidTrials" | "degradedTrials"> | null {
  if (primaryMetricKey === undefined) return null;
  const entries = byMetric.get(primaryMetricKey);
  if (entries === undefined || entries.length < 2) return null;

  const values = entries.map((entry) => entry.value);
  return {
    value: consistencyScore(values),
    robustStandardDeviation: robustStandardDeviation(values),
    intervalLow: null,
    intervalHigh: null,
  };
}
