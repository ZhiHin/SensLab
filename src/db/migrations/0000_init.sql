CREATE TYPE "public"."ads_model" AS ENUM('raw_multiplier', 'internally_fov_scaled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."algorithm_kind" AS ENUM('scoring', 'calibration', 'confidence', 'aim_profile', 'reference_distribution');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('password', 'google', 'discord');--> statement-breakpoint
CREATE TYPE "public"."auth_token_purpose" AS ENUM('email_verify', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."calibration_decision" AS ENUM('narrow', 'narrow_conservative', 'shift', 'stop_converged', 'stop_indistinguishable', 'stop_budget', 'stop_quality', 'stop_fatigue');--> statement-breakpoint
CREATE TYPE "public"."calibration_verdict" AS ENUM('peak_found', 'indistinguishable', 'insufficient_data');--> statement-breakpoint
CREATE TYPE "public"."candidate_source" AS ENUM('initial', 'narrowed', 'shifted', 'anchor', 'fine_tune', 'validation_original', 'validation_recommended');--> statement-breakpoint
CREATE TYPE "public"."consent_scope" AS ENUM('raw_telemetry', 'aggregate_research');--> statement-breakpoint
CREATE TYPE "public"."constraint_source" AS ENUM('pad_width', 'measured', 'none');--> statement-breakpoint
CREATE TYPE "public"."conversion_method" AS ENUM('direct', 'focal_length', 'monitor_distance', 'distance_360');--> statement-breakpoint
CREATE TYPE "public"."dimension_key" AS ENUM('flick', 'precision', 'tracking', 'speed', 'control', 'consistency');--> statement-breakpoint
CREATE TYPE "public"."dpi_source" AS ENUM('known', 'assumed', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."drift_form" AS ENUM('spline', 'linear_fallback');--> statement-breakpoint
CREATE TYPE "public"."environment_class" AS ENUM('pass', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."fov_axis" AS ENUM('horizontal', 'vertical');--> statement-breakpoint
CREATE TYPE "public"."game_region" AS ENUM('global', 'cn', 'other');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('supported', 'beta', 'planned', 'retired');--> statement-breakpoint
CREATE TYPE "public"."grip" AS ENUM('palm', 'claw', 'fingertip', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."invalid_reason" AS ENUM('pointer_lock_lost', 'focus_lost', 'frame_hitch', 'timeout', 'impossible_velocity', 'no_input', 'premature_click', 'premature_movement', 'extra_shot', 'button_held_ratio_low', 'insufficient_kills');--> statement-breakpoint
CREATE TYPE "public"."metric_aggregation" AS ENUM('median', 'mean', 'time_weighted_mean', 'proportion', 'rms');--> statement-breakpoint
CREATE TYPE "public"."metric_direction" AS ENUM('higher_better', 'lower_better', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."model_form" AS ENUM('linear_yaw', 'table', 'piecewise');--> statement-breakpoint
CREATE TYPE "public"."motion_preference" AS ENUM('system', 'reduced', 'full');--> statement-breakpoint
CREATE TYPE "public"."os_family" AS ENUM('windows', 'macos', 'linux', 'other');--> statement-breakpoint
CREATE TYPE "public"."scope_key" AS ENUM('hipfire', 'ads', 'x1', 'x2', 'x3', 'x4', 'x6', 'x8');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('quick', 'standard', 'advanced', 'validation', 'fine_tune');--> statement-breakpoint
CREATE TYPE "public"."session_quality_flag" AS ENUM('no_raw_input', 'frame_degradation', 'unstable_pointer_lock', 'long_gap', 'window_resized', 'dpi_inconsistent', 'high_invalid_rate', 'drift_fallback');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('created', 'in_progress', 'paused', 'completed', 'abandoned', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."settings_reliability" AS ENUM('normal', 'estimated_dpi', 'assumed_dpi');--> statement-breakpoint
CREATE TYPE "public"."telemetry_format" AS ENUM('binary_v1');--> statement-breakpoint
CREATE TYPE "public"."test_category" AS ENUM('baseline', 'scored', 'constraint');--> statement-breakpoint
CREATE TYPE "public"."trial_validity" AS ENUM('valid', 'degraded', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."unit_preference" AS ENUM('metric', 'imperial');--> statement-breakpoint
CREATE TYPE "public"."user_game_setting_source" AS ENUM('user_entered', 'from_recommendation');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'pending_deletion');--> statement-breakpoint
CREATE TYPE "public"."validation_verdict" AS ENUM('improved', 'no_measurable_difference', 'worse');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'partial', 'needs_recheck', 'unverified');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" "bytea",
	"user_agent_hash" "bytea"
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"unit_preference" "unit_preference" DEFAULT 'metric' NOT NULL,
	"motion_preference" "motion_preference" DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"deletion_scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hardware_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"name" text NOT NULL,
	"dpi" integer NOT NULL,
	"dpi_source" "dpi_source" DEFAULT 'known' NOT NULL,
	"polling_rate_hz" integer,
	"mouse_model" text,
	"grip" "grip",
	"mousepad_width_mm" integer,
	"mousepad_height_mm" integer,
	"monitor_width_px" integer,
	"monitor_height_px" integer,
	"refresh_rate_hz" integer,
	"os_family" "os_family",
	"windows_pointer_speed" smallint,
	"enhance_pointer_precision" boolean,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "hardware_profiles_dpi_range" CHECK ("hardware_profiles"."dpi" between 100 and 32000),
	CONSTRAINT "hardware_profiles_polling_range" CHECK ("hardware_profiles"."polling_rate_hz" is null or "hardware_profiles"."polling_rate_hz" between 125 and 8000),
	CONSTRAINT "hardware_profiles_refresh_range" CHECK ("hardware_profiles"."refresh_rate_hz" is null or "hardware_profiles"."refresh_rate_hz" between 24 and 1000),
	CONSTRAINT "hardware_profiles_pointer_speed_range" CHECK ("hardware_profiles"."windows_pointer_speed" is null or "hardware_profiles"."windows_pointer_speed" between 1 and 11),
	CONSTRAINT "hardware_profiles_pad_dimensions" CHECK (("hardware_profiles"."mousepad_width_mm" is null or "hardware_profiles"."mousepad_width_mm" between 50 and 2000)
          and ("hardware_profiles"."mousepad_height_mm" is null or "hardware_profiles"."mousepad_height_mm" between 50 and 2000)),
	CONSTRAINT "hardware_profiles_single_owner" CHECK (("hardware_profiles"."user_id" is null) <> ("hardware_profiles"."guest_session_id" is null))
);
--> statement-breakpoint
CREATE TABLE "game_scopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_version_id" uuid NOT NULL,
	"scope_key" "scope_key" NOT NULL,
	"display_name_localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setting_label_localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"magnification" numeric,
	"has_separate_setting" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sensitivity_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_version_id" uuid NOT NULL,
	"scope_key" "scope_key" NOT NULL,
	"model_form" "model_form" NOT NULL,
	"params" jsonb NOT NULL,
	"setting_min" numeric NOT NULL,
	"setting_max" numeric NOT NULL,
	"setting_step" numeric NOT NULL,
	"setting_decimals" smallint NOT NULL,
	"ads_model" "ads_model" DEFAULT 'unknown' NOT NULL,
	"fov_axis" "fov_axis",
	"fov_scaling" text,
	"fov_min" numeric,
	"fov_max" numeric,
	"default_match_criterion" "conversion_method",
	"default_match_coefficient" numeric,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_sensitivity_models_range" CHECK ("game_sensitivity_models"."setting_min" < "game_sensitivity_models"."setting_max"),
	CONSTRAINT "game_sensitivity_models_step_positive" CHECK ("game_sensitivity_models"."setting_step" > 0)
);
--> statement-breakpoint
CREATE TABLE "game_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"effective_from" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_against_build" text,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adapter_module_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_versions_verified_has_evidence" CHECK (("game_versions"."verification_status" not in ('verified','needs_recheck'))
          or ("game_versions"."verified_at" is not null and "game_versions"."verified_against_build" is not null))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"display_name_localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" "game_region" NOT NULL,
	"engine_family" text,
	"status" "game_status" DEFAULT 'supported' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_game_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_version_id" uuid NOT NULL,
	"hardware_profile_id" uuid,
	"scope_key" "scope_key" NOT NULL,
	"sensitivity" numeric NOT NULL,
	"fov_deg" numeric,
	"source" "user_game_setting_source" DEFAULT 'user_entered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aim_profiles" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name_localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rule_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algorithm_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "algorithm_kind" NOT NULL,
	"version_label" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" "bytea" NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"deprecated_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"unit" text NOT NULL,
	"direction" "metric_direction" NOT NULL,
	"aggregation" "metric_aggregation" NOT NULL,
	"description" text NOT NULL,
	"is_decision_metric" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"display_name" text NOT NULL,
	"category" "test_category" NOT NULL,
	"config" jsonb NOT NULL,
	"engine_min_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_index" smallint NOT NULL,
	"candidate_index" smallint NOT NULL,
	"counts_per_360" double precision NOT NULL,
	"cm_per_360" double precision NOT NULL,
	"blind_label" text NOT NULL,
	"source" "candidate_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibration_candidates_counts_positive" CHECK ("calibration_candidates"."counts_per_360" > 0)
);
--> statement-breakpoint
CREATE TABLE "calibration_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_index" smallint NOT NULL,
	"bracket_low" double precision NOT NULL,
	"bracket_high" double precision NOT NULL,
	"fit_b0" double precision,
	"fit_b1" double precision,
	"fit_b2" double precision,
	"fit_r2_adj" double precision,
	"fit_concave" boolean,
	"x_star" double precision,
	"x_star_ci_low" double precision,
	"x_star_ci_high" double precision,
	"drift_form" "drift_form" NOT NULL,
	"drift_delta" double precision NOT NULL,
	"drift_condition_number" double precision NOT NULL,
	"mde" double precision NOT NULL,
	"decision" "calibration_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibration_rounds_bracket_ordered" CHECK ("calibration_rounds"."bracket_low" <= "calibration_rounds"."bracket_high")
);
--> statement-breakpoint
CREATE TABLE "candidate_scores" (
	"candidate_id" uuid NOT NULL,
	"dimension_key" "dimension_key" NOT NULL,
	"score" double precision NOT NULL,
	"se" double precision NOT NULL,
	"n" integer NOT NULL,
	"alpha_hat" double precision,
	"scoring_version_id" uuid NOT NULL,
	CONSTRAINT "candidate_scores_candidate_id_dimension_key_pk" PRIMARY KEY("candidate_id","dimension_key")
);
--> statement-breakpoint
CREATE TABLE "round_metrics" (
	"round_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision NOT NULL,
	"valid_trials" integer NOT NULL,
	"invalid_trials" integer NOT NULL,
	"degraded_trials" integer NOT NULL,
	"robust_sd" double precision,
	"ci_low" double precision,
	"ci_high" double precision,
	CONSTRAINT "round_metrics_round_id_metric_key_pk" PRIMARY KEY("round_id","metric_key"),
	CONSTRAINT "round_metrics_counts_non_negative" CHECK ("round_metrics"."valid_trials" >= 0 and "round_metrics"."invalid_trials" >= 0 and "round_metrics"."degraded_trials" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_quality_flags" (
	"session_id" uuid NOT NULL,
	"flag" "session_quality_flag" NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_quality_flags_session_id_flag_pk" PRIMARY KEY("session_id","flag")
);
--> statement-breakpoint
CREATE TABLE "test_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"candidate_id" uuid,
	"test_definition_id" uuid NOT NULL,
	"scope_key" "scope_key" DEFAULT 'hipfire' NOT NULL,
	"block_index" smallint NOT NULL,
	"presentation_order" integer NOT NULL,
	"is_practice" boolean DEFAULT false NOT NULL,
	"status" "session_status" DEFAULT 'created' NOT NULL,
	"config_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"hardware_profile_id" uuid,
	"hardware_snapshot" jsonb NOT NULL,
	"primary_game_version_id" uuid,
	"mode" "session_mode" NOT NULL,
	"status" "session_status" DEFAULT 'created' NOT NULL,
	"environment" jsonb NOT NULL,
	"environment_class" "environment_class" NOT NULL,
	"seed" bigint NOT NULL,
	"parent_session_id" uuid,
	"scoring_version_id" uuid NOT NULL,
	"calibration_version_id" uuid NOT NULL,
	"confidence_version_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_sessions_single_owner" CHECK (("test_sessions"."user_id" is null) <> ("test_sessions"."guest_session_id" is null)),
	CONSTRAINT "test_sessions_completed_has_timestamp" CHECK ("test_sessions"."status" <> 'completed' or "test_sessions"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "test_trials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"trial_index" smallint NOT NULL,
	"is_practice" boolean DEFAULT false NOT NULL,
	"validity" "trial_validity" NOT NULL,
	"invalid_reason" "invalid_reason",
	"is_replacement" boolean DEFAULT false NOT NULL,
	"start_offset_ms" double precision NOT NULL,
	"duration_ms" double precision NOT NULL,
	"hit" boolean,
	"shots" smallint DEFAULT 0 NOT NULL,
	"target_angular_radius_deg" double precision,
	"target_distance_deg" double precision,
	"target_direction_deg" double precision,
	"stimulus_seed" text NOT NULL,
	"clean_frame_fraction" real NOT NULL,
	"quality_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_trials_invalid_reason_iff_invalid" CHECK (("test_trials"."validity" = 'invalid') = ("test_trials"."invalid_reason" is not null)),
	CONSTRAINT "test_trials_clean_frame_fraction_range" CHECK ("test_trials"."clean_frame_fraction" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "trial_metrics" (
	"trial_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "trial_metrics_trial_id_metric_key_pk" PRIMARY KEY("trial_id","metric_key")
);
--> statement-breakpoint
CREATE TABLE "recommendation_dimension_scores" (
	"recommendation_id" uuid NOT NULL,
	"dimension_key" "dimension_key" NOT NULL,
	"score" real NOT NULL,
	"shape" real NOT NULL,
	"is_provisional" boolean DEFAULT true NOT NULL,
	"n" integer NOT NULL,
	CONSTRAINT "recommendation_dimension_scores_recommendation_id_dimension_key_pk" PRIMARY KEY("recommendation_id","dimension_key")
);
--> statement-breakpoint
CREATE TABLE "recommendation_game_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"game_version_id" uuid NOT NULL,
	"scope_key" "scope_key" NOT NULL,
	"dpi" integer NOT NULL,
	"setting_key" text DEFAULT 'sensitivity' NOT NULL,
	"setting_value" numeric NOT NULL,
	"ideal_setting_value" numeric NOT NULL,
	"achieved_counts_360" double precision NOT NULL,
	"quantisation_error_pct" real NOT NULL,
	"was_clamped" boolean DEFAULT false NOT NULL,
	"fov_deg" numeric,
	"conversion_method" "conversion_method" NOT NULL,
	"conversion_coefficient" real,
	"adapter_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"verdict" "calibration_verdict" NOT NULL,
	"recommended_counts_360" double precision,
	"recommended_cm_360" double precision,
	"hp_range_low_cm360" double precision,
	"hp_range_high_cm360" double precision,
	"hp_range_level" real DEFAULT 0.9 NOT NULL,
	"comfort_range_low_cm360" double precision NOT NULL,
	"comfort_range_high_cm360" double precision NOT NULL,
	"constraint_max_cm360" double precision,
	"constraint_source" "constraint_source" DEFAULT 'none' NOT NULL,
	"confidence_index" smallint NOT NULL,
	"confidence_breakdown" jsonb NOT NULL,
	"settings_reliability" "settings_reliability" NOT NULL,
	"aim_profile_key" text,
	"aim_profile_explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_curve" jsonb NOT NULL,
	"accepted_counts_360" double precision,
	"scoring_version_id" uuid NOT NULL,
	"calibration_version_id" uuid NOT NULL,
	"confidence_version_id" uuid NOT NULL,
	"parent_recommendation_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_peak_has_value" CHECK ("recommendations"."verdict" <> 'peak_found'
          or ("recommendations"."recommended_counts_360" is not null and "recommendations"."recommended_cm_360" is not null)),
	CONSTRAINT "recommendations_comfort_range_ordered" CHECK ("recommendations"."comfort_range_low_cm360" <= "recommendations"."comfort_range_high_cm360"),
	CONSTRAINT "recommendations_ranges_nested" CHECK ("recommendations"."hp_range_low_cm360" is null
          or ("recommendations"."hp_range_low_cm360" >= "recommendations"."comfort_range_low_cm360"
              and "recommendations"."hp_range_high_cm360" <= "recommendations"."comfort_range_high_cm360")),
	CONSTRAINT "recommendations_confidence_range" CHECK ("recommendations"."confidence_index" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "subjective_preferences" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"chosen_candidate_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_metric_deltas" (
	"validation_run_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"delta" double precision NOT NULL,
	"delta_pct" real,
	"ci_low" double precision NOT NULL,
	"ci_high" double precision NOT NULL,
	"is_significant" boolean NOT NULL,
	CONSTRAINT "validation_metric_deltas_validation_run_id_metric_key_pk" PRIMARY KEY("validation_run_id","metric_key"),
	CONSTRAINT "validation_metric_deltas_significance_matches_interval" CHECK ("validation_metric_deltas"."is_significant" = (("validation_metric_deltas"."ci_low" > 0) or ("validation_metric_deltas"."ci_high" < 0)))
);
--> statement-breakpoint
CREATE TABLE "validation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"baseline_counts_360" double precision NOT NULL,
	"candidate_counts_360" double precision NOT NULL,
	"verdict" "validation_verdict" NOT NULL,
	"composite_delta" double precision NOT NULL,
	"composite_ci_low" double precision NOT NULL,
	"composite_ci_high" double precision NOT NULL,
	"block_count" smallint NOT NULL,
	"confidence_before" smallint NOT NULL,
	"confidence_after" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "validation_runs_ci_ordered" CHECK ("validation_runs"."composite_ci_low" <= "validation_runs"."composite_ci_high"),
	CONSTRAINT "validation_runs_verdict_matches_interval" CHECK (("validation_runs"."verdict" = 'improved' and "validation_runs"."composite_ci_low" > 0)
          or ("validation_runs"."verdict" = 'worse' and "validation_runs"."composite_ci_high" < 0)
          or ("validation_runs"."verdict" = 'no_measurable_difference'
              and "validation_runs"."composite_ci_low" <= 0 and "validation_runs"."composite_ci_high" >= 0))
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"event_key" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"guest_session_id" uuid,
	"scope" "consent_scope" NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "research_consents_single_subject" CHECK (("research_consents"."user_id" is null) <> ("research_consents"."guest_session_id" is null))
);
--> statement-breakpoint
CREATE TABLE "telemetry_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" uuid,
	"storage_key" text NOT NULL,
	"format" "telemetry_format" DEFAULT 'binary_v1' NOT NULL,
	"sample_count" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"consent_id" uuid NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardware_profiles" ADD CONSTRAINT "hardware_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardware_profiles" ADD CONSTRAINT "hardware_profiles_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_scopes" ADD CONSTRAINT "game_scopes_game_version_id_game_versions_id_fk" FOREIGN KEY ("game_version_id") REFERENCES "public"."game_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sensitivity_models" ADD CONSTRAINT "game_sensitivity_models_game_version_id_game_versions_id_fk" FOREIGN KEY ("game_version_id") REFERENCES "public"."game_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_versions" ADD CONSTRAINT "game_versions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_settings" ADD CONSTRAINT "user_game_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_settings" ADD CONSTRAINT "user_game_settings_game_version_id_game_versions_id_fk" FOREIGN KEY ("game_version_id") REFERENCES "public"."game_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game_settings" ADD CONSTRAINT "user_game_settings_hardware_profile_id_hardware_profiles_id_fk" FOREIGN KEY ("hardware_profile_id") REFERENCES "public"."hardware_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_candidates" ADD CONSTRAINT "calibration_candidates_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_rounds" ADD CONSTRAINT "calibration_rounds_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_scores" ADD CONSTRAINT "candidate_scores_candidate_id_calibration_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."calibration_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_scores" ADD CONSTRAINT "candidate_scores_scoring_version_id_algorithm_versions_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_metrics" ADD CONSTRAINT "round_metrics_round_id_test_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."test_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_metrics" ADD CONSTRAINT "round_metrics_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_quality_flags" ADD CONSTRAINT "session_quality_flags_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_rounds" ADD CONSTRAINT "test_rounds_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_rounds" ADD CONSTRAINT "test_rounds_candidate_id_calibration_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."calibration_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_rounds" ADD CONSTRAINT "test_rounds_test_definition_id_test_definitions_id_fk" FOREIGN KEY ("test_definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_hardware_profile_id_hardware_profiles_id_fk" FOREIGN KEY ("hardware_profile_id") REFERENCES "public"."hardware_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_primary_game_version_id_game_versions_id_fk" FOREIGN KEY ("primary_game_version_id") REFERENCES "public"."game_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_scoring_version_id_algorithm_versions_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_calibration_version_id_algorithm_versions_id_fk" FOREIGN KEY ("calibration_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_confidence_version_id_algorithm_versions_id_fk" FOREIGN KEY ("confidence_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_trials" ADD CONSTRAINT "test_trials_round_id_test_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."test_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_metrics" ADD CONSTRAINT "trial_metrics_trial_id_test_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."test_trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_metrics" ADD CONSTRAINT "trial_metrics_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_dimension_scores" ADD CONSTRAINT "recommendation_dimension_scores_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_game_settings" ADD CONSTRAINT "recommendation_game_settings_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_game_settings" ADD CONSTRAINT "recommendation_game_settings_game_version_id_game_versions_id_fk" FOREIGN KEY ("game_version_id") REFERENCES "public"."game_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_aim_profile_key_aim_profiles_key_fk" FOREIGN KEY ("aim_profile_key") REFERENCES "public"."aim_profiles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_scoring_version_id_algorithm_versions_id_fk" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_calibration_version_id_algorithm_versions_id_fk" FOREIGN KEY ("calibration_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_confidence_version_id_algorithm_versions_id_fk" FOREIGN KEY ("confidence_version_id") REFERENCES "public"."algorithm_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjective_preferences" ADD CONSTRAINT "subjective_preferences_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjective_preferences" ADD CONSTRAINT "subjective_preferences_chosen_candidate_id_calibration_candidates_id_fk" FOREIGN KEY ("chosen_candidate_id") REFERENCES "public"."calibration_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_metric_deltas" ADD CONSTRAINT "validation_metric_deltas_validation_run_id_validation_runs_id_fk" FOREIGN KEY ("validation_run_id") REFERENCES "public"."validation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_metric_deltas" ADD CONSTRAINT "validation_metric_deltas_metric_key_metric_definitions_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."metric_definitions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_consents" ADD CONSTRAINT "research_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_consents" ADD CONSTRAINT "research_consents_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_round_id_test_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."test_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_batches" ADD CONSTRAINT "telemetry_batches_consent_id_research_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."research_consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_account_unique" ON "auth_identities" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_user_provider_unique" ON "auth_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_active_idx" ON "auth_sessions" USING btree ("expires_at") WHERE "auth_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_unique" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_expiry_idx" ON "guest_sessions" USING btree ("expires_at") WHERE "guest_sessions"."claimed_by_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_counters_pk" ON "rate_limit_counters" USING btree ("bucket","window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_idx" ON "rate_limit_counters" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_profiles_one_default_per_user" ON "hardware_profiles" USING btree ("user_id") WHERE "hardware_profiles"."is_default" and "hardware_profiles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "hardware_profiles_user_idx" ON "hardware_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hardware_profiles_guest_idx" ON "hardware_profiles" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_scopes_version_scope_unique" ON "game_scopes" USING btree ("game_version_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "game_sensitivity_models_version_scope_unique" ON "game_sensitivity_models" USING btree ("game_version_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "game_versions_game_label_unique" ON "game_versions" USING btree ("game_id","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "game_versions_one_current_per_game" ON "game_versions" USING btree ("game_id") WHERE "game_versions"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "games_slug_unique" ON "games" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_game_settings_unique" ON "user_game_settings" USING btree ("user_id","game_version_id","hardware_profile_id","scope_key");--> statement-breakpoint
CREATE INDEX "user_game_settings_user_idx" ON "user_game_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "algorithm_versions_kind_label_unique" ON "algorithm_versions" USING btree ("kind","version_label");--> statement-breakpoint
CREATE UNIQUE INDEX "test_definitions_key_version_unique" ON "test_definitions" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_candidates_unique" ON "calibration_candidates" USING btree ("session_id","round_index","candidate_index");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_rounds_unique" ON "calibration_rounds" USING btree ("session_id","round_index");--> statement-breakpoint
CREATE INDEX "session_quality_flags_flag_idx" ON "session_quality_flags" USING btree ("flag");--> statement-breakpoint
CREATE UNIQUE INDEX "test_rounds_presentation_unique" ON "test_rounds" USING btree ("session_id","presentation_order");--> statement-breakpoint
CREATE INDEX "test_rounds_session_block_idx" ON "test_rounds" USING btree ("session_id","block_index");--> statement-breakpoint
CREATE INDEX "test_rounds_candidate_idx" ON "test_rounds" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "test_sessions_user_started_idx" ON "test_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "test_sessions_guest_idx" ON "test_sessions" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "test_sessions_hardware_started_idx" ON "test_sessions" USING btree ("hardware_profile_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "test_sessions_sweeper_idx" ON "test_sessions" USING btree ("updated_at") WHERE "test_sessions"."status" in ('created','in_progress','paused');--> statement-breakpoint
CREATE UNIQUE INDEX "test_trials_round_index_unique" ON "test_trials" USING btree ("round_id","trial_index");--> statement-breakpoint
CREATE INDEX "test_trials_round_idx" ON "test_trials" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_game_settings_unique" ON "recommendation_game_settings" USING btree ("recommendation_id","game_version_id","scope_key","setting_key","conversion_method");--> statement-breakpoint
CREATE INDEX "recommendation_game_settings_recommendation_idx" ON "recommendation_game_settings" USING btree ("recommendation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_session_unique" ON "recommendations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "recommendations_created_idx" ON "recommendations" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "validation_runs_recommendation_unique" ON "validation_runs" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "analytics_events_key_time_idx" ON "analytics_events" USING btree ("event_key","occurred_at");--> statement-breakpoint
CREATE INDEX "research_consents_subject_idx" ON "research_consents" USING btree ("user_id","scope");--> statement-breakpoint
CREATE INDEX "telemetry_batches_retention_idx" ON "telemetry_batches" USING btree ("retention_expires_at");--> statement-breakpoint
CREATE INDEX "telemetry_batches_session_idx" ON "telemetry_batches" USING btree ("session_id");