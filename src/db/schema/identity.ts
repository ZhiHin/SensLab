import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, citext } from "./column-types";
import {
  authProviderEnum,
  authTokenPurposeEnum,
  motionPreferenceEnum,
  unitPreferenceEnum,
  userStatusEnum,
} from "./enums";

/**
 * Identity and access (doc 20 §20.3).
 *
 * Two structural decisions worth noting:
 *
 *  - Credentials live in `auth_identities`, not on `users`. A password account and an OAuth
 *    account are then the same shape from day one, so adding Google or Discord later is a
 *    row, not a migration (ADR-022).
 *  - `guest_sessions` exists so that guest ownership is a *server-issued* identity. The claim
 *    flow reads the cookie and resolves this row; a client-supplied session id is never
 *    accepted, which is what makes "this anonymous result is now mine" safe (`SENS-SEC-018`).
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    status: userStatusEnum("status").notNull().default("active"),
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  locale: text("locale").notNull().default("en"),
  unitPreference: unitPreferenceEnum("unit_preference").notNull().default("metric"),
  motionPreference: motionPreferenceEnum("motion_preference").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: authProviderEnum("provider").notNull(),
    /** For `password`, the normalised email. For OAuth, the provider's subject identifier. */
    providerAccountId: text("provider_account_id").notNull(),
    /** Argon2id digest for `password`; null for OAuth identities. */
    secretHash: text("secret_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
    uniqueIndex("auth_identities_user_provider_unique").on(table.userId, table.provider),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** HMAC of the opaque token. The token itself is never stored (`SENS-SEC-003`). */
    tokenHash: bytea("token_hash").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Salted hashes, 30-day retention, abuse mitigation only (doc 23 §23.9). */
    ipHash: bytea("ip_hash"),
    userAgentHash: bytea("user_agent_hash"),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt),
    index("auth_sessions_active_idx")
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: authTokenPurposeEnum("purpose").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Single use, enforced inside the consuming transaction (`SENS-SEC-011`). */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_tokens_token_hash_unique").on(table.tokenHash),
    index("auth_tokens_user_purpose_idx").on(table.userId, table.purpose),
  ],
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey(),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Guest results expire after seven days (`SENS-BR-003`). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("guest_sessions_token_hash_unique").on(table.tokenHash),
    index("guest_sessions_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.claimedByUserId} is null`),
  ],
);

/**
 * Fixed-window rate-limit counters (doc 23 §23.8).
 *
 * A database table rather than Redis at MVP: the volumes do not justify another piece of
 * infrastructure, and a database-backed limiter is correct across instances without one.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rate_limit_counters_pk").on(table.bucket, table.windowStart),
    index("rate_limit_counters_window_idx").on(table.windowStart),
  ],
);

export const isActiveSession = (revokedAt: Date | null, expiresAt: Date, now: Date): boolean =>
  revokedAt === null && expiresAt.getTime() > now.getTime();

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type GuestSessionRow = typeof guestSessions.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
