import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./column-types";
import {
  algorithmKindEnum,
  metricAggregationEnum,
  metricDirectionEnum,
  testCategoryEnum,
} from "./enums";

/**
 * Versioned algorithms and the controlled vocabularies they operate on (doc 20 §20.5).
 *
 * `algorithm_versions` is **insert-only**. A released parameter set is immutable
 * (`SENS-BR-029`) — otherwise every historical result silently changes meaning the next time
 * a weight is nudged. A database trigger enforces it; the migration that creates the trigger
 * lives alongside this schema, because a rule that exists only in application code is a rule
 * that a future script will bypass.
 */

export const algorithmVersions = pgTable(
  "algorithm_versions",
  {
    id: uuid("id").primaryKey(),
    kind: algorithmKindEnum("kind").notNull(),
    versionLabel: text("version_label").notNull(),
    /** The full immutable parameter set. Justified JSONB: written once, read whole. */
    params: jsonb("params").notNull(),
    /** SHA-256 of the canonical serialisation, verified against the code at boot. */
    paramsHash: bytea("params_hash").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("algorithm_versions_kind_label_unique").on(table.kind, table.versionLabel),
  ],
);

/**
 * The metric vocabulary (doc 10).
 *
 * A foreign key from `trial_metrics` and `round_metrics` closes the vocabulary: a metric that
 * is not declared here cannot be stored, which is what keeps the narrow keyed metric tables
 * honest (ADR-012).
 */
export const metricDefinitions = pgTable("metric_definitions", {
  key: text("key").primaryKey(),
  displayName: text("display_name").notNull(),
  unit: text("unit").notNull(),
  direction: metricDirectionEnum("direction").notNull(),
  aggregation: metricAggregationEnum("aggregation").notNull(),
  description: text("description").notNull(),
  /** Participates in the calibration objective (doc 10 §10.9). */
  isDecisionMetric: boolean("is_decision_metric").notNull().default(false),
  version: integer("version").notNull().default(1),
});

export const testDefinitions = pgTable(
  "test_definitions",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    displayName: text("display_name").notNull(),
    category: testCategoryEnum("category").notNull(),
    /** Declarative test configuration. Justified JSONB (doc 19 §19.9). */
    config: jsonb("config").notNull(),
    engineMinVersion: text("engine_min_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("test_definitions_key_version_unique").on(table.key, table.version)],
);

export const aimProfiles = pgTable("aim_profiles", {
  key: text("key").primaryKey(),
  displayNameLocalized: jsonb("display_name_localized").notNull().default({}),
  descriptionLocalized: jsonb("description_localized").notNull().default({}),
  ruleVersion: text("rule_version").notNull(),
});

export type AlgorithmVersionRow = typeof algorithmVersions.$inferSelect;
export type MetricDefinitionRow = typeof metricDefinitions.$inferSelect;
