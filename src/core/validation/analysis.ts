import { getMetricDefinition } from "../metrics/registry";
import { deriveRng } from "../random";
import { computeObjective, scorableTrials, type ObservedTrial } from "../scoring";
import type { ScoringParameters } from "../scoring/contracts";
import { bootstrap, consistencyScore, el, mean, median } from "../statistics";
import { pairIndexOf } from "./sequence";

/**
 * The validation analysis (doc 17 §17.3, `SENS-BR-016`, FR-087).
 *
 * ```
 *   per-block value:  m_A,k  and  m_B,k     for matched block pairs k
 *   paired delta:     Δ_k = m_B,k − m_A,k
 *   estimate:         Δ̄ = median(Δ_k)
 *   interval:         paired bootstrap over blocks and trials, 90% CI, seeded
 * ```
 *
 * ## A confirmatory test after an exploratory search
 *
 * The calibration searched many candidates and kept the best, which biases the winner's
 * apparent advantage upward — the winner's curse. This is the fresh, pre-specified, two-arm
 * comparison that checks whether the advantage survives. Everything about it is fixed before
 * the data arrives: the arms, the block pairing, the five reported metrics and the one
 * composite the verdict is read from.
 *
 * ## No metric shopping
 *
 * The headline verdict comes from the **composite only** — the same objective the calibration
 * optimised, so the verdict is about the thing that was optimised rather than a metric chosen
 * after the fact. The five per-metric deltas are reported individually, each with its own
 * interval and its own significance flag, and nothing here picks among them. A fixture where
 * one metric is significant and the composite is not produces `no_measurable_difference`,
 * and that is a test (doc 17 §17.10).
 */

export type ValidationVerdict = "improved" | "no_measurable_difference" | "worse";

/** Which candidate index plays which arm. A validation uses 0 and 1; a duel names its two. */
export interface ArmAssignment {
  /** Arm A — the baseline, or the duel's first-ranked candidate. */
  readonly baseline: number;
  /** Arm B — the recommendation, or the duel's second-ranked candidate. */
  readonly candidate: number;
}

export const VALIDATION_ARMS: ArmAssignment = Object.freeze({ baseline: 0, candidate: 1 });

/** The reported metrics, fixed in advance (doc 17 §17.3). Order is presentation order. */
export const REPORTED_METRICS = Object.freeze([
  { key: "firstShotAccuracy", label: "Accuracy" },
  { key: "adjustedAcquisitionTime", label: "Target acquisition" },
  { key: "overshootRate", label: "Overshoot" },
  { key: "trackingAccuracy", label: "Tracking" },
  { key: "consistency", label: "Consistency" },
] as const);

export type ReportedMetricKey = (typeof REPORTED_METRICS)[number]["key"];

export interface ValidationInterval {
  readonly delta: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly level: number;
}

export interface MetricDelta extends ValidationInterval {
  readonly key: ReportedMetricKey;
  readonly label: string;
  readonly unit: string;
  readonly direction: "higher_better" | "lower_better";
  readonly baselineMean: number;
  readonly candidateMean: number;
  /** Relative change against the baseline mean, in percent; null when the baseline is zero. */
  readonly deltaPct: number | null;
  /** The interval excludes zero. Derived, never asserted. */
  readonly significant: boolean;
  /** Positive `delta` means the candidate did better, after direction alignment. */
  readonly favoursCandidate: boolean;
  readonly pairs: number;
}

export interface ValidationAnalysis {
  readonly kind: "analysed";
  readonly verdict: ValidationVerdict;
  readonly composite: ValidationInterval;
  readonly metrics: readonly MetricDelta[];
  readonly pairs: number;
  readonly blocks: number;
  readonly trials: { readonly baseline: number; readonly candidate: number };
}

export interface ValidationInsufficient {
  readonly kind: "insufficient";
  readonly pairs: number;
  readonly required: number;
}

export type ValidationOutcome = ValidationAnalysis | ValidationInsufficient;

export interface ValidationAnalysisInput {
  /** Non-practice trials of the validation session, `blockIndex` = the validation block. */
  readonly trials: readonly ObservedTrial[];
  readonly scoring: ScoringParameters;
  readonly level: number;
  readonly resamples: number;
  readonly minimumPairs: number;
  readonly seed: string;
  /** Defaults to the validation assignment (0 = baseline, 1 = recommended). */
  readonly arms?: ArmAssignment;
}

interface BlockPair {
  readonly pairIndex: number;
  readonly baseline: readonly number[];
  readonly candidate: readonly number[];
}

/** Per-block values grouped into matched pairs, keeping only pairs with both arms present. */
function pairBlocks(
  values: readonly { readonly blockIndex: number; readonly arm: number; readonly value: number }[],
  arms: ArmAssignment,
): BlockPair[] {
  const byBlock = new Map<number, { arm: number; values: number[] }>();
  for (const entry of values) {
    const bucket = byBlock.get(entry.blockIndex) ?? { arm: entry.arm, values: [] };
    bucket.values.push(entry.value);
    byBlock.set(entry.blockIndex, bucket);
  }

  const byPair = new Map<number, { baseline?: number[]; candidate?: number[] }>();
  for (const [blockIndex, bucket] of byBlock) {
    const pair = byPair.get(pairIndexOf(blockIndex)) ?? {};
    if (bucket.arm === arms.baseline) pair.baseline = bucket.values;
    else if (bucket.arm === arms.candidate) pair.candidate = bucket.values;
    byPair.set(pairIndexOf(blockIndex), pair);
  }

  return [...byPair.entries()]
    .filter(
      (entry): entry is [number, { baseline: number[]; candidate: number[] }] =>
        entry[1].baseline !== undefined &&
        entry[1].candidate !== undefined &&
        entry[1].baseline.length > 0 &&
        entry[1].candidate.length > 0,
    )
    .sort((a, b) => a[0] - b[0])
    .map(([pairIndex, pair]) => ({
      pairIndex,
      baseline: pair.baseline,
      candidate: pair.candidate,
    }));
}

/**
 * Paired bootstrap over blocks **and** trials: pairs are resampled as units, and within each
 * resampled pair the trials of each arm are resampled too, so the interval reflects both the
 * block-to-block and the trial-to-trial variance.
 */
function pairedInterval(
  pairs: readonly BlockPair[],
  summarise: (values: readonly number[]) => number,
  options: { readonly level: number; readonly resamples: number; readonly rng: string },
): ValidationInterval {
  const inner = deriveRng(options.rng, "within-block");
  const point = median(pairs.map((pair) => summarise(pair.candidate) - summarise(pair.baseline)));

  const outcome = bootstrap(
    pairs,
    (resample) => {
      // The statistic on the original sample (passed by reference) is the plain paired median;
      // every resample also resamples trials within each block.
      if (resample === pairs) return point;
      const deltas = resample.map((pair) => {
        const draw = (block: readonly number[]) =>
          block.map(() => el(block, inner.nextInt(block.length)));
        return summarise(draw(pair.candidate)) - summarise(draw(pair.baseline));
      });
      return median(deltas);
    },
    { resamples: options.resamples, rng: deriveRng(options.rng, "pairs"), level: options.level },
  );

  return {
    delta: point,
    ciLow: outcome.interval.low,
    ciHigh: outcome.interval.high,
    level: options.level,
  };
}

function verdictFor(interval: ValidationInterval): ValidationVerdict {
  if (interval.ciLow > 0) return "improved";
  if (interval.ciHigh < 0) return "worse";
  return "no_measurable_difference";
}

export function analyseValidation(input: ValidationAnalysisInput): ValidationOutcome {
  const arms = input.arms ?? VALIDATION_ARMS;
  const usable = scorableTrials(input.trials, "hipfire").filter(
    (trial) => trial.candidateIndex === arms.baseline || trial.candidateIndex === arms.candidate,
  );

  // Composite, from the calibration's own objective over both arms together — one set of
  // scales, so the two arms are standardised identically.
  const objective = computeObjective(usable, { parameters: input.scoring });
  const compositePairs = pairBlocks(
    objective.trials.map((trial) => ({
      blockIndex: trial.blockIndex,
      arm: trial.candidateIndex,
      value: trial.score,
    })),
    arms,
  );

  if (compositePairs.length < input.minimumPairs) {
    return { kind: "insufficient", pairs: compositePairs.length, required: input.minimumPairs };
  }

  const composite = pairedInterval(compositePairs, mean, {
    level: input.level,
    resamples: input.resamples,
    rng: `${input.seed}:composite`,
  });

  const metrics: MetricDelta[] = [];
  for (const reported of REPORTED_METRICS) {
    const metric = metricDelta(usable, reported.key, reported.label, {
      level: input.level,
      resamples: input.resamples,
      seed: `${input.seed}:${reported.key}`,
      minimumPairs: input.minimumPairs,
      arms,
    });
    if (metric !== null) metrics.push(metric);
  }

  const blocks = new Set(usable.map((trial) => trial.blockIndex)).size;
  return {
    kind: "analysed",
    verdict: verdictFor(composite),
    composite,
    metrics,
    pairs: compositePairs.length,
    blocks,
    trials: {
      baseline: usable.filter((t) => t.candidateIndex === arms.baseline).length,
      candidate: usable.filter((t) => t.candidateIndex === arms.candidate).length,
    },
  };
}

/**
 * One reported metric's paired delta.
 *
 * `consistency` is the consistency score of acquisition time within each block (doc 10
 * §10.6); the others are the block mean of the trial-level metric. The delta is reported in
 * the metric's natural units and direction — "−43 ms" reads as a faster acquisition — with
 * `favoursCandidate` carrying the alignment so no reader has to remember which way is up.
 */
function metricDelta(
  trials: readonly ObservedTrial[],
  key: ReportedMetricKey,
  label: string,
  options: {
    readonly level: number;
    readonly resamples: number;
    readonly seed: string;
    readonly minimumPairs: number;
    readonly arms: ArmAssignment;
  },
): MetricDelta | null {
  const sourceKey = key === "consistency" ? "adjustedAcquisitionTime" : key;
  // Every reported metric is a registered one (doc 17 §17.3's table is drawn from doc 10),
  // and a key that is not would be a table error rather than a case to handle here.
  const definition = getMetricDefinition(sourceKey);
  if (definition === undefined) throw new RangeError(`unregistered metric ${sourceKey}`);
  const direction: MetricDelta["direction"] =
    definition.direction === "lower_better" ? "lower_better" : "higher_better";
  const unit = definition.unit;

  const values = trials.flatMap((trial) => {
    const raw = trial.metrics[sourceKey];
    return raw === undefined || !Number.isFinite(raw)
      ? []
      : [{ blockIndex: trial.blockIndex, arm: trial.candidateIndex, value: raw }];
  });
  const pairs = pairBlocks(values, options.arms);
  const summarise =
    key === "consistency"
      ? (block: readonly number[]) => (block.length < 2 ? 0 : consistencyScore(block))
      : mean;
  const usablePairs =
    key === "consistency"
      ? pairs.filter((pair) => pair.baseline.length >= 2 && pair.candidate.length >= 2)
      : pairs;
  if (usablePairs.length < options.minimumPairs) return null;

  const interval = pairedInterval(usablePairs, summarise, {
    level: options.level,
    resamples: options.resamples,
    rng: options.seed,
  });
  const baselineMean = mean(usablePairs.map((pair) => summarise(pair.baseline)));
  const candidateMean = mean(usablePairs.map((pair) => summarise(pair.candidate)));
  const aligned = direction === "lower_better" ? -interval.delta : interval.delta;

  return {
    key,
    label,
    unit,
    direction,
    baselineMean,
    candidateMean,
    ...interval,
    deltaPct:
      Math.abs(baselineMean) < 1e-9 ? null : (interval.delta / Math.abs(baselineMean)) * 100,
    significant: interval.ciLow > 0 || interval.ciHigh < 0,
    favoursCandidate: aligned > 0,
    pairs: usablePairs.length,
  };
}

/** The familiarity-bias advisory applies above this log2 distance between the arms. */
export function familiarityAdvisoryApplies(
  baselineCounts: number,
  candidateCounts: number,
  thresholdLog2: number,
): boolean {
  return Math.abs(Math.log2(candidateCounts) - Math.log2(baselineCounts)) > thresholdLog2;
}
