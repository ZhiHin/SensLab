import type { ScoredTrial } from "../calibration/contracts";
import type { TestKey } from "../types/vocabulary";
import type { ScoringParameters } from "./contracts";
import {
  computeScales,
  indexScales,
  scorableTrials,
  standardiseValue,
  type MetricScale,
  type ObservedTrial,
} from "./standardise";

/**
 * The calibration objective (doc 14 §14.7).
 *
 * ```
 * y_t = Σ_m  w_{T,m} × z_clipped(m, t)
 * ```
 *
 * ## Per trial, not per round
 *
 * The drift model (doc 13 §13.7) fits a smooth nuisance term against block index, and it needs
 * trial-level observations to have any resolution at all. A per-round objective would give it
 * three points per candidate to work with.
 *
 * ## What the test weight is doing
 *
 * doc 14 §14.7 sets the per-test weights by **information content per unit of session time**,
 * not by perceived importance: a test with high variance and few trials contributes less signal,
 * and weighting it higher would import noise into the recommendation. Because the weight scales
 * the trial's score, a flick trial moves the estimate more than a precision trial does — and
 * since every candidate is measured on the same test mix, that changes the estimate's precision
 * without biasing the comparison.
 *
 * ## The within-test split, which doc 14 leaves open
 *
 * doc 14 gives the per-test weights but not how a test's weight divides among its decision
 * metrics. This implementation splits it **equally over the decision metrics actually present on
 * that trial**, renormalising when one is absent. Renormalising matters: a flick trial that
 * never reached the target has no `pathEfficiency`, and scoring the missing metric as zero would
 * punish the trial twice — once for the miss and again for the absence.
 */

export interface ObjectiveOptions {
  readonly parameters: ScoringParameters;
}

export interface ObjectiveOutcome {
  readonly trials: readonly ScoredTrial[];
  /** The robust scales used, retained so a result can be re-derived and explained. */
  readonly scales: readonly MetricScale[];
  /** Trials that produced no decision metric at all and therefore no score. */
  readonly unscored: number;
}

/** Turns observed trials into the scalar the calibration engine optimises. */
export function computeObjective(
  observed: readonly ObservedTrial[],
  options: ObjectiveOptions,
): ObjectiveOutcome {
  const { parameters } = options;
  const scales = computeScales(observed, {
    robustScaleFloors: parameters.robustScaleFloors,
    clipConstant: parameters.clipConstant,
  });
  const byKey = indexScales(scales);
  const decisionKeys = new Set(parameters.decisionMetricKeys);
  const testWeights = new Map<TestKey, number>(
    parameters.objectiveTestWeights.map((entry) => [entry.test, entry.weight]),
  );

  const trials: ScoredTrial[] = [];
  let unscored = 0;

  for (const trial of scorableTrials(observed)) {
    const testWeight = testWeights.get(trial.testKey);
    // A test with no objective weight contributes nothing to the search by design — reaction
    // and comfort measure something that cannot vary with sensitivity (`SENS-BR-006`).
    if (testWeight === undefined) continue;

    let total = 0;
    let contributing = 0;

    for (const [metricKey, raw] of Object.entries(trial.metrics)) {
      if (!decisionKeys.has(metricKey) || !Number.isFinite(raw)) continue;
      const scale = byKey.get(`${trial.testKey}::${metricKey}`);
      if (scale === undefined) continue;

      total += standardiseValue(scale, raw, parameters.clipConstant);
      contributing += 1;
    }

    if (contributing === 0) {
      unscored += 1;
      continue;
    }

    trials.push({
      candidateIndex: trial.candidateIndex,
      roundIndex: trial.roundIndex,
      blockIndex: trial.blockIndex,
      score: testWeight * (total / contributing),
    });
  }

  return { trials, scales, unscored };
}

/**
 * Counts the scorable trials per candidate.
 *
 * Used to enforce `SENS-BR-012`: a candidate below its minimum sample is **excluded from the
 * fit rather than estimated** from too little data.
 */
export function countTrialsPerCandidate(
  trials: readonly ScoredTrial[],
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const trial of trials) {
    counts.set(trial.candidateIndex, (counts.get(trial.candidateIndex) ?? 0) + 1);
  }
  return counts;
}
