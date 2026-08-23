import { getMetricDefinition } from "../metrics/registry";
import type { ReferenceDistributionParams } from "../params/reference-dist-provisional-v1";
import type { DimensionScore, ScoringParameters } from "../scoring/contracts";
import { scorableTrials, type ObservedTrial } from "../scoring/standardise";
import { median, medianAbsoluteDeviation, MAD_TO_SD } from "../statistics";
import type { ScopeKey, TestKey } from "../types/vocabulary";

/**
 * The six skill dimensions (doc 14 §14.4–§14.5).
 *
 * ## Two different normalisations, never conflated
 *
 * The calibration objective standardises *within the session* and is fully valid on day one.
 * The **display** score below standardises against a cross-player reference distribution —
 * and SensLab has no population data. The reference is therefore provisional, every score
 * produced here carries `provisional: true`, the UI says so, and **no percentile is shown**: a
 * percentile against an invented distribution is a lie with a number attached (doc 14 §14.4).
 *
 * What is *not* provisional is the **shape** — each dimension relative to the player's own
 * mean, in their own spread units. That is a within-session quantity, it drives the aim
 * profile, and it stays valid whatever the reference turns out to be.
 *
 * ```
 * z_ref          = (session median of metric − reference mean) / reference SD, direction-aligned
 * dimension z    = Σ w · z_ref / Σ w         over the weights whose metric was measured
 * score_display  = clamp(50 + 12.5 × z, 1, 99)
 * ```
 */

/**
 * `ASSUMPTION` (`TUNABLE`) — trials a dimension needs before its score is more than noise.
 *
 * Doc 16 §16.5 rule 0 says "fewer than 4 dimensions have sufficient samples" without defining
 * sufficient. Eight distinct trials is the smallest per-candidate sample any scored test
 * declares (doc 09 §9.8), so a dimension fed by fewer than that has not seen one full round.
 */
export const MIN_TRIALS_PER_DIMENSION = 8;

/** `ASSUMPTION` (`TUNABLE`) — floor on the player's own spread (doc 16 §16.5). */
export const SHAPE_SPREAD_FLOOR = 3;

export interface DimensionOutcome extends DimensionScore {
  /** The per-metric contributions, for the breakdown UI. */
  readonly contributions: readonly {
    readonly metricKey: string;
    readonly fromTests: readonly TestKey[];
    readonly weight: number;
    readonly sessionMedian: number;
    readonly zReference: number;
    readonly trials: number;
  }[];
  /** True when enough trials fed the dimension for its score to be reported. */
  readonly sufficient: boolean;
}

export interface DimensionInputs {
  readonly trials: readonly ObservedTrial[];
  readonly scoring: ScoringParameters;
  readonly reference: ReferenceDistributionParams;
  readonly scopeKey?: ScopeKey;
}

/**
 * The session-level `consistency` value per test (doc 10 §10.6).
 *
 * Consistency is aggregated per test from the trial values of that test's primary metric —
 * it is not a per-trial metric. The dimension weights reference it by key, so it is computed
 * here from the trial-level values rather than read from a trial.
 */
function consistencyFor(
  trials: readonly ObservedTrial[],
  primaryMetricKey: string,
): { value: number; trials: number } | null {
  const values = trials
    .map((trial) => trial.metrics[primaryMetricKey])
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (values.length < 3) return null;
  const centre = median(values);
  if (centre === 0) return null;
  const rcv = (MAD_TO_SD * medianAbsoluteDeviation(values)) / Math.abs(centre);
  return { value: 1 / (1 + rcv), trials: values.length };
}

/**
 * Each test's primary metric, for the consistency computation.
 *
 * Kept here rather than imported from the engine because `core/` is the bottom of the
 * dependency graph (doc 18 §18.5). The table mirrors the `primaryMetricKey` each definition
 * declares, and a test asserts the two agree.
 */
export const PRIMARY_METRIC_BY_TEST: Readonly<Partial<Record<TestKey, string>>> = {
  flick: "adjustedAcquisitionTime",
  micro: "microAdjustmentError",
  tracking: "trackingError",
  switching: "switchingTravelTime",
  precision: "flickErrorNorm",
  "wide-flick": "adjustedAcquisitionTime",
  "strafe-tracking": "trackingError",
  "slide-tracking": "peakSpeedTrackingError",
  speed: "adjustedAcquisitionTime",
  recoil: "recoilDeviationVertical",
  ads: "adjustedAcquisitionTime",
};

export function computeDimensionScores(inputs: DimensionInputs): readonly DimensionOutcome[] {
  const { scoring, reference } = inputs;
  const trials = scorableTrials(inputs.trials, inputs.scopeKey ?? "hipfire");
  const referenceByKey = new Map(
    reference.statistics.map((statistic) => [statistic.metricKey, statistic]),
  );
  const scaling = scoring.displayScaling;

  return scoring.dimensions.map((dimension) => {
    const contributions: DimensionOutcome["contributions"][number][] = [];
    const contributingTrials = new Set<string>();

    for (const weight of dimension.weights) {
      const fromTests = new Set<TestKey>(weight.fromTests);
      const subset = trials.filter((trial) => fromTests.has(trial.testKey));
      const statistic = referenceByKey.get(weight.metricKey);
      if (statistic === undefined || subset.length === 0) continue;

      let sessionMedian: number;
      let count: number;

      if (weight.metricKey === "consistency") {
        // One consistency value per test, then the median across the tests in the weight.
        const perTest: number[] = [];
        count = 0;
        for (const testKey of fromTests) {
          const primary = PRIMARY_METRIC_BY_TEST[testKey];
          if (primary === undefined) continue;
          const own = subset.filter((trial) => trial.testKey === testKey);
          const result = consistencyFor(own, primary);
          if (result === null) continue;
          perTest.push(result.value);
          count += result.trials;
          for (const trial of own) contributingTrials.add(trialKey(trial));
        }
        if (perTest.length === 0) continue;
        sessionMedian = median(perTest);
      } else {
        const values: number[] = [];
        for (const trial of subset) {
          const raw = trial.metrics[weight.metricKey];
          if (raw === undefined || !Number.isFinite(raw)) continue;
          values.push(raw);
          contributingTrials.add(trialKey(trial));
        }
        if (values.length === 0) continue;
        sessionMedian = median(values);
        count = values.length;
      }

      const definition = getMetricDefinition(weight.metricKey);
      const zRaw = (sessionMedian - statistic.mean) / statistic.standardDeviation;
      const zReference = definition?.direction === "lower_better" ? -zRaw : zRaw;

      contributions.push({
        metricKey: weight.metricKey,
        fromTests: weight.fromTests,
        weight: weight.weight,
        sessionMedian,
        zReference,
        trials: count,
      });
    }

    const totalWeight = contributions.reduce((sum, c) => sum + c.weight, 0);
    const z =
      totalWeight > 0
        ? contributions.reduce((sum, c) => sum + c.weight * c.zReference, 0) / totalWeight
        : 0;
    const n = contributingTrials.size;
    const sufficient = n >= MIN_TRIALS_PER_DIMENSION && contributions.length > 0;

    return {
      dimension: dimension.dimension,
      score: clampScore(scaling.centre + scaling.perSigma * z, scaling.min, scaling.max),
      // Filled in by `withShape` once every dimension is known.
      shape: 0,
      provisional: reference.provisional,
      sampleCount: n,
      contributions,
      sufficient,
    };
  });
}

/**
 * Adds the profile shape to each dimension (doc 16 §16.5).
 *
 * ```
 * μ        = mean of the sufficient dimensions' scores
 * σ_p      = max(SD, floor)
 * shape_i  = (d_i − μ) / σ_p
 * ```
 *
 * Shape describes what *kind* of aimer someone is, not how good they are: a beginner and an
 * expert with the same relative strengths get the same shape.
 */
export function withShape(
  dimensions: readonly DimensionOutcome[],
  spreadFloor: number = SHAPE_SPREAD_FLOOR,
): readonly DimensionOutcome[] {
  const scored = dimensions.filter((dimension) => dimension.sufficient);
  if (scored.length === 0) return dimensions.map((dimension) => ({ ...dimension, shape: 0 }));

  const mean = scored.reduce((sum, d) => sum + d.score, 0) / scored.length;
  const variance = scored.reduce((sum, d) => sum + (d.score - mean) ** 2, 0) / scored.length;
  const spread = Math.max(Math.sqrt(variance), spreadFloor);

  return dimensions.map((dimension) => ({
    ...dimension,
    shape: dimension.sufficient ? (dimension.score - mean) / spread : 0,
  }));
}

function clampScore(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function trialKey(trial: ObservedTrial): string {
  return `${trial.roundIndex}:${trial.blockIndex}:${trial.testKey}:${trial.trialIndex}`;
}
