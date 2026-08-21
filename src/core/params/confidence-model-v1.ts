import type { ParameterSet } from "./types";

/**
 * `confidence_model_v1` — the seven quality components and their composition (doc 15).
 *
 * The confidence index is **not** a probability. It is a bounded, monotone, deterministic
 * function of named quality inputs, each individually reported to the user. Until it has been
 * calibrated against real test–retest data (doc 15 §15.7) it stays an index, the wording stays
 * "confidence index", and the hard ceiling stays in place (`SENS-BR-028`).
 *
 * Composition is a **weighted geometric mean** rather than an arithmetic one, so that a
 * single very poor component visibly drags the whole index down — which is exactly the
 * behaviour a quality score needs and which an arithmetic mean lacks.
 */

export interface ConfidenceParams {
  /** Multiplicative ceiling applied to the composed value. */
  readonly ceiling: number;

  /** Verdict-specific hard caps on the final 0–100 value. */
  readonly verdictCaps: { readonly peakFound: number; readonly indistinguishable: number };

  /** Reference scales for the components that map a magnitude onto [0, 1]. */
  readonly references: {
    /** Credible-interval width in log2 at which C_peak = 0.5. */
    readonly peakIntervalWidth: number;
    /** Robust CV at which C_consistency = 0.5. */
    readonly consistencyRcv: number;
    /** |drift| in score units at which C_drift = 0.5. */
    readonly driftDelta: number;
  };

  /** Cap on C_peak when no candidate was distinguishable — precision about nothing. */
  readonly indistinguishablePeakCap: number;

  /** Neutral values used when a component could not be measured. */
  readonly neutral: { readonly fitSaturated: number; readonly anchorNotRun: number };

  /** Environment penalties (doc 15 §15.2, C4). */
  readonly environment: {
    readonly noRawInput: number;
    readonly cleanFrameFloor: number;
    readonly perPointerLockLoss: number;
    readonly pointerLockFloor: number;
    readonly windowResized: number;
  };

  /** Multiplier applied when the drift model fell back to a linear form. */
  readonly driftFallbackPenalty: number;

  /** Weights of the geometric mean. */
  readonly weights: {
    readonly peak: number;
    readonly sample: number;
    readonly consistency: number;
    readonly environment: number;
    readonly drift: number;
    readonly fit: number;
    readonly anchor: number;
  };

  /** Multipliers applied after the validation test (doc 15 §15.8). */
  readonly validationMultipliers: {
    readonly improved: number;
    readonly noMeasurableDifference: number;
    readonly worse: number;
  };

  /** Minimum distinct sensitivity points before adjusted R² is meaningful. */
  readonly fitMinimumDistinctPoints: number;
}

export const CONFIDENCE_MODEL_V1: ParameterSet<ConfidenceParams> = Object.freeze({
  kind: "confidence",
  version: "confidence_model_v1",
  releasedAt: "2026-08-20",
  notes:
    "Initial release. The index is ordinal, not a probability: the ceiling of 0.92 stays " +
    "until agreement against same-hardware re-tests has been measured (doc 15 §15.7).",
  params: Object.freeze({
    ceiling: 0.92,
    verdictCaps: Object.freeze({ peakFound: 92, indistinguishable: 40 }),
    references: Object.freeze({
      peakIntervalWidth: 0.3,
      consistencyRcv: 0.3,
      driftDelta: 0.5,
    }),
    indistinguishablePeakCap: 0.35,
    neutral: Object.freeze({ fitSaturated: 0.8, anchorNotRun: 0.85 }),
    environment: Object.freeze({
      noRawInput: 0.85,
      cleanFrameFloor: 0.6,
      perPointerLockLoss: 0.03,
      pointerLockFloor: 0.8,
      windowResized: 0.9,
    }),
    driftFallbackPenalty: 0.9,
    weights: Object.freeze({
      peak: 3,
      sample: 2,
      consistency: 1.5,
      environment: 2,
      drift: 1.5,
      fit: 1,
      anchor: 1,
    }),
    validationMultipliers: Object.freeze({
      improved: 1.08,
      noMeasurableDifference: 0.97,
      worse: 0.7,
    }),
    fitMinimumDistinctPoints: 4,
  }),
});
