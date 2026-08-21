/**
 * Closed vocabularies shared by the domain, the database schema and the API boundary.
 *
 * These are declared once here and consumed everywhere — including by the Drizzle
 * `pgEnum` definitions — so that a database enum and a TypeScript union can never drift
 * apart. TS `enum` is banned by lint; `as const` tuples give us both the runtime array
 * (for schema generation and Zod) and the literal union type.
 */

const tuple = <T extends readonly string[]>(...values: T): T => values;

/* ------------------------------------------------------------------ games & scopes */

/** doc 20 §20.4 — the scope roster a game may expose. */
export const SCOPE_KEYS = tuple("hipfire", "ads", "x1", "x2", "x3", "x4", "x6", "x8");
export type ScopeKey = (typeof SCOPE_KEYS)[number];

/** doc 12 §12.6 — per-(game version, scope) verification state. */
export const VERIFICATION_STATUSES = tuple("verified", "partial", "needs_recheck", "unverified");
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** doc 11 §11.2 — the shape of a game's sensitivity model. Never assumed (doc 08 §8.3). */
export const MODEL_FORMS = tuple("linear_yaw", "table", "piecewise");
export type ModelForm = (typeof MODEL_FORMS)[number];

/** doc 11 §11.6.4 — whether a game already applies its own FOV scaling to ADS. */
export const ADS_MODELS = tuple("raw_multiplier", "internally_fov_scaled", "unknown");
export type AdsModel = (typeof ADS_MODELS)[number];

export const FOV_AXES = tuple("horizontal", "vertical");
export type FovAxis = (typeof FOV_AXES)[number];

/** doc 11 §11.6.2 — the matching criterion used for a scoped conversion. */
export const CONVERSION_METHODS = tuple(
  "direct",
  "focal_length",
  "monitor_distance",
  "distance_360",
);
export type ConversionMethod = (typeof CONVERSION_METHODS)[number];

export const GAME_REGIONS = tuple("global", "cn", "other");
export type GameRegion = (typeof GAME_REGIONS)[number];

export const GAME_STATUSES = tuple("supported", "beta", "planned", "retired");
export type GameStatus = (typeof GAME_STATUSES)[number];

/* ------------------------------------------------------------------ hardware */

/** doc 20 §20.6 — how much we trust the DPI the user gave us (`SENS-BR-005`). */
export const DPI_SOURCES = tuple("known", "assumed", "estimated");
export type DpiSource = (typeof DPI_SOURCES)[number];

export const GRIPS = tuple("palm", "claw", "fingertip", "unknown");
export type Grip = (typeof GRIPS)[number];

export const OS_FAMILIES = tuple("windows", "macos", "linux", "other");
export type OsFamily = (typeof OS_FAMILIES)[number];

/* ------------------------------------------------------------------ sessions */

export const SESSION_MODES = tuple("quick", "standard", "advanced", "validation", "fine_tune");
export type SessionMode = (typeof SESSION_MODES)[number];

export const SESSION_STATUSES = tuple(
  "created",
  "in_progress",
  "paused",
  "completed",
  "abandoned",
  "invalidated",
);
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ENVIRONMENT_CLASSES = tuple("pass", "degraded");
export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number];

/** doc 20 §20.7 — queryable session-level quality problems (`SENS-BR-010`). */
export const SESSION_QUALITY_FLAGS = tuple(
  "no_raw_input",
  "frame_degradation",
  "unstable_pointer_lock",
  "long_gap",
  "window_resized",
  "dpi_inconsistent",
  "high_invalid_rate",
  "drift_fallback",
);
export type SessionQualityFlag = (typeof SESSION_QUALITY_FLAGS)[number];

/* ------------------------------------------------------------------ trials */

export const TRIAL_VALIDITIES = tuple("valid", "degraded", "invalid");
export type TrialValidity = (typeof TRIAL_VALIDITIES)[number];

/**
 * doc 09 §9.0.5 and `SENS-BR-009`.
 *
 * Every reason here is *procedural*. None of them describes how well the player performed.
 * A trial is never invalidated for being a bad trial — that would manufacture a flattering,
 * false result. An architecture test asserts this list contains no performance-derived code.
 */
export const INVALID_REASONS = tuple(
  "pointer_lock_lost",
  "focus_lost",
  "frame_hitch",
  "timeout",
  "impossible_velocity",
  "no_input",
  "premature_click",
  "premature_movement",
  "extra_shot",
  "button_held_ratio_low",
  "insufficient_kills",
);
export type InvalidReason = (typeof INVALID_REASONS)[number];

/* ------------------------------------------------------------------ metrics & scoring */

/** doc 10 — is a larger value better, worse, or neither? */
export const METRIC_DIRECTIONS = tuple("higher_better", "lower_better", "neutral");
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

/** doc 10 §10.7 — how trial values roll up to a round value. */
export const METRIC_AGGREGATIONS = tuple(
  "median",
  "mean",
  "time_weighted_mean",
  "proportion",
  "rms",
);
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

/** doc 14 §14.5 — the six skill dimensions. */
export const DIMENSION_KEYS = tuple(
  "flick",
  "precision",
  "tracking",
  "speed",
  "control",
  "consistency",
);
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/* ------------------------------------------------------------------ calibration */

/** doc 13 §13.11 / doc 16 §16.4. */
export const CALIBRATION_VERDICTS = tuple("peak_found", "indistinguishable", "insufficient_data");
export type CalibrationVerdict = (typeof CALIBRATION_VERDICTS)[number];

/** doc 13 §13.8 / §13.10 — what the search decided after a round. */
export const CALIBRATION_DECISIONS = tuple(
  "narrow",
  "narrow_conservative",
  "shift",
  "stop_converged",
  "stop_indistinguishable",
  "stop_budget",
  "stop_quality",
  "stop_fatigue",
);
export type CalibrationDecision = (typeof CALIBRATION_DECISIONS)[number];

/** doc 20 §20.7 — where a candidate came from. */
export const CANDIDATE_SOURCES = tuple(
  "initial",
  "narrowed",
  "shifted",
  "anchor",
  "fine_tune",
  "validation_original",
  "validation_recommended",
);
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const DRIFT_FORMS = tuple("spline", "linear_fallback");
export type DriftForm = (typeof DRIFT_FORMS)[number];

/** doc 17 §17.3 — the only source of validation headline wording (`SENS-BR-016`). */
export const VALIDATION_VERDICTS = tuple("improved", "no_measurable_difference", "worse");
export type ValidationVerdict = (typeof VALIDATION_VERDICTS)[number];

/** doc 13 §13.4 — which input bound the low-sensitivity end of the search. */
export const CONSTRAINT_SOURCES = tuple("pad_width", "measured", "none");
export type ConstraintSource = (typeof CONSTRAINT_SOURCES)[number];

/** doc 15 §15.5 — reliability of derived game settings, reported separately from confidence. */
export const SETTINGS_RELIABILITIES = tuple("normal", "estimated_dpi", "assumed_dpi");
export type SettingsReliability = (typeof SETTINGS_RELIABILITIES)[number];

/* ------------------------------------------------------------------ algorithms */

export const ALGORITHM_KINDS = tuple(
  "scoring",
  "calibration",
  "confidence",
  "aim_profile",
  "reference_distribution",
);
export type AlgorithmKind = (typeof ALGORITHM_KINDS)[number];

/* ------------------------------------------------------------------ auth */

export const AUTH_PROVIDERS = tuple("password", "google", "discord");
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const AUTH_TOKEN_PURPOSES = tuple("email_verify", "password_reset");
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const USER_STATUSES = tuple("active", "suspended", "pending_deletion");
export type UserStatus = (typeof USER_STATUSES)[number];

export const UNIT_PREFERENCES = tuple("metric", "imperial");
export type UnitPreference = (typeof UNIT_PREFERENCES)[number];

export const MOTION_PREFERENCES = tuple("system", "reduced", "full");
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

/* ------------------------------------------------------------------ tests */

/** doc 09 — the MVP aim-test roster. Post-MVP tests are added in Phase 6. */
export const TEST_KEYS = tuple(
  "reaction",
  "flick",
  "micro",
  "tracking",
  "switching",
  "precision",
  "comfort360",
);
export type TestKey = (typeof TEST_KEYS)[number];

export const TEST_CATEGORIES = tuple("baseline", "scored", "constraint");
export type TestCategory = (typeof TEST_CATEGORIES)[number];

/* ------------------------------------------------------------------ telemetry & consent */

export const CONSENT_SCOPES = tuple("raw_telemetry", "aggregate_research");
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const TELEMETRY_FORMATS = tuple("binary_v1");
export type TelemetryFormat = (typeof TELEMETRY_FORMATS)[number];

export const USER_GAME_SETTING_SOURCES = tuple("user_entered", "from_recommendation");
export type UserGameSettingSource = (typeof USER_GAME_SETTING_SOURCES)[number];
