import type { CountsPer360 } from "../../core/types/brand";
import type {
  InvalidReason,
  ScopeKey,
  SessionMode,
  TestCategory,
  TestKey,
  TrialValidity,
} from "../../core/types/vocabulary";

/**
 * Test-engine domain contracts (doc 19).
 *
 * **Contracts only.** There is no canvas, no pointer lock, no renderer and no timing loop in
 * Phase 1 — that is Phase 2, and building it now would skip the boundary work that makes it
 * cheap and safe.
 *
 * What these types fix is the interface between the engine and everything around it: what a
 * test declaration looks like, what a trial produces, and what a round hands to the server.
 * Fixing it now is what lets the schema, the ingest endpoint and the session planner be
 * built and tested before the engine exists.
 *
 * The central structural claim (doc 19 §19.9): **a test is data plus pure hooks.** Spawning,
 * timing, validity classification, buffering and metric derivation are engine
 * responsibilities. A new test is a new declaration, never an edit to lifecycle code.
 */

/* ------------------------------------------------------------------ declarations */

export interface TargetSpec {
  /** Angular position relative to the camera at spawn, in degrees. */
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly angularRadiusDeg: number;
  /** Distinguishes a reset target from a scored one; reset targets are excluded from metrics. */
  readonly role: "scored" | "reset" | "decoy";
}

export type MotionPattern =
  | { readonly kind: "static" }
  | {
      readonly kind: "sinusoid";
      readonly axis: "yaw" | "pitch" | "both";
      readonly amplitudeDeg: number;
      readonly periodMs: number;
      readonly phase: number;
    }
  | {
      readonly kind: "circular";
      readonly radiusDeg: number;
      readonly periodMs: number;
      readonly phase: number;
    }
  | {
      readonly kind: "random_smooth";
      readonly components: readonly {
        readonly amplitudeDeg: number;
        readonly angularFrequency: number;
        readonly phase: number;
      }[];
    };

export type EndCondition = "first_hit" | "single_shot" | "duration" | "kill_count";
export type ShootingModel = "click" | "hold" | "none";

export interface TrialContext {
  readonly trialIndex: number;
  readonly isPractice: boolean;
  readonly scopeKey: ScopeKey;
  readonly mode: SessionMode;
}

/**
 * A declarative aim-test definition.
 *
 * `spawn` is a pure, seeded function so that a session's exact stimulus sequence can be
 * reproduced from its seed (`SENS-BR-031`), and so that two candidates can be given matched
 * stimuli within a round (doc 13 §13.6).
 */
export interface TestDefinition {
  readonly key: TestKey;
  readonly version: number;
  readonly category: TestCategory;
  /** i18n message keys, not literal copy. */
  readonly instructionsKey: string;
  readonly displayNameKey: string;

  trialCount(mode: SessionMode): number;
  minValidTrials(mode: SessionMode): number;
  practiceTrialCount(mode: SessionMode): number;

  readonly timeoutMs: number;
  readonly interTrialIntervalMs: { readonly min: number; readonly max: number };
  readonly endCondition: EndCondition;
  readonly shootingModel: ShootingModel;
  /** Minimum interval between accepted shots, where a test declares one. */
  readonly shotCooldownMs?: number;

  /** Pure and seeded: the same rng and context must always yield the same targets. */
  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[];
  motionFor(rng: TestRng, context: TrialContext): MotionPattern;

  /** Reason codes this test can produce beyond the universal set. All are procedural. */
  readonly additionalInvalidReasons: readonly InvalidReason[];
  /** Metric keys the engine derives for this test. Must all exist in the metric registry. */
  readonly metricKeys: readonly string[];
}

/** The subset of the RNG surface a test declaration is allowed to touch. */
export interface TestRng {
  next(): number;
  nextInt(maxExclusive: number): number;
  nextRange(min: number, max: number): number;
}

/* ------------------------------------------------------------------ session planning */

export interface PlannedRound {
  /** Global ordering within the session. Doubles as the ingest idempotency key component. */
  readonly presentationOrder: number;
  readonly blockIndex: number;
  readonly roundIndex: number;
  /** Null for sensitivity-independent tests (reaction, 360 comfort). */
  readonly candidateIndex: number | null;
  readonly testKey: TestKey;
  readonly scopeKey: ScopeKey;
  readonly isPractice: boolean;
  readonly trialCount: number;
  /** Seed for this round's stimulus stream. Matched across candidates within a round. */
  readonly stimulusSeed: string;
}

export interface CandidateAssignment {
  readonly candidateIndex: number;
  readonly countsPer360: CountsPer360;
  readonly blindLabel: string;
}

export interface SessionPlan {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly seed: string;
  readonly fovHorizontalHalfDeg: number;
  readonly candidates: readonly CandidateAssignment[];
  readonly rounds: readonly PlannedRound[];
  readonly testConfigVersion: string;
}

/* ------------------------------------------------------------------ engine output */

export interface TrialQuality {
  /** Fraction of frames within the frame budget during the measured window. */
  readonly cleanFrameFraction: number;
  readonly hitchCount: number;
  readonly bufferOverflow: boolean;
}

export interface TrialRecord {
  readonly trialIndex: number;
  readonly isPractice: boolean;
  readonly validity: TrialValidity;
  /** Non-null exactly when `validity` is `invalid`. Always procedural (`SENS-BR-009`). */
  readonly invalidReason: InvalidReason | null;
  /** True when this trial replaced a procedurally invalid one to meet the sample target. */
  readonly isReplacement: boolean;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly hit: boolean | null;
  readonly shots: number;
  readonly targetAngularRadiusDeg: number | null;
  readonly targetDistanceDeg: number | null;
  readonly targetDirectionDeg: number | null;
  readonly stimulusSeed: string;
  readonly quality: TrialQuality;
  /** Derived metric values, keyed by metric registry key. */
  readonly metrics: Readonly<Record<string, number>>;
}

export interface RoundAggregate {
  readonly presentationOrder: number;
  readonly blockIndex: number;
  readonly roundIndex: number;
  readonly candidateIndex: number | null;
  readonly testKey: TestKey;
  readonly scopeKey: ScopeKey;
  readonly isPractice: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly trials: readonly TrialRecord[];
  readonly roundMetrics: Readonly<
    Record<
      string,
      {
        readonly value: number;
        readonly validTrials: number;
        readonly invalidTrials: number;
        readonly degradedTrials: number;
        readonly robustStandardDeviation: number | null;
        readonly intervalLow: number | null;
        readonly intervalHigh: number | null;
      }
    >
  >;
  readonly qualitySummary: {
    readonly lateFrameRatio: number;
    readonly hitchCount: number;
    readonly lockLossCount: number;
  };
}

/* ------------------------------------------------------------------ environment */

export interface EnvironmentFingerprint {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screen: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly estimatedRefreshHz: number;
  readonly frameProbe: {
    readonly meanMs: number;
    readonly p95Ms: number;
    readonly maxMs: number;
    readonly lateFrameRatio: number;
    readonly sampleCount: number;
  };
  readonly pointerLock: {
    readonly supported: boolean;
    readonly unadjustedMovementRequested: boolean;
    /** What actually took effect, not merely what was asked for (EV-010). */
    readonly unadjustedMovementEffective: boolean;
  };
  readonly browser: { readonly name: string; readonly majorVersion: number };
  readonly os: { readonly family: string };
  readonly canvas: {
    readonly cssWidth: number;
    readonly cssHeight: number;
    readonly backingWidth: number;
    readonly backingHeight: number;
  };
  readonly fovHorizontalHalfDeg: number;
  readonly aspectRatio: number;
  readonly testConfigVersion: string;
  readonly engineVersion: string;
  readonly timezoneOffsetMinutes: number;
}
