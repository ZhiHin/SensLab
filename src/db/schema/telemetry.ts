import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { consentScopeEnum, telemetryFormatEnum } from "./enums";
import { guestSessions, users } from "./identity";
import { testRounds, testSessions } from "./sessions";

/**
 * Consent, telemetry pointers and product analytics (doc 20 §20.9, doc 22).
 *
 * What is *absent* from this file is the point: **there is no table for raw pointer
 * telemetry** (`SENS-BR-032`, `SENS-NFR-022`). A session produces ~1.5 million pointer
 * samples; none of them are needed for the recommendation, all of them are a behavioural
 * biometric, and data that was never collected cannot leak. Raw streams live in device memory
 * and are discarded.
 *
 * When a user explicitly opts in, compressed batches go to **object storage** and only a
 * pointer is recorded here.
 */

export const researchConsents = pgTable(
  "research_consents",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestSessionId: uuid("guest_session_id").references(() => guestSessions.id, {
      onDelete: "cascade",
    }),
    scope: consentScopeEnum("scope").notNull(),
    /** The policy text the user actually agreed to. Consent is versioned, not perpetual. */
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "research_consents_single_subject",
      sql`(${table.userId} is null) <> (${table.guestSessionId} is null)`,
    ),
    index("research_consents_subject_idx").on(table.userId, table.scope),
    // `on delete cascade` from a guest session, enforced per deleted parent row.
    index("research_consents_guest_session_idx").on(table.guestSessionId),
  ],
);

export const telemetryBatches = pgTable(
  "telemetry_batches",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => testSessions.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => testRounds.id, { onDelete: "cascade" }),
    /** Object-store key. The samples themselves never enter PostgreSQL. */
    storageKey: text("storage_key").notNull(),
    format: telemetryFormatEnum("format").notNull().default("binary_v1"),
    sampleCount: integer("sample_count").notNull(),
    byteSize: integer("byte_size").notNull(),
    /**
     * NOT NULL by design: a telemetry batch cannot exist without a consent record backing it
     * (`SENS-BR-033`). The schema, not a code path, is what guarantees that.
     */
    consentId: uuid("consent_id")
      .notNull()
      .references(() => researchConsents.id, { onDelete: "cascade" }),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("telemetry_batches_retention_idx").on(table.retentionExpiresAt),
    index("telemetry_batches_session_idx").on(table.sessionId),
    // Rounds and consents both cascade into this table; neither delete had an index to use.
    index("telemetry_batches_round_idx").on(table.roundId),
    index("telemetry_batches_consent_idx").on(table.consentId),
  ],
);

/**
 * Product analytics (FR-104).
 *
 * Continuous values are bucketed before emission and no event carries a metric array, an
 * email, or a raw recommendation value (doc 22 §22.6). A CI contract test asserts the
 * payload schema, because the rule matters more than the intention.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id").references(() => testSessions.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventKey: text("event_key").notNull(),
    properties: jsonb("properties").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analytics_events_key_time_idx").on(table.eventKey, table.occurredAt),
    // Both references are `on delete set null`, and Postgres enforces that with a query
    // against this table for every parent row removed. Unindexed, deleting one account or one
    // session sequentially scans what is designed to be the largest table in the schema —
    // which is exactly what account deletion (`SENS-SEC-021`) and the retention sweep
    // (`SENS-BR-003`) do, in bulk.
    index("analytics_events_session_idx").on(table.sessionId),
    index("analytics_events_user_idx").on(table.userId),
  ],
);

export type ResearchConsentRow = typeof researchConsents.$inferSelect;
export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
