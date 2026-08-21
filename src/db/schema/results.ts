import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aimProfiles, algorithmVersions, metricDefinitions } from "./algorithms";
import {
  calibrationVerdictEnum,
  constraintSourceEnum,
  conversionMethodEnum,
  dimensionKeyEnum,
  scopeKeyEnum,
  settingsReliabilityEnum,
  validationVerdictEnum,
} from "./enums";
import { gameVersions } from "./games";
import { calibrationCandidates, testSessions } from "./sessions";

/**
 * Recommendations and their derivatives (doc 20 §20.8).
 *
 * The central rule this schema enforces: **the canonical value is physical**
 * (`SENS-BR-025`). `recommended_counts_360` is authoritative;
 * `recommendation_game_settings` is a regenerable cache. Game constants change with patches,
 * so a stored game number silently rots while a stored counts/360 does not — and it is what
 * makes "re-derive this old result under the corrected model" possible at all.
 */

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    verdict: calibrationVerdictEnum("verdict").notNull(),

    /** Canonical. Null exactly when no peak was found — never a fabricated point estimate. */
    recommendedCounts360: doublePrecision("recommended_counts_360"),
    recommendedCm360: doublePrecision("recommended_cm_360"),

    /** Statistical interval on the location of the peak (doc 16 §16.3). */
    hpRangeLowCm360: doublePrecision("hp_range_low_cm360"),
    hpRangeHighCm360: doublePrecision("hp_range_high_cm360"),
    hpRangeLevel: real("hp_range_level").notNull().default(0.9),

    /** Practical plateau. Always present, and the only output when the curve is flat. */
    comfortRangeLowCm360: doublePrecision("comfort_range_low_cm360").notNull(),
    comfortRangeHighCm360: doublePrecision("comfort_range_high_cm360").notNull(),

    constraintMaxCm360: doublePrecision("constraint_max_cm360"),
    constraintSource: constraintSourceEnum("constraint_source").notNull().default("none"),

    confidenceIndex: smallint("confidence_index").notNull(),
    /** The seven named components (doc 15 §15.2). Justified JSONB: fixed-shape, never joined. */
    confidenceBreakdown: jsonb("confidence_breakdown").notNull(),
    /** Reported separately from confidence, because DPI does not affect the measurement. */
    settingsReliability: settingsReliabilityEnum("settings_reliability").notNull(),

    aimProfileKey: text("aim_profile_key").references(() => aimProfiles.key),
    /** Structured and localisable, carrying the measured values that triggered the rule. */
    aimProfileExplanation: jsonb("aim_profile_explanation").notNull().default({}),

    /** Everything needed to redraw the evidence chart without re-running the fit. */
    responseCurve: jsonb("response_curve").notNull(),

    /** What the user is actually told to use after validation — may be their original. */
    acceptedCounts360: doublePrecision("accepted_counts_360"),

    scoringVersionId: uuid("scoring_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
    calibrationVersionId: uuid("calibration_version_id")
      .notNull()
      .references(() => algorithmVersions.id),
    confidenceVersionId: uuid("confidence_version_id")
      .notNull()
      .references(() => algorithmVersions.id),

    parentRecommendationId: uuid("parent_recommendation_id"),
    supersededById: uuid("superseded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("recommendations_session_unique").on(table.sessionId),
    index("recommendations_created_idx").on(table.createdAt.desc()),
    check(
      "recommendations_peak_has_value",
      sql`${table.verdict} <> 'peak_found'
          or (${table.recommendedCounts360} is not null and ${table.recommendedCm360} is not null)`,
    ),
    check(
      "recommendations_comfort_range_ordered",
      sql`${table.comfortRangeLowCm360} <= ${table.comfortRangeHighCm360}`,
    ),
    // The comfort range always contains the high-performance range (doc 16 §16.3).
    check(
      "recommendations_ranges_nested",
      sql`${table.hpRangeLowCm360} is null
          or (${table.hpRangeLowCm360} >= ${table.comfortRangeLowCm360}
              and ${table.hpRangeHighCm360} <= ${table.comfortRangeHighCm360})`,
    ),
    check("recommendations_confidence_range", sql`${table.confidenceIndex} between 0 and 100`),
  ],
);

export const recommendationDimensionScores = pgTable(
  "recommendation_dimension_scores",
  {
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    dimensionKey: dimensionKeyEnum("dimension_key").notNull(),
    score: real("score").notNull(),
    /** Position relative to the player's own dimension mean, in their own spread units. */
    shape: real("shape").notNull(),
    /** True while the reference distribution is provisional (doc 14 §14.4). */
    isProvisional: boolean("is_provisional").notNull().default(true),
    n: integer("n").notNull(),
  },
  (table) => [primaryKey({ columns: [table.recommendationId, table.dimensionKey] })],
);

/**
 * Converted game settings.
 *
 * **No row is ever written for an unverified model** (`SENS-BR-014`). The absence of a row
 * *is* the unverified state, which means there is no stale number to leak into an export, a
 * share card, or a feature nobody has written yet.
 */
export const recommendationGameSettings = pgTable(
  "recommendation_game_settings",
  {
    id: uuid("id").primaryKey(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    gameVersionId: uuid("game_version_id")
      .notNull()
      .references(() => gameVersions.id),
    scopeKey: scopeKeyEnum("scope_key").notNull(),
    /** The DPI the conversion assumed. */
    dpi: integer("dpi").notNull(),
    settingKey: text("setting_key").notNull().default("sensitivity"),
    settingValue: numeric("setting_value").notNull(),
    idealSettingValue: numeric("ideal_setting_value").notNull(),
    /** Recomputed from the quantised value — what the player will actually get. */
    achievedCounts360: doublePrecision("achieved_counts_360").notNull(),
    quantisationErrorPct: real("quantisation_error_pct").notNull(),
    wasClamped: boolean("was_clamped").notNull().default(false),
    fovDeg: numeric("fov_deg"),
    conversionMethod: conversionMethodEnum("conversion_method").notNull(),
    conversionCoefficient: real("conversion_coefficient"),
    /** `SENS-BR-026` — every emitted value records what produced it. */
    adapterVersion: text("adapter_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("recommendation_game_settings_unique").on(
      table.recommendationId,
      table.gameVersionId,
      table.scopeKey,
      table.settingKey,
      table.conversionMethod,
    ),
    index("recommendation_game_settings_recommendation_idx").on(table.recommendationId),
  ],
);

export const validationRuns = pgTable(
  "validation_runs",
  {
    id: uuid("id").primaryKey(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    baselineCounts360: doublePrecision("baseline_counts_360").notNull(),
    candidateCounts360: doublePrecision("candidate_counts_360").notNull(),
    /** The only source of headline wording (`SENS-BR-016`). */
    verdict: validationVerdictEnum("verdict").notNull(),
    compositeDelta: doublePrecision("composite_delta").notNull(),
    compositeCiLow: doublePrecision("composite_ci_low").notNull(),
    compositeCiHigh: doublePrecision("composite_ci_high").notNull(),
    blockCount: smallint("block_count").notNull(),
    confidenceBefore: smallint("confidence_before").notNull(),
    confidenceAfter: smallint("confidence_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("validation_runs_recommendation_unique").on(table.recommendationId),
    check("validation_runs_ci_ordered", sql`${table.compositeCiLow} <= ${table.compositeCiHigh}`),
    // The verdict must agree with the interval: "improved" requires an interval excluding
    // zero on the positive side, "worse" on the negative side. Enforced here so no code path
    // can persist a claim the data does not support.
    check(
      "validation_runs_verdict_matches_interval",
      sql`(${table.verdict} = 'improved' and ${table.compositeCiLow} > 0)
          or (${table.verdict} = 'worse' and ${table.compositeCiHigh} < 0)
          or (${table.verdict} = 'no_measurable_difference'
              and ${table.compositeCiLow} <= 0 and ${table.compositeCiHigh} >= 0)`,
    ),
  ],
);

export const validationMetricDeltas = pgTable(
  "validation_metric_deltas",
  {
    validationRunId: uuid("validation_run_id")
      .notNull()
      .references(() => validationRuns.id, { onDelete: "cascade" }),
    metricKey: text("metric_key")
      .notNull()
      .references(() => metricDefinitions.key),
    delta: doublePrecision("delta").notNull(),
    deltaPct: real("delta_pct"),
    ciLow: doublePrecision("ci_low").notNull(),
    ciHigh: doublePrecision("ci_high").notNull(),
    isSignificant: boolean("is_significant").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.validationRunId, table.metricKey] }),
    // Significance is derived from the interval, never asserted independently.
    check(
      "validation_metric_deltas_significance_matches_interval",
      sql`${table.isSignificant} = ((${table.ciLow} > 0) or (${table.ciHigh} < 0))`,
    ),
  ],
);

/**
 * What the player said felt best, recorded after the reveal.
 *
 * Never used in any computation (`SENS-BR-002`, doc 17 §17.8). It exists so a user can notice
 * when their preference disagrees with their measurement, and so that a future model could
 * one day study how felt preference relates to measured optimum.
 */
export const subjectivePreferences = pgTable("subjective_preferences", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => testSessions.id, { onDelete: "cascade" }),
  chosenCandidateId: uuid("chosen_candidate_id")
    .notNull()
    .references(() => calibrationCandidates.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecommendationRow = typeof recommendations.$inferSelect;
export type RecommendationGameSettingRow = typeof recommendationGameSettings.$inferSelect;
