import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  adsModelEnum,
  conversionMethodEnum,
  fovAxisEnum,
  gameRegionEnum,
  gameStatusEnum,
  modelFormEnum,
  scopeKeyEnum,
  userGameSettingSourceEnum,
  verificationStatusEnum,
} from "./enums";
import { hardwareProfiles } from "./hardware";
import { users } from "./identity";

/**
 * Games, versions and their sensitivity models (doc 20 §20.4).
 *
 * The separation of `game_versions` from `game_sensitivity_models` is deliberate and load
 * bearing: a patch can change one scope's behaviour without touching the others, so
 * verification status has to be tracked at **scope** granularity, not per game. That is why
 * PUBG can legitimately reach "hipfire verified, scopes not" and the product can present
 * that state honestly instead of rounding it to verified or unverified.
 */

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    /** Locale → name. Justified JSONB: fixed-shape, written whole, never joined. */
    displayNameLocalized: jsonb("display_name_localized").notNull().default({}),
    region: gameRegionEnum("region").notNull(),
    engineFamily: text("engine_family"),
    status: gameStatusEnum("status").notNull().default("supported"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("games_slug_unique").on(table.slug)],
);

export const gameVersions = pgTable(
  "game_versions",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    versionLabel: text("version_label").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedAgainstBuild: text("verified_against_build"),
    /** Evidence pointers. Justified JSONB: heterogeneous, append-only reference list. */
    sourceRefs: jsonb("source_refs").notNull().default([]),
    /** Must match the compiled adapter module at boot, or startup fails (doc 12 §12.4). */
    adapterModuleVersion: text("adapter_module_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("game_versions_game_label_unique").on(table.gameId, table.versionLabel),
    uniqueIndex("game_versions_one_current_per_game")
      .on(table.gameId)
      .where(sql`${table.isCurrent}`),
    check(
      "game_versions_verified_has_evidence",
      sql`(${table.verificationStatus} not in ('verified','needs_recheck'))
          or (${table.verifiedAt} is not null and ${table.verifiedAgainstBuild} is not null)`,
    ),
  ],
);

export const gameScopes = pgTable(
  "game_scopes",
  {
    id: uuid("id").primaryKey(),
    gameVersionId: uuid("game_version_id")
      .notNull()
      .references(() => gameVersions.id, { onDelete: "cascade" }),
    scopeKey: scopeKeyEnum("scope_key").notNull(),
    displayNameLocalized: jsonb("display_name_localized").notNull().default({}),
    /**
     * The in-game label, per locale. Part of the adapter data rather than the UI translation
     * layer: a copyable value is useless if the user cannot find the field it belongs in
     * (doc 08 §8.7).
     */
    settingLabelLocalized: jsonb("setting_label_localized").notNull().default({}),
    magnification: numeric("magnification"),
    hasSeparateSetting: boolean("has_separate_setting").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("game_scopes_version_scope_unique").on(table.gameVersionId, table.scopeKey),
  ],
);

export const gameSensitivityModels = pgTable(
  "game_sensitivity_models",
  {
    id: uuid("id").primaryKey(),
    gameVersionId: uuid("game_version_id")
      .notNull()
      .references(() => gameVersions.id, { onDelete: "cascade" }),
    scopeKey: scopeKeyEnum("scope_key").notNull(),
    modelForm: modelFormEnum("model_form").notNull(),
    /** Form-specific parameters. Justified JSONB: the shape varies by `model_form`. */
    params: jsonb("params").notNull(),
    settingMin: numeric("setting_min").notNull(),
    settingMax: numeric("setting_max").notNull(),
    settingStep: numeric("setting_step").notNull(),
    settingDecimals: smallint("setting_decimals").notNull(),
    /** Whether the game already applies its own FOV scaling to ADS (doc 11 §11.6.4). */
    adsModel: adsModelEnum("ads_model").notNull().default("unknown"),
    fovAxis: fovAxisEnum("fov_axis"),
    fovScaling: text("fov_scaling"),
    fovMin: numeric("fov_min"),
    fovMax: numeric("fov_max"),
    defaultMatchCriterion: conversionMethodEnum("default_match_criterion"),
    defaultMatchCoefficient: numeric("default_match_coefficient"),
    /** Verification is per scope, not per game. */
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("game_sensitivity_models_version_scope_unique").on(
      table.gameVersionId,
      table.scopeKey,
    ),
    check("game_sensitivity_models_range", sql`${table.settingMin} < ${table.settingMax}`),
    check("game_sensitivity_models_step_positive", sql`${table.settingStep} > 0`),
  ],
);

export const userGameSettings = pgTable(
  "user_game_settings",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameVersionId: uuid("game_version_id")
      .notNull()
      .references(() => gameVersions.id, { onDelete: "cascade" }),
    hardwareProfileId: uuid("hardware_profile_id").references(() => hardwareProfiles.id, {
      onDelete: "cascade",
    }),
    scopeKey: scopeKeyEnum("scope_key").notNull(),
    sensitivity: numeric("sensitivity").notNull(),
    fovDeg: numeric("fov_deg"),
    source: userGameSettingSourceEnum("source").notNull().default("user_entered"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_game_settings_unique").on(
      table.userId,
      table.gameVersionId,
      table.hardwareProfileId,
      table.scopeKey,
    ),
    index("user_game_settings_user_idx").on(table.userId),
    // The unique index leads with `user_id`, so it cannot serve the cascade from a deleted
    // hardware profile.
    index("user_game_settings_hardware_profile_idx").on(table.hardwareProfileId),
  ],
);

export type GameRow = typeof games.$inferSelect;
export type GameVersionRow = typeof gameVersions.$inferSelect;
