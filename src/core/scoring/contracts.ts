import type { DimensionKey, TestKey } from "../types/vocabulary";

/**
 * Scoring contracts (doc 14).
 *
 * Phase 1 defines the shapes and the versioned parameter structure. Phase 4 implements the
 * normalisation, the dimension computation and the objective.
 *
 * The structure encodes the single most important modelling decision in doc 14: there are
 * **two normalisation contexts**, and they must never be conflated (ADR-018).
 *
 *  - `within_session`  — compares the player to themselves. Drives every decision: the
 *                        recommendation, the ranges, the response curve, the validation
 *                        verdict. Requires no population data and is fully valid on day one.
 *  - `reference`       — compares the player to a population. Drives cosmetic 0–100 display
 *                        scores only, and is provisional until real data exists.
 */

export type NormalisationContext = "within_session" | "reference";

/** A metric's contribution to a dimension. Weights within a dimension sum to 1. */
export interface MetricWeight {
  readonly metricKey: string;
  /** Restricts the contribution to trials from specific tests, when the metric spans several. */
  readonly fromTests: readonly TestKey[];
  readonly weight: number;
}

export interface DimensionDefinition {
  readonly dimension: DimensionKey;
  readonly displayName: string;
  readonly weights: readonly MetricWeight[];
  readonly description: string;
}

/** Per-test weighting inside the calibration objective (doc 14 §14.7). */
export interface ObjectiveTestWeight {
  readonly test: TestKey;
  readonly weight: number;
}

/**
 * Reference mean and spread for one metric, used only for display scaling.
 *
 * `provisional` is load-bearing: while true, absolute scores are labelled provisional in the
 * UI and percentiles are not shown at all — a percentile against an invented distribution is
 * a lie with a number attached (doc 14 §14.4).
 */
export interface ReferenceStatistic {
  readonly metricKey: string;
  readonly mean: number;
  readonly standardDeviation: number;
  readonly provisional: boolean;
}

export interface DisplayScaling {
  /** Display score at z = 0. */
  readonly centre: number;
  /** Display points per standard deviation. */
  readonly perSigma: number;
  readonly min: number;
  readonly max: number;
}

export interface ScoringParameters {
  readonly version: string;
  readonly metricRegistryVersion: number;
  /** Per-metric minimum scale, preventing an unusually consistent player from exploding z. */
  readonly robustScaleFloors: Readonly<Record<string, number>>;
  /** Soft-clip constant for the bounded-influence transform: `k · tanh(z / k)`. */
  readonly clipConstant: number;
  readonly dimensions: readonly DimensionDefinition[];
  readonly objectiveTestWeights: readonly ObjectiveTestWeight[];
  readonly decisionMetricKeys: readonly string[];
  readonly displayScaling: DisplayScaling;
  readonly referenceDistributionVersion: string;
  /** Per-game dimension weighting. Disabled at MVP; every game uses `balanced`. */
  readonly gameWeightProfilesEnabled: boolean;
  readonly defaultWeightProfile: Readonly<Record<DimensionKey, number>>;
}

/* ------------------------------------------------------------------ outputs */

export interface DimensionScore {
  readonly dimension: DimensionKey;
  /** 0–100 display score. */
  readonly score: number;
  /** Position relative to the player's own dimension mean, in their own spread units. */
  readonly shape: number;
  readonly provisional: boolean;
  readonly sampleCount: number;
}

export interface AggregatedMetric {
  readonly metricKey: string;
  readonly value: number;
  readonly validTrials: number;
  readonly invalidTrials: number;
  readonly degradedTrials: number;
  readonly robustStandardDeviation: number | null;
  readonly intervalLow: number | null;
  readonly intervalHigh: number | null;
}
