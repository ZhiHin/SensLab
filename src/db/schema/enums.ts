import { pgEnum } from "drizzle-orm/pg-core";
import {
  ADS_MODELS,
  ALGORITHM_KINDS,
  AUTH_PROVIDERS,
  AUTH_TOKEN_PURPOSES,
  CALIBRATION_DECISIONS,
  CANDIDATE_SOURCES,
  CONSENT_SCOPES,
  CONSTRAINT_SOURCES,
  CONVERSION_METHODS,
  DIMENSION_KEYS,
  DPI_SOURCES,
  DRIFT_FORMS,
  ENVIRONMENT_CLASSES,
  FOV_AXES,
  GAME_REGIONS,
  GAME_STATUSES,
  GRIPS,
  INVALID_REASONS,
  METRIC_AGGREGATIONS,
  METRIC_DIRECTIONS,
  MODEL_FORMS,
  MOTION_PREFERENCES,
  OS_FAMILIES,
  SCOPE_KEYS,
  SESSION_MODES,
  SESSION_QUALITY_FLAGS,
  SESSION_STATUSES,
  SETTINGS_RELIABILITIES,
  TELEMETRY_FORMATS,
  TEST_CATEGORIES,
  TRIAL_VALIDITIES,
  UNIT_PREFERENCES,
  USER_GAME_SETTING_SOURCES,
  USER_STATUSES,
  VALIDATION_VERDICTS,
  VERIFICATION_STATUSES,
  CALIBRATION_VERDICTS,
} from "@/core/types/vocabulary";

/**
 * PostgreSQL enum types, generated from the single vocabulary declaration in
 * `core/types/vocabulary.ts`.
 *
 * Deriving them rather than restating them is the point: a database enum and a TypeScript
 * union that are typed out separately *will* drift, and the drift shows up as a runtime
 * constraint violation on a production insert. Here it is a compile error instead.
 *
 * Enum types also make raw rows readable in DBeaver (doc 21 §21.5), which matters when
 * someone is diagnosing a user's session at 2am.
 */

const values = <T extends readonly string[]>(list: T): [T[number], ...T[number][]] =>
  list as unknown as [T[number], ...T[number][]];

/* identity */
export const userStatusEnum = pgEnum("user_status", values(USER_STATUSES));
export const authProviderEnum = pgEnum("auth_provider", values(AUTH_PROVIDERS));
export const authTokenPurposeEnum = pgEnum("auth_token_purpose", values(AUTH_TOKEN_PURPOSES));
export const unitPreferenceEnum = pgEnum("unit_preference", values(UNIT_PREFERENCES));
export const motionPreferenceEnum = pgEnum("motion_preference", values(MOTION_PREFERENCES));

/* games */
export const gameRegionEnum = pgEnum("game_region", values(GAME_REGIONS));
export const gameStatusEnum = pgEnum("game_status", values(GAME_STATUSES));
export const scopeKeyEnum = pgEnum("scope_key", values(SCOPE_KEYS));
export const verificationStatusEnum = pgEnum("verification_status", values(VERIFICATION_STATUSES));
export const modelFormEnum = pgEnum("model_form", values(MODEL_FORMS));
export const adsModelEnum = pgEnum("ads_model", values(ADS_MODELS));
export const fovAxisEnum = pgEnum("fov_axis", values(FOV_AXES));
export const conversionMethodEnum = pgEnum("conversion_method", values(CONVERSION_METHODS));
export const userGameSettingSourceEnum = pgEnum(
  "user_game_setting_source",
  values(USER_GAME_SETTING_SOURCES),
);

/* hardware */
export const dpiSourceEnum = pgEnum("dpi_source", values(DPI_SOURCES));
export const gripEnum = pgEnum("grip", values(GRIPS));
export const osFamilyEnum = pgEnum("os_family", values(OS_FAMILIES));

/* sessions */
export const sessionModeEnum = pgEnum("session_mode", values(SESSION_MODES));
export const sessionStatusEnum = pgEnum("session_status", values(SESSION_STATUSES));
export const environmentClassEnum = pgEnum("environment_class", values(ENVIRONMENT_CLASSES));
export const sessionQualityFlagEnum = pgEnum("session_quality_flag", values(SESSION_QUALITY_FLAGS));
export const trialValidityEnum = pgEnum("trial_validity", values(TRIAL_VALIDITIES));
export const invalidReasonEnum = pgEnum("invalid_reason", values(INVALID_REASONS));
export const candidateSourceEnum = pgEnum("candidate_source", values(CANDIDATE_SOURCES));
export const calibrationDecisionEnum = pgEnum(
  "calibration_decision",
  values(CALIBRATION_DECISIONS),
);
export const calibrationVerdictEnum = pgEnum("calibration_verdict", values(CALIBRATION_VERDICTS));
export const driftFormEnum = pgEnum("drift_form", values(DRIFT_FORMS));
export const constraintSourceEnum = pgEnum("constraint_source", values(CONSTRAINT_SOURCES));
export const settingsReliabilityEnum = pgEnum(
  "settings_reliability",
  values(SETTINGS_RELIABILITIES),
);
export const validationVerdictEnum = pgEnum("validation_verdict", values(VALIDATION_VERDICTS));

/* metrics & algorithms */
export const metricDirectionEnum = pgEnum("metric_direction", values(METRIC_DIRECTIONS));
export const metricAggregationEnum = pgEnum("metric_aggregation", values(METRIC_AGGREGATIONS));
export const dimensionKeyEnum = pgEnum("dimension_key", values(DIMENSION_KEYS));
export const algorithmKindEnum = pgEnum("algorithm_kind", values(ALGORITHM_KINDS));
export const testCategoryEnum = pgEnum("test_category", values(TEST_CATEGORIES));

/* telemetry */
export const consentScopeEnum = pgEnum("consent_scope", values(CONSENT_SCOPES));
export const telemetryFormatEnum = pgEnum("telemetry_format", values(TELEMETRY_FORMATS));
