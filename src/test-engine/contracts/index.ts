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
  /**
   * Angular offset from the camera's orientation at the moment of spawn, in degrees.
   *
   * **Relative, not absolute** (doc 09 §9.0.1). A definition says "12° to the right of wherever
   * the player is looking"; the engine resolves that against the live camera. Absolute
   * coordinates would make every declaration depend on where the previous trial happened to
   * leave the view, which is exactly the drift the reset target exists to prevent.
   */
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

/** What the round knows about a trial before it begins. */
export interface TrialIdentity {
  readonly trialIndex: number;
  readonly isPractice: boolean;
  readonly scopeKey: ScopeKey;
  readonly mode: SessionMode;
}

/**
 * What a definition's hooks see: the trial's identity plus the live view.
 *
 * The live parts are supplied by the engine at call time rather than fixed when the trial
 * began, because a respawning test needs to place a target away from where the crosshair
 * *is*, not away from where the trial started.
 */
export interface TrialContext extends TrialIdentity {
  /** Camera orientation at the moment this hook is called, in degrees. */
  readonly cameraAngles: { readonly yawDeg: number; readonly pitchDeg: number };
  /** Kills so far this trial. 0 at the initial spawn; used by respawning tests. */
  readonly killIndex: number;
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

  /**
   * How long a trial may run before it resolves.
   *
   * For the `duration` end condition this *is* the measured duration — a tracking trial ends
   * when its time is up, not by timing out.
   */
  readonly timeoutMs: number;
  readonly interTrialIntervalMs: { readonly min: number; readonly max: number };
  readonly endCondition: EndCondition;
  readonly shootingModel: ShootingModel;
  /** Minimum interval between accepted shots, where a test declares one. */
  readonly shotCooldownMs?: number;
  /** Scored targets that must be destroyed before a `kill_count` trial resolves. */
  readonly killTarget?: number;
  /**
   * Total mouse counts below which a timed-out trial is classified `no_input` rather than
   * `timeout`. Distinguishing "did not try" from "tried and ran out of time" matters: both are
   * procedural, but only one of them says anything about the stimulus.
   */
  readonly minMovementCounts?: number;
  /**
   * For `hold` tests, the fraction of the trial the fire button must be held before the trial
   * counts as attempted (doc 09 §9.4).
   */
  readonly minHeldRatio?: number;
  /**
   * Minimum kills below which a `kill_count` trial is `insufficient_kills` rather than a short
   * sequence. Procedural: set far below any plausible genuine attempt (doc 09 §9.5).
   */
  readonly minKills?: number;
  /**
   * Whether the camera responds to mouse movement.
   *
   * False only for the reaction test, where movement is ignored by design — a camera that moved
   * would let the player pre-aim and turn a reaction measurement into an aiming one.
   * Movement is still *recorded*, so premature movement remains detectable.
   */
  readonly cameraEnabled?: boolean;

  /** Pure and seeded: the same rng and context must always yield the same targets. */
  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[];
  motionFor(rng: TestRng, context: TrialContext): MotionPattern;
  /**
   * Targets to spawn when a scored target is destroyed mid-trial.
   *
   * Called with the live camera angles and the kill index, so a respawn can be placed away from
   * where the crosshair actually is. Returning an empty list (the default) means the target is
   * simply removed.
   */
  respawn?(rng: TestRng, context: TrialContext): readonly TargetSpec[];
  /**
   * An optional label for what this trial presented — a comfort sub-task, a distance class.
   *
   * Recorded on the trial and handed to metric derivations, so one test can present genuinely
   * different tasks without the derivations having to infer which from the trial index.
   */
  variantFor?(rng: TestRng, context: TrialContext): string | null;

  /** Reason codes this test can produce beyond the universal set. All are procedural. */
  readonly additionalInvalidReasons: readonly InvalidReason[];
  /** Metric keys the engine derives for this test. Must all exist in the metric registry. */
  readonly metricKeys: readonly string[];
  /**
   * The metric this test is fundamentally about.
   *
   * `consistency` is computed from its trial values, because "consistent" is not meaningful
   * on its own — a player can be consistent in acquisition time and erratic in placement, and
   * a single number that averaged the two would describe neither.
   */
  readonly primaryMetricKey?: string;
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

/**
 * The free-aim warm-up (SCR-014, doc 04 stage 6).
 *
 * Not a test and not a `TestDefinition`: it has no trials, no scoring and no metrics. It exists
 * so the player's first contact with the camera is not also their first measured trial —
 * first-contact learning is the largest single confound in a short session (`SENS-BR-011`).
 */
export interface FreeAimStage {
  /** Target acquisitions before the continue control unlocks. */
  readonly minAcquisitions: number;
  readonly targetAngularRadiusDeg: number;
  readonly minDistanceDeg: number;
  readonly maxDistanceDeg: number;
  /** The bracket centre. Never a candidate, so practice cannot advantage one (doc 09 §9.0.6). */
  readonly countsPer360: CountsPer360;
}

export interface SessionPlan {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly seed: string;
  readonly fovHorizontalHalfDeg: number;
  /** Viewport aspect ratio, fixed for the session. A change mid-session flags it. */
  readonly aspectRatio: number;
  readonly candidates: readonly CandidateAssignment[];
  readonly rounds: readonly PlannedRound[];
  readonly testConfigVersion: string;

  /**
   * Sensitivity for rounds that are not tied to a candidate — the reaction and 360 comfort
   * tests, which measure something sensitivity-independent and would otherwise have no value
   * to run at.
   */
  readonly baselineCountsPer360: CountsPer360;

  /**
   * Physical plausibility bound for the anti-manipulation check (doc 23 §23.10).
   *
   * Computed by the planner from the session DPI. Passing counts rather than DPI keeps the
   * engine's only sensitivity concept `degreesPerCount`, which is DPI-independent by
   * construction (doc 11 §11.1).
   */
  readonly maxImpliedCountsPerSecond: number;

  readonly freeAim?: FreeAimStage;
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
  /** What this trial presented, where the test has more than one kind of trial. */
  readonly variant: string | null;
  readonly quality: TrialQuality;
  /**
   * Environmental observations about this trial — a resize, a DPR change, a buffer overflow.
   *
   * Distinct from `invalidReason`: a flag records that something happened, not that the trial
   * is unusable. Stored so a session with an unusual flag pattern can be surfaced rather than
   * quietly cleaned (doc 10 §10.8).
   */
  readonly qualityFlags: readonly string[];
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
