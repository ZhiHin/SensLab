import type { CountsPer360, LogSensitivity } from "../types/brand";
import type {
  CalibrationDecision,
  CalibrationVerdict,
  CandidateSource,
  ConstraintSource,
  DriftForm,
  SessionMode,
} from "../types/vocabulary";

/**
 * Calibration engine contracts (doc 13).
 *
 * Phase 1 defines the shapes; Phase 4 implements the search. They are separated deliberately:
 * the database schema, the session planner and the persistence layer all need to agree on
 * these structures before any optimiser exists, and pinning them now is what stops the
 * optimiser's internal representation leaking into the schema later.
 *
 * The engine optimises **a scalar parameter under a supplied objective**. Nothing in these
 * types mentions sensitivity semantics or games, which is what allows the same engine to run
 * the post-MVP scope calibration unchanged (doc 13 §13.12).
 */

/* ------------------------------------------------------------------ inputs */

export interface SearchBracket {
  readonly centre: LogSensitivity;
  readonly halfWidth: number;
  readonly low: LogSensitivity;
  readonly high: LogSensitivity;
}

export interface ParameterConstraint {
  /** Upper bound in cm/360 imposed by physical reach, or null when unbounded. */
  readonly maxCmPer360: number | null;
  readonly source: ConstraintSource;
  readonly conflict: boolean;
}

export interface CalibrationSpec {
  /** Human-readable name of the parameter being optimised, e.g. "hipfire_counts_per_360". */
  readonly parameterName: string;
  readonly domainLow: LogSensitivity;
  readonly domainHigh: LogSensitivity;
  readonly constraint: ParameterConstraint;
  readonly initialCentre: LogSensitivity;
  readonly initialHalfWidth: number;
  readonly candidatesPerRound: number;
  readonly roundBudget: number;
  readonly mode: SessionMode;
  readonly seed: bigint;
  /** Identifier of the versioned parameter set that supplied the tuning constants. */
  readonly calibrationVersion: string;
}

/* ------------------------------------------------------------------ candidates & trials */

export interface Candidate {
  readonly roundIndex: number;
  readonly candidateIndex: number;
  readonly x: LogSensitivity;
  readonly countsPer360: CountsPer360;
  /**
   * The opaque label shown to the player. Re-shuffled every round so a player cannot even
   * track "the one called A" across rounds (`SENS-BR-007`).
   */
  readonly blindLabel: string;
  readonly source: CandidateSource;
}

/** One scored trial as the engine sees it: a value, a candidate, and a position in time. */
export interface ScoredTrial {
  readonly candidateIndex: number;
  readonly roundIndex: number;
  /** Global block index — the time axis the drift model is fitted against. */
  readonly blockIndex: number;
  /** Composite objective value for this trial, already normalised and direction-aligned. */
  readonly score: number;
}

/* ------------------------------------------------------------------ per-round analysis */

export interface DriftModelSummary {
  readonly form: DriftForm;
  /** Fitted change in the nuisance term from the first block to the last, in score units. */
  readonly deltaFirstToLast: number;
  readonly conditionNumber: number;
}

export interface ResponseSurfaceFit {
  readonly coefficients: readonly number[];
  readonly concave: boolean;
  readonly rSquaredAdjusted: number | null;
  readonly vertexX: LogSensitivity | null;
}

export interface CandidateEstimate {
  readonly candidateIndex: number;
  readonly roundIndex: number;
  readonly x: LogSensitivity;
  /** De-drifted candidate effect (α̂ in doc 13 §13.7). */
  readonly alphaHat: number;
  readonly standardError: number;
  readonly validTrials: number;
  /** True when the minimum sample requirement was not met (`SENS-BR-012`). */
  readonly insufficient: boolean;
}

export interface CalibrationRoundResult {
  readonly roundIndex: number;
  readonly bracket: SearchBracket;
  readonly estimates: readonly CandidateEstimate[];
  readonly fit: ResponseSurfaceFit | null;
  readonly drift: DriftModelSummary;
  /** Smallest candidate difference the achieved sample size could have detected. */
  readonly minimumDetectableEffect: number;
  readonly decision: CalibrationDecision;
  readonly nextBracket: SearchBracket | null;
}

/* ------------------------------------------------------------------ final result */

export interface CredibleInterval {
  readonly low: number;
  readonly high: number;
  readonly level: number;
}

export interface AnchorRetestSummary {
  /** Difference between the same sensitivity measured early and late in the session. */
  readonly deltaScore: number;
  readonly standardError: number;
}

export interface CalibrationResult {
  readonly verdict: CalibrationVerdict;
  /** Null unless the verdict is `peak_found` — never a fabricated point estimate. */
  readonly xStar: LogSensitivity | null;
  readonly countsPer360: CountsPer360 | null;
  /** Statistical interval on the location of the peak. */
  readonly credibleInterval: CredibleInterval | null;
  /** Practical plateau: sensitivities indistinguishable from the peak. Always present. */
  readonly comfortRange: { readonly lowCm360: number; readonly highCm360: number };
  readonly candidates: readonly Candidate[];
  readonly estimates: readonly CandidateEstimate[];
  readonly rounds: readonly CalibrationRoundResult[];
  readonly fit: ResponseSurfaceFit | null;
  readonly drift: DriftModelSummary;
  readonly anchorRetest: AnchorRetestSummary | null;
  readonly minimumDetectableEffect: number;
  readonly stopReason: CalibrationDecision;
  readonly constraint: ParameterConstraint;
  readonly seed: bigint;
  readonly calibrationVersion: string;
}

/**
 * The objective supplied to the engine.
 *
 * Deliberately a function of trials rather than of anything sensitivity-shaped: the engine
 * must not be able to look at the parameter it is optimising and form an opinion about it.
 */
export type CalibrationObjective = (trials: readonly ScoredTrial[]) => readonly ScoredTrial[];
