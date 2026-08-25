import type { ParameterSet } from "./types";

/**
 * `calibration_model_v1` — the tuning constants for the adaptive search (doc 13).
 *
 * Every value here is either derived in doc 13 or marked there as an `ASSUMPTION`/`TUNABLE`.
 * The assumptions are the ones to revisit first once pilot data exists — in particular the
 * trial budget, whose power calculation rests on an assumed trial-level variance (risk R-09).
 */

export interface CalibrationParams {
  /** Admissible domain in cm/360 (doc 11 §11.10). A product bound, not a claim about optima. */
  readonly domainCmPer360: { readonly min: number; readonly max: number };

  /**
   * Cold-start centre. Close to the geometric mean of the domain bounds, which minimises the
   * worst-case number of bracket moves needed to reach either extreme. Not a claim about a
   * typical player.
   */
  readonly coldStartCentreCmPer360: number;

  /** Initial half-width in log2 units, by how much we already know (doc 13 §13.3). */
  readonly initialHalfWidth: {
    readonly knownCurrentSensitivity: number;
    readonly priorRecommendation: number;
    readonly coldStart: number;
  };

  /** Physical-constraint tuning (doc 13 §13.4). */
  readonly constraint: { readonly rho: number; readonly kappa: number };

  /** Candidates per round and round budget, by session mode. */
  readonly candidatesPerRound: {
    readonly quick: number;
    readonly standard: number;
    readonly advanced: number;
  };
  readonly roundBudget: {
    readonly quick: number;
    readonly standard: number;
    readonly advanced: number;
  };

  /** Whether the final-round anchor re-test runs, by mode (doc 13 §13.5). */
  readonly anchorEnabled: {
    readonly quick: boolean;
    readonly standard: boolean;
    readonly advanced: boolean;
  };

  /** Narrowing factor and floor for the bracket half-width (doc 13 §13.8). */
  readonly narrowing: {
    readonly gamma: number;
    readonly minHalfWidth: number;
    readonly conservativeGamma: number;
    /** How far outside the bracket a fitted vertex may sit before we shift instead. */
    readonly vertexClipFactor: number;
  };

  /** Statistical decision parameters (doc 13 §13.9). */
  readonly statistics: {
    /**
     * Two-sided level for candidate discrimination. Deliberately 0.90 rather than 0.95:
     * this is a decision procedure with a symmetric cost of error, not a hypothesis test
     * guarding against a false discovery in the literature.
     */
    readonly significanceLevel: number;
    readonly bootstrapResamples: number;
    readonly credibleIntervalLevel: number;
    /**
     * Whether a `peak_found` verdict additionally requires the **curvature** to be
     * significant: the bootstrap interval on the quadratic term `b₂` must exclude zero at
     * `significanceLevel`.
     *
     * Absent in `calibration_model_v1` and `v2`, where a peak rested on some candidate
     * *pair* separating (doc 13 §13.9) together with a concave point fit. That pair test is the
     * right rule for whether to keep searching (§13.10 condition 3) and the wrong one for
     * claiming a peak: across nine candidates it is an OR over thirty-six comparisons with no
     * multiplicity control, so a flat response clears it far more often than the level implies.
     *
     * Set from `calibration_model_v3`, where the verdict is tested by §13.9’s own rule at
     * §13.9’s own level, applied to the quantity a peak actually asserts — that the response
     * bends. Measured effect on 100 simulated flat players: fabricated peaks fell from 27% to
     * 11%, with real-peak detection and accuracy unchanged (100/100, median error 0.042 log2).
     *
     * It is a released parameter rather than a code-level change so that a session stored under
     * v1 or v2 still re-derives its original verdict (`SENS-BR-029`, `SENS-BR-030`).
     */
    readonly requireSignificantCurvature?: boolean;
  };

  /** Drift/nuisance model (doc 13 §13.7). */
  readonly drift: {
    readonly splineInteriorKnots: number;
    /** Above this design condition number, fall back to a linear drift and penalise confidence. */
    readonly conditionNumberThreshold: number;
    /** |Δg| beyond which the session stops with `stop_fatigue`. */
    readonly abortDeltaScore: number;
  };

  /** Minimum valid trials per candidate per round, by test and mode (doc 09 §9.16). */
  readonly minimumValidTrials: Readonly<
    Record<string, { readonly quick: number; readonly standard: number; readonly advanced: number }>
  >;

  /** Fine-tuning offsets in log2 units (doc 17 §17.7). */
  readonly fineTuneOffsets: readonly number[];

  /** Above this log2 difference, the familiarity-bias advisory is shown (doc 17 §17.6). */
  readonly familiarityAdvisoryLogDelta: number;
}

export const CALIBRATION_MODEL_V1: ParameterSet<CalibrationParams> = Object.freeze({
  kind: "calibration",
  version: "calibration_model_v1",
  releasedAt: "2026-08-20",
  notes:
    "Initial release. Trial minimums rest on an assumed trial-level coefficient of variation " +
    "of ~0.25 (doc 09 §9.16); re-derive from pilot data before relying on the power claim.",
  params: Object.freeze({
    domainCmPer360: Object.freeze({ min: 8, max: 100 }),
    coldStartCentreCmPer360: 30,
    initialHalfWidth: Object.freeze({
      knownCurrentSensitivity: 0.585,
      priorRecommendation: 0.3,
      coldStart: 0.85,
    }),
    constraint: Object.freeze({ rho: 0.55, kappa: 1.0 }),
    candidatesPerRound: Object.freeze({ quick: 3, standard: 3, advanced: 4 }),
    roundBudget: Object.freeze({ quick: 2, standard: 3, advanced: 4 }),
    anchorEnabled: Object.freeze({ quick: false, standard: true, advanced: true }),
    narrowing: Object.freeze({
      gamma: 0.5,
      minHalfWidth: 0.1,
      conservativeGamma: 0.7,
      vertexClipFactor: 0.25,
    }),
    statistics: Object.freeze({
      significanceLevel: 0.9,
      bootstrapResamples: 2000,
      credibleIntervalLevel: 0.9,
    }),
    drift: Object.freeze({
      splineInteriorKnots: 2,
      conditionNumberThreshold: 1e6,
      abortDeltaScore: 1.5,
    }),
    minimumValidTrials: Object.freeze({
      flick: Object.freeze({ quick: 8, standard: 12, advanced: 18 }),
      micro: Object.freeze({ quick: 8, standard: 12, advanced: 18 }),
      tracking: Object.freeze({ quick: 3, standard: 5, advanced: 8 }),
      switching: Object.freeze({ quick: 1, standard: 2, advanced: 3 }),
      precision: Object.freeze({ quick: 6, standard: 10, advanced: 14 }),
      reaction: Object.freeze({ quick: 8, standard: 8, advanced: 8 }),
      comfort360: Object.freeze({ quick: 3, standard: 3, advanced: 3 }),
    }),
    fineTuneOffsets: Object.freeze([-0.14, -0.06, 0, 0.06, 0.14]),
    familiarityAdvisoryLogDelta: 0.3,
  }),
});
