import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { algorithmVersions, metricDefinitions, testDefinitions } from "./algorithms";
import {
  calibrationDecisionEnum,
  candidateSourceEnum,
  dimensionKeyEnum,
  driftFormEnum,
  environmentClassEnum,
  invalidReasonEnum,
  scopeKeyEnum,
  sessionModeEnum,
  sessionQualityFlagEnum,
  sessionStatusEnum,
  trialValidityEnum,
} from "./enums";
import { gameVersions } from "./games";
import { hardwareProfiles } from "./hardware";
import { guestSessions, users } from "./identity";

/**
 * Calibration sessions and everything the search produces (doc 20 §20.7).
 *
 * Naming note, because two collisions in this area are the most likely source of a confusing
 * bug in this codebase (doc 35): a **`test_session`** is a calibration run, not an auth
 * session; a **`calibration_round`** is a step of the adaptive search, while a **`test_round`**
 * is one candidate × one aim test.
 */

export const testSessions = pgTable(
  "test_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestSessionId: uuid("guest_session_id").references(() => guestSessions.id, {
      onDelete: "cascade",
    }),
    hardwareProfileId: uuid("hardware_profile_id").references(() => hardwareProfiles.id, {
      onDelete: "set null",
    }),
    /**
     * Immutable copy of the hardware at session creation (`SENS-BR-035`).
     *
     * Editing a hardware profile must never rewrite history: a recommendation is only valid
     * for the hardware that produced it, and a session whose DPI silently changed is a
     * session whose stored cm/360 has quietly become wrong.
     */
    hardwareSnapshot: jsonb("hardware_snapshot").notNull(),
    primaryGameVersionId: uuid("primary_game_version_id").references(() => gameVersions.id, {
      onDelete: "set null",
    }),
    mode: sessionModeEnum("mode").notNull(),
    status: sessionStatusEnum("status").notNull().default("created"),
    /** Full environment fingerprint (doc 20 §20.12). Justified JSONB. */
    environment: jsonb("environment").notNull(),
    environmentClass: environmentClassEnum("environment_class").notNull(),
    seed: bigint("seed", { mode: "bigint" }).notNull(),
    parentSessionId: uuid("parent_session_id"),
    scoringVersionId: uuid("scoring_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
    calibrationVersionId: uuid("calibration_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
    confidenceVersionId: uuid("confidence_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "test_sessions_single_owner",
      sql`(${table.userId} is null) <> (${table.guestSessionId} is null)`,
    ),
    check(
      "test_sessions_completed_has_timestamp",
      sql`${table.status} <> 'completed' or ${table.completedAt} is not null`,
    ),
    index("test_sessions_user_started_idx").on(table.userId, table.startedAt.desc()),
    index("test_sessions_guest_idx").on(table.guestSessionId),
    index("test_sessions_hardware_started_idx").on(table.hardwareProfileId, table.startedAt.desc()),
    // Drives the abandonment sweeper (doc 20 §20.10).
    index("test_sessions_sweeper_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} in ('created','in_progress','paused')`),
  ],
);

/**
 * Queryable session quality problems (`SENS-BR-010`).
 *
 * A table rather than an array column so that "how often does raw input fail on Firefox?" is
 * a join rather than a full scan — that question is the whole point of the quality dashboards
 * (doc 22 §22.7), and it feeds EV-010.
 */
export const sessionQualityFlags = pgTable(
  "session_quality_flags",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    flag: sessionQualityFlagEnum("flag").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.flag] }),
    index("session_quality_flags_flag_idx").on(table.flag),
  ],
);

export const calibrationCandidates = pgTable(
  "calibration_candidates",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    roundIndex: smallint("round_index").notNull(),
    candidateIndex: smallint("candidate_index").notNull(),
    /** Canonical (ADR-004). */
    countsPer360: doublePrecision("counts_per_360").notNull(),
    /** Derived at write time from the session's DPI. */
    cmPer360: doublePrecision("cm_per_360").notNull(),
    /** Opaque label shown to the player; re-shuffled every round (`SENS-BR-007`). */
    blindLabel: text("blind_label").notNull(),
    source: candidateSourceEnum("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("calibration_candidates_unique").on(
      table.sessionId,
      table.roundIndex,
      table.candidateIndex,
    ),
    check("calibration_candidates_counts_positive", sql`${table.countsPer360} > 0`),
  ],
);

/**
 * The audit trail of the adaptive search (FR-069).
 *
 * Without this table a recommendation cannot be explained: "why did it end there?" has no
 * answer beyond the final number, and `SENS-BR-030`'s recompute guarantee has nothing to
 * check itself against.
 */
export const calibrationRounds = pgTable(
  "calibration_rounds",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    roundIndex: smallint("round_index").notNull(),
    bracketLow: doublePrecision("bracket_low").notNull(),
    bracketHigh: doublePrecision("bracket_high").notNull(),
    fitB0: doublePrecision("fit_b0"),
    fitB1: doublePrecision("fit_b1"),
    fitB2: doublePrecision("fit_b2"),
    fitR2Adj: doublePrecision("fit_r2_adj"),
    fitConcave: boolean("fit_concave"),
    xStar: doublePrecision("x_star"),
    xStarCiLow: doublePrecision("x_star_ci_low"),
    xStarCiHigh: doublePrecision("x_star_ci_high"),
    driftForm: driftFormEnum("drift_form").notNull(),
    driftDelta: doublePrecision("drift_delta").notNull(),
    driftConditionNumber: doublePrecision("drift_condition_number").notNull(),
    /** Smallest candidate difference the achieved sample size could have detected. */
    mde: doublePrecision("mde").notNull(),
    decision: calibrationDecisionEnum("decision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("calibration_rounds_unique").on(table.sessionId, table.roundIndex),
    check("calibration_rounds_bracket_ordered", sql`${table.bracketLow} <= ${table.bracketHigh}`),
  ],
);

export const testRounds = pgTable(
  "test_rounds",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    /** Null for sensitivity-independent tests (reaction, 360 comfort). */
    candidateId: uuid("candidate_id").references(() => calibrationCandidates.id, {
      onDelete: "cascade",
    }),
    testDefinitionId: uuid("test_definition_id")
      .notNull()
      .references(() => testDefinitions.id),
    /** Present from Phase 1 so post-MVP scope work needs no migration. MVP uses `hipfire`. */
    scopeKey: scopeKeyEnum("scope_key").notNull().default("hipfire"),
    blockIndex: smallint("block_index").notNull(),
    /**
     * Global, monotonic ordering within the session.
     *
     * The unique constraint on `(session_id, presentation_order)` is what makes round ingest
     * idempotent (`SENS-NFR-016`): a retried upload conflicts instead of duplicating.
     */
    presentationOrder: integer("presentation_order").notNull(),
    isPractice: boolean("is_practice").notNull().default(false),
    status: sessionStatusEnum("status").notNull().default("created"),
    configOverrides: jsonb("config_overrides").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("test_rounds_presentation_unique").on(table.sessionId, table.presentationOrder),
    index("test_rounds_session_block_idx").on(table.sessionId, table.blockIndex),
    index("test_rounds_candidate_idx").on(table.candidateId),
  ],
);

export const testTrials = pgTable(
  "test_trials",
  {
    id: uuid("id").primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => testRounds.id, { onDelete: "cascade" }),
    trialIndex: smallint("trial_index").notNull(),
    isPractice: boolean("is_practice").notNull().default(false),
    validity: trialValidityEnum("validity").notNull(),
    invalidReason: invalidReasonEnum("invalid_reason"),
    isReplacement: boolean("is_replacement").notNull().default(false),
    startOffsetMs: doublePrecision("start_offset_ms").notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    hit: boolean("hit"),
    shots: smallint("shots").notNull().default(0),
    targetAngularRadiusDeg: doublePrecision("target_angular_radius_deg"),
    targetDistanceDeg: doublePrecision("target_distance_deg"),
    targetDirectionDeg: doublePrecision("target_direction_deg"),
    /** Reproduces the exact stimulus this trial presented (`SENS-BR-031`). */
    stimulusSeed: text("stimulus_seed").notNull(),
    /**
     * What this trial presented, where the test has more than one kind of trial.
     *
     * Null for tests whose trials are all the same. The comfort test's three sub-tasks measure
     * genuinely different quantities, and an analysis that could not tell them apart would
     * average a swipe distance against a return error.
     */
    variant: text("variant"),
    cleanFrameFraction: real("clean_frame_fraction").notNull(),
    qualityFlags: text("quality_flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("test_trials_round_index_unique").on(table.roundId, table.trialIndex),
    index("test_trials_round_idx").on(table.roundId),
    // A reason is present exactly when the trial is invalid — and every reason in the enum is
    // procedural, so a trial can never be excluded for performing badly (`SENS-BR-009`).
    check(
      "test_trials_invalid_reason_iff_invalid",
      sql`(${table.validity} = 'invalid') = (${table.invalidReason} is not null)`,
    ),
    check(
      "test_trials_clean_frame_fraction_range",
      sql`${table.cleanFrameFraction} between 0 and 1`,
    ),
  ],
);

/**
 * Trial-level metric values (ADR-012).
 *
 * Narrow and keyed rather than wide: the metric set grows with the post-MVP tests, and it is
 * sparse (a tracking metric is meaningless on a flick trial). The composite primary key is
 * also the covering index for the only access pattern — "all metrics for these trials".
 */
export const trialMetrics = pgTable(
  "trial_metrics",
  {
    trialId: uuid("trial_id")
      .notNull()
      .references(() => testTrials.id, { onDelete: "cascade" }),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    value: doublePrecision("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trialId, table.metricKey] })],
);

/**
 * Round-level aggregates.
 *
 * The common read path — a results page, a history list — uses these and never touches
 * trial-level data. Sample counts are `NOT NULL` because a metric value without its sample
 * count is not storable (doc 10 §10.10).
 */
export const roundMetrics = pgTable(
  "round_metrics",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => testRounds.id, { onDelete: "cascade" }),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    value: doublePrecision("value").notNull(),
    validTrials: integer("valid_trials").notNull(),
    invalidTrials: integer("invalid_trials").notNull(),
    degradedTrials: integer("degraded_trials").notNull(),
    robustSd: doublePrecision("robust_sd"),
    ciLow: doublePrecision("ci_low"),
    ciHigh: doublePrecision("ci_high"),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.metricKey] }),
    check(
      "round_metrics_counts_non_negative",
      sql`${table.validTrials} >= 0 and ${table.invalidTrials} >= 0 and ${table.degradedTrials} >= 0`,
    ),
  ],
);

export const candidateScores = pgTable(
  "candidate_scores",
  {
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => calibrationCandidates.id, { onDelete: "cascade" }),
    dimensionKey: dimensionKeyEnum("dimension_key").notNull(),
    score: doublePrecision("score").notNull(),
    se: doublePrecision("se").notNull(),
    n: integer("n").notNull(),
    /** De-drifted candidate effect (α̂), null until the drift model has been fitted. */
    alphaHat: doublePrecision("alpha_hat"),
    scoringVersionId: uuid("scoring_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
  },
  (table) => [primaryKey({ columns: [table.candidateId, table.dimensionKey] })],
);

export type TestSessionRow = typeof testSessions.$inferSelect;
export type NewTestSessionRow = typeof testSessions.$inferInsert;
export type TestRoundRow = typeof testRounds.$inferSelect;
export type TestTrialRow = typeof testTrials.$inferSelect;
